import { describe, expect, it } from "vitest";
import { DATABASE_URL_TEST_PAR_DEFAUT, resoudreDatabaseUrlTest } from "./resoudreDatabaseUrlTest";

// Tests unitaires purs (aucune connexion Postgres réelle nécessaire) du garde-fou test/production
// (audit V1 Candidate, §18) : chaque cas passe un environnement synthétique, jamais process.env.
describe("resoudreDatabaseUrlTest", () => {
  it("ATLAS_TEST_DATABASE_URL valide (nom de base contenant 'test') → acceptée telle quelle", () => {
    const url = "postgresql://atlas:atlas@localhost:5432/atlas_test";
    expect(resoudreDatabaseUrlTest({ ATLAS_TEST_DATABASE_URL: url })).toBe(url);
  });

  it("ATLAS_TEST_DATABASE_URL sur un autre hôte local (127.0.0.1) avec marqueur 'test' → acceptée", () => {
    const url = "postgresql://atlas:atlas@127.0.0.1:5432/mon_projet_test";
    expect(resoudreDatabaseUrlTest({ ATLAS_TEST_DATABASE_URL: url })).toBe(url);
  });

  it("ATLAS_TEST_DATABASE_URL sans marqueur 'test' dans le nom de base → refusée", () => {
    expect(() =>
      resoudreDatabaseUrlTest({ ATLAS_TEST_DATABASE_URL: "postgresql://atlas:atlas@localhost:5432/atlas" })
    ).toThrow(/refusée/);
  });

  it("ATLAS_TEST_DATABASE_URL ressemblant à une base de production (hôte distant) → refusée", () => {
    expect(() =>
      resoudreDatabaseUrlTest({
        ATLAS_TEST_DATABASE_URL: "postgresql://user:pass@production.railway.app:5432/atlas_test",
      })
    ).toThrow(/refusée/);
  });

  it("DATABASE_URL de production présente + ATLAS_TEST_DATABASE_URL de test présente → la base de test est utilisée, jamais la production", () => {
    const urlTest = "postgresql://atlas:atlas@localhost:5432/atlas_test";
    const resultat = resoudreDatabaseUrlTest({
      ATLAS_TEST_DATABASE_URL: urlTest,
      DATABASE_URL: "postgresql://user:secret@production.railway.app:5432/atlas",
    });
    expect(resultat).toBe(urlTest);
  });

  it("ATLAS_TEST_DATABASE_URL absente + DATABASE_URL ressemblant à la production → refus explicite", () => {
    expect(() =>
      resoudreDatabaseUrlTest({ DATABASE_URL: "postgresql://user:secret@production.railway.app:5432/atlas" })
    ).toThrow(/Refus de lancer la suite/);
  });

  it("ATLAS_TEST_DATABASE_URL absente + DATABASE_URL absente → repli sur la base de test locale par défaut", () => {
    expect(resoudreDatabaseUrlTest({})).toBe(DATABASE_URL_TEST_PAR_DEFAUT);
  });

  it("ATLAS_TEST_DATABASE_URL absente + DATABASE_URL correspondant à la convention de dev locale documentée → repli sûr (pas la base de dev elle-même)", () => {
    const resultat = resoudreDatabaseUrlTest({ DATABASE_URL: "postgresql://atlas:atlas@localhost:5432/atlas" });
    expect(resultat).toBe(DATABASE_URL_TEST_PAR_DEFAUT);
  });

  it("URL syntaxiquement invalide → refusée avec un message explicite", () => {
    expect(() => resoudreDatabaseUrlTest({ ATLAS_TEST_DATABASE_URL: "pas-une-url" })).toThrow(/URL Postgres valide/);
  });
});
