import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

// ADR-047, §35 de l'audit : enregistrerValidationBien (validationRendezVous.ts) n'avait jusqu'ici
// AUCUN test, direct ou indirect (confirmé par recherche exhaustive lors de l'audit). Comportement
// métier ici, session Atlas mockée comme valide — le refus anonyme réel est couvert séparément par
// validationRendezVous.securite.test.ts (jamais deux stratégies de mock dans un seul fichier).
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, memoireContextuelle } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { enregistrerValidationBien } = await import("./validationRendezVous");

// apps/web/src/data/agenda.ts — rendez-vous mock existant (id fixe, aucune écriture DB requise
// pour le retrouver via getRendezVousAvecContexte, contrairement à un id "gcal-*" réel).
const RDV_MOCK_ID = "rdv-001";
const SOURCE_GOOGLE_CALENDAR = "google_calendar";

const idsBiensCrees: string[] = [];

afterAll(async () => {
  await getDb()
    .delete(memoireContextuelle)
    .where(and(eq(memoireContextuelle.source, SOURCE_GOOGLE_CALENDAR), eq(memoireContextuelle.identifiantExterne, RDV_MOCK_ID)));
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
});

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] VALIDATION-RDV-${suffixe}`,
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function ligneMemoire() {
  const [ligne] = await getDb()
    .select()
    .from(memoireContextuelle)
    .where(and(eq(memoireContextuelle.source, SOURCE_GOOGLE_CALENDAR), eq(memoireContextuelle.identifiantExterne, RDV_MOCK_ID)));
  return ligne;
}

describe("enregistrerValidationBien — comportement métier", () => {
  it("decision 'confirme' fige le bien choisi par le conseiller, confiance maximale (ADR-006)", async () => {
    const bien = await creerBienDeTest("CONFIRME");

    await enregistrerValidationBien(RDV_MOCK_ID, "confirme", bien.id);

    const ligne = await ligneMemoire();
    expect(ligne?.statutValidation).toBe("confirme");
    expect(ligne?.bienId).toBe(bien.id);
    expect(ligne?.confidenceBien).toBe(1);
  });

  it("decision 'ignore' efface le bien même si un bienId est fourni", async () => {
    const bien = await creerBienDeTest("IGNORE");

    await enregistrerValidationBien(RDV_MOCK_ID, "ignore", bien.id);

    const ligne = await ligneMemoire();
    expect(ligne?.statutValidation).toBe("ignore");
    expect(ligne?.bienId).toBeNull();
  });

  it("decision 'corrige' persiste le nouveau bien choisi par le conseiller", async () => {
    const bien = await creerBienDeTest("CORRIGE");

    await enregistrerValidationBien(RDV_MOCK_ID, "corrige", bien.id);

    const ligne = await ligneMemoire();
    expect(ligne?.statutValidation).toBe("corrige");
    expect(ligne?.bienId).toBe(bien.id);
  });

  it("rendez-vous introuvable : retour silencieux, aucune mutation (comportement existant, non modifié)", async () => {
    await expect(enregistrerValidationBien("rdv-inexistant-xyz", "confirme", null)).resolves.toBeUndefined();

    const [ligne] = await getDb()
      .select()
      .from(memoireContextuelle)
      .where(
        and(eq(memoireContextuelle.source, SOURCE_GOOGLE_CALENDAR), eq(memoireContextuelle.identifiantExterne, "rdv-inexistant-xyz"))
      );
    expect(ligne).toBeUndefined();
  });
});
