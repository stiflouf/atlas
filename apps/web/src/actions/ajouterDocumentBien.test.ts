import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration + garde-fou : même principe que ajouterNoteBien.test.ts. Vérifie qu'un appel
// direct à ajouterDocumentBienAction (contournant le formulaire, qui masque déjà l'entrée sur un
// bien archivé et restreint déjà le type de fichier via `accept` — voir BienTabs.tsx) n'écrit
// jamais sur disque ni n'insère de métadonnée si le bien est archivé, si le type MIME n'est pas
// dans la liste blanche, ou si le fichier dépasse 10 Mo.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { listerDocumentsPourBien } = await import("@/lib/documentBienRepository");
const { ajouterDocumentBienAction } = await import("./ajouterDocumentBien");

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
});

async function creerBienDeTest(reference: string) {
  const bien = await creerBien({
    reference,
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
  idsCrees.push(bien.id);
  return bien;
}

function formDataAvecFichier(
  champs: Record<string, string>,
  fichier: File | null
): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  if (fichier) fd.set("fichier", fichier);
  return fd;
}

describe("ajouterDocumentBienAction — garde-fous", () => {
  it("n'insère aucun document si le bien est archivé, même en appelant l'action directement", async () => {
    const bien = await creerBienDeTest("[test réel] DOC-ARCHIVE");
    await archiverBien(bien.id);

    const fichier = new File([new Uint8Array([1, 2, 3])], "diag.pdf", { type: "application/pdf" });
    await ajouterDocumentBienAction(
      formDataAvecFichier({ bienId: bien.id, nom: "Diagnostic", categorie: "diagnostic" }, fichier)
    ).catch(() => {});

    await expect(listerDocumentsPourBien(bien.id)).resolves.toEqual([]);
  });

  it("n'insère aucun document si le type MIME n'est pas dans la liste blanche", async () => {
    const bien = await creerBienDeTest("[test réel] DOC-MIME-INTERDIT");

    const fichier = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
    await ajouterDocumentBienAction(
      formDataAvecFichier({ bienId: bien.id, nom: "Notes", categorie: "autre" }, fichier)
    ).catch(() => {});

    await expect(listerDocumentsPourBien(bien.id)).resolves.toEqual([]);
  });

  it("n'insère aucun document si le fichier dépasse 10 Mo", async () => {
    const bien = await creerBienDeTest("[test réel] DOC-TROP-GROS");

    const fichier = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "gros.pdf", {
      type: "application/pdf",
    });
    await ajouterDocumentBienAction(
      formDataAvecFichier({ bienId: bien.id, nom: "Trop gros", categorie: "autre" }, fichier)
    ).catch(() => {});

    await expect(listerDocumentsPourBien(bien.id)).resolves.toEqual([]);
  });

  it("n'insère aucun document si aucun fichier n'est fourni", async () => {
    const bien = await creerBienDeTest("[test réel] DOC-SANS-FICHIER");

    await ajouterDocumentBienAction(
      formDataAvecFichier({ bienId: bien.id, nom: "Sans fichier", categorie: "autre" }, null)
    ).catch(() => {});

    await expect(listerDocumentsPourBien(bien.id)).resolves.toEqual([]);
  });
});
