import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { getCompteRenduVisiteById, listerComptesRendusPourBien } from "@/lib/compteRenduVisiteRepository";
import { getCompromisById } from "@/lib/compromisRepository";
import { getOffreById } from "@/lib/offreRepository";
import { getProspectVendeurById } from "@/lib/prospectVendeurRepository";
import { LABEL_INTERET } from "@/types/compteRenduVisite";
import { deriverCibleTache, type Tache, type TypeCible } from "@/types/tache";
import {
  type DestinataireCandidat,
  type FaitsCommunication,
  type IntentionCommunication,
} from "./contexteCommunication";
import { resoudreDestinatairesDepuisBien, versCandidatAcquereur, versCandidatProspectVendeur } from "./destinataireCommunication";

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
export async function resoudreContexteCommunicationDepuisTache(tache: Tache): Promise<ContexteCommunicationTache> {
  const cible = deriverCibleTache(tache);
  const base = { tacheContexte: tache.contexte };
  if (!cible) return { candidats: [], faits: base };

  switch (cible.type) {
    case "prospectVendeur": {
      const p = await getProspectVendeurById(cible.id);
      if (!p) return { cibleType: cible.type, candidats: [], faits: base };
      const bien = p.bienId ? await getBienById(p.bienId) : undefined;

      // ADR-042 — distingué par origineCode (identifiant machine stable, ADR-028), jamais par le
      // seul cibleType : une tâche prospectVendeur manuelle ou issue d'une autre règle (mandat
      // signé, inactivité) garde son comportement générique ci-dessous, inchangé. Seule la tâche
      // produite par `retour_vendeur_apres_visite` porte les faits d'une visite (date, intérêt) —
      // dérivés du compte rendu le plus RÉCENT du bien (aucune seconde cible structurée possible
      // sur une tâche mono-cible, ADR-028 ; limite documentée si une autre visite survient entre
      // la création de la tâche et sa résolution ici).
      if (tache.origineCode === "retour_vendeur_apres_visite" && bien) {
        const comptesRendus = await listerComptesRendusPourBien(bien.id);
        const compteRenduRecent = comptesRendus[0];
        return {
          cibleType: cible.type,
          candidats: [versCandidatProspectVendeur(p)],
          faits: {
            ...base,
            bienAdresse: bien.adresse,
            dateVisite: compteRenduRecent ? formatDateFr(compteRenduRecent.dateVisite) : undefined,
            interetVisiteValeur: compteRenduRecent?.interet,
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
        },
      };
    }

    case "acquereur": {
      const a = await getClientById(cible.id);
      return { cibleType: cible.type, candidats: a ? [versCandidatAcquereur(a)] : [], faits: base };
    }

    case "visite": {
      const visite = await getCompteRenduVisiteById(cible.id);
      if (!visite) return { cibleType: cible.type, candidats: [], faits: base };
      const [a, bien] = await Promise.all([getClientById(visite.acquereurId), getBienById(visite.bienId)]);
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
      const offre = await getOffreById(cible.id);
      if (!offre) return { cibleType: cible.type, candidats: [], faits: base };
      const [a, bien] = await Promise.all([getClientById(offre.acquereurId), getBienById(offre.bienId)]);
      return {
        cibleType: cible.type,
        candidats: a ? [versCandidatAcquereur(a)] : [],
        faits: { ...base, bienAdresse: bien?.adresse, montantOffre: offre.montant, dateOffre: formatDateFr(offre.dateOffre) },
      };
    }

    case "compromis": {
      const compromis = await getCompromisById(cible.id);
      if (!compromis) return { cibleType: cible.type, candidats: [], faits: base };
      const [a, bien] = await Promise.all([getClientById(compromis.acquereurId), getBienById(compromis.bienId)]);
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
      const [candidats, bien] = await Promise.all([resoudreDestinatairesDepuisBien(cible.id), getBienById(cible.id)]);
      return { cibleType: cible.type, candidats, faits: { ...base, bienAdresse: bien?.adresse } };
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
  if (cibleType === "visite") return "suivi_visite";
  if (cibleType === "offre") return "suivi_acquereur";
  if (cibleType === "compromis") return "message_compromis";
  if (typeCandidat === "acquereur") return "suivi_acquereur";
  return faits.dateRdvEstimation ? "suivi_rdv_estimation" : "relance_prospect_vendeur";
}
