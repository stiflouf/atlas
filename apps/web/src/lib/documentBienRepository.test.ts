import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : la FK documents_bien -> biens impose un bienId réel, donc un mock ne
// suffit pas ici. Repli sur le même DATABASE_URL par défaut que drizzle.config.ts (Postgres
// local de dev) si non défini par l'environnement — même principe que noteBienRepository.test.ts.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, documentsBien: documentsBienTable } = await import("@/db/schema");
const { listerDocumentsPourBien, getDocumentBienById, enregistrerDocumentBien } = await import(
  "./documentBienRepository"
);

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(documentsBienTable).where(eq(documentsBienTable.id, id));
  }
});

describe("documentBienRepository (intégration Postgres)", () => {
  it("retourne [] pour un id non-UUID (bien mocké), sans erreur de cast", async () => {
    await expect(listerDocumentsPourBien("bien-001")).resolves.toEqual([]);
  });

  it("getDocumentBienById() retourne undefined pour un id non-UUID ou inexistant", async () => {
    await expect(getDocumentBienById("doc-mock")).resolves.toBeUndefined();
    await expect(getDocumentBienById("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });

  it("enregistrerDocumentBien() persiste la métadonnée, listerDocumentsPourBien() la retrouve triée DESC", async () => {
    const [bien] = await getDb().select({ id: biensTable.id }).from(biensTable).limit(1);
    if (!bien) throw new Error("Aucun bien réel en base pour ce test d'intégration.");

    const premier = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Premier document",
      categorie: "diagnostic",
      nomFichierOriginal: "dpe.pdf",
      cleStockage: "cle-test-1",
      tailleOctets: 1024,
      typeMime: "application/pdf",
    });
    idsCrees.push(premier.id);
    const second = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Second document, plus récent",
      categorie: "mandat",
      nomFichierOriginal: "mandat.pdf",
      cleStockage: "cle-test-2",
      tailleOctets: 2048,
      typeMime: "application/pdf",
    });
    idsCrees.push(second.id);

    const documents = await listerDocumentsPourBien(bien.id);
    const pertinents = documents.filter((d) => d.id === premier.id || d.id === second.id);

    expect(pertinents.map((d) => d.id)).toEqual([second.id, premier.id]);

    const resolu = await getDocumentBienById(premier.id);
    expect(resolu).toMatchObject({
      nom: "Premier document",
      categorie: "diagnostic",
      nomFichierOriginal: "dpe.pdf",
      cleStockage: "cle-test-1",
      tailleOctets: 1024,
      typeMime: "application/pdf",
    });
  });
});
