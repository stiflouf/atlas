import { describe, expect, it } from "vitest";
import { construireLienMailto } from "./mailto";

describe("construireLienMailto", () => {
  it("construit un lien mailto: avec objet et corps encodés", () => {
    const lien = construireLienMailto("jean@test.local", "Suivi de dossier", "Bonjour Jean,\n\nMerci.");
    expect(lien.startsWith("mailto:jean@test.local?")).toBe(true);
    expect(lien).toContain("subject=Suivi");
    expect(lien).toContain("body=Bonjour");
  });

  it("n'encode jamais l'adresse elle-même (RFC 6068)", () => {
    const lien = construireLienMailto("jean.martin@test.local", "x", "y");
    expect(lien).toMatch(/^mailto:jean\.martin@test\.local\?/);
  });

  it("gère un destinataire absent sans planter, laisse le champ To vide", () => {
    const lien = construireLienMailto(undefined, "x", "y");
    expect(lien.startsWith("mailto:?")).toBe(true);
  });

  it("encode correctement les caractères spéciaux du corps (accents, retours à la ligne, esperluette)", () => {
    const lien = construireLienMailto("a@test.local", "Été & vérification", "Ligne 1\nLigne 2");
    expect(lien).not.toContain("\n");
    const corpsEncode = lien.split("body=")[1];
    expect(decodeURIComponent(corpsEncode)).toBe("Ligne 1\nLigne 2");
  });
});
