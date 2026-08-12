import { afterAll, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { ecrireDocument, genererCleStockage, lireDocument } from "./stockageDocuments";

// Chemin reconstruit indépendamment du module (même logique que STORAGE_ROOT) uniquement pour le
// nettoyage du test — pas une capacité de suppression exposée par stockageDocuments.ts (aucune
// suppression en V1, voir ADR stockage local).
const clesCreees: string[] = [];

afterAll(async () => {
  for (const cle of clesCreees) {
    await rm(path.join(process.cwd(), "stockage-documents", cle), { force: true });
  }
});

describe("stockageDocuments", () => {
  it("genererCleStockage() produit des clés uniques au format UUID", () => {
    const a = genererCleStockage();
    const b = genererCleStockage();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("ecrireDocument() puis lireDocument() retrouve le contenu exact via la clé", async () => {
    const cle = genererCleStockage();
    clesCreees.push(cle);
    const contenu = Buffer.from("contenu de test");

    await ecrireDocument(cle, contenu);
    const relu = await lireDocument(cle);

    expect(relu).toBeDefined();
    expect(Buffer.compare(relu as Buffer, contenu)).toBe(0);
  });

  it("lireDocument() retourne undefined pour une clé inexistante, sans lever d'exception", async () => {
    await expect(lireDocument(genererCleStockage())).resolves.toBeUndefined();
  });
});
