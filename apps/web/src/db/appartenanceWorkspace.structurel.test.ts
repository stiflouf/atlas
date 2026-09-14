import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// ADR-054 — garantie STRUCTURELLE de l'appartenance, sur le modèle de
// src/actions/gardeSessionAtlas.structurel.test.ts : ce test ne lit pas le texte du fichier, il
// inspecte le modèle Drizzle réellement construit (getTableConfig) — aucun grep, aucune base de
// données, aucune dépendance externe.
//
// Ce qu'il protège, et pourquoi c'est ici plutôt que dans une revue humaine :
//   - toute table AJOUTÉE au schéma doit être classée explicitement (le test échoue tant qu'elle ne
//     l'est pas) — c'est la traduction exécutable de l'invariant ADR-054 §7 « toute table créée
//     après cette ADR porte son appartenance dès sa création » ;
//   - une table FEUILLE ne doit jamais dupliquer `workspace_id` (ADR-054 §7, dernier paragraphe) ;
//   - un secret personnel ne doit jamais devenir un actif du workspace (ADR-054 §6) ;
//   - une appartenance NON TRANCHÉE ne doit pas être résolue en silence par un futur lot.

const NOM_COLONNE = "workspace_id";
const VALEUR_WORKSPACE_HISTORIQUE = "default";

// Le modèle d'appartenance lui-même : ces deux tables ne sont pas « possédées », elles définissent
// la possession. Jamais classées comme racines (elles n'ont pas de workspace_id vers elles-mêmes).
const TABLES_MODELE_APPARTENANCE = ["workspaces", "workspace_membres"];

// RACINES — portent `workspace_id`. Recalculées depuis le schéma réel (aucune FK NOT NULL vers un
// parent possédé), jamais recopiées depuis une liste illustrative d'ADR.
const TABLES_RACINES = [
  // ADR-055 — l'identité canonique naît directement racine (ADR-054 §7), comme toute table créée
  // après cette ADR.
  "contacts",
  // ADR-055 §B — RACINE et non feuille de `contacts` : un projet porté par un couple n'appartient
  // à aucun des deux en particulier, son périmètre ne peut donc pas être dérivé d'un contact.
  "projets_acquereur",
  // ADR-055 §B — même raison côté vendeur : un projet porté en indivision n'appartient à aucun des
  // coindivisaires en particulier.
  "projets_vendeur",
  "biens",
  "acquereurs",
  "prospects_vendeurs",
  "taches",
  "envois_email",
  "evenements_metier",
  "configurations_automatisation",
  "runs_scan_automatisation",
  "compatibilites_a_resynchroniser",
  // ADR-056 — la couche provenance naît racine : deux workspaces peuvent légitimement recevoir le
  // MÊME identifiant du MÊME fournisseur sans que ce soit une collision.
  "references_externes",
  "champs_verrouilles",
];

// FEUILLES — appartenance dérivée d'au moins une FK NOT NULL vers un parent possédé. Aucune ne
// porte `workspace_id` : dénormaliser l'appartenance créerait une seconde vérité qui peut diverger
// de son parent, exactement ce que le schéma refuse partout ailleurs (photo principale dérivée,
// statut de tâche dérivé, statut commercial dérivé).
const TABLES_FEUILLES = [
  // ADR-059 — journal de fusion : feuille de `contacts` par ses deux FK NOT NULL (survivant,
  // absorbé). L'appartenance est celle des deux contacts, que le moteur futur vérifiera identique.
  "contact_fusions",
  // ADR-055 §B — relation contact <-> projet. Feuille de ses DEUX parents ; ne duplique pas
  // `workspace_id`, l'invariant inter-workspaces est tenu par `ajouterPartieProjet`.
  "parties_projet",
  // ADR-055 §F — FEUILLE de `biens` : le périmètre d'un mandat est celui de l'actif sur lequel il
  // porte. Le dupliquer permettrait d'écrire un mandat dans un autre workspace que son bien.
  "mandats",
  // ADR-055 §G — FEUILLE de `contacts` : le périmètre d'un échange est celui de la personne avec
  // qui il a eu lieu.
  "interactions",
  "secteurs_recherche_acquereur",
  "reperes_relationnels_acquereur",
  "notes_bien",
  "documents_bien",
  "photos_bien",
  "visites",
  "comptes_rendus_visite",
  "offres",
  "offre_visites",
  "compromis",
  "transmissions_dossier_notaire",
  "notes_prospect_vendeur",
  "remuneration",
  "executions_automatisation",
  "compatibilites_bien_acquereur_etat",
  "profil_fiscal",
  "historique_amorcage",
  "rfr_foyer",
];

// SECRET / DONNÉE PERSONNELLE À L'IDENTITÉ (ADR-054 §6) — ne devient jamais un actif du workspace.
const TABLES_PRIVEES_IDENTITE = ["connexions_google"];

// RÉFÉRENTIEL NON POSSÉDÉ — barème légal valable pour tout le monde, aucune appartenance.
const TABLES_TECHNIQUES_GLOBALES = ["regle_fiscale"];

// APPARTENANCE NON TRANCHÉE — volontairement sans `workspace_id`. Un doute ne doit pas être
// transformé en modèle permanent : voir les commentaires dédiés dans schema.ts.
const TABLES_APPARTENANCE_NON_TRANCHEE = ["memoire_contextuelle", "dossier_fiscal"];

// Feuilles dont la chaîne de FK NOT NULL remonte à une table d'appartenance NON TRANCHÉE plutôt
// qu'à une racine. Épingler la liste rend le jour de la décision visible : elle doit devenir vide.
const FEUILLES_RATTACHEES_A_UNE_APPARTENANCE_NON_TRANCHEE = ["profil_fiscal", "historique_amorcage", "rfr_foyer"];

// Parcours récursif du code source, même patron que gardeSessionAtlas.structurel.test.ts (qui
// lit un seul dossier) — étendu ici à tout `src/` parce que la règle porte sur le produit entier.
function listerFichiersSource(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return listerFichiersSource(chemin);
    return /\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

type ConfigTable = ReturnType<typeof getTableConfig>;

// `unknown[]` avant le filtre : `Object.values(schema)` produit l'union des types de tables
// CONCRETS, à laquelle `PgTable` générique n'est pas assignable — le prédicat de type ne compilerait
// pas sans cet élargissement (TS2677).
const valeursExportees: unknown[] = Object.values(schema);

const tables = new Map<string, ConfigTable>(
  valeursExportees
    .filter((valeur): valeur is PgTable => is(valeur, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return [config.name, config] as const;
    })
);

function config(nom: string): ConfigTable {
  const trouvee = tables.get(nom);
  if (!trouvee) throw new Error(`Table absente du schéma : ${nom}`);
  return trouvee;
}

function colonneWorkspace(nom: string) {
  return config(nom).columns.find((colonne) => colonne.name === NOM_COLONNE);
}

// Parents MÉTIER atteignables par une FK NOT NULL (une FK nullable ne prouve jamais une
// appartenance : la ligne peut exister sans elle). `workspaces` est exclu : la FK d'une racine vers
// lui EST son appartenance, pas un parent dont elle l'hériterait — les confondre ferait passer
// toute racine pour une feuille.
function parentsObligatoires(nom: string): string[] {
  const c = config(nom);
  return c.foreignKeys
    .map((fk) => fk.reference())
    .filter((reference) => reference.columns.every((colonne) => colonne.notNull))
    .map((reference) => getTableConfig(reference.foreignTable).name)
    .filter((parent) => parent !== nom && !TABLES_MODELE_APPARTENANCE.includes(parent));
}

// Remonte la chaîne des FK NOT NULL jusqu'à une table qui n'en a plus : c'est là que
// l'appartenance doit être portée.
function racinesStructurelles(nom: string, vues = new Set<string>()): string[] {
  if (vues.has(nom)) return [];
  vues.add(nom);
  const parents = parentsObligatoires(nom);
  if (parents.length === 0) return [nom];
  return [...new Set(parents.flatMap((parent) => racinesStructurelles(parent, vues)))];
}

describe("ADR-054 — le périmètre n'est jamais inventé par le code de production", () => {
  const FICHIERS_PRODUCTION = listerFichiersSource("src").filter(
    (chemin) => !/\.test\.tsx?$/.test(chemin) && !chemin.endsWith("workspaceDeTest.ts")
  );

  it("aucun fichier de production ne code en dur l'identifiant du workspace historique", () => {
    // Le périmètre vient de la session (`exigerWorkspaceCourant`) ou de la base
    // (`resoudreWorkspaceExecutionMachine`). Un littéral rangerait silencieusement des données dans
    // le workspace historique le jour où un second existera — exactement ce que la migration 0033
    // cherche à rendre impossible. Seul le schéma a le droit de le nommer : c'est lui qui déclare
    // la valeur par défaut de `workspaces.id`.
    const fautifs = FICHIERS_PRODUCTION.filter((chemin) => {
      if (chemin.endsWith("schema.ts")) return false;
      const contenu = readFileSync(chemin, "utf8");
      return /workspaceId\s*[:=]\s*"default"|"default"\s*as\s+WorkspaceId/.test(contenu);
    });
    expect(fautifs).toEqual([]);
  });

  it("le raccourci de test WORKSPACE_TEST n'est importé par aucun fichier de production", () => {
    const fautifs = FICHIERS_PRODUCTION.filter((chemin) => readFileSync(chemin, "utf8").includes("workspaceDeTest"));
    expect(fautifs).toEqual([]);
  });
});

describe("ADR-054 — appartenance des tables (garantie structurelle)", () => {
  it("classe chaque table du schéma exactement une fois", () => {
    const classees = [
      ...TABLES_MODELE_APPARTENANCE,
      ...TABLES_RACINES,
      ...TABLES_FEUILLES,
      ...TABLES_PRIVEES_IDENTITE,
      ...TABLES_TECHNIQUES_GLOBALES,
      ...TABLES_APPARTENANCE_NON_TRANCHEE,
    ];

    expect(new Set(classees).size, "une table ne peut appartenir qu'à une seule catégorie").toBe(classees.length);
    // Une table ajoutée au schéma sans être classée fait échouer ce test — c'est exactement le
    // garde-fou voulu par ADR-054 §7 (aucune table sans appartenance décidée).
    expect([...tables.keys()].sort()).toEqual([...classees].sort());
  });

  it("chaque table RACINE porte workspace_id : NOT NULL, SANS DEFAULT, FK vers workspaces", () => {
    for (const nom of TABLES_RACINES) {
      const colonne = colonneWorkspace(nom);
      expect(colonne, `${nom} doit porter ${NOM_COLONNE}`).toBeDefined();
      expect(colonne!.notNull, `${nom}.${NOM_COLONNE} doit être NOT NULL`).toBe(true);
      // ADR-054, migration 0033 — AUCUN DEFAULT : le filet posé par 0032 a été retiré une fois tous
      // les chemins d'écriture rendus explicites. C'est un invariant de SÉCURITÉ, pas un détail de
      // schéma : le réintroduire ferait silencieusement retomber toute écriture distraite dans le
      // workspace historique au lieu de la faire échouer.
      expect(colonne!.hasDefault, `${nom}.${NOM_COLONNE} ne doit avoir AUCUN DEFAULT (migration 0033)`).toBe(false);

      const fkVersWorkspaces = config(nom)
        .foreignKeys.map((fk) => fk.reference())
        .find((reference) => reference.columns.some((colonne) => colonne.name === NOM_COLONNE));
      expect(fkVersWorkspaces, `${nom}.${NOM_COLONNE} doit être une vraie FK`).toBeDefined();
      expect(getTableConfig(fkVersWorkspaces!.foreignTable).name).toBe("workspaces");
      expect(fkVersWorkspaces!.foreignColumns.map((colonne) => colonne.name)).toEqual(["id"]);
    }
  });

  it("aucune table RACINE n'est en réalité une feuille (aucune FK NOT NULL vers un parent possédé)", () => {
    for (const nom of TABLES_RACINES) {
      expect(parentsObligatoires(nom), `${nom} a un parent obligatoire : ce serait une feuille`).toEqual([]);
    }
  });

  it("aucune table FEUILLE ne duplique workspace_id, et chacune a un parent obligatoire", () => {
    for (const nom of TABLES_FEUILLES) {
      expect(colonneWorkspace(nom), `${nom} est une feuille : elle ne doit pas porter ${NOM_COLONNE}`).toBeUndefined();
      expect(parentsObligatoires(nom).length, `${nom} doit avoir au moins une FK NOT NULL`).toBeGreaterThan(0);
    }
  });

  it("l'appartenance d'une feuille remonte toujours à une racine, ou à une appartenance explicitement non tranchée", () => {
    const feuillesNonTranchees: string[] = [];

    for (const nom of TABLES_FEUILLES) {
      for (const racine of racinesStructurelles(nom)) {
        const estRacinePossedee = TABLES_RACINES.includes(racine);
        const estNonTranchee = TABLES_APPARTENANCE_NON_TRANCHEE.includes(racine);
        expect(
          estRacinePossedee || estNonTranchee,
          `${nom} remonte à ${racine}, qui n'est ni une racine possédée ni une appartenance non tranchée`
        ).toBe(true);
        if (estNonTranchee) feuillesNonTranchees.push(nom);
      }
    }

    // Doit devenir [] le jour où l'appartenance de dossier_fiscal est tranchée.
    expect([...new Set(feuillesNonTranchees)].sort()).toEqual([...FEUILLES_RATTACHEES_A_UNE_APPARTENANCE_NON_TRANCHEE].sort());
  });

  it("un secret personnel ne devient jamais un actif du workspace (ADR-054 §6)", () => {
    for (const nom of TABLES_PRIVEES_IDENTITE) {
      expect(colonneWorkspace(nom), `${nom} porte un secret personnel : jamais de ${NOM_COLONNE}`).toBeUndefined();
      const referenceWorkspaces = config(nom)
        .foreignKeys.map((fk) => fk.reference())
        .some((reference) => getTableConfig(reference.foreignTable).name === "workspaces");
      expect(referenceWorkspaces, `${nom} ne doit référencer workspaces d'aucune manière`).toBe(false);
    }
  });

  it("une appartenance non tranchée ou globale ne reçoit pas workspace_id en silence", () => {
    for (const nom of [...TABLES_APPARTENANCE_NON_TRANCHEE, ...TABLES_TECHNIQUES_GLOBALES]) {
      expect(colonneWorkspace(nom), `${nom} ne doit pas porter ${NOM_COLONNE} sans décision explicite`).toBeUndefined();
    }
  });

  it("workspaces et workspace_membres restent le modèle minimal décidé par ADR-054", () => {
    const workspaces = config("workspaces");
    expect(workspaces.columns.map((colonne) => colonne.name).sort()).toEqual(["cree_le", "id", "nom"]);
    // Aucune colonne « au cas où » : pas de slug, pas de statut, pas d'organisation, pas de plan.
    expect(workspaces.columns.find((colonne) => colonne.name === "id")!.default).toBe(VALEUR_WORKSPACE_HISTORIQUE);
    // `nom` nullable : le workspace historique n'a jamais reçu de libellé, aucun n'est inventé.
    expect(workspaces.columns.find((colonne) => colonne.name === "nom")!.notNull).toBe(false);

    const membres = config("workspace_membres");
    expect(membres.columns.map((colonne) => colonne.name).sort()).toEqual([
      "ajoute_le",
      "email",
      "identite_sub",
      "role",
      "workspace_id",
    ]);
    // Clé logique en PK composite, jamais un uuid de substitution.
    expect(membres.primaryKeys.map((pk) => pk.columns.map((colonne) => colonne.name))).toEqual([
      ["workspace_id", "identite_sub"],
    ]);
    // Vocabulaire de rôle fermé : 'member'/'manager'/'admin' n'existent pas tant que leur
    // sémantique n'est pas implémentée (ADR-054 §5).
    expect(membres.checks.map((contrainte) => contrainte.name)).toContain("workspace_membres_role_check");
  });
});
