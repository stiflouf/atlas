import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-033 — ORDRE TOTAL du journal de scan, en base réelle. Ce qui est vérifié ici n'existe que
// dans Postgres : `now()` est le `transaction_timestamp()`, donc deux écritures d'une même
// transaction partagent EXACTEMENT le même `demarre_le`. C'est le mécanisme réel de l'égalité que
// la production atteint sous concurrence — jamais un timestamp fabriqué en mémoire pour les
// besoins du test.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { runsScanAutomatisation: runsTable } = await import("@/db/schema");
const { demarrerRunScanAutomatisation, getDernierRunScanPourRegle } = await import("./runScanAutomatisationRepository");

// Code distinct de celui qu'utilise scanTemporel.test.ts ('inactivite_prospect_vendeur') : ces deux
// fichiers possèdent chacun le journal de LEUR règle, sans jamais se purger l'un l'autre.
const REGLE = "preparation_apres_mandat" as const;

async function purger() {
  await getDb().delete(runsTable).where(eq(runsTable.regleCode, REGLE));
}

beforeAll(purger);
afterAll(purger);

// Deux runs dans UNE transaction : `demarre_le` est alors bit à bit identique pour les deux, et
// seul l'ordre d'insertion les distingue. `ids` permet de choisir les uuid, donc de construire un
// cas où l'ordre lexical contredit l'ordre réel.
async function deuxRunsAuMemeInstant(ids?: [string, string]): Promise<[string, string]> {
  return getDb().transaction(async (tx) => {
    const [premier] = await tx
      .insert(runsTable)
      .values({ regleCode: REGLE, workspaceId: WORKSPACE_TEST, ...(ids ? { id: ids[0] } : {}) })
      .returning({ id: runsTable.id });
    const [second] = await tx
      .insert(runsTable)
      .values({ regleCode: REGLE, workspaceId: WORKSPACE_TEST, ...(ids ? { id: ids[1] } : {}) })
      .returning({ id: runsTable.id });
    return [premier.id, second.id];
  });
}

async function demarreLeDe(id: string) {
  const [ligne] = await getDb().select({ demarreLe: runsTable.demarreLe }).from(runsTable).where(eq(runsTable.id, id));
  return ligne!.demarreLe.getTime();
}

describe("getDernierRunScanPourRegle — ordre total du journal (ADR-033)", () => {
  it("à `demarre_le` strictement égal, c'est le run démarré en DERNIER qui est rendu", async () => {
    await purger();
    const [premier, second] = await deuxRunsAuMemeInstant();

    // L'égalité est bien réelle, sinon ce test ne prouverait rien du cas qu'il prétend couvrir.
    expect(await demarreLeDe(premier)).toBe(await demarreLeDe(second));

    const dernier = await getDernierRunScanPourRegle(REGLE, WORKSPACE_TEST);
    expect(dernier?.id).toBe(second);
  });

  it("l'uuid ne départage RIEN : le plus grand lexicalement peut être le plus ancien", async () => {
    await purger();
    // Le run le plus ANCIEN porte l'uuid le plus GRAND. Sous l'ancien tie-break (`id DESC`) ce test
    // rendait `ffffffff…` — déterministe, et faux. Il interdit désormais toute réintroduction d'un
    // ordre temporel fondé sur l'identifiant.
    const ancien = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const recent = "00000000-0000-4000-8000-000000000000";
    await deuxRunsAuMemeInstant([ancien, recent]);

    const dernier = await getDernierRunScanPourRegle(REGLE, WORKSPACE_TEST);
    expect(dernier?.id).toBe(recent);
  });

  it("et symétriquement, l'uuid le plus petit peut être le plus ancien", async () => {
    await purger();
    // Le miroir du test précédent : un ordre qui ne ferait que s'inverser (`id ASC`) échouerait
    // ici. Seul un vrai critère d'ordre passe les deux.
    const ancien = "00000000-0000-4000-8000-000000000000";
    const recent = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await deuxRunsAuMemeInstant([ancien, recent]);

    const dernier = await getDernierRunScanPourRegle(REGLE, WORKSPACE_TEST);
    expect(dernier?.id).toBe(recent);
  });

  it("deux démarrages concurrents restent totalement ordonnés", async () => {
    await purger();
    // Le vrai chemin de production : deux appels au repository lancés ensemble, sans aucun verrou
    // (ADR-033 n'en pose pas, et ce lot n'en introduit pas). Qu'ils partagent ou non la même
    // microseconde, la question « lequel est le dernier » a toujours UNE réponse, et la même à
    // chaque relecture.
    const [a, b] = await Promise.all([
      demarrerRunScanAutomatisation(REGLE, WORKSPACE_TEST),
      demarrerRunScanAutomatisation(REGLE, WORKSPACE_TEST),
    ]);

    const lectures = await Promise.all([
      getDernierRunScanPourRegle(REGLE, WORKSPACE_TEST),
      getDernierRunScanPourRegle(REGLE, WORKSPACE_TEST),
      getDernierRunScanPourRegle(REGLE, WORKSPACE_TEST),
    ]);
    const ids = new Set(lectures.map((r) => r?.id));
    expect(ids.size, "la réponse ne doit pas varier d'une lecture à l'autre").toBe(1);
    expect([a, b]).toContain([...ids][0]);

    const lignes = await getDb().select({ ordre: runsTable.ordre }).from(runsTable).where(eq(runsTable.regleCode, REGLE));
    expect(new Set(lignes.map((l) => l.ordre)).size, "chaque run a son propre rang").toBe(lignes.length);
  });

  it("quand les timestamps diffèrent réellement, c'est `demarre_le` qui décide — inchangé", async () => {
    await purger();
    // Non-régression de la sémantique métier : `ordre` ne fait que trancher les égalités, il ne
    // prend jamais le pas sur le temps. Un run inséré APRÈS mais démarré AVANT reste l'ancien.
    const recent = await demarrerRunScanAutomatisation(REGLE, WORKSPACE_TEST);
    const [ancien] = await getDb()
      .insert(runsTable)
      .values({ regleCode: REGLE, workspaceId: WORKSPACE_TEST, demarreLe: new Date("2020-01-01T00:00:00Z") })
      .returning({ id: runsTable.id });

    expect(ancien.id).toBeDefined();
    const dernier = await getDernierRunScanPourRegle(REGLE, WORKSPACE_TEST);
    expect(dernier?.id).toBe(recent);
  });

  it("aucun run pour la règle : rien, jamais le run d'une autre règle", async () => {
    await purger();
    await demarrerRunScanAutomatisation("suivi_apres_visite", WORKSPACE_TEST);
    const dernier = await getDernierRunScanPourRegle(REGLE, WORKSPACE_TEST);
    expect(dernier).toBeUndefined();
    await getDb().delete(runsTable).where(eq(runsTable.regleCode, "suivi_apres_visite"));
  });
});
