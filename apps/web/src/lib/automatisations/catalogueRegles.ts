import { getProspectVendeurById } from "@/lib/prospectVendeurRepository";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { listerSecteursPourAcquereur } from "@/lib/secteurRechercheRepository";
import { listerOffresPourBien } from "@/lib/offreRepository";
import { listerCompromisPourBien } from "@/lib/compromisRepository";
import { evaluerCompatibilite } from "@/lib/compatibilite/evaluerCompatibilite";
import { existeExecutionAvecTacheOuvertePourPaire } from "./executionAutomatisationRepository";
import type { ChampsTacheAutomatique, CodeRegleAutomatisation, EvenementMetier, TypeEvenementMetier } from "@/types/automatisation";

// Catalogue de règles déterministes (ADR-032) — versionné et testé en code (pas de constructeur
// no-code en V1, pas de règles en base : seule leur ACTIVATION vit en base,
// configurations_automatisation). Chaque règle ne peut produire qu'une tâche (ChampsTacheAutomatique
// est structurellement monomorphe — aucun champ "actionType" générique, voir point 16 de l'audit) :
// étendre le moteur à une autre catégorie d'action nécessiterait de changer ce type lui-même, pas
// d'ajouter un cas dans un switch.
export type ReglAutomatisation = {
  code: CodeRegleAutomatisation;
  nom: string;
  description: string;
  typeEvenement: TypeEvenementMetier;
  // Peut lire (jamais écrire) via les repositories existants pour enrichir la tâche produite ;
  // `undefined` = la règle décide de ne rien produire pour ce cas précis (aucune des 4 règles V1
  // n'utilise cette branche aujourd'hui, mais elle reste honnête plutôt que de forcer une tâche).
  construireTache: (evenement: EvenementMetier) => Promise<ChampsTacheAutomatique | undefined>;
};

export const CATALOGUE_REGLES_AUTOMATISATION: ReglAutomatisation[] = [
  {
    code: "suivi_apres_visite",
    nom: "Suivi après visite",
    description: "Crée une tâche de suivi lorsqu'une visite est marquée réalisée.",
    typeEvenement: "visite_realisee",
    construireTache: async (evenement) => {
      if (!evenement.compteRenduVisiteId) return undefined;
      return {
        titre: "Faire le suivi de la visite",
        type: "relance",
        priorite: "normale",
        cible: { type: "visite", id: evenement.compteRenduVisiteId },
      };
    },
  },
  {
    code: "suivi_apres_rdv_estimation",
    nom: "Suivi après RDV estimation",
    description: "Crée une tâche de suivi lorsqu'un rendez-vous d'estimation est marqué réalisé.",
    typeEvenement: "rdv_estimation_realise",
    construireTache: async (evenement) => {
      if (!evenement.prospectVendeurId) return undefined;
      return {
        titre: "Faire le suivi de l'estimation",
        type: "relance",
        priorite: "normale",
        cible: { type: "prospectVendeur", id: evenement.prospectVendeurId },
      };
    },
  },
  {
    code: "preparation_apres_mandat",
    nom: "Préparation après signature du mandat",
    description: "Crée une tâche de lancement de commercialisation lorsqu'un mandat est signé.",
    typeEvenement: "mandat_signe",
    construireTache: async (evenement) => {
      if (!evenement.prospectVendeurId) return undefined;
      const prospect = await getProspectVendeurById(evenement.prospectVendeurId);
      if (!prospect?.bienId) return undefined;
      return {
        titre: "Lancer la commercialisation du bien",
        type: "autre",
        priorite: "normale",
        cible: { type: "bien", id: prospect.bienId },
      };
    },
  },
  {
    code: "preparation_dossier_notaire_apres_compromis",
    nom: "Préparation du dossier notaire après compromis",
    description: "Crée une tâche de préparation du dossier notaire lorsqu'un compromis est signé.",
    typeEvenement: "compromis_signe",
    construireTache: async (evenement) => {
      if (!evenement.compromisId) return undefined;
      return {
        titre: "Préparer le dossier pour le notaire",
        type: "document",
        priorite: "normale",
        cible: { type: "compromis", id: evenement.compromisId },
      };
    },
  },
  {
    code: "inactivite_prospect_vendeur",
    nom: "Relance après période sans contact",
    description: "Crée une tâche de relance lorsqu'un prospect vendeur actif n'a connu aucune interaction depuis le seuil configuré (ADR-033).",
    typeEvenement: "inactivite_prospect_vendeur",
    // Aucun blocage sur une éventuelle tâche automatique déjà ouverte d'un cycle précédent
    // (ADR-033, décision validée) : un vrai nouveau contact change l'ancre du cycle et ouvre une
    // occurrence métier à part entière, qui ne doit jamais être perdue au prétexte qu'une ancienne
    // relance traîne encore. L'idempotence porte sur le cycle (voir evenementMetierRepository.ts),
    // jamais sur l'historique complet des relances du prospect.
    construireTache: async (evenement) => {
      if (!evenement.prospectVendeurId) return undefined;
      const prospect = await getProspectVendeurById(evenement.prospectVendeurId);
      if (!prospect) return undefined;
      const contact = prospect.prenom ? `${prospect.prenom} ${prospect.nom}` : prospect.nom;
      return {
        titre: `Relancer ${contact}`,
        type: "relance",
        priorite: "normale",
        cible: { type: "prospectVendeur", id: evenement.prospectVendeurId },
      };
    },
  },
  {
    code: "nouveau_match_bien_acquereur",
    nom: "Nouveau match Bien × Acquéreur",
    description: "Crée une tâche de contact lorsqu'une paire bien/acquéreur devient compatible (ADR-036/037).",
    typeEvenement: "compatibilite_bien_acquereur_devenue_compatible",
    // Revalidation complète au moment de l'exécution (ADR-037) — jamais dans le synchroniseur
    // ADR-036, qui reste totalement indépendant de toute conséquence commerciale. L'événement
    // signifie uniquement "cette paire est devenue compatible à un instant donné", jamais "produire
    // une tâche quelle que soit la situation actuelle" : chaque garde ci-dessous retourne
    // `undefined` pour un cas métier honnête ("l'effet n'est plus pertinent"), jamais une erreur —
    // seule une exception réellement inattendue (DB indisponible, etc.) continue de remonter et de
    // faire échouer l'exécution (ADR-032, marquée `echouee`), jamais confondue avec ces cas.
    // `evaluerCompatibilite()` (ADR-034/035) reste l'unique source de vérité relue ici — jamais
    // `compatibilites_bien_acquereur_etat` (mémoire technique ADR-036, jamais une vérité métier).
    construireTache: async (evenement) => {
      if (!evenement.bienId || !evenement.acquereurId) return undefined;
      const { bienId, acquereurId } = evenement;

      const [bien, acquereur] = await Promise.all([getBienById(bienId), getClientById(acquereurId)]);
      if (!bien || !acquereur) return undefined; // entité introuvable — jamais de retry infini
      if (bien.archiveLe || acquereur.archiveLe) return undefined; // sorti du périmètre commercial actif

      const secteurs = await listerSecteursPourAcquereur(acquereurId);
      const resultat = evaluerCompatibilite(bien, acquereur, secteurs);
      if (resultat.statutGlobal !== "compatible") return undefined; // redevenu incompatible/à vérifier

      // Relation commerciale déjà avancée pour cette paire précise (ADR-037) — règle minimale sûre,
      // jamais une machine d'état inventée : une offre encore "en_cours", ou un compromis
      // "en_cours"/"realise", représentent une opportunité déjà activement engagée par un autre
      // chemin ; un compromis "annule" ne bloque jamais indéfiniment un futur cycle légitime.
      // Aucune vérification sur les comptes rendus de visite : ce modèle ne porte aucune notion de
      // visite "programmée/en cours" (uniquement des rapports déjà réalisés, après coup) — bloquer
      // sur un ancien rapport créerait une interdiction éternelle non voulue, sans signal fiable
      // pour la borner. Limite assumée et documentée (docs/KNOWN_LIMITATIONS.md), jamais un état
      // inventé.
      const [offres, compromisListe] = await Promise.all([listerOffresPourBien(bienId), listerCompromisPourBien(bienId)]);
      const offreEnCours = offres.some((o) => o.acquereurId === acquereurId && o.statut === "en_cours");
      if (offreEnCours) return undefined;
      const compromisAvance = compromisListe.some(
        (c) => c.acquereurId === acquereurId && (c.statut === "en_cours" || c.statut === "realise")
      );
      if (compromisAvance) return undefined;

      // Anti-spam inter-cycle — distinct de l'idempotence ADR-032 (UNIQUE(regle_code,
      // evenement_id), déjà garantie par ailleurs) : ne crée jamais une seconde tâche ouverte pour
      // la même paire tant qu'une précédente (d'un cycle antérieur) n'a pas été résolue par le
      // conseiller. Jamais une analyse de texte de tâche — uniquement la provenance structurée
      // ADR-032 déjà réelle (executions_automatisation -> evenements_metier/taches).
      const dejaUneTacheOuverte = await existeExecutionAvecTacheOuvertePourPaire("nouveau_match_bien_acquereur", bienId, acquereurId);
      if (dejaUneTacheOuverte) return undefined;

      return {
        titre: `Nouveau match — contacter ${acquereur.prenom} ${acquereur.nom} pour ${bien.reference}`,
        contexte: "Atlas a détecté une nouvelle compatibilité avec ce bien. Vérifier les critères puis contacter l'acquéreur si pertinent.",
        type: "appel",
        priorite: "normale",
        cible: { type: "acquereur", id: acquereurId },
      };
    },
  },
];

export const LABEL_REGLE_AUTOMATISATION: Record<CodeRegleAutomatisation, string> = Object.fromEntries(
  CATALOGUE_REGLES_AUTOMATISATION.map((r) => [r.code, r.nom])
) as Record<CodeRegleAutomatisation, string>;

export function trouverRegle(code: CodeRegleAutomatisation): ReglAutomatisation | undefined {
  return CATALOGUE_REGLES_AUTOMATISATION.find((r) => r.code === code);
}

export function reglesPourTypeEvenement(typeEvenement: TypeEvenementMetier): ReglAutomatisation[] {
  return CATALOGUE_REGLES_AUTOMATISATION.filter((r) => r.typeEvenement === typeEvenement);
}
