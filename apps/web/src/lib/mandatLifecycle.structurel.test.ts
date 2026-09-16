import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

// ADR-060 — garanties STRUCTURELLES de MANDATE_LIFECYCLE_FOUNDATION_V1 : le schéma additif, le
// standard workspace des writers, l'absence de dual-write legacy/canonique, et tout ce que ce lot
// ne fait volontairement PAS (parties_mandat, événement ciblant un mandat, connecteur, écran).

const SRC = join(__dirname, "..");
const valeursExportees: unknown[] = Object.values(schema);
const tables = new Map(
  valeursExportees
    .filter((valeur): valeur is PgTable => is(valeur, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return [config.name, config] as const;
    })
);
const mandats = tables.get("mandats")!;
const colonne = (nom: string) => mandats.columns.find((c) => c.name === nom);

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function corps(code: string, signature: string): string {
  const debut = code.indexOf(signature);
  expect(debut, signature).toBeGreaterThanOrEqual(0);
  const suite = code.indexOf("\nexport ", debut + 1);
  return code.slice(debut, suite === -1 ? undefined : suite);
}

function listerFichiers(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return listerFichiers(chemin);
    return /\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

describe("ADR-060 — migration lifecycle : additive, nullable, sans default", () => {
  it("quatre colonnes nullables sans default", () => {
    for (const nom of ["type", "numero", "exclusivite_jusqu_au", "motif_resiliation"]) {
      const c = colonne(nom);
      expect(c, nom).toBeDefined();
      expect(c!.notNull, `${nom} nullable`).toBe(false);
      expect(c!.hasDefault, `${nom} sans default`).toBe(false);
    }
  });

  it("CHECK type (vocabulaire ADR-055 §F) et CHECK exclusivité", () => {
    const noms = mandats.checks.map((c) => c.name);
    expect(noms).toContain("mandats_type_check");
    expect(noms).toContain("mandats_exclusivite_coherente_check");
    const source = readFileSync(join(SRC, "db", "schema.ts"), "utf8");
    expect(source).toMatch(/mandats_type_check[\s\S]{0,200}'simple','exclusif','semi_exclusif'/);
  });

  it("trois index FK, aucune unicité, aucun booléen exclusif", () => {
    const index = mandats.indexes.map((i) => i.config.name);
    expect(index).toEqual(expect.arrayContaining(["mandats_bien_idx", "mandats_projet_vendeur_idx", "mandats_remplace_idx"]));
    expect(mandats.uniqueConstraints).toEqual([]);
    expect(colonne("exclusif")).toBeUndefined();
    expect(colonne("duree_mois")).toBeUndefined();
    expect(colonne("date_signature")).toBeUndefined();
  });

  it("aucun workspace_id, aucun statut stocké, aucune table parties_mandat, aucun événement ciblant un mandat", () => {
    expect(colonne("workspace_id")).toBeUndefined();
    for (const interdit of ["statut", "etat", "remplace_le", "cloture_le"]) expect(colonne(interdit), interdit).toBeUndefined();
    expect([...tables.keys()]).not.toContain("parties_mandat");
    expect(tables.get("evenements_metier")!.columns.map((c) => c.name)).not.toContain("mandat_id");
    expect(tables.get("taches")!.columns.map((c) => c.name)).not.toContain("mandat_id");
    expect(tables.get("documents_bien")!.columns.map((c) => c.name)).not.toContain("mandat_id");
  });
});

describe("ADR-060 §13 — writers Mandat : workspace de session, verrou, jamais le formulaire", () => {
  const REPO = codeSeul(join(SRC, "lib", "mandatRepository.ts"));
  const PROSPECT = codeSeul(join(SRC, "lib", "prospectVendeurRepository.ts"));
  const ACTION = codeSeul(join(SRC, "actions", "prospectVendeur.ts"));

  it("la signature relit le prospect FOR UPDATE, scoped workspace, avant toute écriture", () => {
    const signature = corps(PROSPECT, "export async function signerMandatProspectVendeur(");
    const verrou = signature.indexOf('.for("update")');
    expect(verrou).toBeGreaterThan(0);
    expect(signature.slice(0, verrou)).toContain("eq(prospectsVendeursTable.workspaceId, workspaceId)");
    expect(signature.indexOf("creerBien(")).toBeGreaterThan(verrou);
    expect(signature.indexOf("creerMandat(")).toBeGreaterThan(signature.indexOf("creerBien("));
    expect(signature).toContain("executeur.transaction(");
    expect(signature).not.toMatch(/getProspectVendeurById\(/);
  });

  it("modifier / résilier / enregistrer verrouillent via le bien du workspace ; l'action ne lit pas le prospect elle-même", () => {
    const verrouMandat = corps(REPO, "async function verrouillerMandat(");
    expect(verrouMandat).toContain("eq(biensTable.workspaceId, workspaceId)");
    expect(verrouMandat).toContain('.for("update", { of: mandatsTable })');
    const verrouBien = corps(REPO, "export async function verrouillerBienPourMandat(");
    expect(verrouBien).toContain("eq(biensTable.workspaceId, workspaceId)");
    expect(verrouBien).toContain('.for("update")');
    for (const writer of ["export async function modifierMandat(", "export async function resilierMandat("]) {
      expect(corps(REPO, writer)).toContain("verrouillerMandat(mandatId, workspaceId, tx)");
    }
    expect(corps(REPO, "export async function enregistrerMandatExistant(")).toContain("verrouillerBienPourMandat(bienId, workspaceId, tx)");

    const action = corps(ACTION, "export async function signerMandatProspectVendeurAction(");
    expect(action).toContain("exigerWorkspaceCourant()");
    expect(action).not.toMatch(/chargerProspectPourJalon|getProspectVendeurById|transaction\(/);
    expect(ACTION).not.toMatch(/formData\.get\(\s*["']workspace/);
  });

  it("aucun second mandat courant via un writer standard ; une seule définition du courant", () => {
    const enregistrer = corps(REPO, "export async function enregistrerMandatExistant(");
    expect(enregistrer).toContain("mandatCourant !== undefined");
    expect(REPO.match(/export async function mandatCourantDuBien\(/g)).toHaveLength(1);
    expect(corps(REPO, "export async function verrouillerBienPourMandat(")).toContain("mandatCourantDuBien(");
  });

  it("résiliation et renouvellement ne touchent jamais `date_fin` de la ligne concernée", () => {
    const resilier = corps(REPO, "export async function resilierMandat(");
    const set = resilier.slice(resilier.indexOf(".set({"), resilier.indexOf("})", resilier.indexOf(".set({")));
    expect(set).not.toContain("dateFin");
    expect(set).not.toContain("dateDebut");
    const successeur = corps(REPO, "export async function creerMandatSuccesseur(");
    expect(successeur).not.toMatch(/\.update\(/);
  });

  it("aucun dual-write : modifierBien n'écrit jamais mandats, et fige le legacy quand le canonique existe", () => {
    const BIEN = codeSeul(join(SRC, "lib", "bienRepository.ts"));
    const modifier = corps(BIEN, "export async function modifierBien(");
    expect(modifier).toContain("existeMandatCanonique(id, executeur)");
    expect(modifier).toMatch(/mandatLegacyFige \? \{\} : \{ statutMandat: input\.statutMandat, dateMandat: input\.dateMandat \}/);
    expect(BIEN).not.toMatch(/insert\(mandatsTable\)|creerMandat\(/);
    const CREER = codeSeul(join(SRC, "actions", "creerBien.ts"));
    expect(CREER).toContain('donnees.statutMandat === "actif" ? parseFaitsMandatFormData(formData) : undefined');
    expect(CREER).toContain("if (faitsMandat) await creerMandat(");
  });

  it("un seul INSERT dans mandats, dans le repository", () => {
    const fautifs = listerFichiers(SRC).filter((chemin) => /\.insert\(\s*mandatsTable\s*\)/.test(readFileSync(chemin, "utf8")));
    expect(fautifs.map((c) => c.replace(SRC, ""))).toEqual([join("/", "lib", "mandatRepository.ts")]);
  });
});

describe("ADR-060 — hors périmètre du lot lifecycle", () => {
  it("aucun connecteur Mandat : la mutation externe reste restreinte au projet acquéreur", () => {
    const sync = readFileSync(join(SRC, "types", "synchronisation.ts"), "utf8");
    expect(sync).not.toMatch(/typeEntiteCanonique:\s*["']mandat["']/);
  });

  it("champs verrouillables : les faits CORE, jamais la résiliation", () => {
    const source = readFileSync(join(SRC, "lib", "provenance", "champVerrouilleRepository.ts"), "utf8");
    expect(source).toMatch(/mandat: \["type", "numero", "dateDebut", "dateFin", "exclusiviteJusquAu"\]/);
    expect(source).not.toMatch(/mandat: \[[^\]]*resilieLe/);
  });
});
