import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// ADR-055 §B — garanties STRUCTURELLES du côté vendeur, et de la relation désormais partagée par
// les deux types de projet. Même patron que les tests structurels précédents : inspection du modèle
// Drizzle réellement construit, aucune base, aucun grep sur le texte du schéma.
//
// L'invariant central protégé ici est celui qu'ADR-055 pose en toutes lettres (invariant 5) : une
// partie rattache un contact à EXACTEMENT un projet. Le jour où quelqu'un ajoutera une troisième
// cible en oubliant le CHECK, ou remplacera les cibles dédiées par un couple {type, id} « plus
// souple », ces tests doivent échouer.

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

describe("ADR-055 §B — le projet vendeur est une intention de vendre, jamais une personne", () => {
  it("projets_vendeur ne porte aucune identité humaine", () => {
    const interdits = ["nom", "prenom", "email", "telephone", "contact_id", "personne_morale"];
    expect(
      colonnes("projets_vendeur").filter((colonne) => interdits.includes(colonne)),
      "un projet de vente n'a pas de nom : il a des parties, qui sont des contacts"
    ).toEqual([]);
  });

  it("contacts ne reçoit en retour aucun champ vendeur", () => {
    // Frontière symétrique : ce lot ne fait pas non plus remonter un jalon de vente sur la personne.
    const interdits = [
      "mandat_signe_le",
      "mandat_propose_le",
      "qualifie_le",
      "estimation_proposee_centimes",
      "origine_lead",
      "projet_vendeur_id",
    ];
    expect(colonnes("contacts").filter((colonne) => interdits.includes(colonne))).toEqual([]);
  });

  it("projets_vendeur ne porte ni description de bien, ni attribut de mandat", () => {
    // Le bien relèvera de Property, le mandat de l'entité `mandats` (ADR-055 §F). Recopier leurs
    // champs ici figerait des frontières que ce lot n'a pas les moyens de trancher.
    const duBien = ["adresse", "adresse_bien_potentiel", "ville", "code_postal", "type_bien", "bien_id"];
    const duMandat = ["numero_mandat", "type_mandat", "exclusivite_jusqu_au", "date_fin", "resilie_le"];
    expect(colonnes("projets_vendeur").filter((colonne) => duBien.includes(colonne))).toEqual([]);
    expect(colonnes("projets_vendeur").filter((colonne) => duMandat.includes(colonne))).toEqual([]);
  });

  it("aucun stade_projet stocké côté vendeur : le statut se dérive des jalons", () => {
    // ADR-014/027 — `deriverStatutProspectVendeur()` déduit le statut du jalon le plus avancé
    // réellement atteint. Le stocker créerait une seconde vérité qui divergerait.
    for (const interdit of ["stade_projet", "statut", "statut_vendeur", "pipeline"]) {
      expect(colonnes("projets_vendeur"), `projets_vendeur.${interdit}`).not.toContain(interdit);
    }
  });

  it("projets_vendeur porte son appartenance explicitement (ADR-054)", () => {
    const workspace = config("projets_vendeur").columns.find((colonne) => colonne.name === "workspace_id");
    expect(workspace).toBeDefined();
    expect(workspace!.notNull).toBe(true);
    expect(workspace!.hasDefault).toBe(false);
  });

  it("aucun identifiant fournisseur (ADR-056)", () => {
    const interdits = ["playiad_id", "hektor_id", "apimo_id", "external_id", "reference_externe", "source_id"];
    expect(colonnes("projets_vendeur").filter((colonne) => interdits.includes(colonne))).toEqual([]);
  });

  it("le pont vers le projet vendeur est optionnel, et l'historique intact", () => {
    const pont = config("prospects_vendeurs").columns.find((colonne) => colonne.name === "projet_vendeur_id");
    expect(pont, "prospects_vendeurs doit pouvoir pointer vers son projet canonique").toBeDefined();
    expect(pont!.notNull, "aucun NOT NULL tant que le backfill n'est pas prouvé").toBe(false);

    // Aucune colonne historique perdue : le modèle qui pilote le pipeline vendeur est intact.
    for (const colonne of ["nom", "email", "telephone", "qualifie_le", "mandat_signe_le", "bien_id"]) {
      expect(colonnes("prospects_vendeurs"), `prospects_vendeurs.${colonne}`).toContain(colonne);
    }
  });
});

describe("ADR-055 invariant 5 — une partie rattache un contact à exactement un projet", () => {
  const partie = config("parties_projet");

  it("les deux cibles sont des colonnes dédiées, jamais un couple polymorphe", () => {
    expect(colonnes("parties_projet")).toContain("projet_acquereur_id");
    expect(colonnes("parties_projet")).toContain("projet_vendeur_id");
    // Le couple {type, id} est explicitement écarté par ADR-055 : il rend les FK impossibles et
    // laisse la base incapable de refuser un identifiant qui ne désigne rien.
    for (const interdit of ["projet_type", "projet_id", "cible_type", "cible_id", "type"]) {
      expect(colonnes("parties_projet"), `parties_projet.${interdit}`).not.toContain(interdit);
    }

    // Chaque cible est une VRAIE clé étrangère vers sa table.
    const cibles = partie.foreignKeys
      .map((fk) => fk.reference())
      .map((reference) => [reference.columns[0].name, getTableConfig(reference.foreignTable).name]);
    expect(cibles).toContainEqual(["projet_acquereur_id", "projets_acquereur"]);
    expect(cibles).toContainEqual(["projet_vendeur_id", "projets_vendeur"]);
  });

  it("un CHECK impose exactement une cible — jamais zéro, jamais deux", () => {
    const contrainte = partie.checks.find((c) => c.name === "parties_projet_une_seule_cible_check");
    expect(contrainte, "l'invariant 5 d'ADR-055 doit être tenu par la base, pas par une convention").toBeDefined();
  });

  it("le rôle vit sur la relation, avec un vocabulaire fermé couvrant les deux côtés", () => {
    expect(colonnes("parties_projet")).toContain("role");
    // Ni la personne ni les projets ne stockent de rôle : c'est la participation qui le fait.
    expect(colonnes("contacts")).not.toContain("role");
    expect(colonnes("projets_vendeur")).not.toContain("role");
    expect(colonnes("projets_acquereur")).not.toContain("role");
    expect(partie.checks.map((c) => c.name)).toContain("parties_projet_role_check");
  });

  it("N:N réel des DEUX côtés : aucune unicité sur une colonne seule", () => {
    // Une unicité sur `contact_id` seul interdirait à une personne d'avoir plusieurs projets ; une
    // unicité sur un `projet_*_id` seul interdirait le couple. L'une ou l'autre ferait retomber le
    // modèle en 1:N sans que personne ne s'en aperçoive.
    const uniques = partie.uniqueConstraints.map((contrainte) => contrainte.columns.map((c) => c.name).sort());
    expect(uniques).toContainEqual(["contact_id", "projet_acquereur_id"]);
    expect(uniques).toContainEqual(["contact_id", "projet_vendeur_id"]);
    expect(uniques.every((colonnes) => colonnes.length === 2)).toBe(true);
  });
});

describe("ADR-055 §B — le tunnel vendeur historique reste sur prospects_vendeurs", () => {
  const FICHIERS = listerFichiersSource("src").filter((chemin) => !/\.test\.tsx?$/.test(chemin));

  it("ni mandat, ni interaction, ni provenance n'existent encore", () => {
    const horsPerimetre = ["mandats", "projets_vendeur_biens", "interactions", "references_externes"];
    expect([...tables.keys()].filter((nom) => horsPerimetre.includes(nom))).toEqual([]);
  });

  it("aucun écran ne lit le modèle vendeur canonique", () => {
    const fautifs = FICHIERS.filter(
      (chemin) => chemin.includes(join("src", "app")) || chemin.includes(join("src", "components"))
    ).filter((chemin) => /projetVendeurRepository|projetsVendeur|partieProjetRepository/.test(readFileSync(chemin, "utf8")));
    expect(fautifs, "le modèle canonique est encore une fondation, pas une lecture").toEqual([]);
  });

  it("les moteurs purs ne consomment pas le modèle canonique", () => {
    const moteurs = [join("lib", "compatibilite"), join("lib", "opportunites"), join("lib", "alertes"), join("lib", "fiscal")];
    const fautifs = FICHIERS.filter((chemin) => moteurs.some((moteur) => chemin.includes(moteur))).filter((chemin) =>
      /projetsVendeur|projetsAcquereur|partiesProjet|projetVendeurRepository|projetAcquereurRepository|partieProjetRepository/.test(
        readFileSync(chemin, "utf8")
      )
    );
    expect(fautifs, "les moteurs purs restent branchés sur le modèle historique").toEqual([]);
  });

  it("visites, offres et tâches ne sont pas migrées vers les projets canoniques", () => {
    for (const table of ["visites", "offres", "comptes_rendus_visite", "taches", "notes_prospect_vendeur"]) {
      expect(colonnes(table), `${table}`).not.toContain("projet_vendeur_id");
      expect(colonnes(table), `${table}`).not.toContain("projet_acquereur_id");
    }
  });
});
