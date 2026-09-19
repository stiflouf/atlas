import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-055 §H — la section RENDS des faits, elle n'en produit aucun et n'en tire aucune décision.
// Frontières verrouillées : aucune base, aucune écriture, aucune fusion, aucun rapprochement,
// aucune comparaison de coordonnées, aucun score, aucun fournisseur, aucune journalisation.

const COMPOSANT = join(__dirname, "ContactsSimilairesSection.tsx");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    // Checkout Windows (core.autocrlf) : les fins de ligne CRLF casseraient la comparaison
    // structurelle ci-dessous, dont l'attendu contient un `\n` littéral au milieu d'un texte JSX
    // reformaté sur deux lignes — normalisées ici, jamais pour un fichier réellement écrit.
    .replace(/\r\n/g, "\n")
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

  it("aucun formulaire ni bouton d'action : deux navigations, la fiche du candidat et la comparaison", () => {
    expect(composant).not.toMatch(/<form|action=|<button|type="submit"|onClick|"use client"/);
    expect(composant).toContain("href={`/contacts/${candidat.contactId}`}");
    expect(composant).toContain("Voir le contact");
    // ADR-059 — « Comparer » ouvre la page de fusion, dont le premier segment est le contact courant
    // (conservé par défaut). Aucun bouton « Fusionner » ici : la fusion se décide sur cette page.
    expect(composant).toContain("href={`/contacts/${contactCourantId}/fusionner/${candidat.contactId}`}");
    expect(composant).toContain("Comparer");
    expect(composant).not.toMatch(/>\s*Fusionner/);
  });

  it("aucun mot de doublon ni de verdict d'identité", () => {
    expect(composant).not.toMatch(/doublon|dupli|merge|résoudre/i);
    // Le seul « fusionner » est le segment d'URL de la page de comparaison, jamais un libellé.
    expect(composant.match(/fusionn/gi)?.length).toBe(1);
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
