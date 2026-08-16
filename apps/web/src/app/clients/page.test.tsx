import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { like, or } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable } = await import("@/db/schema");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const ClientsPage = (await import("./page")).default;

const NOM_PREFIX = "[test réel] ADR048-PAGE-Acquereur";
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
    email: `adr048-page-${suffixe}@test.local`,
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

describe("/clients (ADR-048)", () => {
  it("q filtre réellement la liste affichée", async () => {
    const trouve = await creerAcquereur(acquereurTest("TROUVE"));
    idsCrees.push(trouve.id);
    const autre = await creerAcquereur(acquereurTest("AUTRE"));
    idsCrees.push(autre.id);

    const element = await ClientsPage({ searchParams: Promise.resolve({ q: `${NOM_PREFIX}-TROUVE` }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain(trouve.nom);
    expect(html).not.toContain(autre.nom);
  });

  it("recherche sans résultat affiche un message honnête, jamais une liste vide silencieuse", async () => {
    const element = await ClientsPage({
      searchParams: Promise.resolve({ q: "zzz-aucune-correspondance-adr048-zzz" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Aucun résultat pour");
  });

  it("page hors bornes redirige vers la dernière page valide, jamais une page vide", async () => {
    const acquereur = await creerAcquereur(acquereurTest("HORS-BORNES"));
    idsCrees.push(acquereur.id);

    await expect(
      ClientsPage({ searchParams: Promise.resolve({ q: `${NOM_PREFIX}-HORS-BORNES`, page: "99" }) })
    ).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("archives=1 continue de fonctionner seul (rétrocompatibilité du lien existant)", async () => {
    const archive = await creerAcquereur(acquereurTest("ARCHIVE-COMPAT"));
    idsCrees.push(archive.id);
    await archiverAcquereur(archive.id);

    const element = await ClientsPage({ searchParams: Promise.resolve({ archives: "1" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Acquéreurs archivés");
    expect(html).toContain(archive.nom);
  });
});
