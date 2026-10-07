import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { genererPdfBonVisite } from "./pdfBonVisite";
import { texteVisiblePdfDeTest } from "./texteVisiblePdfDeTest";
import { TEXTE_CONSENTEMENT_BON_VISITE_V2, VERSION_TEMPLATE_BON_VISITE_V2 } from "./templateBonVisite";
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

const SNAPSHOT_V2: SnapshotBonVisite = {
  ...SNAPSHOT,
  visite: { id: "visite-1", datePrevue: "2026-06-01", realiseeLe: "2026-06-04T08:15:00.000Z" },
  template: { version: VERSION_TEMPLATE_BON_VISITE_V2, texte: "Le bien a ete visite avec le concours du conseiller." },
  consentement: { texte: TEXTE_CONSENTEMENT_BON_VISITE_V2, version: VERSION_TEMPLATE_BON_VISITE_V2 },
};

const BON = { id: "11111111-2222-3333-4444-555555555555", version: 3 };

describe("genererPdfBonVisite (§14/§15)", () => {
  it("produit un vrai PDF (signature %PDF), contenant une image de signature", async () => {
    const bytes = await genererPdfBonVisite({
      contenuSnapshot: SNAPSHOT,
      bon: BON,
      signataire: { nomComplet: "Marie Dupont", roleSignataire: "principal" },
      signatureImagePng: await pngSignatureFactice(),
      signeLe: new Date("2026-06-01T10:00:00Z"),
    });
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  // T7/T8/T9/T10 (BON_VISITE_LEGAL_HARDENING_V2)
  it("V2 — imprime titre, texte, consentement exact, rôle lisible, horodatage, référence et version", async () => {
    const bytes = await genererPdfBonVisite({
      contenuSnapshot: SNAPSHOT_V2,
      bon: BON,
      signataire: { nomComplet: "Marie Dupont", roleSignataire: "principal" },
      signatureImagePng: await pngSignatureFactice(),
      signeLe: new Date("2026-06-04T10:30:00Z"),
    });
    const texte = texteVisiblePdfDeTest(bytes);

    expect(texte).toContain("BON DE VISITE");
    expect(texte).toContain("ATTESTATION DE VISITE");
    expect(texte).toContain("Le bien a ete visite avec le concours du conseiller.");
    // T7 — la formule reproduite est la formule exacte du snapshot, mot pour mot.
    for (const fragment of TEXTE_CONSENTEMENT_BON_VISITE_V2.split(" ")) {
      expect(texte).toContain(fragment);
    }
    // T10 — libellé humain, jamais la valeur brute du vocabulaire.
    expect(texte).toContain("Signataire principal");
    expect(texte).not.toContain("(principal)");
    // Date ET heure de signature (fuseau Europe/Paris : 10:30 UTC = 12:30) — seule date que le
    // produit prouve quand la Visite n'était pas encore réalisée.
    expect(texte).toContain("4 juin 2026");
    expect(texte).toContain("12:30");
    // T8/T9 — référence stable du bon et version du modèle.
    expect(texte).toContain(BON.id);
    expect(texte).toContain("version 3");
    expect(texte).toContain(VERSION_TEMPLATE_BON_VISITE_V2);
  });

  // I10 — le hash est une métadonnée EXTERNE : l'imprimer modifierait ce qu'il mesure.
  it("n'imprime aucun hash SHA-256 du document", async () => {
    const bytes = await genererPdfBonVisite({
      contenuSnapshot: SNAPSHOT_V2,
      bon: BON,
      signataire: { nomComplet: "Marie Dupont", roleSignataire: "principal" },
      signatureImagePng: await pngSignatureFactice(),
      signeLe: new Date("2026-06-04T10:30:00Z"),
    });
    const texte = texteVisiblePdfDeTest(bytes);
    expect(texte.toLowerCase()).not.toContain("sha-256");
    expect(texte.toLowerCase()).not.toContain("sha256");
    expect(texte).not.toMatch(/\b[0-9a-f]{64}\b/);
  });

  // T11/T12 — un snapshot domiora-v1 garde son titre et n'acquiert jamais un bloc consentement
  // reconstitué après coup.
  it("V1 — titre d'origine conservé, aucun bloc consentement inventé", async () => {
    const bytes = await genererPdfBonVisite({
      contenuSnapshot: SNAPSHOT,
      bon: BON,
      signataire: { nomComplet: "Marie Dupont", roleSignataire: "secondaire" },
      signatureImagePng: await pngSignatureFactice(),
      signeLe: new Date("2026-06-01T10:00:00Z"),
    });
    const texte = texteVisiblePdfDeTest(bytes);
    expect(texte).toContain("BON DE VISITE");
    expect(texte).not.toContain("ATTESTATION DE VISITE");
    expect(texte).not.toContain("Consentement");
    expect(texte).toContain("Second signataire");
  });
});
