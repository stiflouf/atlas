import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2B5 (ADR-054) — tests d'intégration réels de l'identité d'une configuration
// d'automatisation, qui est désormais le COUPLE (workspace_id, regle_code) et non plus la règle
// seule (migration 0054).
//
// Ce que ce fichier prouve, et qu'aucun test existant ne pouvait prouver avant la migration : deux
// workspaces configurent la MÊME règle sans se marcher dessus. Avant 0054, l'`ON CONFLICT
// (regle_code)` des deux writers faisait de la seconde activation une RÉÉCRITURE de la première —
// une corruption silencieuse, invisible du côté écrasé jusqu'au prochain scan.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { configurationsAutomatisation, workspaces: workspacesTable } = await import("@/db/schema");
const {
  definirActivationAutomatisation,
  definirSeuilAutomatisation,
  getConfigurationAutomatisation,
  listerConfigurationsAutomatisation,
} = await import("./configurationAutomatisationRepository");

// Règle temporelle à seuil : elle permet d'exercer les DEUX writers (activation et seuil) sur la
// même ligne, donc les deux `ON CONFLICT`.
const REGLE = "offre_sans_decision" as const;
const AUTRE_REGLE = "visite_j_1" as const;

const WORKSPACE_B = `ws-config-auto-${Date.now()}`;

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] configurations automatisation B" });
});

afterAll(async () => {
  await getDb().delete(configurationsAutomatisation).where(eq(configurationsAutomatisation.workspaceId, WORKSPACE_B));
  await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
  // Le workspace historique garde ses lignes seedées : on les remet dans leur état de repos plutôt
  // que de les supprimer (les migrations 0020/0021/0024/0027/0047/0052 les ont posées).
  for (const regle of [REGLE, AUTRE_REGLE]) {
    await getDb()
      .update(configurationsAutomatisation)
      .set({ active: false, seuilJours: null })
      .where(
        and(
          eq(configurationsAutomatisation.workspaceId, WORKSPACE_TEST),
          eq(configurationsAutomatisation.regleCode, regle)
        )
      );
  }
});

async function lignesPourRegle(regle: typeof REGLE | typeof AUTRE_REGLE) {
  return getDb()
    .select()
    .from(configurationsAutomatisation)
    .where(eq(configurationsAutomatisation.regleCode, regle));
}

describe("T9 — migration 0054 : l'identité d'une configuration est (workspace_id, regle_code)", () => {
  it("la clé primaire réelle en base porte bien sur les deux colonnes, dans cet ordre", async () => {
    const lignes = await getDb().execute(sql`
      SELECT kcu.column_name, kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'configurations_automatisation'
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position`);
    expect([...lignes].map((l) => l.column_name)).toEqual(["workspace_id", "regle_code"]);
  });

  it("aucune ligne n'a perdu son périmètre, et le couple reste unique", async () => {
    // Pas d'assertion sur un NOMBRE de lignes : `configurations_automatisation` est une table
    // partagée que d'autres suites peuplent et purgent légitimement (le seed de démonstration
    // supprime les siennes en fin de test). Ce qui doit tenir quel que soit l'ordre d'exécution,
    // c'est l'INVARIANT de clé — c'est lui que la migration 0054 a changé.
    const toutes = await getDb().select().from(configurationsAutomatisation);
    expect(toutes.length).toBeGreaterThan(0);

    const couples = toutes.map((l) => `${l.workspaceId}::${l.regleCode}`);
    expect(new Set(couples).size, "aucun doublon (workspace, règle)").toBe(couples.length);
    for (const ligne of toutes) {
      expect(ligne.workspaceId, "workspace_id reste NOT NULL et renseigné").toBeTruthy();
    }

    // Et la ligne historique d'une règle seedée est toujours rattachée au workspace historique :
    // la migration n'a ni déplacé ni réinterprété une seule ligne (aucun backfill).
    const [seedee] = await getDb()
      .select()
      .from(configurationsAutomatisation)
      .where(
        and(
          eq(configurationsAutomatisation.workspaceId, WORKSPACE_TEST),
          eq(configurationsAutomatisation.regleCode, "suivi_apres_visite")
        )
      );
    expect(seedee?.workspaceId).toBe(WORKSPACE_TEST);
  });
});

describe("T1 / T8 — deux workspaces configurent la même règle", () => {
  it("A active X et B active X : deux lignes distinctes, aucune violation de clé", async () => {
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_B);

    const lignes = await lignesPourRegle(REGLE);
    const parWorkspace = new Map(lignes.map((l) => [l.workspaceId, l]));
    expect(parWorkspace.get(WORKSPACE_TEST)?.active).toBe(true);
    expect(parWorkspace.get(WORKSPACE_B)?.active).toBe(true);
    // Deux lignes pour la même règle : impossible avant la migration 0054.
    expect(lignes.filter((l) => l.workspaceId === WORKSPACE_TEST || l.workspaceId === WORKSPACE_B)).toHaveLength(2);
  });

  it("la ligne de B est créée à la volée : aucune configuration n'est précréée pour un nouveau workspace", async () => {
    // AUTRE_REGLE n'a encore jamais été touchée pour B.
    const avant = await getDb()
      .select()
      .from(configurationsAutomatisation)
      .where(
        and(
          eq(configurationsAutomatisation.workspaceId, WORKSPACE_B),
          eq(configurationsAutomatisation.regleCode, AUTRE_REGLE)
        )
      );
    expect(avant).toHaveLength(0);

    // …et se lit pourtant comme INACTIVE, jamais comme une absence d'information.
    const config = await getConfigurationAutomatisation(AUTRE_REGLE, WORKSPACE_B);
    expect(config.active).toBe(false);
    expect(config.seuilJours).toBeUndefined();

    await definirActivationAutomatisation(AUTRE_REGLE, true, WORKSPACE_B);
    const apres = await getDb()
      .select()
      .from(configurationsAutomatisation)
      .where(
        and(
          eq(configurationsAutomatisation.workspaceId, WORKSPACE_B),
          eq(configurationsAutomatisation.regleCode, AUTRE_REGLE)
        )
      );
    expect(apres).toHaveLength(1);
  });

  it("un nouveau workspace voit les douze règles du catalogue, toutes inactives, sans aucune ligne pour lui", async () => {
    const vierge = `ws-vierge-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: vierge, nom: "[test réel] workspace vierge" });
    try {
      const configurations = await listerConfigurationsAutomatisation(vierge);
      expect(configurations).toHaveLength(12);
      expect(configurations.every((c) => c.active === false)).toBe(true);
      expect(configurations.every((c) => c.seuilJours === undefined)).toBe(true);

      const lignes = await getDb()
        .select()
        .from(configurationsAutomatisation)
        .where(eq(configurationsAutomatisation.workspaceId, vierge));
      expect(lignes).toHaveLength(0);
    } finally {
      await getDb().delete(workspacesTable).where(eq(workspacesTable.id, vierge));
    }
  });
});

describe("T2 — une modification dans un workspace n'en touche jamais un autre", () => {
  it("A désactive X : B reste active", async () => {
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_B);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);

    expect((await getConfigurationAutomatisation(REGLE, WORKSPACE_TEST)).active).toBe(false);
    expect((await getConfigurationAutomatisation(REGLE, WORKSPACE_B)).active).toBe(true);
  });

  it("A règle son seuil à 3 et B le sien à 10 : modifier A laisse B intact", async () => {
    await definirSeuilAutomatisation(REGLE, 3, WORKSPACE_TEST);
    await definirSeuilAutomatisation(REGLE, 10, WORKSPACE_B);

    expect((await getConfigurationAutomatisation(REGLE, WORKSPACE_TEST)).seuilJours).toBe(3);
    expect((await getConfigurationAutomatisation(REGLE, WORKSPACE_B)).seuilJours).toBe(10);

    await definirSeuilAutomatisation(REGLE, 4, WORKSPACE_TEST);

    expect((await getConfigurationAutomatisation(REGLE, WORKSPACE_TEST)).seuilJours).toBe(4);
    expect((await getConfigurationAutomatisation(REGLE, WORKSPACE_B)).seuilJours).toBe(10);
  });

  it("régler le seuil ne touche jamais l'activation de l'autre workspace, ni l'inverse", async () => {
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_B);
    await definirSeuilAutomatisation(REGLE, 7, WORKSPACE_TEST);

    // Le seuil de A a bougé ; l'activation de B, elle, n'a pas été réécrite au passage.
    expect((await getConfigurationAutomatisation(REGLE, WORKSPACE_B)).active).toBe(true);
    expect((await getConfigurationAutomatisation(REGLE, WORKSPACE_B)).seuilJours).toBe(10);
  });
});

describe("T7 (lecture) — les lecteurs ne rendent jamais la configuration d'un autre workspace", () => {
  it("listerConfigurationsAutomatisation rend l'état DU workspace demandé", async () => {
    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_B);

    const vueA = await listerConfigurationsAutomatisation(WORKSPACE_TEST);
    const vueB = await listerConfigurationsAutomatisation(WORKSPACE_B);

    expect(vueA.find((c) => c.regleCode === REGLE)?.active).toBe(false);
    expect(vueB.find((c) => c.regleCode === REGLE)?.active).toBe(true);
    // Les deux vues couvrent le catalogue entier, jamais l'union des lignes des deux workspaces.
    expect(vueA).toHaveLength(12);
    expect(vueB).toHaveLength(12);
  });
});
