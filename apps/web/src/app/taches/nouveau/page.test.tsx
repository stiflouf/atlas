import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2B1 (ADR-054) — cette page résout désormais le périmètre depuis la session :
// il est mocké ici sur le workspace de test, comme dans app/biens/page.test.tsx.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: async () => "default",
}));


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
  }, WORKSPACE_TEST);
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
  }, WORKSPACE_TEST);
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

async function prospectDeTest(suffixe: string) {
  const prospect = await creerProspectVendeur({ nom: `[test réel] Tâche Prospect ${suffixe}` }, WORKSPACE_TEST);
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

// TASK_CREATE_FORM_ACCESSIBILITY — chaque label VISIBLE du formulaire doit réellement cibler son
// contrôle. Aucun `htmlFor` n'existait : les labels n'étaient que du texte posé au-dessus du champ,
// donc sans nom accessible pour un lecteur d'écran, sans activation au clic sur le libellé, et
// introuvables par `getByLabel` (constaté au lot précédent lors du contrôle Playwright).
// Assertions portées sur le HTML RENDU, jamais sur le source : c'est le contrat livré au navigateur
// qui compte.
describe("/taches/nouveau — association label ↔ contrôle (accessibilité)", () => {
  // Les huit champs visibles, avec le libellé affiché et le `name` métier qui ne doit pas bouger.
  const CHAMPS = [
    { id: "tache-titre", label: "Titre *", name: "titre", balise: "input" },
    { id: "tache-contexte", label: "Contexte", name: "contexte", balise: "textarea" },
    { id: "tache-type", label: "Type", name: "type", balise: "select" },
    { id: "tache-priorite", label: "Priorité", name: "priorite", balise: "select" },
    { id: "tache-echeance", label: "Échéance", name: "echeance", balise: "input" },
    { id: "tache-bienId", label: "Bien", name: "bienId", balise: "select" },
    { id: "tache-acquereurId", label: "Acquéreur", name: "acquereurId", balise: "select" },
    { id: "tache-prospectVendeurId", label: "Prospect vendeur", name: "prospectVendeurId", balise: "select" },
  ] as const;

  async function rendre(): Promise<string> {
    return renderToStaticMarkup(await NouvelleTachePage({ searchParams: Promise.resolve({}) }));
  }

  it("chaque champ visible porte un label associé, sur le bon contrôle, sans changer son name métier", async () => {
    const html = await rendre();
    for (const champ of CHAMPS) {
      // Le label existe, cible ce champ, et affiche toujours le même texte.
      expect(html).toMatch(
        new RegExp(`<label[^>]*for="${champ.id}"[^>]*>\\s*${champ.label.replace("*", "\\*")}\\s*</label>`)
      );
      // La cible du htmlFor est bien le contrôle attendu, et son name métier est inchangé.
      expect(html).toMatch(new RegExp(`<${champ.balise}[^>]*id="${champ.id}"[^>]*name="${champ.name}"`));
    }
  });

  it("chaque htmlFor pointe vers un id réellement présent dans le document", async () => {
    const html = await rendre();
    const cibles = [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    expect(cibles.length).toBeGreaterThanOrEqual(CHAMPS.length);
    expect(cibles.filter((cible) => !ids.has(cible))).toEqual([]);
  });

  it("aucun id dupliqué dans le document rendu", async () => {
    const html = await rendre();
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const doublons = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(doublons).toEqual([]);
  });

  it("aucun label visible orphelin : plus aucun <label> sans for dans ce formulaire", async () => {
    const html = await rendre();
    const labelsSansFor = [...html.matchAll(/<label(?![^>]*\sfor=)[^>]*>([\s\S]*?)<\/label>/g)].map((m) =>
      m[1].trim()
    );
    expect(labelsSansFor).toEqual([]);
  });

  it("le champ caché redirectTo reste sans label et sans id (non-régression)", async () => {
    const html = await rendre();
    expect(html).toContain('<input type="hidden" name="redirectTo"');
    expect(html).not.toMatch(/for="tache-redirectTo"/);
  });
});
