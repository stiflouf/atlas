import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// ADR-049 / ADR-047 : fournit le test comportemental direct — un appel anonyme doit échouer AVANT
// toute lecture/mutation métier. Séparé de transmissionDossierNotaire.test.ts (comportement métier,
// session mockée valide) pour ne jamais mélanger deux stratégies de mock dans un seul fichier.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockRejectedValue(new Error("Non authentifié.")),
}));

const { getDb } = await import("@/db/client");
const { transmissionsDossierNotaire: transmissionsTable } = await import("@/db/schema");
const { enregistrerTransmissionDossierNotaireAction } = await import("./transmissionDossierNotaire");

afterAll(async () => {
  // Rien ne devrait jamais avoir été créé — nettoyage défensif uniquement, par sécurité.
  await getDb().delete(transmissionsTable).where(eq(transmissionsTable.etudeNom, "[test réel] ETUDE-SECURITE"));
});

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("enregistrerTransmissionDossierNotaireAction — sécurité (ADR-047)", () => {
  it("anonyme échoue AVANT toute lecture/mutation métier — aucune transmission créée", async () => {
    await expect(
      enregistrerTransmissionDossierNotaireAction(
        null,
        formData({
          compromisId: "00000000-0000-0000-0000-000000000000",
          cleIdempotence: crypto.randomUUID(),
          documentIds: "00000000-0000-0000-0000-000000000001",
          etudeNom: "[test réel] ETUDE-SECURITE",
        })
      )
    ).rejects.toThrow(/non authentifié/i);

    const lignes = await getDb().select().from(transmissionsTable).where(eq(transmissionsTable.etudeNom, "[test réel] ETUDE-SECURITE"));
    expect(lignes).toHaveLength(0);
  });
});
