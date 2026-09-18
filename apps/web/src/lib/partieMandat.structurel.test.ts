import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

// ADR-060 §16 — garanties STRUCTURELLES de MANDATE_PARTIES_V1 : le schéma de `parties_mandat`
// (feuille, deux rôles, une personne par mandat, rien supprimé en cascade), un seul writer, la
// garde Contact actif réutilisée, le moteur de fusion seul à repointer, la priorité des rôles
// déterministe et propre au domaine, et tout ce que ce lot ne fait volontairement PAS : provenance
// dédiée, verrous de champ, écran, automatisation, backfill, copie depuis parties_projet.

const SRC = join(__dirname, "..");
const REPO = join(SRC, "lib", "partieMandatRepository.ts");
const MOTEUR = join(SRC, "lib", "fusionContactRepository.ts");

const valeursExportees: unknown[] = Object.values(schema);
const tables = new Map(
  valeursExportees
    .filter((valeur): valeur is PgTable => is(valeur, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return [config.name, config] as const;
    })
);
const parties = tables.get("parties_mandat")!;
const colonne = (nom: string) => parties.columns.find((c) => c.name === nom);

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
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

describe("ADR-060 §16 — schéma parties_mandat", () => {
  it("la table existe : mandat_id, contact_id, role NOT NULL ; cree_le avec default ; rien d'autre", () => {
    expect(parties).toBeDefined();
    expect(parties.columns.map((c) => c.name).sort()).toEqual(["contact_id", "cree_le", "id", "mandat_id", "role"]);
    for (const nom of ["mandat_id", "contact_id", "role"]) expect(colonne(nom)!.notNull, nom).toBe(true);
    expect(colonne("role")!.hasDefault).toBe(false);
    expect(colonne("cree_le")!.hasDefault).toBe(true);
  });

  it("CHECK rôle à deux valeurs, UNIQUE(mandat_id, contact_id), aucune autre unicité", () => {
    expect(parties.checks.map((c) => c.name)).toEqual(["parties_mandat_role_check"]);
    const source = readFileSync(join(SRC, "db", "schema.ts"), "utf8");
    expect(source).toMatch(/parties_mandat_role_check", sql`\$\{table\.role\} IN \('mandant','representant'\)`/);
    expect(parties.uniqueConstraints.map((u) => [u.name, u.columns.map((c) => c.name)])).toEqual([
      ["parties_mandat_mandat_contact_unique", ["mandat_id", "contact_id"]],
    ]);
  });

  it("deux FK NO ACTION (mandats, contacts) : rien n'est jamais supprimé en cascade", () => {
    const fks = parties.foreignKeys.map((fk) => {
      const reference = fk.reference();
      return { table: getTableConfig(reference.foreignTable).name, colonne: reference.columns[0].name, onDelete: fk.onDelete ?? "no action" };
    });
    expect(fks.sort((x, y) => x.table.localeCompare(y.table))).toEqual([
      { table: "contacts", colonne: "contact_id", onDelete: "no action" },
      { table: "mandats", colonne: "mandat_id", onDelete: "no action" },
    ]);
  });

  it("deux index explicites, aucun workspace_id (feuille : partie → mandat → bien → workspace)", () => {
    expect(parties.indexes.map((i) => i.config.name).sort()).toEqual(["parties_mandat_contact_idx", "parties_mandat_mandat_idx"]);
    expect(colonne("workspace_id")).toBeUndefined();
  });

  it("la migration 0045 est additive : une table, aucun INSERT/UPDATE/DELETE, aucun backfill", () => {
    const sql = readFileSync(join(SRC, "db", "migrations", "0045_mandate_parties.sql"), "utf8").replace(/^--.*$/gm, "");
    expect(sql).toContain('CREATE TABLE "parties_mandat"');
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP)\b/m);
    expect(sql).not.toMatch(/ALTER TABLE "(mandats|contacts|parties_projet)"/);
    expect(sql).toMatch(/ON DELETE no action[\s\S]*ON DELETE no action/);
    expect(sql).not.toMatch(/workspace_id/);
  });
});

describe("ADR-060 §16 — writers et gardes", () => {
  const repo = codeSeul(REPO);
  const moteur = codeSeul(MOTEUR);

  it("un seul INSERT dans parties_mandat, dans le repository ; UPDATE/DELETE seulement là et dans le moteur de fusion", () => {
    const inserts = FICHIERS.filter((c) => /\.insert\(\s*partiesMandatTable\s*\)/.test(codeSeul(c)));
    expect(inserts.map(relatif)).toEqual(["lib/partieMandatRepository.ts"]);
    const mutations = FICHIERS.filter((c) => /\.(update|delete)\(\s*partiesMandatTable\s*\)/.test(codeSeul(c)));
    expect(mutations.map(relatif).sort()).toEqual(["lib/fusionContactRepository.ts", "lib/partieMandatRepository.ts"]);
    // Le repository ne réécrit jamais `contact_id` ni `mandat_id` : une partie change de rôle ou disparaît.
    expect(repo).not.toMatch(/\.set\(\s*\{[^}]*\b(contactId|mandatId)\b/);
    expect(repo.match(/\.set\(/g)?.length).toBe(1);
    expect(repo).toContain(".set({ role })");
  });

  it("ajouterPartieMandat : transaction, mandat verrouillé scoped AVANT le contact, garde Contact actif partagée", () => {
    expect(repo).toContain('import { verrouillerContactActif } from "@/lib/contactActif"');
    expect(repo).toContain('import { verrouillerMandat } from "@/lib/mandatRepository"');
    const debut = repo.indexOf("export async function ajouterPartieMandat(");
    const fin = repo.indexOf("\nexport ", debut + 1);
    const writer = repo.slice(debut, fin);
    expect(writer).toContain("executeur.transaction(async (tx) =>");
    const verrouMandat = writer.indexOf("verrouillerMandat(mandatId, workspaceId, tx)");
    const verrouContact = writer.indexOf("verrouillerContactActif(input.contactId, tx, workspaceId)");
    const insertion = writer.indexOf(".insert(partiesMandatTable)");
    expect(verrouMandat).toBeGreaterThan(0);
    expect(verrouContact).toBeGreaterThan(verrouMandat);
    expect(insertion).toBeGreaterThan(verrouContact);
    expect(writer).toContain('return { statut: "contact_fusionne" }');
    // Jamais réécrit vers le survivant ; aucun verrou de contact posé par le repository lui-même.
    expect(repo).not.toMatch(/fusionneDansContactId|resoudreContactActif|\.for\("update"\)\s*;?\s*$/m);
    expect(repo.match(/\.for\("update", \{ of: partiesMandatTable \}\)/g)?.length).toBe(1);
  });

  it("retirer / modifier rôle : scoped par mandat → bien → workspace, sous verrou de la partie", () => {
    const verrou = repo.slice(repo.indexOf("async function verrouillerPartie("), repo.indexOf("\nexport ", repo.indexOf("async function verrouillerPartie(")));
    expect(verrou).toContain("innerJoin(mandatsTable, eq(partiesMandatTable.mandatId, mandatsTable.id))");
    expect(verrou).toContain("innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))");
    expect(verrou).toContain("eq(biensTable.workspaceId, workspaceId)");
    for (const writer of ["export async function retirerPartieMandat(", "export async function modifierRolePartieMandat("]) {
      const debut = repo.indexOf(writer);
      const corps = repo.slice(debut, repo.indexOf("\nexport ", debut + 1));
      expect(corps, writer).toContain("verrouillerPartie(partieId, workspaceId, tx)");
    }
    expect(repo).not.toMatch(/delete\(\s*(contactsTable|mandatsTable)\s*\)/);
  });

  it("listerPartiesMandat : une requête jointe contacts + mandats + biens, filtrée par workspace", () => {
    const debut = repo.indexOf("export async function listerPartiesMandat(");
    const lecture = repo.slice(debut);
    expect(lecture.match(/\.select\(/g)?.length).toBe(1);
    expect(lecture).toContain("innerJoin(contactsTable, eq(partiesMandatTable.contactId, contactsTable.id))");
    expect(lecture).toContain("eq(biensTable.workspaceId, workspaceId)");
    expect(lecture).not.toMatch(/for \(|\.map\(async|Promise\.all/);
  });

  it("le moteur de fusion est le seul à repointer contact_id, dédouble AVANT, et lit la priorité pure du domaine", () => {
    const repoints = FICHIERS.filter((c) => /update\(\s*partiesMandatTable\s*\)\s*\.set\(\s*\{\s*contactId/.test(codeSeul(c)));
    expect(repoints.map(relatif)).toEqual(["lib/fusionContactRepository.ts"]);
    expect(moteur.indexOf("tx.delete(partiesMandatTable)")).toBeLessThan(moteur.indexOf(".update(partiesMandatTable)\n        .set({ contactId: contactSurvivantId })"));
    expect(moteur).toContain("roleRetenuPartieMandat(");
    const types = codeSeul(join(SRC, "types", "partieMandat.ts"));
    expect(types).not.toMatch(/partieProjet|drizzle-orm|@\/db\//);
    expect(types).toContain("const PRIORITE: Record<RolePartieMandat, number> = { mandant: 0, representant: 1 }");
  });

  it("le journal de fusion garde ses clés historiques et ajoute les trois clés parties_mandat, optionnelles à la lecture", () => {
    const types = readFileSync(join(SRC, "types", "contactFusion.ts"), "utf8");
    for (const cle of ["partiesProjet: string[]", "partiesProjetSupprimees: string[]", "partiesProjetRoleCorrige:"]) expect(types).toContain(cle);
    for (const cle of ["partiesMandat?: string[]", "partiesMandatSupprimees?: string[]", "partiesMandatRoleCorrige?:"]) expect(types).toContain(cle);
  });
});

describe("ADR-060 §16 — hors périmètre du lot parties", () => {
  it("aucune provenance dédiée, aucun verrou de champ pour une partie de mandat", () => {
    for (const table of ["references_externes", "champs_verrouilles"]) {
      expect(tables.get(table)!.columns.map((c) => c.name), table).not.toContain("partie_mandat_id");
    }
    const provenance = FICHIERS.filter((c) => c.includes(join("lib", "provenance")) || c.includes(join("types", "provenance")));
    for (const chemin of provenance) expect(codeSeul(chemin), relatif(chemin)).not.toMatch(/partie_mandat|partieMandat|partiesMandat/);
  });

  // Lot MANDATE_CANONICAL_UI_V1 : les parties se gèrent depuis la fiche Bien — par UNE Server
  // Action (`actions/mandat.ts`, writers du repository) et UN composant présentationnel
  // (`MandatBienPanel`, props seulement). Aucune page, aucune automatisation.
  it("seuls actions/mandat.ts et MandatBienPanel touchent parties_mandat ; aucune page, aucune automatisation", () => {
    const consommateurs = FICHIERS.filter(
      (c) => [join("src", "app"), join("src", "components"), join("src", "actions"), join("lib", "automatisations")].some((d) => c.includes(d))
    ).filter((c) => /partieMandatRepository|partiesMandat|types\/partieMandat|parties_mandat/.test(codeSeul(c)));
    expect(consommateurs.map(relatif).sort()).toEqual(["actions/mandat.ts", "components/mandat/MandatBienPanel.tsx"]);
    expect(codeSeul(join(SRC, "components", "mandat", "MandatBienPanel.tsx"))).not.toMatch(/partieMandatRepository|@\/db\//);
  });

  it("aucune copie automatique ni backfill : signature, création directe, enregistrement et successeur n'écrivent aucune partie", () => {
    for (const chemin of ["lib/prospectVendeurRepository.ts", "lib/mandatRepository.ts", "lib/bienRepository.ts", "actions/creerBien.ts", "actions/prospectVendeur.ts"]) {
      expect(codeSeul(join(SRC, chemin)), chemin).not.toMatch(/partiesMandat|partieMandatRepository|ajouterPartieMandat/);
    }
    // Le repository des parties ne lit jamais parties_projet : suggestion future, jamais source de vérité.
    expect(codeSeul(REPO)).not.toMatch(/partiesProjet|partieProjet/);
  });

  it("aucune personne morale : deux rôles, aucune table Organisation", () => {
    for (const nom of ["organisations", "personnes_morales", "societes"]) expect([...tables.keys()]).not.toContain(nom);
    expect(readFileSync(join(SRC, "types", "partieMandat.ts"), "utf8")).toContain('["mandant", "representant"] as const');
  });
});
