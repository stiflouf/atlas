import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

// ADR-059 — le MODÈLE de fusion, sans moteur. Ce que ces gardes figent : le journal est
// append-only, aucun moteur de fusion n'existe dans ce lot, les lecteurs de contacts ACTIFS
// excluent les absorbés en SQL, l'éditeur et le writer d'identité les refusent, la fiche absorbée
// explique sans rediriger, et la résolution de chaîne est bornée.

const SRC = join(__dirname, "..");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function listerFichiersSource(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return listerFichiersSource(chemin);
    return /\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

const FICHIERS_PRODUCTION = listerFichiersSource(SRC);
const lire = (...segments: string[]) => codeSeul(join(SRC, ...segments));

describe("ADR-059 — schéma", () => {
  it("contacts porte le marqueur de fusion : pointeur nullable auto-référent + date, cohérents et jamais vers soi", () => {
    const contacts = getTableConfig(schema.contacts);
    const pointeur = contacts.columns.find((c) => c.name === "fusionne_dans_contact_id");
    const date = contacts.columns.find((c) => c.name === "fusionne_le");
    expect(pointeur?.notNull).toBe(false);
    expect(date?.notNull).toBe(false);
    const fk = contacts.foreignKeys.map((f) => f.reference()).find((r) => r.columns.some((c) => c.name === "fusionne_dans_contact_id"));
    expect(getTableConfig(fk!.foreignTable).name).toBe("contacts");
    expect(contacts.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining(["contacts_fusion_coherente_check", "contacts_fusion_pas_soi_meme_check"])
    );
    expect(contacts.indexes.map((i) => i.config.name)).toContain("contacts_fusionne_dans_idx");
  });

  it("contact_fusions a exactement les colonnes du journal, deux FK NOT NULL vers contacts, aucun workspace_id", () => {
    const journal = getTableConfig(schema.contactFusions);
    expect(journal.columns.map((c) => c.name).sort()).toEqual(
      [
        "id",
        "contact_survivant_id",
        "contact_absorbe_id",
        "fusionne_le",
        "fusionne_par_sub",
        "fusionne_par_email",
        "identite_avant_survivant",
        "identite_avant_absorbe",
        "identite_finale",
        "choix_par_champ",
        "ids_deplaces",
        "avertissements_acquittes",
      ].sort()
    );
    const parents = journal.foreignKeys.map((f) => f.reference()).map((r) => [getTableConfig(r.foreignTable).name, r.columns[0].notNull]);
    expect(parents).toEqual([
      ["contacts", true],
      ["contacts", true],
    ]);
    expect(journal.checks.map((c) => c.name)).toContain("contact_fusions_pas_soi_meme_check");
  });
});

describe("ADR-059 — journal append-only, un seul moteur", () => {
  it("aucun UPDATE ni DELETE de contact_fusions dans src", () => {
    const fautifs = FICHIERS_PRODUCTION.filter((chemin) => /\.(update|delete)\(\s*contactFusions/.test(codeSeul(chemin)));
    expect(fautifs).toEqual([]);
  });

  it("le journal n'est écrit que par le moteur, le marqueur n'est posé que par contactRepository", () => {
    const journal = FICHIERS_PRODUCTION.filter((chemin) => /insert\(\s*contactFusions/.test(codeSeul(chemin)));
    expect(journal).toEqual([join(SRC, "lib", "fusionContactRepository.ts")]);
    const marqueur = FICHIERS_PRODUCTION.filter((chemin) =>
      /\.set\(\s*\{[^}]*fusionne(DansContactId|Le)\s*:/.test(codeSeul(chemin))
    );
    expect(marqueur).toEqual([join(SRC, "lib", "contactRepository.ts")]);
  });

  it("un seul moteur de fusion, dans lib, et aucun alias (absorberContact, repointerContact, mergeContacts)", () => {
    const moteur = FICHIERS_PRODUCTION.filter((chemin) => /export async function fusionnerContacts\(/.test(codeSeul(chemin)));
    expect(moteur).toEqual([join(SRC, "lib", "fusionContactRepository.ts")]);
    const alias = FICHIERS_PRODUCTION.filter((chemin) => /absorberContact|repointerContact|mergeContacts/.test(codeSeul(chemin)));
    expect(alias).toEqual([]);
  });

  it("exactement DEUX writers de contacts dans src, tous deux dans contactRepository", () => {
    const porteurs = FICHIERS_PRODUCTION.filter((chemin) => /update\(\s*contactsTable/.test(codeSeul(chemin)));
    expect(porteurs).toEqual([join(SRC, "lib", "contactRepository.ts")]);
    const code = lire("lib", "contactRepository.ts");
    expect(code.match(/\.update\(contactsTable\)/g)?.length).toBe(2);
    const identite = code.match(/export async function modifierIdentiteContact[\s\S]*?\n}/)?.[0] ?? "";
    const marqueur = code.match(/export async function marquerContactFusionne[\s\S]*?\n}/)?.[0] ?? "";
    expect(identite).toContain(".update(contactsTable)");
    expect(marqueur).toContain(".update(contactsTable)");
  });
});

describe("ADR-059 — lecteurs de contacts actifs", () => {
  const EXCLUSION = "isNull(contactsTable.fusionneDansContactId)";

  it("la recherche Contact, la recherche mixte et les candidats de rattachement excluent les absorbés en SQL", () => {
    for (const fichier of ["rechercheContactRepository.ts", "recherchePersonneRepository.ts", "rattachementContact.ts"]) {
      expect(lire("lib", fichier), fichier).toContain(EXCLUSION);
    }
  });

  it("la similarité exclut les absorbés comme source et comme candidat", () => {
    expect(lire("lib", "similariteContactRepository.ts").match(/isNull\(contactsTable\.fusionneDansContactId\)/g)?.length).toBe(2);
  });

  it("le rattachement refuse un contact absorbé comme destination, par la garde partagée sous verrou", () => {
    const code = lire("lib", "rattachementContact.ts");
    expect(code).toContain("const contact = await verrouillerContactActif(contactId, executeur);");
    expect(code).toContain('if (contact.statut !== "actif") return { statut: "contact_introuvable" };');
  });
});

describe("ADR-059 — un contact absorbé est figé", () => {
  it("le writer d'identité vérifie lui-même l'état fusionné avant d'écrire", () => {
    const code = lire("lib", "contactRepository.ts");
    const writer = code.match(/export async function modifierIdentiteContact[\s\S]*?\n}/)?.[0] ?? "";
    expect(writer.indexOf("estContactFusionne(")).toBeGreaterThan(-1);
    expect(writer.indexOf("estContactFusionne(")).toBeLessThan(writer.indexOf(".update(contactsTable)"));
  });

  it("l'écran et l'action d'édition traitent un absorbé comme introuvable", () => {
    expect(lire("app", "contacts", "[id]", "modifier", "page.tsx")).toContain("estContactFusionne(contact)) notFound()");
    expect(lire("actions", "modifierContact.ts")).toContain("estContactFusionne(actuel)) notFound()");
  });
});

describe("ADR-059 — fiche absorbée et chaîne", () => {
  it("le read model de la fiche distingue actif et fusionné, et s'arrête à la première requête pour un absorbé", () => {
    const code = lire("lib", "contactDetailRepository.ts");
    expect(code).toContain('type: "fusionne"');
    expect(code).toContain('type: "actif"');
    expect(code.indexOf('type: "fusionne"')).toBeLessThan(code.indexOf(".from(partiesProjetTable)"));
  });

  it("la fiche explique sans rediriger : composant dédié, aucun redirect, similarité non appelée pour un absorbé", () => {
    const page = lire("app", "contacts", "[id]", "page.tsx");
    expect(page).not.toMatch(/redirect\(/);
    expect(page).toContain('resultat.type === "fusionne"');
    expect(page.indexOf("<ContactFusionneFiche")).toBeLessThan(page.indexOf("trouverContactsSimilaires(id, workspaceId)"));
    const fiche = lire("components", "contact", "ContactFusionneFiche.tsx");
    expect(fiche).toContain("Ce contact a été fusionné avec un autre contact.");
    expect(fiche).toContain("Voir le contact actif");
    expect(fiche).not.toMatch(/<form|<button|action=|\/modifier|@\/db\/|Repository"/);
  });

  it("le lien de la fiche absorbée cible le contact actif FINAL, résolu par le read model, jamais suivi par le composant", () => {
    const fiche = lire("components", "contact", "ContactFusionneFiche.tsx");
    expect(fiche).toContain("href={`/contacts/${contactActifId}`}");
    expect(fiche).not.toMatch(/fusionneDansContactId|resoudreContactActif|MAX_CHAINE_FUSION|while|for \(/);
    const readModel = lire("lib", "contactDetailRepository.ts");
    expect(readModel).toContain("resoudreContactActif(identite.id, workspaceId, executeur)");
    expect(readModel).toContain("contactActifId: resolution.contact.id");
    expect(readModel).toContain('if (resolution.statut !== "actif")');
    // Aucune seconde traversée : la seule boucle sur `fusionneDansContactId` est dans resoudreContactActif.
    const traversees = FICHIERS_PRODUCTION.filter((chemin) => /while\s*\(\s*estContactFusionne|\.fusionneDansContactId,\s*workspaceId/.test(codeSeul(chemin)));
    expect(traversees).toEqual([join(SRC, "lib", "contactRepository.ts")]);
    const page = lire("app", "contacts", "[id]", "page.tsx");
    expect(page).toContain("contactActifId={resultat.contactActifId}");
    expect(page).not.toContain("resoudreContactActif");
  });

  it("la résolution de chaîne est bornée et détecte les cycles", () => {
    const code = lire("lib", "contactRepository.ts");
    const resolution = code.match(/export async function resoudreContactActif[\s\S]*?\n}/)?.[0] ?? "";
    expect(resolution).toContain("MAX_CHAINE_FUSION");
    expect(resolution).toContain("vus.has(");
    expect(resolution).toContain('statut: "chaine_invalide"');
    expect(lire("lib", "contactFusion.ts")).toContain("export const MAX_CHAINE_FUSION = 10;");
  });
});
