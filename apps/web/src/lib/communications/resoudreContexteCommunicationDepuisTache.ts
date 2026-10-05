import { getBienDuWorkspace } from "@/lib/bienRepository";
import { getAcquereurDuWorkspace } from "@/lib/clientRepository";
import { getCompteRenduVisiteById } from "@/lib/compteRenduVisiteRepository";
import { getCompromisById } from "@/lib/compromisRepository";
import { getEvenementMetierById } from "@/lib/automatisations/evenementMetierRepository";
import { getExecutionAutomatisationParTacheId } from "@/lib/automatisations/executionAutomatisationRepository";
import { getOffreById } from "@/lib/offreRepository";
import { getProspectVendeurDuWorkspace } from "@/lib/prospectVendeurRepository";
import { LABEL_INTERET } from "@/types/compteRenduVisite";
import { deriverCibleTache, type Tache, type TypeCible } from "@/types/tache";
import {
  type DestinataireCandidat,
  type FaitsCommunication,
  type IntentionCommunication,
} from "./contexteCommunication";
import { resoudreContactActif } from "@/lib/contactRepository";
import {
  resoudreDestinatairesDepuisBien,
  versCandidatAcquereur,
  versCandidatContact,
  versCandidatProspectVendeur,
} from "./destinataireCommunication";

export type ContexteCommunicationTache = {
  cibleType?: TypeCible;
  candidats: DestinataireCandidat[];
  faits: Omit<FaitsCommunication, "destinataireNom" | "destinatairePrenom">;
};

function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Point d'entrée principal (ADR-031, correction n°1) : suit UNIQUEMENT les FK/relations métier
// déjà réelles de la tâche (deriverCibleTache, ADR-028) — jamais titre/contexte (texte libre) pour
// deviner une personne. Retourne 0, 1 ou plusieurs candidats ; jamais tranché arbitrairement ici,
// l'appelant présente un choix humain si `candidats.length > 1`.
// GLOBAL_READER_GUARD_EXTENSION_V1 — toutes les lectures de ce module passent désormais par des
// readers SCOPÉS. Les identifiants dérivent d'une tâche déjà prouvée dans le périmètre, donc la
// dérivation était défendable ; mais `workspaceId` est là, en paramètre, et une chaîne explicite
// vaut mieux qu'un raisonnement à refaire à chaque relecture — surtout dans un module qui vivait
// hors de portée de la garde.
export async function resoudreContexteCommunicationDepuisTache(tache: Tache, workspaceId: string): Promise<ContexteCommunicationTache> {
  const cible = deriverCibleTache(tache);
  const base = { tacheContexte: tache.contexte };
  if (!cible) return { candidats: [], faits: base };

  switch (cible.type) {
    case "prospectVendeur": {
      const p = await getProspectVendeurDuWorkspace(cible.id, workspaceId);
      if (!p) return { cibleType: cible.type, candidats: [], faits: base };
      const bien = p.bienId ? await getBienDuWorkspace(p.bienId, workspaceId) : undefined;

      // ADR-042/043 — distingué par origineCode (identifiant machine stable, ADR-028), jamais par
      // le seul cibleType : une tâche prospectVendeur manuelle ou issue d'une autre règle (mandat
      // signé, inactivité) garde son comportement générique ci-dessous, inchangé. Seule la tâche
      // produite par `retour_vendeur_apres_visite` porte les faits d'une visite (date, intérêt).
      //
      // Pour une communication issue d'une tâche automatique événementielle, les faits historiques
      // sont résolus depuis l'ÉVÉNEMENT EXACT ayant créé la tâche (tache -> execution -> evenement
      // -> compte rendu), jamais depuis « l'objet le plus récent » de la cible (ADR-043 — corrige
      // ADR-042, qui listait les comptes rendus du bien et prenait le plus récent : deux visites
      // successives du même bien contaminaient alors la tâche la plus ancienne avec les faits de la
      // plus récente). Fail-closed : tout maillon manquant (aucune exécution retrouvée, événement
      // d'un type différent, compte rendu introuvable) laisse les faits de visite absents — jamais
      // un repli sur un autre compte rendu du bien.
      if (tache.origineCode === "retour_vendeur_apres_visite" && bien) {
        const execution = await getExecutionAutomatisationParTacheId(tache.id);
        const evenement = execution ? await getEvenementMetierById(execution.evenementId) : undefined;
        const compteRenduExact =
          evenement?.typeEvenement === "visite_realisee" && evenement.compteRenduVisiteId
            ? await getCompteRenduVisiteById(evenement.compteRenduVisiteId, workspaceId)
            : undefined;
        return {
          cibleType: cible.type,
          candidats: [versCandidatProspectVendeur(p)],
          faits: {
            ...base,
            bienAdresse: bien.adresse,
            dateVisite: compteRenduExact ? formatDateFr(compteRenduExact.dateVisite) : undefined,
            interetVisiteValeur: compteRenduExact?.interet,
          },
        };
      }

      return {
        cibleType: cible.type,
        candidats: [versCandidatProspectVendeur(p)],
        faits: {
          ...base,
          bienAdresse: bien?.adresse ?? p.adresseBienPotentiel,
          dateRdvEstimation: p.rdvEstimationRealiseLe ? formatDateFr(p.rdvEstimationRealiseLe) : undefined,
          // Une proposition encore en attente de réponse — signée, elle n'a plus à être relancée.
          mandatPropose: Boolean(p.mandatProposeLe) && !p.mandatSigneLe,
        },
      };
    }

    case "acquereur": {
      const a = await getAcquereurDuWorkspace(cible.id, workspaceId);
      return { cibleType: cible.type, candidats: a ? [versCandidatAcquereur(a)] : [], faits: base };
    }

    case "visite": {
      const visite = await getCompteRenduVisiteById(cible.id, workspaceId);
      if (!visite) return { cibleType: cible.type, candidats: [], faits: base };
      const [a, bien] = await Promise.all([getAcquereurDuWorkspace(visite.acquereurId, workspaceId), getBienDuWorkspace(visite.bienId, workspaceId)]);
      return {
        cibleType: cible.type,
        candidats: a ? [versCandidatAcquereur(a)] : [],
        faits: {
          ...base,
          bienAdresse: bien?.adresse,
          dateVisite: formatDateFr(visite.dateVisite),
          interetVisite: LABEL_INTERET[visite.interet],
        },
      };
    }

    case "offre": {
      const offre = await getOffreById(cible.id, workspaceId);
      if (!offre) return { cibleType: cible.type, candidats: [], faits: base };
      const [a, bien] = await Promise.all([getAcquereurDuWorkspace(offre.acquereurId, workspaceId), getBienDuWorkspace(offre.bienId, workspaceId)]);
      return {
        cibleType: cible.type,
        candidats: a ? [versCandidatAcquereur(a)] : [],
        faits: { ...base, bienAdresse: bien?.adresse, montantOffre: offre.montant, dateOffre: formatDateFr(offre.dateOffre) },
      };
    }

    case "compromis": {
      const compromis = await getCompromisById(cible.id, workspaceId);
      if (!compromis) return { cibleType: cible.type, candidats: [], faits: base };
      const [a, bien] = await Promise.all([getAcquereurDuWorkspace(compromis.acquereurId, workspaceId), getBienDuWorkspace(compromis.bienId, workspaceId)]);
      return {
        cibleType: cible.type,
        candidats: a ? [versCandidatAcquereur(a)] : [],
        faits: {
          ...base,
          bienAdresse: bien?.adresse,
          prixConvenuCompromis: compromis.prixConvenu,
          dateActeCompromis: compromis.dateActe ? formatDateFr(compromis.dateActe) : undefined,
        },
      };
    }

    case "bien": {
      const [candidats, bien] = await Promise.all([
        resoudreDestinatairesDepuisBien(cible.id, workspaceId),
        getBienDuWorkspace(cible.id, workspaceId),
      ]);
      return { cibleType: cible.type, candidats, faits: { ...base, bienAdresse: bien?.adresse } };
    }

    // TASK_CONTACT_TARGET_V1 (ADR-064) — une tâche rattachée au SEUL contact se suffit : aucun
    // acquéreur, aucun prospect vendeur, aucun bien n'est exigé pour obtenir un destinataire.
    //
    // `resoudreContactActif` est la primitive EXISTANTE de résolution de l'identité effective
    // (ADR-059) : elle suit la chaîne de fusion jusqu'au survivant, dans le périmètre, et la logique
    // de fusion n'est donc pas réécrite ici. Une tâche posée sur A avant que A ne soit absorbé par B
    // propose B — jamais une identité dont l'historique continue ailleurs.
    //
    // Les deux issues non résolues (`introuvable` hors périmètre ou id inconnu, `chaine_invalide`
    // cycle ou maillon manquant) rendent ZÉRO candidat : aucun destinataire inventé, aucune adresse
    // reprise d'un dossier (ADR-057). `faits` reste vide — un contact ne porte, par construction,
    // aucune donnée de projet (ADR-055 §A) : il n'y a rien de factuel à joindre au message.
    case "contact": {
      const resolution = await resoudreContactActif(cible.id, workspaceId);
      return {
        cibleType: cible.type,
        candidats: resolution.statut === "actif" ? [versCandidatContact(resolution.contact)] : [],
        faits: base,
      };
    }

    case "remuneration":
      // Aucune relation structurée directe vers une personne n'est câblée depuis une rémunération
      // (remunerationRepository n'expose aucun lookup par id de rémunération) — non ajouté ici,
      // périmètre non demandé par ADR-031.
      return { cibleType: cible.type, candidats: [], faits: base };

    default:
      return { candidats: [], faits: base };
  }
}

// Intention par défaut UNIQUEMENT une fois le destinataire choisi (auto si unique, sinon après le
// choix humain) — jamais fixée avant, car pour une cible `bien` le candidat retenu (vendeur ou
// acquéreur) détermine seul quel message a du sens.
//
// `origineCode` (ADR-042) tranche AVANT tout le reste pour une cible prospectVendeur : seule la
// tâche produite par la règle `retour_vendeur_apres_visite` doit recevoir cette intention dédiée —
// jamais "toute tâche prospectVendeur" (une tâche manuelle ou issue de mandat_signe/inactivité
// garde son intention générique existante, inchangée).
export function determinerIntentionParDefaut(
  cibleType: TypeCible | undefined,
  typeCandidat: DestinataireCandidat["type"] | undefined,
  faits: Omit<FaitsCommunication, "destinataireNom" | "destinatairePrenom">,
  origineCode?: string
): IntentionCommunication {
  if (origineCode === "retour_vendeur_apres_visite") return "retour_vendeur_apres_visite";
  // TASK_CONTACT_TARGET_V1 (ADR-064) — AVANT le repli final, et sur le TYPE DE CIBLE : le repli
  // historique (`relance_prospect_vendeur`) parle d'un projet de vente, ce qu'une tâche ciblant une
  // personne n'affirme nulle part. La seule intention honnête ici n'affirme rien.
  if (cibleType === "contact") return "message_contact";
  if (cibleType === "visite") return "suivi_visite";
  if (cibleType === "offre") return "suivi_acquereur";
  if (cibleType === "compromis") return "message_compromis";
  if (typeCandidat === "acquereur") return "suivi_acquereur";
  return faits.dateRdvEstimation ? "suivi_rdv_estimation" : "relance_prospect_vendeur";
}
