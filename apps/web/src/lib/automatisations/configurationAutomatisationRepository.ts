import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { configurationsAutomatisation } from "@/db/schema";
import { CODES_REGLE_AUTOMATISATION } from "@/types/automatisation";
import type { ConfigurationAutomatisation, CodeRegleAutomatisation } from "@/types/automatisation";

function ligneVersConfiguration(ligne: typeof configurationsAutomatisation.$inferSelect): ConfigurationAutomatisation {
  return {
    regleCode: ligne.regleCode as CodeRegleAutomatisation,
    active: ligne.active,
    seuilJoursInactivite: ligne.seuilJoursInactivite ?? undefined,
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

// Une ligne par règle du catalogue (seedées inactives, ADR-032) — absence de ligne traitée comme
// inactive par l'appelant (jamais supposée active).
export async function listerConfigurationsAutomatisation(): Promise<ConfigurationAutomatisation[]> {
  const lignes = await getDb().select().from(configurationsAutomatisation);
  const parCode = new Map(lignes.map((l) => [l.regleCode, ligneVersConfiguration(l)]));
  return CODES_REGLE_AUTOMATISATION.map(
    (code) => parCode.get(code) ?? { regleCode: code, active: false, modifieLe: new Date(0).toISOString() }
  );
}

// Lecture unitaire (ADR-033) — utilisée par le scanner temporel, qui n'a besoin que d'une seule
// règle à la fois. Même repli "absent = inactif" que listerConfigurationsAutomatisation.
export async function getConfigurationAutomatisation(regleCode: CodeRegleAutomatisation): Promise<ConfigurationAutomatisation> {
  const [ligne] = await getDb()
    .select()
    .from(configurationsAutomatisation)
    .where(eq(configurationsAutomatisation.regleCode, regleCode))
    .limit(1);
  return ligne ? ligneVersConfiguration(ligne) : { regleCode, active: false, modifieLe: new Date(0).toISOString() };
}

// Bascule explicite (ADR-032, point 7) — jamais un état implicite. `onConflictDoUpdate` : la ligne
// existe déjà pour les 4 règles V1 (seedées), mais reste robuste si une future règle n'a encore
// aucune ligne.
export async function definirActivationAutomatisation(
  regleCode: CodeRegleAutomatisation,
  active: boolean
): Promise<void> {
  await getDb()
    .insert(configurationsAutomatisation)
    .values({ regleCode, active })
    .onConflictDoUpdate({
      target: configurationsAutomatisation.regleCode,
      set: { active, modifieLe: new Date() },
    });
}

// Seuil produit explicite (ADR-033, point 4) — jamais une constante cachée. Ne touche jamais
// `active` : renseigner/corriger le seuil est un geste distinct de l'activation (la garde
// "impossible d'activer sans seuil valide" vit dans la Server Action, pas ici — ADR-007).
export async function definirSeuilAutomatisation(
  regleCode: CodeRegleAutomatisation,
  seuilJoursInactivite: number
): Promise<void> {
  await getDb()
    .insert(configurationsAutomatisation)
    .values({ regleCode, seuilJoursInactivite })
    .onConflictDoUpdate({
      target: configurationsAutomatisation.regleCode,
      set: { seuilJoursInactivite, modifieLe: new Date() },
    });
}
