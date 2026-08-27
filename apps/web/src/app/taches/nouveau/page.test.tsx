import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";

// Test d'intégration réel (même pattern que biens/page.test.tsx, ADR-048) — correctif UX : après
// création depuis une fiche, l'utilisateur doit revenir sur cette fiche (jamais "Aujourd'hui" par
// défaut), et au plus une cible doit apparaître présélectionnée dans le formulaire.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, prospectsVendeurs: prospectsVendeursTable } = await import(
  "@/db/schema"
);
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const NouvelleTachePage = (await import("./page")).default;

// React (SSR) sérialise un <select> contrôlé en marquant l'<option> correspondante
// `selected=""`, jamais un attribut `value` sur le <select> lui-même — cet extracteur lit la
// valeur réellement présélectionnée pour un nom de champ donné.
function valeurSelectionnee(html: string, nomChamp: string): string | undefined {
  const motifSelect = new RegExp(`name="${nomChamp}"[^>]*>((?:(?!</select>)[\\s\\S])*)</select>`);
  const contenu = html.match(motifSelect)?.[1] ?? "";
  return contenu.match(/<option value="([^"]*)" selected="">/)?.[1];
}

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsProspectsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsProspectsCrees) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
});

async function bienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] TACHE-NOUVEAU-${suffixe}`,
    titre: `Bien de test tâche ${suffixe}`,
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function acquereurDeTest(suffixe: string) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Tâche ${suffixe}`,
    email: `test-réel-tache-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

async function prospectDeTest(suffixe: string) {
  const prospect = await creerProspectVendeur({ nom: `[test réel] Tâche Prospect ${suffixe}` });
  idsProspectsCrees.push(prospect.id);
  return prospect;
}

describe("/taches/nouveau — retour contextuel après création (correctif UX)", () => {
  it("?acquereurId=A : Acquéreur présélectionné, Bien/Prospect vides, retour vers /clients/A", async () => {
    const acquereur = await acquereurDeTest("ACQ");
    const html = renderToStaticMarkup(
      await NouvelleTachePage({ searchParams: Promise.resolve({ acquereurId: acquereur.id }) })
    );
    expect(valeurSelectionnee(html, "acquereurId")).toBe(acquereur.id);
    expect(valeurSelectionnee(html, "bienId")).toBe("");
    expect(valeurSelectionnee(html, "prospectVendeurId")).toBe("");
    expect(html).toContain(`name="redirectTo" value="/clients/${acquereur.id}"`);
  });

  it("?bienId=B : Bien présélectionné, Acquéreur/Prospect vides, retour vers /biens/B", async () => {
    const bien = await bienDeTest("BIEN");
    const html = renderToStaticMarkup(await NouvelleTachePage({ searchParams: Promise.resolve({ bienId: bien.id }) }));
    expect(valeurSelectionnee(html, "bienId")).toBe(bien.id);
    expect(valeurSelectionnee(html, "acquereurId")).toBe("");
    expect(valeurSelectionnee(html, "prospectVendeurId")).toBe("");
    expect(html).toContain(`name="redirectTo" value="/biens/${bien.id}"`);
  });

  it("?prospectVendeurId=P : Prospect présélectionné, Bien/Acquéreur vides, retour vers la vraie fiche /prospects-vendeurs/P", async () => {
    const prospect = await prospectDeTest("PROSPECT");
    const html = renderToStaticMarkup(
      await NouvelleTachePage({ searchParams: Promise.resolve({ prospectVendeurId: prospect.id }) })
    );
    expect(valeurSelectionnee(html, "prospectVendeurId")).toBe(prospect.id);
    expect(valeurSelectionnee(html, "bienId")).toBe("");
    expect(valeurSelectionnee(html, "acquereurId")).toBe("");
    expect(html).toContain(`name="redirectTo" value="/prospects-vendeurs/${prospect.id}"`);
  });

  it("sans contexte : comportement générique conservé, retour vers /", async () => {
    const html = renderToStaticMarkup(await NouvelleTachePage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('name="redirectTo" value="/"');
    expect(valeurSelectionnee(html, "bienId")).toBe("");
    expect(valeurSelectionnee(html, "acquereurId")).toBe("");
    expect(valeurSelectionnee(html, "prospectVendeurId")).toBe("");
  });

  it("id inconnu/obsolète dans l'URL : aucune présélection, retour générique — jamais une erreur", async () => {
    const html = renderToStaticMarkup(
      await NouvelleTachePage({ searchParams: Promise.resolve({ acquereurId: "id-obsolete-inexistant" }) })
    );
    expect(valeurSelectionnee(html, "acquereurId")).toBe("");
    expect(html).toContain('name="redirectTo" value="/"');
  });
});
