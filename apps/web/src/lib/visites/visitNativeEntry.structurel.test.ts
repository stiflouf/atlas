import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// VISIT_NATIVE_ENTRY_V1 — gardes structurelles (brief §49) : ce que le lot a livré ne doit pas se
// défaire silencieusement. Lecture du source, jamais d'exécution.
const SRC = join(__dirname, "..", "..");
const lire = (chemin: string) => readFileSync(join(SRC, chemin), "utf8");

describe("VISIT_NATIVE_ENTRY_V1 — gardes structurelles", () => {
  it("creerVisite a un appelant de production natif : la Server Action creerVisiteAction", () => {
    const action = lire("actions/creerVisite.ts");
    expect(action).toContain('import { creerVisite } from "@/lib/visiteRepository"');
    expect(action).toContain("await creerVisite(");
    expect(action).toContain("export async function creerVisiteAction");
  });

  it("aucune nouvelle UI Visite ne dépend de Calendar (ni google/, ni rendezVousContexte, ni /preparer)", () => {
    for (const chemin of [
      "actions/creerVisite.ts",
      "components/visite/PlanifierVisiteForm.tsx",
      "app/visites/nouvelle/page.tsx",
      "components/aujourd-hui/VisiteJourCard.tsx",
      "lib/visites/agendaDuJour.ts",
      "lib/visites/retourVisite.ts",
    ]) {
      const source = lire(chemin);
      expect(source, chemin).not.toContain("@/lib/google/");
      expect(source, chemin).not.toContain("rendezVousContexte");
      // Un lien vers /preparer (id Calendar) — pas une simple mention en commentaire.
      expect(source, chemin).not.toMatch(/\/visites\/\$\{[^}]+\}\/preparer/);
    }
  });

  it("/visites/nouvelle ne lit que des lecteurs scopés workspace (jamais listerBiens/listerClients/getBienById/getClientById)", () => {
    const page = lire("app/visites/nouvelle/page.tsx");
    expect(page).toContain("await exigerWorkspaceCourant()");
    expect(page).toMatch(/import \{[^}]*listerBiensActifsDuWorkspace[^}]*\} from "@\/lib\/bienRepository"/);
    expect(page).toMatch(/import \{[^}]*listerAcquereursActifsDuWorkspace[^}]*\} from "@\/lib\/clientRepository"/);
    expect(page).not.toMatch(/\b(listerBiens|listerClients|getBienById|getClientById)\b/);
    expect(page).not.toMatch(/workspaceId.*(params|formData)\./);
    for (const [chemin, lecteur] of [
      ["lib/bienRepository.ts", "listerBiensActifsDuWorkspace"],
      ["lib/clientRepository.ts", "listerAcquereursActifsDuWorkspace"],
    ]) {
      const corps = lire(chemin).match(new RegExp(`export async function ${lecteur}[\\s\\S]*?\\n}`))?.[0] ?? "";
      expect(corps, lecteur).toMatch(/workspaceId, workspaceId\)/);
      expect(corps, lecteur).not.toMatch(/Demo\b/);
    }
  });

  it("la création native redirige vers /visites/{visite.id} (route canonique), jamais vers /preparer", () => {
    const action = lire("actions/creerVisite.ts");
    expect(action).toContain("routeVisiteAvecRetour(resultat.visite.id, retour)");
    expect(lire("lib/visites/retourVisite.ts")).toContain("`/visites/${visiteId}`");
  });

  it("`retour` est un enum fermé (bien | acquereur) — jamais une URL relue depuis la requête", () => {
    const source = lire("lib/visites/retourVisite.ts");
    expect(source).toContain('export const RETOURS_VISITE = ["bien", "acquereur"] as const;');
    expect(lire("actions/creerVisite.ts")).toContain('retourVisiteValide(String(formData.get("retour")');
    expect(lire("app/visites/[id]/page.tsx")).toContain("retourVisiteValide(");
  });

  it("le formulaire est unique, en jour civil : un seul PlanifierVisiteForm, aucun champ heure/durée", () => {
    const form = lire("components/visite/PlanifierVisiteForm.tsx");
    expect(form).toContain('type="date"');
    expect(form).not.toContain('type="time"');
    expect(form).not.toMatch(/name="(heure|duree|dureeMinutes)"/);
    expect(form).toContain("useActionState(creerVisiteAction");
    expect(form).toContain("loading={pending}");
    expect(form).not.toMatch(/className="[^"]*\bgrid-cols-2\b/);
    // Les trois entrées produit pointent la même route (formulaire unique).
    for (const chemin of [
      "components/bien/BienTabs.tsx",
      "components/client/AcquereurHero.tsx",
      "components/client/AcquereurVisites.tsx",
      "components/bien/BienAcquereursCompatibles.tsx",
      "components/client/AcquereurBiensCompatibles.tsx",
    ]) {
      expect(lire(chemin), chemin).toContain("/visites/nouvelle?");
    }
  });

  it("matching : le CTA n'apparaît jamais sur un match incompatible, sans toucher au moteur", () => {
    for (const chemin of ["components/bien/BienAcquereursCompatibles.tsx", "components/client/AcquereurBiensCompatibles.tsx"]) {
      const source = lire(chemin);
      expect(source, chemin).toContain('resultat.statutGlobal !== "incompatible" &&');
      expect(source, chemin).not.toMatch(/^import [^\n]*compatibilite\/(orchestration|evaluerCompatibilite)/m);
    }
  });

  it("Today lit les Visites natives via un reader set-based et déduplique Calendar", () => {
    const today = lire("app/page.tsx");
    expect(today).toContain('import { visitesDuJour } from "@/lib/visiteRepository"');
    expect(today).toContain("fusionnerAgendaDuJour(");
    expect(today).toContain("await exigerWorkspaceCourant()");
    const reader = lire("lib/visiteRepository.ts").match(/export async function visitesDuJour[\s\S]*?\n}/)?.[0] ?? "";
    expect(reader).toContain(".innerJoin(biensTable");
    expect(reader).toContain(".innerJoin(acquereursTable");
    expect(reader).not.toContain("getBienById");
    expect(reader).not.toContain("getClientById");
    const carte = lire("components/aujourd-hui/VisiteJourCard.tsx");
    expect(carte).not.toContain("await ");
    expect(carte).not.toMatch(/^import (?!type )[^\n]*Repository"/m);
  });

  it("la signature du mandat pose le mandant canonique via ajouterPartieMandat, dans la transaction", () => {
    const repo = lire("lib/prospectVendeurRepository.ts");
    expect(repo).toContain('import { ajouterPartieMandat } from "@/lib/partieMandatRepository"');
    const signature = repo.match(/export async function signerMandatProspectVendeur[\s\S]*?\n}/)?.[0] ?? "";
    expect(signature).toContain("poserMandantDepuisProspect(mandat.id, verrouille.contactId, workspaceId, tx)");
    expect(repo).not.toContain("insert(partiesMandatTable)");
  });

  it("aucun BuyerProject, aucune migration ajoutée par ce lot", () => {
    const fichiers = readdirSync(join(SRC, "lib")).concat(readdirSync(join(SRC, "actions")), readdirSync(join(SRC, "types")));
    expect(fichiers.filter((f) => /buyerProject/i.test(f))).toEqual([]);
    const migrations = readdirSync(join(SRC, "db", "migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrations.length).toBe(54);
    expect(migrations.at(-1)).toBe("0053_seller_feedback_interaction_v1.sql");
  });
});
