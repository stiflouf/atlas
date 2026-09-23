import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

// ADR-054 — même raison que le mock de session juste au-dessus : ces tests portent sur le
// COMPORTEMENT MÉTIER de l'action, pas sur la résolution du périmètre (couverte par ses propres
// tests, src/lib/auth/workspaceCourant.test.ts). Sans ce mock, la résolution tenterait un bootstrap
// d'appartenance pour un `sub` fictif et dépendrait de l'allowlist. Le littéral est celui du
// workspace historique : ce que l'action écrit reste vérifié en base par les assertions.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { rfrFoyer: rfrFoyerTable } = await import("@/db/schema");
const { enregistrerRfrFoyerAction } = await import("./rfrFoyer");

afterAll(async () => {
  await getDb().delete(rfrFoyerTable).where(eq(rfrFoyerTable.dossierFiscalId, "default"));
});

const ETAT_FORMULAIRE_INITIAL = { statut: "idle" } as const;

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

// DEMO_UX_HARDENING_V1 — les refus de saisie reviennent au formulaire (FORM_FEEDBACK_V1), ils ne
// lèvent plus : une virgule mal placée ne doit jamais éjecter le conseiller sur error.tsx.
describe("enregistrerRfrFoyerAction — garde-fous", () => {
  it("refuse un nombre de parts invalide, en état de formulaire", async () => {
    const etat = await enregistrerRfrFoyerAction(ETAT_FORMULAIRE_INITIAL, formData({ anneeRfr: "2024", rfrFoyer: "3000000", nombreParts: "0" }));
    expect(etat.statut).toBe("erreur");
    expect(etat.statut === "erreur" && etat.message).toMatch(/parts/);
  });

  it("refuse un RFR invalide, en état de formulaire", async () => {
    const etat = await enregistrerRfrFoyerAction(ETAT_FORMULAIRE_INITIAL, formData({ anneeRfr: "2024", rfrFoyer: "abc", nombreParts: "1.5" }));
    expect(etat.statut).toBe("erreur");
    expect(etat.statut === "erreur" && etat.message).toMatch(/RFR/);
  });

  it("refuse un format de milliers AMBIGU (30.000,00) plutôt que de deviner", async () => {
    const etat = await enregistrerRfrFoyerAction(ETAT_FORMULAIRE_INITIAL, formData({ anneeRfr: "2024", rfrFoyer: "30.000,00", nombreParts: "1" }));
    expect(etat.statut).toBe("erreur");
  });

  it("accepte les formats humains non ambigus : espaces (ASCII, U+00A0, U+202F) et symbole €", async () => {
    for (const [annee, saisie] of [[2019, "45 000"], [2018, "45\u00a0000 €"], [2017, "45\u202f000,50"]] as const) {
      await enregistrerRfrFoyerAction(ETAT_FORMULAIRE_INITIAL, formData({ anneeRfr: String(annee), rfrFoyer: saisie, nombreParts: " 1,5 " })).catch(() => {});
      const [ligne] = await getDb().select().from(rfrFoyerTable).where(eq(rfrFoyerTable.anneeRfr, annee));
      expect(ligne?.nombrePartsCentiemes, saisie).toBe(150);
      expect(ligne?.rfrFoyerCentimes, saisie).toBe(annee === 2017 ? 4500050 : 4500000);
    }
  });

  it("convertit 1,5 part en 150 centièmes exacts, sans flottant", async () => {
    await enregistrerRfrFoyerAction(ETAT_FORMULAIRE_INITIAL, formData({ anneeRfr: "2024", rfrFoyer: "3000000", nombreParts: "1.5" })).catch(
      () => {}
    );

    const [ligne] = await getDb().select().from(rfrFoyerTable).where(eq(rfrFoyerTable.anneeRfr, 2024));
    expect(ligne?.nombrePartsCentiemes).toBe(150);
  });
});
