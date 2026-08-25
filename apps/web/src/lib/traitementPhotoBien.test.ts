import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ErreurPhotoInvalide, traiterPhotoBien } from "./traitementPhotoBien";

// Fixtures générées à la volée (pas de binaire committé) — un pixel de couleur suffit à produire
// un fichier JPEG/PNG/WebP réellement décodable par Sharp.
async function fixtureJpeg(largeur = 40, hauteur = 30): Promise<Buffer> {
  return sharp({ create: { width: largeur, height: hauteur, channels: 3, background: { r: 200, g: 20, b: 20 } } })
    .jpeg()
    .toBuffer();
}
async function fixturePng(largeur = 40, hauteur = 30): Promise<Buffer> {
  return sharp({ create: { width: largeur, height: hauteur, channels: 4, background: { r: 20, g: 200, b: 20, alpha: 1 } } })
    .png()
    .toBuffer();
}
async function fixtureWebp(largeur = 40, hauteur = 30): Promise<Buffer> {
  return sharp({ create: { width: largeur, height: hauteur, channels: 3, background: { r: 20, g: 20, b: 200 } } })
    .webp()
    .toBuffer();
}
async function fixtureGif(): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } } }).gif().toBuffer();
}

describe("traiterPhotoBien() — ADR-052, décodage réel via Sharp", () => {
  it("JPEG réel : accepté, MIME canonique image/jpeg, WebP produit", async () => {
    const resultat = await traiterPhotoBien(await fixtureJpeg());
    expect(resultat.typeMimeOriginal).toBe("image/jpeg");
    const meta = await sharp(resultat.bufferOptimise).metadata();
    expect(meta.format).toBe("webp");
  });

  it("PNG réel : accepté, MIME canonique image/png, WebP produit", async () => {
    const resultat = await traiterPhotoBien(await fixturePng());
    expect(resultat.typeMimeOriginal).toBe("image/png");
    const meta = await sharp(resultat.bufferOptimise).metadata();
    expect(meta.format).toBe("webp");
  });

  it("WebP réel : accepté, MIME canonique image/webp, WebP produit", async () => {
    const resultat = await traiterPhotoBien(await fixtureWebp());
    expect(resultat.typeMimeOriginal).toBe("image/webp");
    const meta = await sharp(resultat.bufferOptimise).metadata();
    expect(meta.format).toBe("webp");
  });

  it("le MIME persisté est celui réellement décodé — aucune entrée file.type n'est même acceptée par cette fonction, seul le contenu compte", async () => {
    const octetsReellementJpeg = await fixtureJpeg();
    const resultat = await traiterPhotoBien(octetsReellementJpeg);
    expect(resultat.typeMimeOriginal).toBe("image/jpeg");
  });

  it("format non supporté (GIF) : rejeté explicitement, jamais silencieusement accepté", async () => {
    await expect(traiterPhotoBien(await fixtureGif())).rejects.toThrow(ErreurPhotoInvalide);
  });

  it("contenu réellement corrompu/illisible : rejeté, jamais une exception Sharp brute", async () => {
    await expect(traiterPhotoBien(Buffer.from("ceci n'est pas une image"))).rejects.toThrow(ErreurPhotoInvalide);
  });

  it("faux JPEG (octets arbitraires, en-tête JPEG absent) : rejeté", async () => {
    const faux = Buffer.concat([Buffer.from([0x00, 0x01, 0x02, 0x03]), Buffer.alloc(50, 0xff)]);
    await expect(traiterPhotoBien(faux)).rejects.toThrow(ErreurPhotoInvalide);
  });

  it("withoutEnlargement : une image déjà plus petite que 1600px n'est jamais agrandie", async () => {
    const original = await fixtureJpeg(40, 30);
    const resultat = await traiterPhotoBien(original);
    const meta = await sharp(resultat.bufferOptimise).metadata();
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(30);
  });

  it("fit inside : une image plus grande que 1600px sur le grand côté est réduite, ratio conservé", async () => {
    const original = await fixtureJpeg(2000, 1000);
    const resultat = await traiterPhotoBien(original);
    const meta = await sharp(resultat.bufferOptimise).metadata();
    expect(meta.width).toBeLessThanOrEqual(1600);
    expect(meta.height).toBeLessThanOrEqual(1600);
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(800); // ratio 2:1 conservé
  });

  it("hashSha256 : déterministe pour un même contenu, différent pour un contenu différent", async () => {
    const original = await fixtureJpeg();
    const r1 = await traiterPhotoBien(original);
    const r2 = await traiterPhotoBien(Buffer.from(original)); // copie, mêmes octets
    expect(r1.hashSha256).toBe(r2.hashSha256);
    expect(r1.hashSha256).toMatch(/^[0-9a-f]{64}$/);

    const autre = await traiterPhotoBien(await fixtureJpeg(41, 30));
    expect(autre.hashSha256).not.toBe(r1.hashSha256);
  });
});
