import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOGUE_REGLES_AUTOMATISATION } from "@/lib/automatisations/catalogueRegles";

// VISIT_SIGNED_FORM_V1 (ADR-063) — gardes structurelles du périmètre (§61 du brief) : jamais de
// revendication eIDAS/qualifiée, jamais de fournisseur externe câblé, jamais de règle
// d'automatisation consommant bon_visite_signe, lifecycle Visite jamais dépendant du bon.
function lireFichier(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), "utf8");
}

describe("VISIT_SIGNED_FORM_V1 — gardes structurelles", () => {
  it("aucune revendication eIDAS/signature qualifiée dans le code du domaine", () => {
    const fichiers = [
      "./templateBonVisite.ts",
      "./pdfBonVisite.ts",
      "../bonVisiteRepository.ts",
      "../../actions/bonVisite.ts",
    ];
    for (const chemin of fichiers) {
      const source = lireFichier(chemin);
      expect(source.toLowerCase()).not.toContain("eidas");
      expect(source.toLowerCase()).not.toContain("qualifiée");
      expect(source.toLowerCase()).not.toContain("signature avancée");
    }
  });

  it("§9 — le provider de signature reste verrouillé à 'domiora' en V1 (aucun câblage externe)", () => {
    const source = lireFichier("../bonVisiteRepository.ts");
    expect(source).toContain('provider: "domiora"');
    expect(source).not.toMatch(/provider:\s*["'`](?!domiora)/);
  });

  it("aucune règle d'automatisation ne consomme bon_visite_signe (§18/§24 — pas d'automation Visit)", () => {
    const codes = CATALOGUE_REGLES_AUTOMATISATION.map((r) => r.typeEvenement);
    expect(codes).not.toContain("bon_visite_signe");
  });

  it("aucun mot-clé BuyerProject/co-acquéreur générique dans le domaine bon de visite", () => {
    const source = lireFichier("../bonVisiteRepository.ts");
    expect(source).not.toMatch(/BuyerProject/i);
    expect(source).not.toMatch(/participants_visite/i);
  });
});

// BON_VISITE_LEGAL_HARDENING_V2 — gardes du durcissement V2.
describe("BON_VISITE_LEGAL_HARDENING_V2 — gardes structurelles", () => {
  // I6 — source unique : la formule de consentement n'est écrite QUE dans le template.
  it("la formule de consentement n'est dupliquée ni dans le formulaire React, ni dans le PDF", () => {
    const fragment = "appose volontairement ma signature";
    expect(lireFichier("./templateBonVisite.ts")).toContain(fragment);
    for (const chemin of ["./pdfBonVisite.ts", "../../components/visite/BonVisiteSignatureForm.tsx"]) {
      expect(lireFichier(chemin)).not.toContain(fragment);
    }
  });

  // I3 — aucune date ne peut venir du client : la Server Action ne lit AUCUN champ de date.
  it("la Server Action de signature ne lit aucune date du formulaire", () => {
    const source = lireFichier("../../actions/bonVisite.ts");
    for (const [, champ] of source.matchAll(/formData\.get\("([^"]+)"\)/g)) {
      expect(champ.toLowerCase()).not.toMatch(/date|realisee|horodat/);
    }
    expect(source).not.toMatch(/datePrevue/);
  });

  // I4 — la date prévue n'est pas un paramètre du gabarit V2, et son unique appelant ne tente pas
  // de la lui passer. Le snapshot continue par ailleurs de CONSERVER `visite.datePrevue` comme
  // donnée (c'est un fait de la Visite) : ce qui est interdit, c'est de l'AFFIRMER comme date de
  // visite dans l'attestation.
  it("domiora-v2 ne reçoit jamais datePrevue", () => {
    const template = lireFichier("./templateBonVisite.ts");
    expect(template.slice(template.indexOf("ParametresTexteBonVisiteV2"))).not.toContain("datePrevue");
    const repo = lireFichier("../bonVisiteRepository.ts");
    const appels = [...repo.matchAll(/construireTexteBonVisiteV2\(\{[^}]*\}\)/g)];
    expect(appels).toHaveLength(1);
    expect(appels[0][0]).not.toContain("datePrevue");
  });

  // BON_VISITE_V2_VISIT_LIFECYCLE_CORRECTION — TEXT_SHOWN = TEXT_SIGNED par CONSTRUCTION : le texte
  // n'est substitué qu'à la préparation du bon, et aucun chemin ne le recalcule ensuite. Un seul
  // appelant du gabarit (garde ci-dessus), et aucune réécriture de `contenuSnapshot` à la signature.
  it("le texte n'est jamais reconstruit après la préparation du bon", () => {
    const repo = lireFichier("../bonVisiteRepository.ts");
    // `contenuSnapshot` n'apparaît dans aucun `.set({...})` : la seule écriture est l'INSERT de
    // création. Un UPDATE du contenu figé réintroduirait la divergence « texte lu / texte signé ».
    expect(repo).not.toMatch(/\.set\(\{[^}]*contenuSnapshot/);
    // Ni la page de signature ni le PDF ne construisent de texte.
    for (const chemin of [
      "../../app/visites/[id]/bon-de-visite/[bonId]/page.tsx",
      "../../components/visite/BonVisiteSignatureForm.tsx",
      "./pdfBonVisite.ts",
    ]) {
      expect(lireFichier(chemin)).not.toContain("construireTexteBonVisiteV2");
    }
  });

  // La signature ne touche JAMAIS au lifecycle de la Visite : `planifiee → realisee` reste la
  // conséquence exclusive de la création d'un compte rendu (ADR-040 §7, ADR-063 §43).
  it("le domaine bon de visite n'écrit jamais le statut ni realisee_le de la Visite", () => {
    for (const chemin of ["../bonVisiteRepository.ts", "../../actions/bonVisite.ts"]) {
      const source = lireFichier(chemin);
      // `realiseeLe` ne doit être que LU (snapshot, choix de formulation), jamais écrit : aucun
      // UPDATE de `visites`, aucune pose de statut terminal.
      expect(source).not.toMatch(/update\(visitesTable\)/);
      expect(source).not.toMatch(/\.set\(\{[^}]*(realiseeLe|statut:\s*["']realisee["'])/);
    }
  });

  // I10 — le hash reste hors du PDF : le générateur n'a aucun moyen de le calculer ni de le recevoir.
  it("le générateur PDF n'a aucun accès au hash du document", () => {
    const source = lireFichier("./pdfBonVisite.ts");
    expect(source).not.toContain("createHash");
    expect(source).not.toContain("node:crypto");
    // Aucun champ de hash dans le contrat d'entrée du générateur.
    const contrat = source.slice(source.indexOf("export type DonneesPdfBonVisite"), source.indexOf("const LARGEUR_A4"));
    expect(contrat.toLowerCase()).not.toContain("hash");
  });
});
