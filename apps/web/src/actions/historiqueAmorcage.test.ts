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

// Même remarque que profilFiscal.test.ts : dossier 'default' mono-dossier, nettoyé en afterAll —
// exécuter la validation navigateur après `pnpm test`.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { historiqueAmorcage: historiqueAmorcageTable } = await import("@/db/schema");
const { enregistrerHistoriqueAmorcageAction } = await import("./historiqueAmorcage");

afterAll(async () => {
  await getDb().delete(historiqueAmorcageTable).where(eq(historiqueAmorcageTable.dossierFiscalId, "default"));
});

const ETAT_FORMULAIRE_INITIAL = { statut: "idle" } as const;

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

// DEMO_UX_HARDENING_V1 — refus de saisie rendus au formulaire (FORM_FEEDBACK_V1), jamais error.tsx.
describe("enregistrerHistoriqueAmorcageAction — garde-fous", () => {
  it("refuse une date de fin de couverture hors de l'année déclarée, en état de formulaire", async () => {
    const anneeEnCours = new Date().getFullYear();
    const etat = await enregistrerHistoriqueAmorcageAction(
      ETAT_FORMULAIRE_INITIAL,
      formData({ annee: String(anneeEnCours), montantEncaisse: "50000", dateFinCouverture: `${anneeEnCours - 1}-12-31` })
    );
    expect(etat.statut === "erreur" && etat.message).toMatch(/année déclarée/);
  });

  it("refuse une date de fin de couverture absente pour l'année en cours, en état de formulaire", async () => {
    const anneeEnCours = new Date().getFullYear();
    const etat = await enregistrerHistoriqueAmorcageAction(
      ETAT_FORMULAIRE_INITIAL,
      formData({ annee: String(anneeEnCours), montantEncaisse: "50000" })
    );
    expect(etat.statut === "erreur" && etat.message).toMatch(/obligatoire/);
  });

  it("accepte un montant collé depuis un tableur (espace insécable et €)", async () => {
    await enregistrerHistoriqueAmorcageAction(ETAT_FORMULAIRE_INITIAL, formData({ annee: "2021", montantEncaisse: "12\u00a0000 €" })).catch(() => {});
    const [ligne] = await getDb().select().from(historiqueAmorcageTable).where(eq(historiqueAmorcageTable.annee, 2021));
    expect(ligne?.montantEncaisseCentimes).toBe(1200000);
  });

  it("pose automatiquement le 31 décembre pour une année révolue, sans que le champ soit fourni", async () => {
    await enregistrerHistoriqueAmorcageAction(ETAT_FORMULAIRE_INITIAL, formData({ annee: "2023", montantEncaisse: "1200000" })).catch(() => {});

    const [ligne] = await getDb()
      .select()
      .from(historiqueAmorcageTable)
      .where(eq(historiqueAmorcageTable.annee, 2023));
    expect(ligne?.dateFinCouverture).toBe("2023-12-31");
  });

  it("refuse un montant invalide, en état de formulaire", async () => {
    const etat = await enregistrerHistoriqueAmorcageAction(ETAT_FORMULAIRE_INITIAL, formData({ annee: "2022", montantEncaisse: "abc" }));
    expect(etat.statut === "erreur" && etat.message).toMatch(/Montant/);
  });
});
