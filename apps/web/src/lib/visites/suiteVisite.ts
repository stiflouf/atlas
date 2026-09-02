import { deriverStatutTache, type Tache } from "@/types/tache";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import type { ProfilAcquereur } from "@/types/client";
import type { ProspectVendeur } from "@/types/prospectVendeur";

// VALUE-02 — dérivation des suites d'une visite déjà traitée. Volontairement PAS un nouveau moteur
// et PAS un nouvel enum d'états post-visite : les décisions métier du post-visite existent déjà et
// restent la source de vérité (ADR-041 pour le suivi acquéreur, ADR-042 pour le retour vendeur,
// ADR-044 pour l'offre). Cette fonction ne fait que rendre visibles, sur la fiche visite, les
// parcours déjà prévus — elle n'en invente aucun, n'en contredit aucun, et n'ouvre jamais de route
// nouvelle : chaque action pointe vers un écran qui existait déjà avant VALUE-02.
//
// `retour` (texte libre du conseiller) n'est JAMAIS lu ici : aucune action ne dépend de son
// contenu, aucun parsing, aucune regex de pseudo-compréhension (même frontière qu'EMAIL-DEMO-02).

export type ActionSuiteVisite = {
  cle: string;
  libelle: string;
  href: string;
  // Une seule action mise en avant à la fois — jamais un mur de boutons.
  principale: boolean;
};

export type SuiteVisite = {
  // Phrase factuelle décrivant la situation, dérivée du seul `interet` (donnée structurée).
  raison: string;
  actions: ActionSuiteVisite[];
  prochaineEtape?: string;
  // Tâches actives déjà ouvertes sur ce dossier : ce qui est DÉJÀ planifié, jamais reproposé.
  tachesPlanifiees: Tache[];
  // `true` seulement si la prochaine étape n'est couverte par aucune tâche active — c'est la seule
  // condition qui autorise le bouton de création explicite.
  proposerTacheDepuisProchaineEtape: boolean;
};

// Libellé exact que porterait la tâche créée depuis la prochaine étape. Déterministe et dérivé du
// seul texte persisté : c'est lui qui sert d'identité pour la déduplication, jamais un
// rapprochement approximatif.
export function titreTacheProchaineEtape(prochaineEtape: string): string {
  return prochaineEtape.trim();
}

const RAISON_PAR_INTERET: Record<CompteRenduVisite["interet"], string> = {
  interesse: "L'acquéreur s'est déclaré intéressé à l'issue de la visite.",
  a_reflechir: "L'acquéreur souhaite prendre le temps de réfléchir.",
  pas_interesse: "L'acquéreur ne souhaite pas donner suite à cette visite.",
  inconnu: "Le retour de l'acquéreur n'est pas encore établi.",
};

export function construireSuiteVisite(entrees: {
  acquereur: ProfilAcquereur;
  prospectVendeur?: ProspectVendeur;
  compteRendu: CompteRenduVisite;
  tachesAcquereur: Tache[];
  tachesVendeur: Tache[];
}): SuiteVisite {
  const { acquereur, prospectVendeur, compteRendu, tachesAcquereur, tachesVendeur } = entrees;

  const estActive = (t: Tache) => deriverStatutTache(t) === "a_faire";
  const actives = [...tachesAcquereur, ...tachesVendeur].filter(estActive);
  // La tâche qui PORTE déjà l'axe de suivi, quand elle existe (créée par ADR-041/042 ou par la
  // promotion explicite d'une prochaine étape). C'est elle qui devient la cible de l'action, au
  // lieu d'un CTA de création qui ferait doublon.
  const suiviAcquereur = tachesAcquereur.find(estActive);
  const retourVendeur = tachesVendeur.find(estActive);

  const actions: ActionSuiteVisite[] = [];

  // Suivi acquéreur — jamais proposé pour `pas_interesse` : relancer une personne ayant
  // explicitement décliné n'aide pas le conseiller (même décision qu'ADR-041, jamais rejouée
  // autrement ici).
  if (compteRendu.interet !== "pas_interesse") {
    actions.push(
      suiviAcquereur
        ? {
            cle: "suivi_acquereur",
            libelle: "Préparer la relance",
            // Route existante d'ADR-031 : la préparation d'un message part TOUJOURS d'une tâche,
            // seule porteuse du contexte structuré. Aucune architecture d'envoi parallèle n'est
            // ouverte ici, aucun appel Gmail/OAuth touché.
            href: `/communications/nouveau?tacheId=${suiviAcquereur.id}`,
            principale: true,
          }
        : {
            cle: "suivi_acquereur",
            // Aucune route de préparation de message n'existe sans tâche : le parcours existant
            // pour prévoir ce suivi est /taches/nouveau, prérempli sur l'acquéreur. Libellé honnête
            // sur ce qu'il fait réellement — jamais « préparer un email » vers un écran qui n'en
            // prépare aucun.
            libelle: compteRendu.interet === "a_reflechir" ? "Prévoir une relance douce" : "Prévoir la relance acquéreur",
            href: `/taches/nouveau?acquereurId=${acquereur.id}`,
            principale: true,
          }
    );
  }

  // Retour vendeur — pertinent quelle que soit l'issue, y compris `pas_interesse` (ADR-042 : le
  // vendeur est informé du retour de visite indépendamment de la suite commerciale côté acquéreur).
  // ADR-042 reste seule source de vérité : rien n'est recalculé ici, la tâche qu'elle a produite
  // est simplement rendue actionnable.
  if (retourVendeur) {
    actions.push({
      cle: "retour_vendeur",
      libelle: "Préparer le retour vendeur",
      href: `/communications/nouveau?tacheId=${retourVendeur.id}`,
      principale: actions.length === 0,
    });
  } else if (prospectVendeur) {
    // Automatisation inactive (ou tâche déjà traitée) : le parcours reste accessible via la
    // planification existante. Aucune tâche n'est créée ici, aucune règle n'est activée.
    actions.push({
      cle: "retour_vendeur",
      libelle: "Prévoir le retour vendeur",
      href: `/taches/nouveau?prospectVendeurId=${prospectVendeur.id}`,
      principale: actions.length === 0,
    });
  }
  // Aucun prospect vendeur rattaché au bien : aucun destinataire vendeur structuré n'existe, donc
  // aucune action vendeur n'est affichée — jamais un lien construit à l'aveugle.

  // « Créer une offre » n'est volontairement PAS repris ici : ce CTA existe déjà juste au-dessus,
  // porté par ADR-044, et le dupliquer afficherait deux fois le même bouton sur le même écran.
  // Ce bloc n'en propose donc jamais après un refus explicite ; le lien ADR-044, lui, reste
  // inchangé et non conditionné à `interet` — décision antérieure explicite et testée (un
  // acquéreur peut formuler une offre malgré un `interet` déjà saisi), non rouverte ici.

  const prochaineEtape = compteRendu.prochaineEtape?.trim() || undefined;
  const titreAttendu = prochaineEtape ? titreTacheProchaineEtape(prochaineEtape) : undefined;
  // Identité métier : une tâche ACTIVE de cet acquéreur portant exactement le libellé que la
  // création produirait. Le libellé étant dérivé du texte persisté, la comparaison est une égalité
  // stricte sur une valeur déterministe, jamais un rapprochement flou.
  const tacheProchaineEtapeExiste =
    titreAttendu !== undefined && tachesAcquereur.some((t) => estActive(t) && t.titre === titreAttendu);

  return {
    raison: RAISON_PAR_INTERET[compteRendu.interet],
    actions,
    prochaineEtape,
    tachesPlanifiees: actives,
    proposerTacheDepuisProchaineEtape: prochaineEtape !== undefined && !tacheProchaineEtapeExiste,
  };
}
