import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PREFIXE_DATA_URL_PNG, TAILLE_MAX_SIGNATURE_OCTETS, validerEtDecoderSignatureImage } from "./validationSignatureImage";

async function pngNonVide(): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 255 } } })
    .png()
    .toBuffer();
}

async function pngTransparent(): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
}

describe("validerEtDecoderSignatureImage (§29/§42/§43/§44)", () => {
  it("accepte un PNG réel avec des pixels non transparents", async () => {
    const dataUrl = PREFIXE_DATA_URL_PNG + (await pngNonVide()).toString("base64");
    const resultat = await validerEtDecoderSignatureImage(dataUrl);
    expect(resultat.statut).toBe("valide");
  });

  it("§29/§56 — refuse un PNG réel mais entièrement transparent (canvas jamais touché), jamais une simple vérification de chaîne non vide", async () => {
    const dataUrl = PREFIXE_DATA_URL_PNG + (await pngTransparent()).toString("base64");
    const resultat = await validerEtDecoderSignatureImage(dataUrl);
    expect(resultat.statut).toBe("vide");
  });

  it("refuse une chaîne vide", async () => {
    expect((await validerEtDecoderSignatureImage("")).statut).toBe("absente");
  });

  it("§42/§44 — refuse un préfixe MIME différent (ne fait jamais confiance au type déclaré)", async () => {
    const dataUrl = "data:image/jpeg;base64," + (await pngNonVide()).toString("base64");
    expect((await validerEtDecoderSignatureImage(dataUrl)).statut).toBe("absente");
  });

  it("§44 — refuse un contenu qui n'est pas réellement un PNG, même avec le bon préfixe déclaré", async () => {
    const dataUrl = PREFIXE_DATA_URL_PNG + Buffer.from("ceci n'est pas une image").toString("base64");
    expect((await validerEtDecoderSignatureImage(dataUrl)).statut).toBe("format_invalide");
  });

  it("§43 — refuse un payload dépassant la taille maximale, résultat contrôlé", async () => {
    const enorme = Buffer.alloc(TAILLE_MAX_SIGNATURE_OCTETS + 1, 1);
    const dataUrl = PREFIXE_DATA_URL_PNG + enorme.toString("base64");
    expect((await validerEtDecoderSignatureImage(dataUrl)).statut).toBe("trop_grande");
  });
});
