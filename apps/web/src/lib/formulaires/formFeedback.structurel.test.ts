import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// FORM_FEEDBACK_V1 — gardes structurelles : le contrat reste léger et fail-closed, les actions
// converties gardent la garde de session en tête, les repositories ignorent ErreurSaisie, et les
// formulaires centraux passent par les primitives (état local + pending).
const SRC = join(__dirname, "..", "..");
const lire = (chemin: string) => readFileSync(join(SRC, chemin), "utf8");

const ACTIONS_CONVERTIES: Record<string, string[]> = {
  "actions/creerTache.ts": ["creerTacheAction"],
  "actions/offre.ts": ["ajouterOffreAction", "changerStatutOffreAction"],
  "actions/offreVisite.ts": ["lierVisiteAOffreAction", "delierVisiteAction"],
  "actions/compromis.ts": ["ajouterCompromisAction", "changerStatutCompromisAction", "modifierDateActeAction"],
  "actions/remuneration.ts": ["ajouterRemunerationAction", "modifierRemunerationAction", "marquerRemunerationEncaisseeAction"],
  "actions/prospectVendeur.ts": [
    "creerProspectVendeurAction",
    "modifierProspectVendeurAction",
    "qualifierProspectVendeurAction",
    "enregistrerEstimationProspectVendeurAction",
    "planifierRdvEstimationProspectVendeurAction",
    "marquerRdvEstimationRealiseProspectVendeurAction",
    "proposerMandatProspectVendeurAction",
    "signerMandatProspectVendeurAction",
    "marquerProspectVendeurPerduAction",
    "ajouterNoteProspectVendeurAction",
  ],
  "actions/creerAcquereur.ts": ["creerAcquereurAction"],
  "actions/modifierAcquereur.ts": ["modifierAcquereurAction"],
  "actions/creerBien.ts": ["creerBienAction"],
  "actions/modifierBien.ts": ["modifierBienAction"],
  "actions/ajouterDocumentBien.ts": ["ajouterDocumentBienAction", "corrigerClassementDocumentBienAction"],
  // CRM_TIMELINE_V1
  "actions/enregistrerEchange.ts": ["enregistrerEchangeAction"],
  // DEMO_UX_HARDENING_V1 — les trois derniers écrans de démonstration qui pouvaient encore
  // éjecter sur error.tsx pour une saisie plausible.
  "actions/rfrFoyer.ts": ["enregistrerRfrFoyerAction"],
  "actions/historiqueAmorcage.ts": ["enregistrerHistoriqueAmorcageAction"],
  "actions/modifierContact.ts": ["modifierContactAction"],
};

// `throw new Error` encore attendus dans les fichiers convertis : invariants (D) et états
// métier/comptables impossibles (B non-saisie) — jamais une validation de saisie.
const THROWS_CONSERVES: Record<string, string[]> = {
  "actions/prospectVendeur.ts": ["Contact canonique introuvable"],
  "actions/modifierAcquereur.ts": ["Contact canonique introuvable"],
  "actions/remuneration.ts": ["introuvable", "annulé", "existe déjà", "encaissée", "compromis réalisé", "date réelle de l'acte"],
  // ADR-057 — le writer a déjà relu et validé la ligne : ce `throw` ne peut naître que d'une
  // course, jamais d'une saisie. Même invariant que ses jumeaux ci-dessus.
  "actions/modifierContact.ts": ["Contact introuvable."],
};

describe("FORM_FEEDBACK_V1 — contrat", () => {
  it("avecFeedbackFormulaire ne capture que ErreurSaisie (instanceof), et relance tout le reste", () => {
    const source = lire("lib/formulaires/etatFormulaire.ts");
    const corps = source.slice(source.indexOf("export async function avecFeedbackFormulaire"));
    expect(corps).toContain("if (erreur instanceof ErreurSaisie) return { statut: \"erreur\", message: erreur.message };");
    expect(corps).toContain("throw erreur;");
    expect(corps).not.toMatch(/catch \(erreur\) \{\s*return/);
  });

  it("aucun repository ne connaît ErreurSaisie (couche formulaire/action uniquement)", () => {
    const lib = join(SRC, "lib");
    for (const fichier of readdirSync(lib)) {
      if (!fichier.endsWith("Repository.ts")) continue;
      expect(readFileSync(join(lib, fichier), "utf8"), fichier).not.toContain("etatFormulaire");
    }
  });

  it("chaque action convertie : signature useActionState, garde de session en tête, corps sous avecFeedbackFormulaire", () => {
    for (const [chemin, noms] of Object.entries(ACTIONS_CONVERTIES)) {
      const source = lire(chemin);
      expect(source, chemin).toContain('from "@/lib/formulaires/etatFormulaire"');
      for (const nom of noms) {
        const signature = `export async function ${nom}(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {\n  await exigerSessionAtlas();\n  return avecFeedbackFormulaire(async () => {`;
        expect(source, `${chemin} → ${nom}`).toContain(signature);
      }
    }
  });

  it("dans les fichiers convertis, seuls les throw d'invariant ou d'état impossible subsistent", () => {
    for (const chemin of Object.keys(ACTIONS_CONVERTIES)) {
      const source = lire(chemin);
      const conserves = THROWS_CONSERVES[chemin] ?? [];
      for (const ligne of source.split("\n").filter((l) => l.includes("throw new Error("))) {
        expect(conserves.some((motif) => ligne.includes(motif)), `${chemin} : ${ligne.trim()}`).toBe(true);
      }
    }
  });

  it("les formulaires centraux passent par FormulaireAvecEtat + BoutonSoumettre (état local, pending)", () => {
    for (const chemin of [
      "app/taches/nouveau/page.tsx",
      "components/prospectVendeur/ProspectVendeurFormulaire.tsx",
      "components/prospectVendeur/ProspectVendeurConversionFormulaire.tsx",
      "components/prospectVendeur/ProspectVendeurProchaineEtape.tsx",
      "components/prospectVendeur/ProspectVendeurJournal.tsx",
      "components/client/AcquereurFormulaire.tsx",
      "components/bien/BienFormulaire.tsx",
      "components/offre/OffreFormulaire.tsx",
      "components/compromis/CompromisFormulaire.tsx",
      "components/bien/BienTabs.tsx",
      "components/contact/NoterEchangeForm.tsx",
      "components/fiscal/RfrFoyerFormulaire.tsx",
      "components/fiscal/HistoriqueAmorcageFormulaire.tsx",
    ]) {
      const source = lire(chemin);
      expect(source, chemin).toContain("FormulaireAvecEtat");
      expect(source, chemin).toContain("BoutonSoumettre");
      for (const noms of Object.values(ACTIONS_CONVERTIES)) {
        for (const nom of noms) expect(source, `${chemin} → ${nom}`).not.toMatch(new RegExp(`<form\\s+action=\\{${nom}\\}`));
      }
    }
  });

  it("les parseurs de formulaire lèvent ErreurSaisie, jamais Error", () => {
    for (const chemin of ["lib/prospectVendeurFormulaire.ts", "lib/acquereurFormulaire.ts", "lib/bienFormulaire.ts", "lib/contactFormulaire.ts", "lib/mandatFormulaire.ts"]) {
      const source = lire(chemin);
      expect(source, chemin).not.toContain("throw new Error(");
      expect(source, chemin).toContain("throw new ErreurSaisie(");
    }
  });
});
