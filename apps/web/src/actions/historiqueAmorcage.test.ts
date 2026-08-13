import { afterAll, describe, expect, it } from "vitest";
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

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("enregistrerHistoriqueAmorcageAction — garde-fous", () => {
  it("refuse explicitement (throw) une date de fin de couverture hors de l'année déclarée", async () => {
    const anneeEnCours = new Date().getFullYear();
    await expect(
      enregistrerHistoriqueAmorcageAction(
        formData({ annee: String(anneeEnCours), montantEncaisse: "50000", dateFinCouverture: `${anneeEnCours - 1}-12-31` })
      )
    ).rejects.toThrow(/année déclarée/);
  });

  it("refuse explicitement (throw) une date de fin de couverture absente pour l'année en cours", async () => {
    const anneeEnCours = new Date().getFullYear();
    await expect(
      enregistrerHistoriqueAmorcageAction(formData({ annee: String(anneeEnCours), montantEncaisse: "50000" }))
    ).rejects.toThrow(/obligatoire/);
  });

  it("pose automatiquement le 31 décembre pour une année révolue, sans que le champ soit fourni", async () => {
    await enregistrerHistoriqueAmorcageAction(formData({ annee: "2023", montantEncaisse: "1200000" })).catch(() => {});

    const [ligne] = await getDb()
      .select()
      .from(historiqueAmorcageTable)
      .where(eq(historiqueAmorcageTable.annee, 2023));
    expect(ligne?.dateFinCouverture).toBe("2023-12-31");
  });

  it("refuse explicitement (throw) un montant invalide", async () => {
    await expect(
      enregistrerHistoriqueAmorcageAction(formData({ annee: "2022", montantEncaisse: "abc" }))
    ).rejects.toThrow(/Montant/);
  });
});
