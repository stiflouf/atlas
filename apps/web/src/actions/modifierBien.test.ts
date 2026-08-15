import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : base Postgres réelle, IGN mocké. Couvre en particulier le scénario "très
// important" ADR-035 section 6 : un codeInseeCommune périmé ne doit jamais survivre à une édition
// dont la nouvelle résolution échoue.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, compatibilitesARessynchroniser, compatibilitesBienAcquereurEtat, evenementsMetier } =
  await import("@/db/schema");
const { inArray } = await import("drizzle-orm");
const { creerBien } = await import("@/lib/bienRepository");
const { modifierBienAction } = await import("./modifierBien");

const idsCrees: string[] = [];

// modifierBienAction enqueue désormais une demande de resynchronisation (ADR-036) DANS LA MÊME
// transaction que la modification — mêmes lignes techniques à purger avant le bien, même ordre que
// creerBien.test.ts/evenementMetierRepository.test.ts.
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

function reponseIgn(score: number, ville = "Houilles", citycode = "78311"): Response {
  return new Response(
    JSON.stringify({
      features: [
        {
          geometry: { coordinates: [2.18, 48.92] },
          properties: { score, label: ville, citycode, city: ville, postcode: "78800", context: "78, Yvelines" },
        },
      ],
    }),
    { status: 200 }
  );
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] MODIF-BIEN-${suffixe}`,
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue Test",
    ville: "Houilles",
    codePostal: "78800",
    surface: 50,
    pieces: 3,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    codeInseeCommune: "78311",
  });
  idsCrees.push(bien.id);
  return bien;
}

const CHAMPS_BASE = {
  titre: "Bien de test",
  type: "appartement",
  surface: "50",
  pieces: "3",
  prix: "300000",
  statutMandat: "actif",
  dateMandat: "2026-01-01",
};

describe("modifierBienAction — jamais de codeInseeCommune périmé (ADR-035, section 6)", () => {
  it("remplace codeInseeCommune par la nouvelle résolution quand l'adresse change et que l'IGN confirme la nouvelle commune", async () => {
    const bien = await creerBienDeTest("001");
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn(0.95, "Sartrouville", "78575")));

    await modifierBienAction(
      formData({
        ...CHAMPS_BASE,
        id: bien.id,
        reference: bien.reference,
        adresse: "2 avenue Sartrouville",
        ville: "Sartrouville",
        codePostal: "78500",
      })
    ).catch(() => {});

    const [ligne] = await getDb().select().from(biensTable).where(eq(biensTable.id, bien.id));
    expect(ligne.codeInseeCommune).toBe("78575");
  });

  it("efface codeInseeCommune (NULL) si la nouvelle résolution échoue — jamais l'ancienne valeur conservée", async () => {
    const bien = await creerBienDeTest("002");

    // Vérifie d'abord que le code initial est bien en place.
    const [avant] = await getDb().select().from(biensTable).where(eq(biensTable.id, bien.id));
    expect(avant.codeInseeCommune).toBe("78311");

    // L'IGN échoue désormais (panne réseau) pour l'édition — même si l'adresse soumise est
    // inchangée, la résolution est TOUJOURS refaite (jamais conditionnée à "l'adresse a changé").
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await modifierBienAction(
      formData({ ...CHAMPS_BASE, id: bien.id, reference: bien.reference, adresse: "1 rue Test", ville: "Houilles", codePostal: "78800" })
    ).catch(() => {});

    const [apres] = await getDb().select().from(biensTable).where(eq(biensTable.id, bien.id));
    expect(apres.codeInseeCommune).toBeNull();
  });

  it("efface codeInseeCommune (NULL) si la nouvelle adresse résout avec un score insuffisant", async () => {
    const bien = await creerBienDeTest("003");
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn(0.4)));

    await modifierBienAction(
      formData({
        ...CHAMPS_BASE,
        id: bien.id,
        reference: bien.reference,
        adresse: "adresse approximative",
        ville: "Houilles",
        codePostal: "78800",
      })
    ).catch(() => {});

    const [ligne] = await getDb().select().from(biensTable).where(eq(biensTable.id, bien.id));
    expect(ligne.codeInseeCommune).toBeNull();
  });

  it("aucune ancienne localisation ne subsiste silencieusement même après plusieurs éditions successives", async () => {
    const bien = await creerBienDeTest("004");

    // 1) résolution réussie vers une nouvelle commune
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn(0.9, "Carrières-sur-Seine", "78124")));
    await modifierBienAction(
      formData({ ...CHAMPS_BASE, id: bien.id, reference: bien.reference, adresse: "x", ville: "Carrières-sur-Seine", codePostal: "78420" })
    ).catch(() => {});
    vi.unstubAllGlobals();

    let [ligne] = await getDb().select().from(biensTable).where(eq(biensTable.id, bien.id));
    expect(ligne.codeInseeCommune).toBe("78124");

    // 2) résolution suivante en échec — le code de l'étape 1 ne doit jamais survivre
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erreur", { status: 500 })));
    await modifierBienAction(
      formData({ ...CHAMPS_BASE, id: bien.id, reference: bien.reference, adresse: "y", ville: "Ailleurs", codePostal: "00000" })
    ).catch(() => {});

    [ligne] = await getDb().select().from(biensTable).where(eq(biensTable.id, bien.id));
    expect(ligne.codeInseeCommune).toBeNull();
  });
});
