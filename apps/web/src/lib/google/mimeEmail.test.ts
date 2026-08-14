import { describe, expect, it } from "vitest";
import { ErreurConstructionEmail, construireMessageRaw } from "./mimeEmail";

function decoderMessage(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("construireMessageRaw", () => {
  it("construit un message valide, encodé en base64url", () => {
    const raw = construireMessageRaw("jean@test.local", "Bonjour", "Contenu du message");
    expect(raw).not.toMatch(/[+/=]/); // pas de caractères base64 standard, uniquement base64url
    const decode = decoderMessage(raw);
    expect(decode).toContain("To: jean@test.local");
    expect(decode).toContain("Contenu du message");
  });

  it("rejette une adresse email invalide", () => {
    expect(() => construireMessageRaw("pas-une-adresse", "Objet", "Corps")).toThrow(ErreurConstructionEmail);
  });

  it("rejette un retour à la ligne dans le destinataire", () => {
    expect(() => construireMessageRaw("jean@test.local\nBcc: pirate@evil.com", "Objet", "Corps")).toThrow(
      ErreurConstructionEmail
    );
  });

  it("rejette un retour à la ligne dans l'objet (protection contre l'injection d'en-têtes)", () => {
    expect(() => construireMessageRaw("jean@test.local", "Objet\r\nBcc: pirate@evil.com", "Corps")).toThrow(
      ErreurConstructionEmail
    );
  });

  it("autorise les retours à la ligne dans le corps (texte libre, pas un en-tête)", () => {
    const raw = construireMessageRaw("jean@test.local", "Objet", "Ligne 1\nLigne 2\nLigne 3");
    const decode = decoderMessage(raw);
    expect(decode).toContain("Ligne 1");
    expect(decode).toContain("Ligne 2");
  });

  it("encode l'objet en RFC 2047 (UTF-8/Base64), déchiffrable", () => {
    const raw = construireMessageRaw("jean@test.local", "Été vérifié", "Corps");
    const decode = decoderMessage(raw);
    const ligneSujet = decode.split("\r\n").find((l) => l.startsWith("Subject:"));
    expect(ligneSujet).toMatch(/^Subject: =\?UTF-8\?B\?/);
    const sujetEncode = ligneSujet!.replace("Subject: =?UTF-8?B?", "").replace("?=", "");
    expect(Buffer.from(sujetEncode, "base64").toString("utf8")).toBe("Été vérifié");
  });

  it("préserve les accents du corps en UTF-8", () => {
    const raw = construireMessageRaw("jean@test.local", "Objet", "Café, thé, à bientôt");
    expect(decoderMessage(raw)).toContain("Café, thé, à bientôt");
  });
});
