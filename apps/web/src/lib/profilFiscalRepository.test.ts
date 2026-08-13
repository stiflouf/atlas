import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration — dossier_fiscal dédié à ce fichier (id aléatoire, jamais 'default') pour ne
// pas interférer avec le dossier utilisé par l'UI en environnement de dev. ON DELETE CASCADE sur
// profil_fiscal.dossierFiscalId : supprimer le dossier de test nettoie tout.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { dossierFiscal: dossierFiscalTable } = await import("@/db/schema");
const { enregistrerProfilFiscal, chargerProfilFiscalADate } = await import("./profilFiscalRepository");

const DOSSIER_TEST_ID = "test-dossier-profil-fiscal";

afterAll(async () => {
  await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, DOSSIER_TEST_ID));
});

function profil(dateDebutValidite: string, regimeFiscal: "micro_bnc" | "declaration_controlee" | "inconnu") {
  return {
    dossierFiscalId: DOSSIER_TEST_ID,
    dateDebutValidite,
    natureActivite: "agent_commercial_immobilier" as const,
    dateDebutActivite: "2024-01-01",
    regimeFiscal,
    regimeTva: "franchise" as const,
    periodiciteUrssaf: "mensuelle" as const,
    affiliationRetraite: "ssi_regime_general" as const,
  };
}

describe("profilFiscalRepository — résolution par date et corrections rétroactives", () => {
  it("prépare un dossier fiscal de test", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_TEST_ID }).onConflictDoNothing();
  });

  it("résout le bon instantané selon la date, y compris après insertion rétroactive dans le passé", async () => {
    await enregistrerProfilFiscal(profil("2026-06-01", "declaration_controlee"));

    // Correction rétroactive découverte après coup : date antérieure à l'instantané déjà existant,
    // acceptée sans contrainte d'ordre d'insertion (point 2).
    await enregistrerProfilFiscal(profil("2026-01-01", "micro_bnc"));

    const avantJuin = await chargerProfilFiscalADate(DOSSIER_TEST_ID, "2026-03-01");
    expect(avantJuin?.regimeFiscal).toBe("micro_bnc");

    const apresJuin = await chargerProfilFiscalADate(DOSSIER_TEST_ID, "2026-08-01");
    expect(apresJuin?.regimeFiscal).toBe("declaration_controlee");

    const avantTout = await chargerProfilFiscalADate(DOSSIER_TEST_ID, "2025-12-31");
    expect(avantTout).toBeUndefined();
  });

  it("en cas d'égalité de dateDebutValidite, la ligne la plus récemment créée fait foi", async () => {
    await enregistrerProfilFiscal(profil("2026-09-01", "micro_bnc"));
    // Deuxième insertion le même jour métier (correction immédiate d'une erreur de saisie) :
    // supplante la précédente pour la lecture, sans la supprimer.
    await enregistrerProfilFiscal(profil("2026-09-01", "declaration_controlee"));

    const resultat = await chargerProfilFiscalADate(DOSSIER_TEST_ID, "2026-09-01");
    expect(resultat?.regimeFiscal).toBe("declaration_controlee");
  });
});
