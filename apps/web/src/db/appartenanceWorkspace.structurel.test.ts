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
  // WORKSPACE_SCOPING_V2D1 (ADR-054, question ouverte n°4) — appartenance TRANCHÉE : WORKSPACE.
  // RACINE et non feuille : ses cibles (`bien_id`, `client_id`) sont du TEXTE sans FK (ADR-010,
  // catalogues mockés) et sont nullables — aucune dérivation n'est possible, le périmètre doit
  // donc être porté par sa propre colonne. Migration 0055.
  "memoire_contextuelle",
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
  // ADR-060 §16 — relation mandat <-> contact. Feuille de `mandats` (donc de `biens`) et de
  // `contacts` ; l'invariant inter-workspaces est tenu par `ajouterPartieMandat`.
  "parties_mandat",
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
  // ADR-063 (VISIT_SIGNED_FORM_V1) — FEUILLE de `visites` (donc de `biens`) : le périmètre d'un bon
  // de visite est celui de la Visite pour laquelle il a été préparé.
  "bons_visite",
  // ADR-063 (VISIT_SIGNED_FORM_V1) — FEUILLE de `bons_visite` (donc de `visites`/`biens`) : une
  // signature n'a aucun sens hors du bon qu'elle signe.
  "signatures_bon_visite",
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
const TABLES_PRIVEES_IDENTITE = ["connexions_google", "dossier_fiscal"];

// RÉFÉRENTIEL NON POSSÉDÉ — barème légal valable pour tout le monde, aucune appartenance.
const TABLES_TECHNIQUES_GLOBALES = ["regle_fiscale"];

// APPARTENANCE NON TRANCHÉE — volontairement sans `workspace_id`. Un doute ne doit pas être
// transformé en modèle permanent : voir les commentaires dédiés dans schema.ts.
//
// (WORKSPACE_SCOPING_V2D1 a retiré `memoire_contextuelle` : appartenance tranchée par WORKSPACE.
// FISCAL_IDENTITY_OWNERSHIP_V1 a retiré `dossier_fiscal` : appartenance tranchée par IDENTITÉ,
// il rejoint TABLES_PRIVEES_IDENTITE. Les deux entrées ont été RETIRÉES, pas commentées —
// la liste est VIDE, et c'est le jalon qu'ADR-054 attendait.)
const TABLES_APPARTENANCE_NON_TRANCHEE: string[] = [];

// Feuilles dont la chaîne de FK NOT NULL remonte à une table d'appartenance NON TRANCHÉE plutôt
// qu'à une racine. Épingler la liste rend le jour de la décision visible : elle doit devenir vide.
// Devenue vide avec FISCAL_IDENTITY_OWNERSHIP_V1 : les trois filles fiscales dérivent désormais
// d'une racine dont l'appartenance est tranchée (identité). Elles n'ont PAS reçu de colonne propre
// — ADR-023 §1 l'avait prévu : le rattachement s'ajoute sur `dossier_fiscal` SEULE.
const FEUILLES_RATTACHEES_A_UNE_APPARTENANCE_NON_TRANCHEE: string[] = [];

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
        // FISCAL_IDENTITY_OWNERSHIP_V1 — une feuille peut aussi remonter à une racine possédée par
        // une IDENTITÉ, et non par un workspace : c'est le cas des trois filles fiscales depuis que
        // `dossier_fiscal` porte `identite_sub`. Leur isolation vient de leur parent, exactement
        // comme pour une feuille de workspace — seul le propriétaire diffère.
        const estRacineIdentite = TABLES_PRIVEES_IDENTITE.includes(racine);
        expect(
          estRacinePossedee || estRacineIdentite || estNonTranchee,
          `${nom} remonte à ${racine}, qui n'est ni une racine possédée (workspace ou identité) ni une appartenance non tranchée`
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

  // WORKSPACE_SCOPING_V2D2 — le pendant POSITIF de la garde ci-dessus. « Pas de workspace_id » ne
  // suffisait pas : la table n'avait AUCUNE appartenance, son identité était le littéral 'default'.
  // Un secret personnel doit être rattaché à quelqu'un, et à une PERSONNE — ce test échoue donc
  // aussi bien si `identite_sub` disparaît que si elle cesse d'être la clé.
  it("un secret personnel est rattaché à une identité, et cette identité est sa clé", () => {
    for (const nom of TABLES_PRIVEES_IDENTITE) {
      const colonnes = config(nom).columns;
      const identite = colonnes.find((c) => c.name === "identite_sub");
      expect(identite, `${nom} doit porter identite_sub : un secret sans propriétaire est un secret partagé`).toBeDefined();
      expect(identite!.notNull, `${nom}.identite_sub ne peut pas être nullable`).toBe(true);
      // Ce qui compte est UNE LIGNE PAR PERSONNE, pas la forme de la clé. `connexions_google` y
      // parvient par sa PK (aucune table fille) ; `dossier_fiscal` par une contrainte UNIQUE, parce
      // que trois filles référencent déjà son `id` et qu'y déplacer la PK imposerait de réécrire
      // leurs FK sur des données non recalculables (ADR-023 §1). Les deux formes sont acceptées,
      // l'absence d'unicité ne l'est pas.
      const uniqueSurIdentite = config(nom).uniqueConstraints.some(
        (contrainte) => contrainte.columns.length === 1 && contrainte.columns[0].name === "identite_sub"
      );
      expect(
        identite!.primary || uniqueSurIdentite,
        `${nom}.identite_sub doit être unique (PK ou contrainte UNIQUE) : une ligne PAR personne`
      ).toBe(true);
      // Aucune FK : il n'existe pas de table d'utilisateurs, et workspace_membres.identite_sub n'est
      // pas unique. Une FK vers elle rattacherait le secret à une APPARTENANCE, pas à une personne.
      expect(config(nom).foreignKeys, `${nom} ne doit avoir aucune FK`).toHaveLength(0);
    }
  });

  it("une appartenance non tranchée ou globale ne reçoit pas workspace_id en silence", () => {
    for (const nom of [...TABLES_APPARTENANCE_NON_TRANCHEE, ...TABLES_TECHNIQUES_GLOBALES]) {
      expect(colonneWorkspace(nom), `${nom} ne doit pas porter ${NOM_COLONNE} sans décision explicite`).toBeUndefined();
    }
  });

  it("workspaces et workspace_membres restent le modèle minimal décidé par ADR-054", () => {
    const workspaces = config("workspaces");
    // Deux socles distincts, et la distinction est le fond de cette garde.
    //
    // ADR-054 — APPARTENANCE : trois colonnes, et toujours trois. Aucune colonne « au cas où » :
    // pas de slug, pas de statut, pas d'organisation, pas de plan.
    //
    // ADR-065 — IDENTITÉ JURIDIQUE du responsable du traitement. Ces colonnes ne sont pas des
    // colonnes spéculatives : chacune correspond à une information qu'une notice de confidentialité
    // doit porter, décidée et justifiée par son ADR. La garde reste donc une LISTE FERMÉE —
    // ajouter une quatorzième colonne continue de faire échouer ce test, et c'est le seul moment où
    // quelqu'un est forcé de se demander si elle sert vraiment à identifier un responsable.
    const COLONNES_APPARTENANCE = ["cree_le", "id", "nom"];
    const COLONNES_IDENTITE_PRIVACY = [
      "controller_address_line1",
      "controller_address_line2",
      "controller_city",
      "controller_country_code",
      "controller_legal_form",
      "controller_legal_name",
      "controller_postal_code",
      "controller_siren",
      "controller_trade_name",
      "dpo_email",
      "dpo_name",
      "privacy_identity_modifie_le",
      "privacy_rights_email",
    ];
    expect(workspaces.columns.map((colonne) => colonne.name).sort()).toEqual(
      [...COLONNES_APPARTENANCE, ...COLONNES_IDENTITE_PRIVACY].sort()
    );
    expect(workspaces.columns.find((colonne) => colonne.name === "id")!.default).toBe(VALEUR_WORKSPACE_HISTORIQUE);
    // `nom` nullable : le workspace historique n'a jamais reçu de libellé, aucun n'est inventé.
    expect(workspaces.columns.find((colonne) => colonne.name === "nom")!.notNull).toBe(false);
    // ADR-065 — les treize colonnes d'identité sont TOUTES nullables et sans défaut. C'est ce qui
    // rend la migration 0059 applicable sans backfill : aucune identité juridique n'existe nulle
    // part dans le produit, et un NOT NULL aurait exigé d'en inventer une.
    for (const nom of COLONNES_IDENTITE_PRIVACY) {
      const colonne = workspaces.columns.find((candidate) => candidate.name === nom)!;
      expect(colonne.notNull, nom).toBe(false);
      expect(colonne.default, nom).toBeUndefined();
    }

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
