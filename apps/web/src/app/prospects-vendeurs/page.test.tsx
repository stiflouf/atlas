import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { like } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { prospectsVendeurs: prospectsVendeursTable } = await import("@/db/schema");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const ProspectsVendeursPage = (await import("./page")).default;

const NOM_PREFIX = "[test réel] ADR048-PAGE-Prospect";
const idsCrees: string[] = [];

afterAll(async () => {
  await getDb().delete(prospectsVendeursTable).where(like(prospectsVendeursTable.nom, `${NOM_PREFIX}%`));
});

async function prospectDeTest(suffixe: string) {
  const prospect = await creerProspectVendeur({
    nom: `${NOM_PREFIX}-${suffixe}`,
    prenom: "Jean",
    email: undefined,
    telephone: undefined,
    origineLead: undefined,
    origineLeadDetail: undefined,
    adresseBienPotentiel: undefined,
    secteurBienPotentiel: undefined,
    ville: undefined,
    codePostal: undefined,
    typeBien: undefined,
  });
  idsCrees.push(prospect.id);
  return prospect;
}

describe("/prospects-vendeurs (ADR-048)", () => {
  it("q filtre réellement la liste affichée", async () => {
    const trouve = await prospectDeTest("TROUVE");
    const autre = await prospectDeTest("AUTRE");

    const element = await ProspectsVendeursPage({ searchParams: Promise.resolve({ q: `${NOM_PREFIX}-TROUVE` }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain(trouve.nom);
    expect(html).not.toContain(autre.nom);
  });

  it("recherche sans résultat affiche un message honnête, jamais une liste vide silencieuse", async () => {
    const element = await ProspectsVendeursPage({
      searchParams: Promise.resolve({ q: "zzz-aucune-correspondance-adr048-zzz" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Aucun résultat pour");
  });

  it("page hors bornes redirige vers la dernière page valide, jamais une page vide", async () => {
    await prospectDeTest("HORS-BORNES");

    await expect(
      ProspectsVendeursPage({ searchParams: Promise.resolve({ q: `${NOM_PREFIX}-HORS-BORNES`, page: "99" }) })
    ).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("vue=perdus continue de fonctionner seule (rétrocompatibilité du lien existant)", async () => {
    const element = await ProspectsVendeursPage({ searchParams: Promise.resolve({ vue: "perdus" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Prospects perdus");
  });
});
