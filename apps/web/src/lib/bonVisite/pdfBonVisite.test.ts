import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { genererPdfBonVisite } from "./pdfBonVisite";
import type { SnapshotBonVisite } from "@/types/bonVisite";

async function pngSignatureFactice(): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 255 } } })
    .png()
    .toBuffer();
}

const SNAPSHOT: SnapshotBonVisite = {
  visite: { id: "visite-1", datePrevue: "2026-06-01" },
  bien: { id: "bien-1", reference: "REF-1", titre: "Bel appartement", adresse: "1 rue Test", ville: "Testville", codePostal: "00000" },
  conseiller: { nom: "Conseiller DOMIORA" },
  template: { version: "domiora-v1", texte: "Bon de visite\n\nTexte du bon." },
};

describe("genererPdfBonVisite (§14/§15)", () => {
  it("produit un vrai PDF (signature %PDF), contenant une image de signature", async () => {
    const bytes = await genererPdfBonVisite({
      contenuSnapshot: SNAPSHOT,
      signataire: { nomComplet: "Marie Dupont", roleSignataire: "principal" },
      signatureImagePng: await pngSignatureFactice(),
      signeLe: new Date("2026-06-01T10:00:00Z"),
    });
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
