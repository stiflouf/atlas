import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// ADR-055 §G — garanties STRUCTURELLES de l'interaction canonique.
//
// L'invariant central protégé ici est une FRONTIÈRE, pas une colonne : Interaction ≠ Event ≠ Task ≠
// Domain Record. C'est la distinction qu'une table « générique » efface toujours, et une fois
// effacée elle ne se reconstruit pas — on ne sait plus lesquelles des lignes décrivaient un échange
// humain et lesquelles décrivaient un fait du domaine.

const valeursExportees: unknown[] = Object.values(schema);
const tables = new Map(
  valeursExportees
    .filter((valeur): valeur is PgTable => is(valeur, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return [config.name, config] as const;
    })
);

function config(nomTable: string) {
  const trouvee = tables.get(nomTable);
  if (!trouvee) throw new Error(`Table absente du schéma : ${nomTable}`);
  return trouvee;
}

function colonnes(nomTable: string): string[] {
  return config(nomTable).columns.map((colonne) => colonne.name);
}

function listerFichiersSource(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return listerFichiersSource(chemin);
    return /\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

describe("ADR-055 §G — l'interaction est un échange humain, rattaché à une personne", () => {
  it("interactions est une FEUILLE de contacts : contact_id NOT NULL, aucun workspace_id", () => {
    const interaction = config("interactions");
    const contactId = interaction.columns.find((colonne) => colonne.name === "contact_id");
    expect(contactId!.notNull, "une interaction sans personne ne décrit aucune relation").toBe(true);
    expect(interaction.columns.some((colonne) => colonne.name === "workspace_id")).toBe(false);

    const parents = interaction.foreignKeys
      .map((fk) => fk.reference())
      .filter((reference) => reference.columns.every((colonne) => colonne.notNull))
      .map((reference) => getTableConfig(reference.foreignTable).name);
    expect(parents).toEqual(["contacts"]);
  });

  it("le contact n'absorbe aucune interaction en retour", () => {
    // La frontière est symétrique : ni contenu d'échange, ni date de dernier contact sur la
    // personne. Une mémoire relationnelle se DÉRIVE des interactions, elle ne s'y stocke pas.
    const interdits = ["derniere_interaction_le", "dernier_contact_le", "contenu", "type", "sens", "survenu_le"];
    expect(colonnes("contacts").filter((colonne) => interdits.includes(colonne))).toEqual([]);
  });

  it("une interaction ne porte aucun rôle ni statut métier", () => {
    const interdits = ["role", "statut", "stade_projet", "pipeline", "interet", "score"];
    expect(colonnes("interactions").filter((colonne) => interdits.includes(colonne))).toEqual([]);
  });

  it("le type est contraint par la base, pas par une convention", () => {
    // Le CONTENU du vocabulaire (et l'absence de 'visite', 'mandat_signe', 'offre_acceptee') est
    // vérifié en base par interactionRepository.test.ts, qui tente réellement l'insertion : c'est
    // la seule preuve qui vaille, l'objet SQL du CHECK n'étant pas inspectable comme du texte.
    expect(config("interactions").checks.map((c) => c.name)).toContain("interactions_type_check");
  });

  it("le sens est optionnel : un rendez-vous n'est ni reçu, ni émis, ni interne", () => {
    const sens = config("interactions").columns.find((colonne) => colonne.name === "sens");
    expect(sens!.notNull, "un NOT NULL forcerait une valeur inventée sur un cas réel").toBe(false);
    expect(config("interactions").checks.map((c) => c.name)).toContain("interactions_sens_check");
  });

  it("la date métier du fait est distincte de la date d'enregistrement", () => {
    // Un import futur enregistrera des échanges vieux de six mois : les dater d'aujourd'hui
    // inventerait une chronologie.
    const survenu = config("interactions").columns.find((colonne) => colonne.name === "survenu_le");
    expect(survenu!.notNull).toBe(true);
    expect(survenu!.hasDefault, "survenu_le ne doit jamais retomber sur now()").toBe(false);
    const cree = config("interactions").columns.find((colonne) => colonne.name === "cree_le");
    expect(cree!.hasDefault).toBe(true);
  });

  it("le contexte utilise des cibles dédiées, jamais un couple polymorphe", () => {
    for (const interdit of ["contexte_type", "contexte_id", "cible_type", "cible_id", "objet_type", "objet_id"]) {
      expect(colonnes("interactions"), `interactions.${interdit}`).not.toContain(interdit);
    }
    const cibles = config("interactions")
      .foreignKeys.map((fk) => fk.reference())
      .map((reference) => [reference.columns[0].name, getTableConfig(reference.foreignTable).name]);
    expect(cibles).toContainEqual(["projet_acquereur_id", "projets_acquereur"]);
    expect(cibles).toContainEqual(["projet_vendeur_id", "projets_vendeur"]);
    expect(cibles).toContainEqual(["bien_id", "biens"]);
    // AU PLUS une : un appel de courtoisie sans dossier reste un fait relationnel valide.
    expect(config("interactions").checks.map((c) => c.name)).toContain("interactions_un_seul_contexte_check");
  });

  it("aucun identifiant fournisseur ni payload brut (ADR-056)", () => {
    const interdits = [
      "gmail_message_id",
      "calendar_event_id",
      "playiad_id",
      "hektor_id",
      "apimo_id",
      "external_id",
      "payload",
      "payload_brut",
    ];
    expect(colonnes("interactions").filter((colonne) => interdits.includes(colonne))).toEqual([]);
  });
});

describe("ADR-055 §G — aucune table existante n'est fusionnée ni remplacée", () => {
  it("comptes_rendus_visite garde son vocabulaire contrôlé, lu par les moteurs", () => {
    expect(colonnes("comptes_rendus_visite")).toContain("interet");
    expect(config("comptes_rendus_visite").checks.length).toBeGreaterThan(0);
  });

  it("notes_prospect_vendeur garde le type qui pilote dernier_contact_le (ADR-027 §4)", () => {
    expect(colonnes("notes_prospect_vendeur")).toContain("type");
    expect(config("notes_prospect_vendeur").checks.map((c) => c.name)).toContain(
      "notes_prospect_vendeur_type_check"
    );
  });

  it("envois_email reste un audit technique, jamais un fait CRM (ADR-031-bis)", () => {
    // Ses marqueurs d'audit sont intacts, et il n'a toujours aucun contact : ce n'est pas une
    // interaction déguisée.
    expect(colonnes("envois_email")).toEqual(
      expect.arrayContaining(["contenu_hash", "incertain_le", "gmail_message_id"])
    );
    expect(colonnes("envois_email")).not.toContain("contact_id");
  });

  it("evenements_metier et taches restent des tables distinctes", () => {
    // Interaction = ce qui s'est passé dans la relation. Event = un fait déterministe du domaine.
    // Task = ce qui doit être fait. Aucune des trois ne référence les autres.
    expect(tables.has("evenements_metier")).toBe(true);
    expect(tables.has("taches")).toBe(true);
    for (const table of ["evenements_metier", "taches", "comptes_rendus_visite", "notes_prospect_vendeur"]) {
      expect(colonnes(table), `${table} ne doit pas être rattachée aux interactions`).not.toContain(
        "interaction_id"
      );
    }
    expect(colonnes("interactions"), "une interaction ne référence ni un événement ni une tâche").not.toContain(
      "evenement_id"
    );
    expect(colonnes("interactions")).not.toContain("tache_id");
  });

  it("memoire_contextuelle n'est pas touchée", () => {
    // La mémoire relationnelle future sera un READ MODEL dérivé, pas une reprise de cette table.
    expect(tables.has("memoire_contextuelle")).toBe(true);
    expect(colonnes("memoire_contextuelle")).not.toContain("interaction_id");
  });

  it("ni provenance, ni connecteur, ni relation projet-biens", () => {
    const horsPerimetre = ["references_externes", "synchronisations_entite", "projets_vendeur_biens"];
    expect([...tables.keys()].filter((nom) => horsPerimetre.includes(nom))).toEqual([]);
  });
});

describe("ADR-055 §G — rien ne lit encore les interactions", () => {
  const FICHIERS = listerFichiersSource("src").filter((chemin) => !/\.test\.tsx?$/.test(chemin));
  const REFERENCES = /interactionRepository|interactions as |from "@\/types\/interaction"|interactionsTable/;

  it("aucun écran ne lit interactions", () => {
    const fautifs = FICHIERS.filter(
      (chemin) => chemin.includes(join("src", "app")) || chemin.includes(join("src", "components"))
    ).filter((chemin) => REFERENCES.test(readFileSync(chemin, "utf8")));
    expect(fautifs, "l'interaction canonique est une fondation, pas une lecture").toEqual([]);
  });

  it("aucun moteur pur ne dépend des interactions", () => {
    const moteurs = [
      join("lib", "compatibilite"),
      join("lib", "opportunites"),
      join("lib", "alertes"),
      join("lib", "fiscal"),
      join("lib", "relations"),
    ];
    const fautifs = FICHIERS.filter((chemin) => moteurs.some((moteur) => chemin.includes(moteur))).filter((chemin) =>
      REFERENCES.test(readFileSync(chemin, "utf8"))
    );
    expect(fautifs, "les moteurs purs restent sur les sources historiques").toEqual([]);
  });

  it("aucun flux existant n'écrit d'interaction canonique", () => {
    // Décision du lot : ni les notes vendeur, ni les envois d'email ne créent de miroir. Une note
    // vendeur A déjà un foyer, et `envois_email` n'a ni contact ni contenu — un miroir y serait
    // fabriqué, pas constaté.
    const fautifs = FICHIERS.filter((chemin) => chemin.includes(join("src", "actions"))).filter((chemin) =>
      REFERENCES.test(readFileSync(chemin, "utf8"))
    );
    expect(fautifs).toEqual([]);
  });
});
