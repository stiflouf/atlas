import { and, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { compatibilitesBienAcquereurEtat } from "@/db/schema";
import type { StatutCompatibilite } from "./types";

type LigneEtat = typeof compatibilitesBienAcquereurEtat.$inferSelect;

// Mémoire technique de dernière observation (ADR-036) — jamais la source de vérité du matching,
// jamais affichée telle quelle : seule evaluerCompatibilite() décide qu'une paire est compatible.
export type EtatCompatibilite = {
  bienId: string;
  acquereurId: string;
  dernierStatut: StatutCompatibilite;
  dansPerimetreActif: boolean;
  cycleCompatibilite: number;
  observeLe: string;
};

function ligneVersEtat(ligne: LigneEtat): EtatCompatibilite {
  return {
    bienId: ligne.bienId,
    acquereurId: ligne.acquereurId,
    dernierStatut: ligne.dernierStatut as StatutCompatibilite,
    dansPerimetreActif: ligne.dansPerimetreActif,
    cycleCompatibilite: ligne.cycleCompatibilite,
    observeLe: ligne.observeLe.toISOString(),
  };
}

// Verrouille (ou constate l'absence de) la ligne d'état technique d'une paire — DOIT être appelée à
// l'intérieur d'une transaction, jamais seule : c'est ce verrou qui sérialise deux synchronisations
// concurrentes de la même paire (même patron que verrouillerExecutionATraiter, ADR-032).
// undefined = paire jamais observée (aucun état précédent) — pas une erreur.
export async function verrouillerEtatPaire(
  bienId: string,
  acquereurId: string,
  executeur: Executeur
): Promise<EtatCompatibilite | undefined> {
  const [ligne] = await executeur
    .select()
    .from(compatibilitesBienAcquereurEtat)
    .where(and(eq(compatibilitesBienAcquereurEtat.bienId, bienId), eq(compatibilitesBienAcquereurEtat.acquereurId, acquereurId)))
    .for("update");
  return ligne ? ligneVersEtat(ligne) : undefined;
}

// Upsert de l'état technique après décision de transition — appelée après verrouillerEtatPaire()
// dans la même transaction (baseline/rebuild exceptés, qui écrivent directement sans lecture de
// transition). Clé du upsert = la PK composite (bienId, acquereurId).
export async function ecrireEtatPaire(
  input: {
    bienId: string;
    acquereurId: string;
    dernierStatut: StatutCompatibilite;
    dansPerimetreActif: boolean;
    cycleCompatibilite: number;
  },
  executeur: Executeur
): Promise<void> {
  await executeur
    .insert(compatibilitesBienAcquereurEtat)
    .values({
      bienId: input.bienId,
      acquereurId: input.acquereurId,
      dernierStatut: input.dernierStatut,
      dansPerimetreActif: input.dansPerimetreActif,
      cycleCompatibilite: input.cycleCompatibilite,
    })
    .onConflictDoUpdate({
      target: [compatibilitesBienAcquereurEtat.bienId, compatibilitesBienAcquereurEtat.acquereurId],
      set: {
        dernierStatut: input.dernierStatut,
        dansPerimetreActif: input.dansPerimetreActif,
        cycleCompatibilite: input.cycleCompatibilite,
        observeLe: new Date(),
      },
    });
}

// Archivage (ADR-036) : bascule dans_perimetre_actif = false pour TOUTES les paires déjà observées
// d'une entité, sans jamais appeler evaluerCompatibilite() — un simple UPDATE déterministe, sans
// risque d'échec lié aux données, exécuté DANS LA MÊME transaction que l'archivage lui-même (jamais
// via le handoff : aucun fan-out, aucune évaluation, rien à isoler). N'affecte aucune ligne si la
// paire n'a jamais été observée — il n'y a alors rien à figer.
export async function marquerHorsPerimetrePourBien(bienId: string, executeur: Executeur): Promise<void> {
  await executeur
    .update(compatibilitesBienAcquereurEtat)
    .set({ dansPerimetreActif: false })
    .where(eq(compatibilitesBienAcquereurEtat.bienId, bienId));
}

export async function marquerHorsPerimetrePourAcquereur(acquereurId: string, executeur: Executeur): Promise<void> {
  await executeur
    .update(compatibilitesBienAcquereurEtat)
    .set({ dansPerimetreActif: false })
    .where(eq(compatibilitesBienAcquereurEtat.acquereurId, acquereurId));
}

// Désarchivage : PAS de bascule inline symétrique à marquerHorsPerimetrePourBien/Acquereur ci-dessus
// — délibérément. Une bascule inline ici, dans la même transaction que le désarchivage, poserait
// dans_perimetre_actif=true AVANT que la resynchronisation mise en file (src/actions/
// archivageBien.ts / archivageAcquereur.ts) ne relise l'état technique : traiterPaire()
// (synchronisation.ts) verrait alors un `etatAvant` déjà à jour (dans_perimetre_actif=true),
// masquant la transition hors_perimetre → actif qui doit pourtant produire un nouveau cycle. La
// bascule vers `true` est donc laissée à ecrireEtatPaire() (appelée par traiterPaire, qui écrit
// systématiquement dans_perimetre_actif=true dans ce contexte) — c'est elle qui lit encore
// l'ancien `false` au moment de décider la transition, exactement l'inverse de l'archivage (qui
// n'a besoin d'aucune resynchronisation, donc bascule inline sans risque de course).
