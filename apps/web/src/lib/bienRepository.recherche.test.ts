import { afterAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";

// ADR-048 — recherche + pagination serveur : rechercherBiensPage(). Test d'intégration réel
// (Postgres local), même principe que bienRepository.test.ts.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien, archiverBien, rechercherBiensPage } = await import("./bienRepository");

const REFERENCE_PREFIX = "[test réel] ADR048-BIEN";
const idsCrees: string[] = [];

afterAll(async () => {
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
});

function bienTest(suffixe: string, overrides: Partial<Parameters<typeof creerBien>[0]> = {}) {
  return {
    reference: `${REFERENCE_PREFIX}-${suffixe}`,
    titre: "Bien de test recherche",
    type: "appartement" as const,
    adresse: "1 rue du Vercors",
    ville: "Grenoble",
    codePostal: "38000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif" as const,
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...overrides,
  };
}

describe("rechercherBiensPage (ADR-048)", () => {
  it("filtre par archives=false/true comme les fonctions existantes", async () => {
    const actif = await creerBien(bienTest("ARCHIVES-1"));
    idsCrees.push(actif.id);
    const archive = await creerBien(bienTest("ARCHIVES-2"));
    idsCrees.push(archive.id);
    await archiverBien(archive.id);

    const { lignes: actifs } = await rechercherBiensPage({ archives: false, page: 1, parPage: 50 });
    expect(actifs.some((b) => b.id === actif.id)).toBe(true);
    expect(actifs.some((b) => b.id === archive.id)).toBe(false);

    const { lignes: archives } = await rechercherBiensPage({ archives: true, page: 1, parPage: 50 });
    expect(archives.some((b) => b.id === archive.id)).toBe(true);
    expect(archives.some((b) => b.id === actif.id)).toBe(false);
  });

  it("recherche texte : trouve par référence, adresse ou ville, insensible à la casse", async () => {
    const bien = await creerBien(
      bienTest("TEXTE-1", { reference: `${REFERENCE_PREFIX}-TEXTE-1`, adresse: "12 avenue Foch", ville: "Belfort" })
    );
    idsCrees.push(bien.id);

    const parReference = await rechercherBiensPage({ q: "texte-1", archives: false, page: 1, parPage: 50 });
    expect(parReference.lignes.some((b) => b.id === bien.id)).toBe(true);

    const parAdresse = await rechercherBiensPage({ q: "FOCH", archives: false, page: 1, parPage: 50 });
    expect(parAdresse.lignes.some((b) => b.id === bien.id)).toBe(true);

    const parVille = await rechercherBiensPage({ q: "belfort", archives: false, page: 1, parPage: 50 });
    expect(parVille.lignes.some((b) => b.id === bien.id)).toBe(true);

    const sansCorrespondance = await rechercherBiensPage({
      q: "zzz-aucune-correspondance-zzz",
      archives: false,
      page: 1,
      parPage: 50,
    });
    expect(sansCorrespondance.lignes).toHaveLength(0);
    expect(sansCorrespondance.total).toBe(0);
  });

  it("pagine réellement côté serveur : total exact, pages disjointes, ordre stable creeLe DESC puis id DESC", async () => {
    const reference = `${REFERENCE_PREFIX}-PAGINATION`;
    const crees = [];
    for (let i = 0; i < 5; i++) {
      const bien = await creerBien(bienTest(`PAGINATION-${i}`, { reference }));
      idsCrees.push(bien.id);
      crees.push(bien);
    }

    const page1 = await rechercherBiensPage({ q: "PAGINATION", archives: false, page: 1, parPage: 2 });
    const page2 = await rechercherBiensPage({ q: "PAGINATION", archives: false, page: 2, parPage: 2 });
    const page3 = await rechercherBiensPage({ q: "PAGINATION", archives: false, page: 3, parPage: 2 });

    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.lignes).toHaveLength(2);
    expect(page2.lignes).toHaveLength(2);
    expect(page3.lignes).toHaveLength(1);

    // Ordre déterministe : creeLe croissant à l'insertion => DESC place les plus récents en
    // premier, donc les 5 biens créés séquentiellement apparaissent dans l'ordre inverse de
    // création, sans doublon ni trou entre les 3 pages.
    const idsToutesPages = [...page1.lignes, ...page2.lignes, ...page3.lignes].map((b) => b.id);
    expect(new Set(idsToutesPages).size).toBe(5);
    expect(idsToutesPages).toEqual([...crees].reverse().map((b) => b.id));
  });

  it("page hors bornes retourne une liste vide, jamais une erreur — total reste correct", async () => {
    const bien = await creerBien(bienTest("HORS-BORNES"));
    idsCrees.push(bien.id);

    const resultat = await rechercherBiensPage({ q: "HORS-BORNES", archives: false, page: 99, parPage: 25 });
    expect(resultat.lignes).toHaveLength(0);
    expect(resultat.total).toBe(1);
  });
});
