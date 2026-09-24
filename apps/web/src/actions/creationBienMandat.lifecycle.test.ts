import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import { ETAT_FORMULAIRE_INITIAL, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

// ADR-060 §14 — DIRECT_PROPERTY_CREATION_POLICY (B avec réserve) : un bien créé « actif » naît avec
// son mandat canonique dans la même transaction, à partir des seuls faits saisis ; créé
// « suspendu » ou « expire », aucun mandat n'est fabriqué. Et §2 — LEGACY_WRITE_POLICY : dès qu'un
// mandat canonique existe, `modifierBien` n'écrit plus `date_mandat` / `statut_mandat`.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: vi.fn().mockResolvedValue(WORKSPACE_TEST) }));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { biens: biensTable, compatibilitesARessynchroniser, compatibilitesBienAcquereurEtat, evenementsMetier, mandats: mandatsTable } =
  await import("@/db/schema");
const { creerBienAction } = await import("./creerBien");
const { modifierBienAction } = await import("./modifierBien");
const { getBienById, modifierBien } = await import("@/lib/bienRepository");
const { creerMandat, listerMandatsDuBien } = await import("@/lib/mandatRepository");

const M = `[test réel] CREATION-MANDAT ${Date.now()}`;
let compteur = 0;

afterAll(async () => {
  const biens = await getDb().select({ id: biensTable.id }).from(biensTable).where(eq(biensTable.titre, M));
  const ids = biens.map((b) => b.id);
  if (ids.length > 0) {
    await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.bienId, ids));
    await getDb().delete(compatibilitesBienAcquereurEtat).where(inArray(compatibilitesBienAcquereurEtat.bienId, ids));
    await getDb().delete(compatibilitesARessynchroniser).where(inArray(compatibilitesARessynchroniser.bienId, ids));
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, ids));
    await getDb().delete(biensTable).where(inArray(biensTable.id, ids));
  }
});

afterEach(() => vi.unstubAllGlobals());

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

function champsBien(extra: Record<string, string> = {}) {
  return {
    reference: `${M} ${++compteur}`,
    titre: M,
    type: "appartement",
    adresse: "1 rue Test",
    ville: "Testville",
    codePostal: "00000",
    surface: "50",
    pieces: "3",
    prix: "300000",
    statutMandat: "actif",
    dateMandat: "2026-01-15",
    ...extra,
  };
}

async function soumettre(action: (etat: EtatFormulaire, fd: FormData) => Promise<EtatFormulaire>, fd: FormData): Promise<string> {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("IGN indisponible (simulé)"); }));
  try {
    const etat = await action(ETAT_FORMULAIRE_INITIAL, fd);
    // FORM_FEEDBACK_V1 — un refus de saisie revient désormais comme état, jamais comme exception.
    return etat.statut === "erreur" ? etat.message : "aucune";
  } catch (erreur) {
    return String((erreur as { digest?: string }).digest ?? (erreur as Error).message);
  }
}

const bienParReference = async (reference: string) => (await getDb().select().from(biensTable).where(eq(biensTable.reference, reference)))[0];

describe("creerBienAction — ADR-060 §14", () => {
  it("A. statut actif → bien ET mandat canonique (type, numéro, terme saisis ; prise d'effet = date du mandat)", async () => {
    const champs = champsBien({ typeMandat: "exclusif", numeroMandat: " X-9 ", dateFinMandat: "2027-01-14" });
    expect(await soumettre(creerBienAction, formulaire(champs))).toMatch(/NEXT_REDIRECT/);
    const bien = await bienParReference(champs.reference);
    const mandats = await listerMandatsDuBien(bien.id, WORKSPACE_TEST);
    expect(mandats).toHaveLength(1);
    expect(mandats[0]).toMatchObject({ type: "exclusif", numero: "X-9", dateDebut: "2026-01-15", dateFin: "2027-01-14", projetVendeurId: undefined });
  });

  it("B/C. statut suspendu ou expire → bien legacy seulement, aucun mandat fabriqué", async () => {
    for (const statutMandat of ["suspendu", "expire"]) {
      const champs = champsBien({ statutMandat, typeMandat: "simple" });
      expect(await soumettre(creerBienAction, formulaire(champs))).toMatch(/NEXT_REDIRECT/);
      const bien = await bienParReference(champs.reference);
      expect(bien.statutMandat).toBe(statutMandat);
      expect(await listerMandatsDuBien(bien.id, WORKSPACE_TEST)).toEqual([]);
    }
  });

  it("D. actif sans type → refus AVANT toute écriture", async () => {
    const champs = champsBien();
    expect(await soumettre(creerBienAction, formulaire(champs))).toMatch(/type de mandat est obligatoire/);
    expect(await bienParReference(champs.reference)).toBeUndefined();
  });
});

describe("modifierBien — ADR-060 §2 LEGACY_WRITE_POLICY", () => {
  it("canonique présent → date_mandat / statut_mandat ignorés, le reste modifié ; aucun dual-write vers mandats", async () => {
    const champs = champsBien({ typeMandat: "simple" });
    await soumettre(creerBienAction, formulaire(champs));
    const bien = await bienParReference(champs.reference);
    const mandatsAvant = await listerMandatsDuBien(bien.id, WORKSPACE_TEST);

    const issue = await soumettre(
      modifierBienAction,
      formulaire({ ...champs, id: bien.id, titre: M, prix: "999000", statutMandat: "expire", dateMandat: "2020-01-01" })
    );
    expect(issue).toMatch(/NEXT_REDIRECT/);
    const relu = (await getBienById(bien.id))!;
    expect(relu.prix).toBe(999000);
    expect(relu.statutMandat).toBe("actif");
    expect(relu.dateMandat).toBe("2026-01-15");
    expect(await listerMandatsDuBien(bien.id, WORKSPACE_TEST)).toEqual(mandatsAvant);
  });

  it("canonique absent → legacy éditable comme avant", async () => {
    const champs = champsBien({ statutMandat: "suspendu" });
    await soumettre(creerBienAction, formulaire(champs));
    const bien = await bienParReference(champs.reference);
    expect(await listerMandatsDuBien(bien.id, WORKSPACE_TEST)).toEqual([]);

    await soumettre(modifierBienAction, formulaire({ ...champs, id: bien.id, statutMandat: "expire", dateMandat: "2025-06-01" }));
    const relu = (await getBienById(bien.id))!;
    expect(relu.statutMandat).toBe("expire");
    expect(relu.dateMandat).toBe("2025-06-01");
    expect(await listerMandatsDuBien(bien.id, WORKSPACE_TEST), "aucun mandat créé par une édition legacy").toEqual([]);
  });

  it("le repository lui-même applique la politique, sans passer par l'action", async () => {
    const champs = champsBien({ statutMandat: "suspendu" });
    await soumettre(creerBienAction, formulaire(champs));
    const bien = (await getBienById((await bienParReference(champs.reference)).id))!;
    await creerMandat({ bienId: bien.id, dateDebut: "2026-02-01", type: "simple" });
    const modifie = await modifierBien(bien.id, { ...bien, statutMandat: "actif", dateMandat: "2026-02-01" }, WORKSPACE_TEST);
    expect(modifie!.statutMandat).toBe("suspendu");
    expect(modifie!.dateMandat).toBe(bien.dateMandat);
  });
});
