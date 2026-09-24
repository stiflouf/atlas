import { afterAll, describe, expect, it } from "vitest";
import { eq, like, or } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-048 — recherche + pagination serveur : rechercherAcquereursPage(). Test d'intégration réel
// (Postgres local), même principe que clientRepository.test.ts.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable } = await import("@/db/schema");
const { creerAcquereur, archiverAcquereur, rechercherAcquereursPage } = await import("./clientRepository");

const NOM_PREFIX = "[test réel] ADR048-Acquereur";
const idsCrees: string[] = [];

afterAll(async () => {
  await getDb()
    .delete(acquereursTable)
    .where(or(like(acquereursTable.nom, `${NOM_PREFIX}%`), like(acquereursTable.prenom, `${NOM_PREFIX}%`)));
});

function acquereurTest(suffixe: string, overrides: Partial<Parameters<typeof creerAcquereur>[0]> = {}) {
  return {
    prenom: "Jean",
    nom: `${NOM_PREFIX}-${suffixe}`,
    email: `adr048-${suffixe}@test.local`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte" as const,
    notes: "",
    datePremiereContact: "2026-01-01",
    ...overrides,
  };
}

describe("rechercherAcquereursPage (ADR-048)", () => {
  it("filtre par archives=false/true comme les fonctions existantes", async () => {
    const actif = await creerAcquereur(acquereurTest("ARCHIVES-1"), WORKSPACE_TEST);
    idsCrees.push(actif.id);
    const archive = await creerAcquereur(acquereurTest("ARCHIVES-2"), WORKSPACE_TEST);
    idsCrees.push(archive.id);
    await archiverAcquereur(archive.id, WORKSPACE_TEST);

    const { lignes: actifs } = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, archives: false, page: 1, parPage: 50 });
    expect(actifs.some((a) => a.id === actif.id)).toBe(true);
    expect(actifs.some((a) => a.id === archive.id)).toBe(false);

    const { lignes: archives } = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, archives: true, page: 1, parPage: 50 });
    expect(archives.some((a) => a.id === archive.id)).toBe(true);
  });

  it("recherche texte : trouve par nom ou par prénom, insensible à la casse", async () => {
    const acquereur = await creerAcquereur(acquereurTest("TEXTE-1", { prenom: "Dominique" }), WORKSPACE_TEST);
    idsCrees.push(acquereur.id);

    const parNom = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: "texte-1", archives: false, page: 1, parPage: 50 });
    expect(parNom.lignes.some((a) => a.id === acquereur.id)).toBe(true);

    const parPrenom = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: "DOMINIQUE", archives: false, page: 1, parPage: 50 });
    expect(parPrenom.lignes.some((a) => a.id === acquereur.id)).toBe(true);

    const sansCorrespondance = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST,
      q: "zzz-aucune-correspondance-zzz",
      archives: false,
      page: 1,
      parPage: 50,
    });
    expect(sansCorrespondance.lignes).toHaveLength(0);
    expect(sansCorrespondance.total).toBe(0);
  });

  it("pagine réellement côté serveur : total exact, pages disjointes, ordre stable creeLe DESC puis id DESC", async () => {
    const nom = `${NOM_PREFIX}-PAGINATION`;
    const crees = [];
    for (let i = 0; i < 5; i++) {
      const acquereur = await creerAcquereur(acquereurTest(`PAGINATION-${i}`, { nom }), WORKSPACE_TEST);
      idsCrees.push(acquereur.id);
      crees.push(acquereur);
    }

    const page1 = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: "PAGINATION", archives: false, page: 1, parPage: 2 });
    const page2 = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: "PAGINATION", archives: false, page: 2, parPage: 2 });
    const page3 = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: "PAGINATION", archives: false, page: 3, parPage: 2 });

    expect(page1.total).toBe(5);
    expect(page1.lignes).toHaveLength(2);
    expect(page2.lignes).toHaveLength(2);
    expect(page3.lignes).toHaveLength(1);

    const idsToutesPages = [...page1.lignes, ...page2.lignes, ...page3.lignes].map((a) => a.id);
    expect(new Set(idsToutesPages).size).toBe(5);
    expect(idsToutesPages).toEqual([...crees].reverse().map((a) => a.id));
  });

  it("page hors bornes retourne une liste vide, jamais une erreur — total reste correct", async () => {
    const acquereur = await creerAcquereur(acquereurTest("HORS-BORNES"), WORKSPACE_TEST);
    idsCrees.push(acquereur.id);

    const resultat = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: "HORS-BORNES", archives: false, page: 99, parPage: 25 });
    expect(resultat.lignes).toHaveLength(0);
    expect(resultat.total).toBe(1);
  });
});
