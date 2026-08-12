import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : la FK notes_bien -> biens impose un bienId réel, donc un mock ne suffit
// pas ici. Repli sur le même DATABASE_URL par défaut que drizzle.config.ts (Postgres local de
// dev) si non défini par l'environnement — même principe que actionRepository.test.ts.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, notesBien: notesBienTable } = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { listerNotesPourBien, ajouterNoteBien } = await import("./noteBienRepository");

const idsCrees: string[] = [];
const idsBiensCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(notesBienTable).where(eq(notesBienTable.id, id));
  }
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
});

describe("noteBienRepository (intégration Postgres)", () => {
  it("retourne [] pour un id non-UUID (bien mocké), sans erreur de cast", async () => {
    await expect(listerNotesPourBien("bien-001")).resolves.toEqual([]);
  });

  it("ajouterNoteBien() persiste la note, listerNotesPourBien() la retrouve triée DESC", async () => {
    // Bien créé dédié à ce test (plutôt qu'une ligne réelle arbitraire piochée sans tri) : évite
    // une course avec d'autres suites d'intégration qui créent/suppriment leurs propres biens
    // réels en parallèle.
    const bien = await creerBien({
      reference: "[test réel] NOTE-BIEN-001",
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

    const premiere = await ajouterNoteBien(bien.id, "Première note.");
    idsCrees.push(premiere.id);
    const seconde = await ajouterNoteBien(bien.id, "Seconde note, plus récente.");
    idsCrees.push(seconde.id);

    const notes = await listerNotesPourBien(bien.id);
    const idsPertinents = notes.filter((n) => n.id === premiere.id || n.id === seconde.id);

    expect(idsPertinents.map((n) => n.id)).toEqual([seconde.id, premiere.id]);
  });
});
