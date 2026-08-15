import { getDb } from "@/db/client";
import { getBienById, listerBiensActifsPersistes } from "@/lib/bienRepository";
import { getClientById, listerClientsActifsPersistes } from "@/lib/clientRepository";
import { listerSecteursPourAcquereur, listerSecteursPourAcquereurs } from "@/lib/secteurRechercheRepository";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";
import { evaluerCompatibilite } from "./evaluerCompatibilite";
import { ecrireEtatPaire, verrouillerEtatPaire } from "./etatRepository";
import type { StatutCompatibilite } from "./types";

// Couche métier centrale de détection de transition (ADR-036) — appelée UNIQUEMENT depuis le
// traitement d'une demande de resynchronisation (traitementResynchronisation.ts), jamais
// directement depuis une Server Action. Travaille exclusivement sur des entités persistées
// (listerBiensActifsPersistes/listerClientsActifsPersistes, jamais listerBiens()/listerClients()
// et leur repli mock — voir ces deux fonctions dans bienRepository.ts/clientRepository.ts).
//
// Un nouveau critère ajouté plus tard à evaluerCompatibilite() (src/lib/compatibilite/criteres.ts)
// n'exige AUCUN changement ici : ce module ne connaît que statutGlobal, jamais le détail des
// critères — evaluerCompatibilite() reste l'unique source de vérité appelée.

export type ResultatSynchronisation = {
  pairesTraitees: number;
  evenementsEmis: number;
  erreurs: string[];
};

function categoriserErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message.slice(0, 200);
  return "erreur_inconnue";
}

// Décide et applique la transition pour UNE paire, dans sa propre transaction courte — une paire
// défectueuse n'annule jamais le traitement des autres (même philosophie d'isolation que
// scanTemporel.ts/moteur.ts, ADR-032/033). Verrouille la ligne d'état (protection concurrence,
// §18 de l'addendum) avant de décider : deux synchronisations concurrentes de la même paire
// sérialisent sur ce verrou. `emettreEvenementEtPreparerExecutions` porte son propre backstop
// (index unique partiel sur bien_id/acquereur_id/cycle_compatibilite) — même en cas de faille du
// verrouillage applicatif, Postgres empêche structurellement un doublon d'événement pour le même
// cycle.
//
// Aucune écriture si rien n'a changé (statut ET périmètre identiques à la dernière observation) —
// évite une écriture inutile pour les paires stables (ADR-036, performance).
async function traiterPaire(
  bienId: string,
  acquereurId: string,
  statutObserve: StatutCompatibilite,
  dansPerimetreActif: boolean
): Promise<{ emis: boolean } | { erreur: string }> {
  try {
    const emis = await getDb().transaction(async (tx) => {
      const etatAvant = await verrouillerEtatPaire(bienId, acquereurId, tx);

      const inchange =
        etatAvant !== undefined &&
        etatAvant.dernierStatut === statutObserve &&
        etatAvant.dansPerimetreActif === dansPerimetreActif;
      if (inchange) return false;

      // Formule de transition unifiée (ADR-036, addendum §8) : couvre incompatible/a_verifier →
      // compatible, première observation (aucun état précédent), ET désarchivage avec statut
      // toujours compatible — sans branche spéciale pour aucun de ces cas.
      const effectifAvant = (etatAvant?.dansPerimetreActif ?? false) && etatAvant?.dernierStatut === "compatible";
      const effectifApres = dansPerimetreActif && statutObserve === "compatible";
      const emettre = !effectifAvant && effectifApres;
      const cycleCompatibilite = emettre ? (etatAvant?.cycleCompatibilite ?? 0) + 1 : (etatAvant?.cycleCompatibilite ?? 0);

      await ecrireEtatPaire({ bienId, acquereurId, dernierStatut: statutObserve, dansPerimetreActif, cycleCompatibilite }, tx);

      if (emettre) {
        // idsExecutionsATraiter est toujours vide aujourd'hui (aucune règle ADR-032 ne référence
        // encore ce type d'événement — ADR-037 s'en chargera) : rien à traiter après commit pour
        // ADR-036 lui-même.
        await emettreEvenementEtPreparerExecutions(
          { typeEvenement: "compatibilite_bien_acquereur_devenue_compatible", bienId, acquereurId, cycleCompatibilite },
          tx
        );
      }

      return emettre;
    });
    return { emis };
  } catch (erreur) {
    return { erreur: categoriserErreur(erreur) };
  }
}

// Mutation d'un bien (création, modification, désarchivage — jamais appelée pour un archivage, qui
// bascule dans_perimetre_actif directement sans évaluation, voir etatRepository.ts) : 1 bien × tous
// les acquéreurs actifs persistés, secteurs chargés en une seule requête groupée (ADR-035),
// jamais un fetch IGN ni une requête par paire.
export async function synchroniserCompatibilitesPourBien(bienId: string): Promise<ResultatSynchronisation> {
  const bien = await getBienById(bienId);
  // Garde défensive : normalement jamais appelée pour un bien archivé (voir ci-dessus), mais une
  // course avec un archivage concurrent reste possible entre l'enqueue et le traitement — dans ce
  // cas rien à synchroniser ici, l'archivage a déjà posé dans_perimetre_actif = false lui-même.
  if (!bien || bien.archiveLe) return { pairesTraitees: 0, evenementsEmis: 0, erreurs: [] };

  const acquereurs = await listerClientsActifsPersistes();
  const secteursParAcquereur = await listerSecteursPourAcquereurs(acquereurs.map((a) => a.id));

  let evenementsEmis = 0;
  const erreurs: string[] = [];
  for (const acquereur of acquereurs) {
    const resultat = evaluerCompatibilite(bien, acquereur, secteursParAcquereur.get(acquereur.id) ?? []);
    const traitement = await traiterPaire(bien.id, acquereur.id, resultat.statutGlobal, true);
    if ("erreur" in traitement) {
      console.error(`[compatibilite] échec de synchronisation pour la paire bien=${bien.id} acquereur=${acquereur.id} :`, traitement.erreur);
      erreurs.push(traitement.erreur);
    } else if (traitement.emis) {
      evenementsEmis += 1;
    }
  }
  return { pairesTraitees: acquereurs.length, evenementsEmis, erreurs };
}

// Symétrique côté acquéreur (création, modification, ajout/suppression de secteur, désarchivage) :
// 1 acquéreur × tous les biens actifs persistés, secteurs de ce seul acquéreur chargés une fois.
export async function synchroniserCompatibilitesPourAcquereur(acquereurId: string): Promise<ResultatSynchronisation> {
  const acquereur = await getClientById(acquereurId);
  if (!acquereur || acquereur.archiveLe) return { pairesTraitees: 0, evenementsEmis: 0, erreurs: [] };

  const [biens, secteursRecherche] = await Promise.all([
    listerBiensActifsPersistes(),
    listerSecteursPourAcquereur(acquereurId),
  ]);

  let evenementsEmis = 0;
  const erreurs: string[] = [];
  for (const bien of biens) {
    const resultat = evaluerCompatibilite(bien, acquereur, secteursRecherche);
    const traitement = await traiterPaire(bien.id, acquereur.id, resultat.statutGlobal, true);
    if ("erreur" in traitement) {
      console.error(`[compatibilite] échec de synchronisation pour la paire bien=${bien.id} acquereur=${acquereur.id} :`, traitement.erreur);
      erreurs.push(traitement.erreur);
    } else if (traitement.emis) {
      evenementsEmis += 1;
    }
  }
  return { pairesTraitees: biens.length, evenementsEmis, erreurs };
}
