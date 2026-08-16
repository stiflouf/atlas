import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : cette page est privée (session Atlas) mais le composant Server lui-même n'appelle pas
// exigerSessionAtlas() (le Proxy protège la navigation) — aucun mock nécessaire ici, contrairement
// aux Server Actions/Route Handlers.
import { renderToStaticMarkup } from "react-dom/server";
import { eq, like } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const BiensPage = (await import("./page")).default;

const REFERENCE_PREFIX = "[test réel] ADR048-PAGE-BIEN";
const idsCrees: string[] = [];

afterAll(async () => {
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
});

function bienTest(suffixe: string, overrides: Partial<Parameters<typeof creerBien>[0]> = {}) {
  return {
    reference: `${REFERENCE_PREFIX}-${suffixe}`,
    titre: "Bien de test page",
    type: "appartement" as const,
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
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

describe("/biens (ADR-048)", () => {
  it("q filtre réellement la liste affichée", async () => {
    const trouve = await creerBien(bienTest("TROUVE", { ville: "Annecy" }));
    idsCrees.push(trouve.id);
    const autre = await creerBien(bienTest("AUTRE", { ville: "Chambéry" }));
    idsCrees.push(autre.id);

    const element = await BiensPage({ searchParams: Promise.resolve({ q: "Annecy" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain(trouve.reference);
    expect(html).not.toContain(autre.reference);
  });

  it("recherche sans résultat affiche un message honnête, jamais une liste vide silencieuse", async () => {
    const element = await BiensPage({
      searchParams: Promise.resolve({ q: "zzz-aucune-correspondance-adr048-zzz" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Aucun résultat pour");
  });

  it("page hors bornes redirige vers la dernière page valide, jamais une page vide", async () => {
    const bien = await creerBien(bienTest("HORS-BORNES"));
    idsCrees.push(bien.id);

    await expect(
      BiensPage({ searchParams: Promise.resolve({ q: `${REFERENCE_PREFIX}-HORS-BORNES`, page: "99" }) })
    ).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("archives=1 continue de fonctionner seul (rétrocompatibilité du lien existant)", async () => {
    const archive = await creerBien(bienTest("ARCHIVE-COMPAT"));
    idsCrees.push(archive.id);
    await archiverBien(archive.id);

    const element = await BiensPage({ searchParams: Promise.resolve({ archives: "1" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Biens archivés");
    expect(html).toContain(archive.reference);
  });
});
