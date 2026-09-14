import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-055 §H — la section RENDS des faits, elle n'en produit aucun et n'en tire aucune décision.
// Frontières verrouillées : aucune base, aucune écriture, aucune fusion, aucun rapprochement,
// aucune comparaison de coordonnées, aucun score, aucun fournisseur, aucune journalisation.

const COMPOSANT = join(__dirname, "ContactsSimilairesSection.tsx");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const composant = codeSeul(COMPOSANT);

describe("ContactsSimilairesSection — rendu pur de faits", () => {
  it("ne lit aucune base et n'importe aucun repository", () => {
    expect(composant).not.toMatch(/@\/db\/|drizzle-orm|Repository"|getDb|Table\b/);
  });

  it("n'importe aucun chemin d'écriture, de rattachement ni de fusion", () => {
    for (const interdit of [
      "@/actions",
      "rattachementContact",
      "modifierIdentiteContact",
      "creerContact",
      "fusionnerContacts",
      "verrouillerChamp",
    ]) {
      expect(composant, interdit).not.toContain(interdit);
    }
  });

  it("aucun formulaire ni bouton d'action : uniquement une navigation vers la fiche du candidat", () => {
    expect(composant).not.toMatch(/<form|action=|<button|type="submit"|onClick|"use client"/);
    expect(composant).toContain("href={`/contacts/${candidat.contactId}`}");
    expect(composant).toContain("Voir le contact");
  });

  it("aucun mot de fusion, de doublon ni de verdict d'identité", () => {
    expect(composant).not.toMatch(/fusionn|doublon|dupli|merge|résoudre|comparer/i);
    // « même personne » n'apparaît que nié : le texte dit ce que la détection ne prouve pas.
    expect(composant.match(/même personne/g)).toHaveLength(1);
    expect(composant).toContain("ne signifie pas nécessairement qu’il\n        s’agit de la même personne");
  });

  it("aucune comparaison ni normalisation d'email, de téléphone ou de nom", () => {
    expect(composant).not.toMatch(/\.email\s*===|\.telephone\s*===|\.nom\s*===|\.prenom\s*===/);
    expect(composant).not.toMatch(/toLowerCase|trim\(|normalize\(|replace\(|localeCompare/);
    expect(composant).not.toMatch(/\.sort\(|\.slice\(|\.filter\(|new Set\(|new Map\(|\.reduce\(/);
  });

  it("aucun score ni niveau : les signaux sont des libellés textuels, un par signal", () => {
    expect(composant).not.toMatch(/score|confiance|confidence|pourcentage|%|fort|moyen|faible/i);
    expect(composant).toContain('email: "Même email"');
    expect(composant).toContain('telephone: "Même téléphone"');
    expect(composant).toContain('nom_prenom: "Même nom et prénom"');
    expect(composant).toContain("candidat.signaux.map(");
  });

  it("le nom vient de nomPersonne, jamais d'une concaténation locale", () => {
    expect(composant).toContain("nomComplet(candidat)");
    expect(composant).not.toMatch(/\$\{candidat\.prenom\}|candidat\.prenom \+/);
  });

  it("rien n'est rendu sans candidat", () => {
    expect(composant).toContain("if (candidats.length === 0) return null;");
  });

  it("aucun fournisseur, aucune journalisation", () => {
    expect(composant).not.toMatch(/referencesExternes|lib\/provenance|google|gmail|\biad\b|synchronisation/i);
    expect(composant).not.toMatch(/console\.\w+/);
  });
});
