import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : la FK notes_bien -> biens impose un bienId réel, donc un mock ne suffit
// pas ici. Repli sur le même DATABASE_URL par défaut que drizzle.config.ts (Postgres local de
// dev) si non défini par l'environnement — même principe que actionRepository.test.ts.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, notesBien: notesBienTable } = await import("@/db/schema");
const { listerNotesPourBien, ajouterNoteBien } = await import("./noteBienRepository");

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(notesBienTable).where(eq(notesBienTable.id, id));
  }
});

describe("noteBienRepository (intégration Postgres)", () => {
  it("retourne [] pour un id non-UUID (bien mocké), sans erreur de cast", async () => {
    await expect(listerNotesPourBien("bien-001")).resolves.toEqual([]);
  });

  it("ajouterNoteBien() persiste la note, listerNotesPourBien() la retrouve triée DESC", async () => {
    const [bien] = await getDb().select({ id: biensTable.id }).from(biensTable).limit(1);
    if (!bien) throw new Error("Aucun bien réel en base pour ce test d'intégration.");

    const premiere = await ajouterNoteBien(bien.id, "Première note.");
    idsCrees.push(premiere.id);
    const seconde = await ajouterNoteBien(bien.id, "Seconde note, plus récente.");
    idsCrees.push(seconde.id);

    const notes = await listerNotesPourBien(bien.id);
    const idsPertinents = notes.filter((n) => n.id === premiere.id || n.id === seconde.id);

    expect(idsPertinents.map((n) => n.id)).toEqual([seconde.id, premiere.id]);
  });
});
