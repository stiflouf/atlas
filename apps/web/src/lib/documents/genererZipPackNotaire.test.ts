import { afterAll, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { ErreurGenerationPack, MAX_TAILLE_PACK_OCTETS, genererZipPackNotaire } from "./genererZipPackNotaire";
import { calculerPackNotaire } from "./packNotaire";
import { ecrireDocument, genererCleStockage } from "@/lib/stockageDocuments";
import type { Bien } from "@/types/bien";
import type { DocumentBien } from "@/types/documentBien";

const clesCreees: string[] = [];
afterAll(async () => {
  for (const cle of clesCreees) {
    await rm(path.join(process.cwd(), "stockage-documents", cle), { force: true });
  }
});

const bien: Bien = {
  id: "bien-1",
  reference: "REF-1",
  titre: "Appartement test",
  type: "appartement",
  adresse: "1 rue Test",
  ville: "Testville",
  codePostal: "00000",
  surface: 50,
  pieces: 3,
  prix: 300000,
  statutMandat: "actif",
  dateMandat: "2026-01-01",
  caracteristiques: [],
  description: "",
};

let compteur = 0;
function creerDocument(overrides: Partial<DocumentBien> = {}): DocumentBien {
  compteur += 1;
  return {
    id: `doc-${compteur}`,
    bienId: bien.id,
    nom: `Document ${compteur}`,
    categorie: "autre",
    nomFichierOriginal: "fichier.pdf",
    cleStockage: `cle-inexistante-${compteur}`,
    tailleOctets: 1024,
    typeMime: "application/pdf",
    creeLe: "2026-01-10T10:00:00.000Z",
    etatVerification: "confirme",
    ...overrides,
  };
}

async function creerDocumentAvecFichier(contenu: Buffer, overrides: Partial<DocumentBien> = {}) {
  const cleStockage = genererCleStockage();
  clesCreees.push(cleStockage);
  await ecrireDocument(cleStockage, contenu);
  return creerDocument({ cleStockage, tailleOctets: contenu.byteLength, ...overrides });
}

const pack = calculerPackNotaire({ bien }, [], new Date("2026-06-01T00:00:00.000Z"));

describe("genererZipPackNotaire — atomicité", () => {
  it("rejette une sélection vide sans générer de ZIP", async () => {
    await expect(genererZipPackNotaire({ bien }, pack, [])).rejects.toThrow(ErreurGenerationPack);
  });

  it("génère un ZIP contenant les documents renommés et le manifeste", async () => {
    const doc1 = await creerDocumentAvecFichier(Buffer.from("contenu 1"), { typeDocument: "titre_propriete" });
    const doc2 = await creerDocumentAvecFichier(Buffer.from("contenu 2"), { typeDocument: "dpe" });

    const zipBuffer = await genererZipPackNotaire({ bien }, pack, [doc1, doc2]);
    const zip = await JSZip.loadAsync(zipBuffer);

    const noms = Object.keys(zip.files);
    expect(noms).toContain("01_Titre_de_propriete.pdf");
    expect(noms).toContain("02_DPE.pdf");
    expect(noms).toContain("manifeste.txt");

    const contenu1 = await zip.file("01_Titre_de_propriete.pdf")?.async("string");
    expect(contenu1).toBe("contenu 1");
  });

  it("aucun ZIP n'est retourné si un document sélectionné est physiquement introuvable — erreur explicite le nommant", async () => {
    const docValide = await creerDocumentAvecFichier(Buffer.from("contenu valide"), { nom: "Titre valide" });
    const docManquant = creerDocument({ nom: "Fichier fantôme", cleStockage: "cle-jamais-ecrite" });

    await expect(genererZipPackNotaire({ bien }, pack, [docValide, docManquant])).rejects.toThrow(
      /Fichier fantôme/
    );
    await expect(genererZipPackNotaire({ bien }, pack, [docValide, docManquant])).rejects.toThrow(
      ErreurGenerationPack
    );
  });

  it("jamais 17 demandés -> 16 exportés silencieusement : un seul document illisible fait échouer tout le lot", async () => {
    const docs = await Promise.all(
      Array.from({ length: 4 }, (_, i) => creerDocumentAvecFichier(Buffer.from(`contenu ${i}`), { nom: `Doc ${i}` }))
    );
    const docIllisible = creerDocument({ nom: "Illisible", cleStockage: "cle-jamais-ecrite-2" });

    await expect(genererZipPackNotaire({ bien }, pack, [...docs, docIllisible])).rejects.toThrow(
      ErreurGenerationPack
    );
  });
});

describe("genererZipPackNotaire — garde-fou de taille (MAX_TAILLE_PACK_OCTETS)", () => {
  it("rejette explicitement au-delà de la limite, sans lire aucun fichier", async () => {
    const doc = creerDocument({ tailleOctets: MAX_TAILLE_PACK_OCTETS + 1 });
    await expect(genererZipPackNotaire({ bien }, pack, [doc])).rejects.toThrow(/taille maximale autorisée/);
  });

  it("accepte exactement la limite (frontière inclusive) — la vérification de taille passe avant la lecture", async () => {
    // cleStockage inexistante : si le garde-fou de taille avait rejeté, l'erreur serait
    // "taille maximale" ; ici l'échec attendu est "fichier introuvable", preuve que la
    // vérification de taille a bien laissé passer une somme exactement égale à la limite.
    const doc = creerDocument({ tailleOctets: MAX_TAILLE_PACK_OCTETS });
    await expect(genererZipPackNotaire({ bien }, pack, [doc])).rejects.toThrow(/Fichier introuvable/);
  });

  it("la somme cumulée déclenche le refus même si aucun document pris isolément ne dépasse la limite", async () => {
    const moitiePlusUn = Math.floor(MAX_TAILLE_PACK_OCTETS / 2) + 1;
    const docA = creerDocument({ tailleOctets: moitiePlusUn, nom: "A" });
    const docB = creerDocument({ tailleOctets: moitiePlusUn, nom: "B" });
    await expect(genererZipPackNotaire({ bien }, pack, [docA, docB])).rejects.toThrow(/taille maximale autorisée/);
  });
});
