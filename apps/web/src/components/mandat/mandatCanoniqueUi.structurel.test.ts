import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-060 §1-§2 — garanties STRUCTURELLES du lot MANDATE_CANONICAL_UI_V1 : la précédence
// canonique > legacy est écrite UNE fois (`presentationMandatBien.ts`) ; les composants Mandat ne
// lisent jamais les colonnes legacy ni la base ; les actions Mandat n'ont ni SQL ni workspace de
// formulaire ; les read models Mandat exigent un workspace ; l'inventaire des lecteurs legacy est
// fermé et classé ; aucune route, migration ou automatisation nouvelle.

const SRC = join(__dirname, "..", "..");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function listerFichiers(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return listerFichiers(chemin);
    return /\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

const FICHIERS = listerFichiers(SRC);
const relatif = (chemin: string) => chemin.replace(SRC + "/", "");

describe("précédence canonique > legacy : une seule règle, centralisée", () => {
  it("les composants Mandat ne lisent ni statut/date legacy, ni la base, ni un repository", () => {
    for (const chemin of listerFichiers(join(SRC, "components", "mandat"))) {
      const code = codeSeul(chemin);
      // `presentation.dateMandat` est le fait legacy DÉJÀ tranché par le read model, pas une lecture du bien.
      expect(code, relatif(chemin)).not.toMatch(/(?<!presentation\.)\b(statutMandat|dateMandat)\b|statut_mandat|date_mandat/);
      expect(code, relatif(chemin)).not.toMatch(/@\/db\/|drizzle-orm|Repository"/);
    }
  });

  it("le read model tranche par EXISTENCE d'un mandat canonique (historique), jamais par le courant, et n'a aucun fallback champ par champ", () => {
    const code = codeSeul(join(SRC, "lib", "presentationMandatBien.ts"));
    expect(code).toContain("const historique = await listerMandatsDuBien(bien.id, workspaceId, aujourdhui, executeur)");
    expect(code).toContain("if (historique.length > 0) {");
    expect(code.indexOf("historique.length > 0")).toBeLessThan(code.indexOf("mandatCourantDuBien("));
    // Le legacy n'est lu que dans la branche sans canonique.
    const brancheCanonique = code.slice(code.indexOf("if (historique.length > 0) {"), code.indexOf('return { mode: "canonique"'));
    expect(brancheCanonique).not.toMatch(/bien\.(statutMandat|dateMandat)/);
    expect(code).not.toMatch(/\?\?\s*bien\.(statutMandat|dateMandat)/);
    // Une seule définition du courant : jamais recalculé depuis l'historique.
    expect(code).not.toMatch(/historique\.find\([^)]*statut === "actif"/);
  });

  it("inventaire fermé des lecteurs de production de biens.statut_mandat / date_mandat (§40), chacun classé", () => {
    const lecteurs = FICHIERS.filter((c) => /(?<!presentation\.)\b(statutMandat|dateMandat)\b|statut_mandat|date_mandat/.test(codeSeul(c))).map(relatif).sort();
    expect(lecteurs).toEqual(
      [
        // A. lecture Mandat métier — basculée : la précédence est tranchée ici et nulle part ailleurs.
        "lib/presentationMandatBien.ts",
        // A. moteur pur : statut effectif fourni par l'appelant, legacy en repli documenté sans workspace.
        "lib/pointsAttention/moteur.ts",
        // B. données/jalons legacy légitimes : schéma, type, mapping, saisie à la création, signature.
        "db/schema.ts",
        "types/bien.ts",
        "lib/bienRepository.ts",
        "lib/bienFormulaire.ts",
        "lib/prospectVendeurRepository.ts",
        "actions/creerBien.ts",
        // C. saisie legacy conservée : création directe et conversion prospect (le mandat canonique
        // naît de la même soumission) ; édition legacy-only (masquée si canonique).
        "components/bien/BienFormulaire.tsx",
        "components/prospectVendeur/ProspectVendeurConversionFormulaire.tsx",
        // D. fixtures de démonstration.
        "data/biens.ts",
      ].sort()
    );
  });

  it("BienFormulaire masque les champs legacy sur `mandatCanonique`, décidé par la page (existence scoped), jamais par le composant", () => {
    const formulaire = codeSeul(join(SRC, "components", "bien", "BienFormulaire.tsx"));
    expect(formulaire).toContain("mandatCanonique ? (");
    expect(formulaire).not.toMatch(/Repository|@\/db\//);
    const page = codeSeul(join(SRC, "app", "biens", "[id]", "modifier", "page.tsx"));
    expect(page).toContain("existeMandatCanoniqueDuBien(bien.id, await exigerWorkspaceCourant())");
  });
});

describe("read models et actions Mandat : workspace de session, jamais de SQL hors repository", () => {
  it("chaque lecture produit Mandat exige un workspaceId", () => {
    const repo = codeSeul(join(SRC, "lib", "mandatRepository.ts"));
    for (const signature of [
      "export async function getMandatById(id: string, workspaceId: string",
      "export async function listerMandatsDuBien(\n  bienId: string,\n  workspaceId: string",
      "export async function listerMandatsDuProjetVendeur(\n  projetVendeurId: string,\n  workspaceId: string",
      "export async function mandatCourantDuBien(\n  bienId: string,\n  workspaceId: string",
      "export async function existeMandatCanoniqueDuBien(\n  bienId: string,\n  workspaceId: string",
    ]) {
      expect(repo).toContain(signature);
    }
    for (const fonction of ["getMandatById", "listerMandatsDuBien", "listerMandatsDuProjetVendeur", "existeMandatCanoniqueDuBien"]) {
      const debut = repo.indexOf(`export async function ${fonction}(`);
      const corps = repo.slice(debut, repo.indexOf("\nexport ", debut + 1));
      expect(corps, fonction).toContain("eq(biensTable.workspaceId, workspaceId)");
    }
    const parties = codeSeul(join(SRC, "lib", "partieMandatRepository.ts"));
    expect(parties).toContain("export async function listerPartiesMandat(\n  mandatId: string,\n  workspaceId: string");
    const presentation = codeSeul(join(SRC, "lib", "presentationMandatBien.ts"));
    expect(presentation).toContain("workspaceId: string");
  });

  it("actions/mandat.ts : session en tête, workspace de session, aucun SQL, aucun workspace depuis le formulaire", () => {
    const actions = codeSeul(join(SRC, "actions", "mandat.ts"));
    expect(actions).not.toMatch(/@\/db\/|drizzle-orm|\.(select|insert|update|delete)\(/);
    expect(actions).not.toMatch(/formData\.get\(\s*["']workspace/);
    const fonctions = actions.match(/export async function \w+Action\(/g) ?? [];
    expect(fonctions).toHaveLength(6);
    expect(actions.match(/await exigerWorkspaceCourant\(\)/g)).toHaveLength(6);
    for (const writer of ["modifierMandat(", "resilierMandat(", "enregistrerMandatExistant(", "ajouterPartieMandat(", "modifierRolePartieMandat(", "retirerPartieMandat("]) {
      expect(actions).toContain(`await ${writer}`);
    }
  });

  it("aucune route nouvelle, aucune migration après 0045, aucune automatisation Mandat", () => {
    const pages = listerFichiers(join(SRC, "app")).filter((c) => /\/page\.tsx$/.test(c) && /mandat/i.test(relatif(c)));
    expect(pages.map(relatif)).toEqual(["app/prospects-vendeurs/[id]/signer-mandat/page.tsx"]);
    // Le lot UI Mandat n'a ajouté aucune migration : 0045 (parties) est la dernière du domaine Mandat ;
    // les migrations ultérieures appartiennent à d'autres domaines (0046 = Offre, ADR-061).
    const migrations = readdirSync(join(SRC, "db", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(migrations.filter((f) => /mandat/i.test(f)).pop()).toBe("0045_mandate_parties.sql");
    expect(migrations.some((f) => f.startsWith("0045_"))).toBe(true);
    for (const chemin of listerFichiers(join(SRC, "lib", "automatisations"))) {
      expect(codeSeul(chemin), relatif(chemin)).not.toMatch(/mandatRepository|presentationMandatBien|partieMandatRepository/);
    }
  });
});
