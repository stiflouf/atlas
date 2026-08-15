import { and, eq, max } from "drizzle-orm";
import { getDb } from "@/db/client";
import { compatibilitesBienAcquereurEtat, evenementsMetier } from "@/db/schema";
import { listerBiensActifsPersistes } from "@/lib/bienRepository";
import { listerClientsActifsPersistes } from "@/lib/clientRepository";
import { listerSecteursPourAcquereurs } from "@/lib/secteurRechercheRepository";
import { evaluerCompatibilite } from "./evaluerCompatibilite";
import { ecrireEtatPaire } from "./etatRepository";
import type { StatutCompatibilite } from "./types";

// Outil explicite de baseline/rebuild (ADR-036) — NE PASSE JAMAIS par la sémantique normale de
// transition (synchronisation.ts) : observe l'état courant du moteur canonique et écrit
// directement la mémoire technique, SANS JAMAIS émettre d'événement, créer de tâche ni envoyer
// d'email, quel que soit le statut observé. Réservé à un geste explicite d'opérateur (script/route
// protégée), jamais déclenché automatiquement par une migration ou un déploiement.

export type RapportBaseline = {
  mode: "dry-run" | "apply";
  biensActifs: number;
  acquereursActifs: number;
  pairesEvaluees: number;
  compatibles: number;
  incompatibles: number;
  aVerifier: number;
  etatsEcrits: number;
  evenementsCrees: 0;
  tachesCreees: 0;
  emailsEnvoyes: 0;
};

export type ResultatDemandeBaseline =
  | { statut: "ok"; rapport: RapportBaseline }
  // Refusé (apply uniquement) : la table d'état contient déjà des lignes — une baseline aveugle
  // écraserait les cycles d'un système déjà en fonctionnement (ADR-036, §27). Un rebuild volontaire
  // doit passer explicitement `autoriserEcrasementExistant: true`.
  | { statut: "refuse_table_non_vide"; lignesExistantes: number };

// Cycle de reprise (ADR-036, §28) : un rebuild ne doit jamais pouvoir produire ultérieurement un
// `cycle` déjà utilisé par un événement historique pour la même paire — le cycle repris est donc
// le maximum entre l'état technique déjà présent (s'il existe) et le plus haut cycle jamais observé
// dans evenements_metier pour cette paire précise, jamais recalculé "à zéro" du seul fait que la
// table technique a été perdue.
async function cyclePlancherPourPaire(bienId: string, acquereurId: string): Promise<number> {
  const [ligne] = await getDb()
    .select({ maxCycle: max(evenementsMetier.cycleCompatibilite) })
    .from(evenementsMetier)
    .where(
      and(
        eq(evenementsMetier.typeEvenement, "compatibilite_bien_acquereur_devenue_compatible"),
        eq(evenementsMetier.bienId, bienId),
        eq(evenementsMetier.acquereurId, acquereurId)
      )
    );
  return ligne?.maxCycle ?? 0;
}

async function calculerRapport(mode: "dry-run" | "apply"): Promise<RapportBaseline> {
  const biens = await listerBiensActifsPersistes();
  const acquereurs = await listerClientsActifsPersistes();
  const secteursParAcquereur = await listerSecteursPourAcquereurs(acquereurs.map((a) => a.id));

  let compatibles = 0;
  let incompatibles = 0;
  let aVerifier = 0;
  let etatsEcrits = 0;

  for (const bien of biens) {
    for (const acquereur of acquereurs) {
      const resultat = evaluerCompatibilite(bien, acquereur, secteursParAcquereur.get(acquereur.id) ?? []);
      const statut: StatutCompatibilite = resultat.statutGlobal;
      if (statut === "compatible") compatibles += 1;
      else if (statut === "incompatible") incompatibles += 1;
      else aVerifier += 1;

      if (mode === "apply") {
        const cyclePlancher = statut === "compatible" ? Math.max(1, await cyclePlancherPourPaire(bien.id, acquereur.id)) : 0;
        await ecrireEtatPaire(
          {
            bienId: bien.id,
            acquereurId: acquereur.id,
            dernierStatut: statut,
            dansPerimetreActif: true,
            cycleCompatibilite: cyclePlancher,
          },
          getDb()
        );
      }
      etatsEcrits += 1;
    }
  }

  return {
    mode,
    biensActifs: biens.length,
    acquereursActifs: acquereurs.length,
    pairesEvaluees: biens.length * acquereurs.length,
    compatibles,
    incompatibles,
    aVerifier,
    etatsEcrits: mode === "apply" ? etatsEcrits : 0,
    evenementsCrees: 0,
    tachesCreees: 0,
    emailsEnvoyes: 0,
  };
}

// Lecture seule, n'écrit jamais rien — sûr à appeler à tout moment.
export async function calculerBaselineDryRun(): Promise<RapportBaseline> {
  return calculerRapport("dry-run");
}

// Écrit la mémoire technique. Refuse par défaut si la table contient déjà des lignes (protection
// contre un écrasement accidentel des cycles d'un système déjà en fonctionnement, §27) — passer
// `autoriserEcrasementExistant: true` pour un rebuild volontaire (perte/corruption de la table).
// Idempotent dans les deux cas : un second passage sans changement de données réelles réécrit
// exactement le même résultat (même statut, même cycle plancher), jamais un événement, jamais une
// dégradation.
export async function appliquerBaseline(options: { autoriserEcrasementExistant: boolean }): Promise<ResultatDemandeBaseline> {
  const lignesExistantes = await comptageEtatExistant();
  if (lignesExistantes > 0 && !options.autoriserEcrasementExistant) {
    return { statut: "refuse_table_non_vide", lignesExistantes };
  }
  const rapport = await calculerRapport("apply");
  return { statut: "ok", rapport };
}

async function comptageEtatExistant(): Promise<number> {
  const lignes = await getDb().select({ bienId: compatibilitesBienAcquereurEtat.bienId }).from(compatibilitesBienAcquereurEtat);
  return lignes.length;
}
