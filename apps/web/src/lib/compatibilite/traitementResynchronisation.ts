import { getDb } from "@/db/client";
import {
  listerDemandesEnAttente,
  marquerDemandeEnEchec,
  marquerDemandeTraitee,
  verrouillerDemande,
} from "./resynchronisationRepository";
import { synchroniserCompatibilitesPourAcquereur, synchroniserCompatibilitesPourBien } from "./synchronisation";

export type ResultatTraitementDemande = { traitee: boolean; evenementsEmis: number; erreur?: string };

// Traite UNE demande de resynchronisation (ADR-036) : verrouille la ligne pour toute la durée du
// traitement (la lock n'est relâchée qu'au commit/rollback de cette transaction) — protège contre
// deux traitements concurrents de LA MÊME ligne (le balayage de reprise pendant que le traitement
// immédiat après commit est encore en cours, par exemple) : le second verrouillage bloque puis, une
// fois le premier traitement commité (traitee_le posé), ne trouve plus la ligne (WHERE traitee_le
// IS NULL) et ressort sans rien faire.
//
// Marque la ligne traitée SEULEMENT si aucune paire n'a échoué — un échec partiel laisse la ligne
// éligible au retraitement (jamais un état terminal, voir resynchronisationRepository.ts) : rejouer
// une ligne déjà partiellement synchronisée est sans risque, chaque paire est idempotente.
//
// Appelée aussi bien pour le traitement immédiat après commit (même requête que la mutation
// source) que par le balayage de reprise (/api/compatibilite/scan) — jamais de logique dupliquée
// entre les deux chemins.
export async function traiterDemandeResynchronisation(idDemande: string): Promise<ResultatTraitementDemande> {
  let evenementsEmis = 0;
  let derniereErreur: string | undefined;
  let traitee = false;

  try {
    await getDb().transaction(async (tx) => {
      const demande = await verrouillerDemande(idDemande, tx);
      if (!demande) return; // déjà traitée, ou verrouillée par un traitement concurrent — rien à faire

      const resultat = demande.bienId
        ? await synchroniserCompatibilitesPourBien(demande.bienId)
        : await synchroniserCompatibilitesPourAcquereur(demande.acquereurId!);

      evenementsEmis = resultat.evenementsEmis;

      if (resultat.erreurs.length > 0) {
        derniereErreur = resultat.erreurs.slice(0, 5).join(" | ").slice(0, 500);
        return; // ne marque PAS traitee — reste éligible au retraitement
      }

      await marquerDemandeTraitee(demande.id, tx);
      traitee = true;
    });
  } catch (erreur) {
    derniereErreur = erreur instanceof Error ? erreur.message.slice(0, 200) : "erreur_inconnue";
  }

  if (derniereErreur) {
    console.error(`[compatibilite] resynchronisation ${idDemande} en échec (retraitement ultérieur) :`, derniereErreur);
    await marquerDemandeEnEchec(idDemande, derniereErreur);
  }

  return { traitee, evenementsEmis, erreur: derniereErreur };
}

export type ResultatBalayageResynchronisation = {
  demandesExaminees: number;
  demandesTraitees: number;
  evenementsEmis: number;
};

// Filet de reprise (ADR-036) : traite toutes les demandes encore en attente, la plus ancienne
// d'abord. Idempotent et rejouable — une demande déjà traitée entre-temps (par le chemin
// synchrone) est simplement ignorée par verrouillerDemande(). Isolation par demande : une erreur
// sur l'une n'interrompt jamais le balayage des suivantes (même philosophie que scanTemporel.ts).
export async function balayerResynchronisationsEnAttente(limite = 200): Promise<ResultatBalayageResynchronisation> {
  const demandes = await listerDemandesEnAttente(limite);
  let demandesTraitees = 0;
  let evenementsEmis = 0;

  for (const demande of demandes) {
    const resultat = await traiterDemandeResynchronisation(demande.id);
    if (resultat.traitee) demandesTraitees += 1;
    evenementsEmis += resultat.evenementsEmis;
  }

  return { demandesExaminees: demandes.length, demandesTraitees, evenementsEmis };
}
