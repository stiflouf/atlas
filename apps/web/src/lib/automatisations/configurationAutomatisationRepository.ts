import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { configurationsAutomatisation } from "@/db/schema";
import { CODES_REGLE_AUTOMATISATION } from "@/types/automatisation";
import type { ConfigurationAutomatisation, CodeRegleAutomatisation } from "@/types/automatisation";

function ligneVersConfiguration(ligne: typeof configurationsAutomatisation.$inferSelect): ConfigurationAutomatisation {
  return {
    regleCode: ligne.regleCode as CodeRegleAutomatisation,
    active: ligne.active,
    seuilJours: ligne.seuilJours ?? undefined,
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

// Une ligne par règle du catalogue DANS CE WORKSPACE (seedées inactives pour le workspace
// historique, ADR-032) — absence de ligne traitée comme inactive par l'appelant (jamais supposée
// active). C'est ce repli, et lui seul, qui fait qu'un workspace nouvellement créé voit les douze
// règles inactives sans qu'aucune ligne n'ait été précréée pour lui.
//
// WORKSPACE_SCOPING_V2B5 — `workspaceId` OBLIGATOIRE : sans lui, cette lecture rendait les
// configurations de tous les workspaces confondus, et /automatisations affichait l'activation d'un
// autre conseiller.
export async function listerConfigurationsAutomatisation(workspaceId: string): Promise<ConfigurationAutomatisation[]> {
  const lignes = await getDb()
    .select()
    .from(configurationsAutomatisation)
    .where(eq(configurationsAutomatisation.workspaceId, workspaceId));
  const parCode = new Map(lignes.map((l) => [l.regleCode, ligneVersConfiguration(l)]));
  return CODES_REGLE_AUTOMATISATION.map(
    (code) => parCode.get(code) ?? { regleCode: code, active: false, modifieLe: new Date(0).toISOString() }
  );
}

// Lecture unitaire (ADR-033) — utilisée par le scanner temporel (une règle, un workspace, à la
// fois) et par la garde "seuil obligatoire" de la Server Action d'activation. Même repli
// "absent = inactif" que listerConfigurationsAutomatisation.
//
// WORKSPACE_SCOPING_V2B5 — `workspaceId` OBLIGATOIRE : une lecture par `regleCode` seul rendait la
// ligne d'un workspace arbitraire, ce qui faisait décider un scan (ou une garde d'activation) sur
// l'activation et le seuil d'un autre.
export async function getConfigurationAutomatisation(
  regleCode: CodeRegleAutomatisation,
  workspaceId: string
): Promise<ConfigurationAutomatisation> {
  const [ligne] = await getDb()
    .select()
    .from(configurationsAutomatisation)
    .where(
      and(
        eq(configurationsAutomatisation.regleCode, regleCode),
        eq(configurationsAutomatisation.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return ligne ? ligneVersConfiguration(ligne) : { regleCode, active: false, modifieLe: new Date(0).toISOString() };
}

// Bascule explicite (ADR-032, point 7) — jamais un état implicite. `onConflictDoUpdate` : la ligne
// existe déjà pour le workspace historique (seedée par les migrations), et est créée à la volée
// pour tout autre workspace au premier geste d'activation — aucune précréation.
// ADR-054 — `workspaceId` est un paramètre OBLIGATOIRE, jamais une valeur que ce repository
// choisirait : il vient du contexte authentifié (`exigerWorkspaceCourant()`). Aucun repli, aucun
// `?? "default"` — la migration 0033 a retiré le DEFAULT SQL précisément pour qu'un oubli échoue
// immédiatement au lieu d'être silencieusement rangé dans le workspace historique.
//
// WORKSPACE_SCOPING_V2B5 — la cible du `ON CONFLICT` est le COUPLE, jamais `regleCode` seul. Avec
// `regleCode` seul, activer une règle depuis le workspace B entrait en conflit avec la ligne de A
// et écrasait SON activation : une corruption silencieuse, invisible côté A jusqu'au prochain scan.
export async function definirActivationAutomatisation(
  regleCode: CodeRegleAutomatisation,
  active: boolean,
  workspaceId: string
): Promise<void> {
  await getDb()
    .insert(configurationsAutomatisation)
    .values({ regleCode, active, workspaceId })
    .onConflictDoUpdate({
      target: [configurationsAutomatisation.workspaceId, configurationsAutomatisation.regleCode],
      set: { active, modifieLe: new Date() },
    });
}

// Seuil produit explicite (ADR-033, point 4 ; généralisé AUTOMATION_ENGINE_GENERALIZATION_V1 — plus
// spécifique à une seule règle, voir types/automatisation.ts) — jamais une constante cachée. Ne
// touche jamais `active` : renseigner/corriger le seuil est un geste distinct de l'activation (la
// garde "impossible d'activer sans seuil valide" vit dans la Server Action, pas ici — ADR-007).
export async function definirSeuilAutomatisation(regleCode: CodeRegleAutomatisation, seuilJours: number, workspaceId: string): Promise<void> {
  await getDb()
    .insert(configurationsAutomatisation)
    .values({ regleCode, seuilJours, workspaceId })
    .onConflictDoUpdate({
      // Même cible composite que l'activation, pour la même raison : un seuil réglé dans B ne doit
      // jamais réécrire le seuil de A (WORKSPACE_SCOPING_V2B5).
      target: [configurationsAutomatisation.workspaceId, configurationsAutomatisation.regleCode],
      set: { seuilJours, modifieLe: new Date() },
    });
}
