import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { getCompteRenduVisiteById } from "@/lib/compteRenduVisiteRepository";
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
export function determinerIntentionParDefaut(
  cibleType: TypeCible | undefined,
  typeCandidat: DestinataireCandidat["type"] | undefined,
  faits: Omit<FaitsCommunication, "destinataireNom" | "destinatairePrenom">
): IntentionCommunication {
  if (cibleType === "visite") return "suivi_visite";
  if (cibleType === "offre") return "suivi_acquereur";
  if (cibleType === "compromis") return "message_compromis";
  if (typeCandidat === "acquereur") return "suivi_acquereur";
  return faits.dateRdvEstimation ? "suivi_rdv_estimation" : "relance_prospect_vendeur";
}
