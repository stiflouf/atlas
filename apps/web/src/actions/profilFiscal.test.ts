import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
import { eq } from "drizzle-orm";

// Garde-fous portés par la Server Action (ADR-023, point 1) : invariants croisés entre
// regimeFiscal/regimeComptable et regimeTva/optionDebits, jamais exprimables en CHECK SQL sur une
// seule colonne.
//
// L'action résout toujours le dossier fiscal 'default' (mono-dossier, ADR-006) : ce fichier
// écrit donc dans le même dossier que l'UI en environnement de dev et nettoie tout le profil
// fiscal 'default' en afterAll. Exécuter ce fichier de test efface le profil fiscal saisi
// manuellement dans le navigateur — lancer la validation navigateur après `pnpm test`, jamais
// avant, tant qu'Atlas reste mono-dossier.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { dossierFiscal: dossierFiscalTable, profilFiscal: profilFiscalTable } = await import("@/db/schema");
const { enregistrerProfilFiscalAction } = await import("./profilFiscal");

afterAll(async () => {
  await getDb().delete(profilFiscalTable).where(eq(profilFiscalTable.dossierFiscalId, "default"));
});

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

const CHAMPS_MINIMAUX = {
  dateDebutValidite: "2026-01-01",
  dateDebutActivite: "2024-01-01",
  regimeTva: "franchise",
  periodiciteUrssaf: "mensuelle",
  affiliationRetraite: "ssi_regime_general",
};

describe("enregistrerProfilFiscalAction — garde-fous", () => {
  it("refuse explicitement (throw) regimeComptable renseigné hors déclaration contrôlée", async () => {
    await expect(
      enregistrerProfilFiscalAction(
        formData({ ...CHAMPS_MINIMAUX, regimeFiscal: "micro_bnc", regimeComptable: "caisse" })
      )
    ).rejects.toThrow(/régime comptable/);
  });

  it("refuse explicitement (throw) optionDebits renseignée en franchise de TVA", async () => {
    await expect(
      enregistrerProfilFiscalAction(
        formData({ ...CHAMPS_MINIMAUX, regimeFiscal: "micro_bnc", regimeTva: "franchise", optionDebits: "oui" })
      )
    ).rejects.toThrow(/débits/);
  });

  it("refuse explicitement (throw) des dates ACRE sans acreActif à oui", async () => {
    await expect(
      enregistrerProfilFiscalAction(
        formData({ ...CHAMPS_MINIMAUX, regimeFiscal: "micro_bnc", acreDateDebut: "2024-01-01" })
      )
    ).rejects.toThrow(/ACRE/);
  });

  it("accepte un instantané cohérent (déclaration contrôlée + régime comptable + TVA redevable + option débits)", async () => {
    await enregistrerProfilFiscalAction(
      formData({
        ...CHAMPS_MINIMAUX,
        regimeFiscal: "declaration_controlee",
        regimeComptable: "engagement",
        regimeTva: "redevable_reel_simplifie",
        optionDebits: "oui",
      })
    ).catch(() => {});

    const [ligne] = await getDb()
      .select()
      .from(profilFiscalTable)
      .where(eq(profilFiscalTable.dossierFiscalId, "default"));
    expect(ligne?.regimeComptable).toBe("engagement");
    expect(ligne?.optionDebits).toBe(true);
  });
});
