import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
import { eq } from "drizzle-orm";

// Test d'intégration : base Postgres réelle, IGN mocké (ADR-035, section 19 — les tests
// automatisés principaux ne doivent jamais dépendre du réseau IGN réel ; une validation réelle a
// été faite manuellement, voir docs/adr/035-...).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, compatibilitesARessynchroniser, compatibilitesBienAcquereurEtat, evenementsMetier } =
  await import("@/db/schema");
const { inArray } = await import("drizzle-orm");
const { creerBienAction } = await import("./creerBien");
const { getBienById } = await import("@/lib/bienRepository");

const idsCrees: string[] = [];

// creerBienAction enqueue désormais une demande de resynchronisation (ADR-036) DANS LA MÊME
// transaction que la création — ces lignes techniques (bien_id, NO ACTION, jamais CASCADE, même
// principe que evenements_metier) doivent être purgées AVANT le bien lui-même, sinon la suppression
// échoue (violation de clé étrangère). Même ordre que evenementMetierRepository.test.ts.
afterAll(async () => {
  if (idsCrees.length > 0) {
    await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.bienId, idsCrees));
    await getDb().delete(compatibilitesBienAcquereurEtat).where(inArray(compatibilitesBienAcquereurEtat.bienId, idsCrees));
    await getDb().delete(compatibilitesARessynchroniser).where(inArray(compatibilitesARessynchroniser.bienId, idsCrees));
  }
  for (const id of idsCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function reponseIgn(score: number, avecCitycode = true): Response {
  const properties: Record<string, unknown> = { score, label: "Houilles" };
  if (avecCitycode) {
    Object.assign(properties, { citycode: "78311", city: "Houilles", postcode: "78800", context: "78, Yvelines" });
  }
  return new Response(
    JSON.stringify({ features: [{ geometry: { coordinates: [2.18, 48.92] }, properties }] }),
    { status: 200 }
  );
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

const CHAMPS_BASE = {
  reference: "[test réel] CREER-BIEN-001",
  titre: "Bien de test",
  type: "appartement",
  adresse: "1 rue Test",
  ville: "Houilles",
  codePostal: "78800",
  surface: "50",
  pieces: "3",
  prix: "300000",
  statutMandat: "actif",
  dateMandat: "2026-01-01",
};

describe("creerBienAction — résolution IGN non bloquante (ADR-035, section 5)", () => {
  it("persiste codeInseeCommune quand la résolution IGN est fiable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn(0.95)));

    await creerBienAction(formData(CHAMPS_BASE)).catch(() => {});

    const biens = await getDb().select().from(biensTable).where(eq(biensTable.reference, CHAMPS_BASE.reference));
    expect(biens).toHaveLength(1);
    idsCrees.push(biens[0].id);
    expect(biens[0].codeInseeCommune).toBe("78311");
  });

  it("crée le bien normalement (codeInseeCommune NULL) si l'IGN échoue en réseau — jamais bloquant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await creerBienAction(formData({ ...CHAMPS_BASE, reference: "[test réel] CREER-BIEN-002" })).catch(() => {});

    const biens = await getDb()
      .select()
      .from(biensTable)
      .where(eq(biensTable.reference, "[test réel] CREER-BIEN-002"));
    expect(biens).toHaveLength(1);
    idsCrees.push(biens[0].id);
    expect(biens[0].codeInseeCommune).toBeNull();
  });

  it("crée le bien normalement (codeInseeCommune NULL) si le score IGN est insuffisant", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn(0.3)));

    await creerBienAction(formData({ ...CHAMPS_BASE, reference: "[test réel] CREER-BIEN-003" })).catch(() => {});

    const biens = await getDb()
      .select()
      .from(biensTable)
      .where(eq(biensTable.reference, "[test réel] CREER-BIEN-003"));
    expect(biens).toHaveLength(1);
    idsCrees.push(biens[0].id);
    expect(biens[0].codeInseeCommune).toBeNull();
    const relu = await getBienById(biens[0].id);
    expect(relu?.codeInseeCommune).toBeUndefined();
  });
});
