import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// ADR-055 §B — garanties STRUCTURELLES du projet acquéreur canonique, même patron que
// contactCanonique.structurel.test.ts : inspection du modèle Drizzle réellement construit, aucune
// base de données, aucun grep sur le texte du schéma.
//
// Ce que ces tests protègent : la frontière PERSONNE / PROJET. Elle est facile à respecter le jour
// où on l'écrit et facile à effacer six mois plus tard, en ajoutant « juste le nom » sur le projet
// pour éviter une jointure — ce qui rendrait à nouveau indécidable à qui appartient un projet porté
// par un couple, exactement la dette que ce lot solde.

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

describe("ADR-055 §B — le projet est une intention immobilière, jamais une personne", () => {
  it("projets_acquereur ne porte aucune identité humaine", () => {
    // L'identité vit dans `contacts`, atteinte par `parties_projet`. La recopier ici obligerait à
    // désigner arbitrairement « le » nom d'un projet porté par deux personnes.
    const interdits = ["nom", "prenom", "email", "telephone", "contact_id", "personne_morale"];
    const presents = colonnes("projets_acquereur").filter((colonne) => interdits.includes(colonne));

    expect(
      presents,
      "un projet n'a pas de nom : il a des parties, qui sont des contacts"
    ).toEqual([]);
  });

  it("contacts ne reçoit en retour aucune donnée de projet", () => {
    // La frontière est symétrique : ce lot ne doit pas non plus faire remonter le budget ou le
    // stade sur la personne pour « simplifier » un affichage.
    const interdits = [
      "budget_min",
      "budget_max",
      "criteres",
      "stade_projet",
      "pieces_min",
      "surface_min",
      "projet_acquereur_id",
    ];
    const presents = colonnes("contacts").filter((colonne) => interdits.includes(colonne));

    expect(presents, "une personne n'a pas de budget : ses projets en ont un").toEqual([]);
  });

  it("projets_acquereur porte son appartenance explicitement (ADR-054)", () => {
    const workspace = config("projets_acquereur").columns.find((colonne) => colonne.name === "workspace_id");
    expect(workspace).toBeDefined();
    expect(workspace!.notNull).toBe(true);
    // Aucun DEFAULT : une écriture qui oublierait son périmètre échoue au lieu de retomber
    // silencieusement dans le workspace historique (migration 0033).
    expect(workspace!.hasDefault).toBe(false);
  });

  it("parties_projet est une vraie relation N:N entre contact et projet acquéreur", () => {
    const partie = config("parties_projet");
    expect(partie.columns.find((colonne) => colonne.name === "contact_id")!.notNull).toBe(true);
    // `projet_acquereur_id` est devenue nullable quand les projets vendeur sont arrivés : c'est le
    // CHECK « exactement une cible » qui porte désormais l'invariant, pas la nullabilité. Il est
    // vérifié par projetVendeurCanonique.structurel.test.ts.
    expect(partie.columns.some((colonne) => colonne.name === "projet_acquereur_id")).toBe(true);

    // Les DEUX côtés sont libres : aucune unicité sur `contact_id` seul (un contact peut porter
    // plusieurs projets) ni sur `projet_acquereur_id` seul (un projet peut avoir plusieurs
    // contacts). Une unicité sur l'une des deux colonnes ferait secrètement retomber le modèle en
    // 1:N — c'est exactement l'erreur que ce test empêche.
    const uniques = partie.uniqueConstraints.map((contrainte) => contrainte.columns.map((c) => c.name).sort());
    expect(uniques).toContainEqual(["contact_id", "projet_acquereur_id"]);
    expect(uniques.every((colonnes) => colonnes.length === 2)).toBe(true);
  });

  it("le rôle vit sur la relation, jamais sur le contact ni sur le projet", () => {
    expect(colonnes("parties_projet")).toContain("role");
    // Le corollaire : ni la personne ni le projet ne stockent de rôle.
    expect(colonnes("contacts")).not.toContain("role");
    expect(colonnes("projets_acquereur")).not.toContain("role");
  });

  it("aucun identifiant fournisseur dans le modèle canonique (ADR-056)", () => {
    const interdits = ["playiad_id", "hektor_id", "apimo_id", "external_id", "reference_externe", "source_id"];
    for (const table of ["projets_acquereur", "parties_projet"]) {
      expect(colonnes(table).filter((colonne) => interdits.includes(colonne)), table).toEqual([]);
    }
  });

  it("aucune interaction, aucune provenance n'existe encore", () => {
    const horsPerimetre = ["projets_vendeur_biens", "interactions", "references_externes"];
    expect([...tables.keys()].filter((nom) => horsPerimetre.includes(nom))).toEqual([]);
  });

  it("le pont vers le projet canonique est optionnel, et l'historique intact", () => {
    const acquereur = config("acquereurs");
    const pont = acquereur.columns.find((colonne) => colonne.name === "projet_acquereur_id");
    expect(pont, "acquereurs doit pouvoir pointer vers son projet canonique").toBeDefined();
    // NULLABLE : c'est l'état de toutes les lignes historiques, aucun backfill n'a été fait.
    expect(pont!.notNull, "aucun NOT NULL tant que le backfill n'est pas prouvé").toBe(false);

    // Aucune colonne historique perdue : le modèle qui pilote les workflows est intact.
    for (const colonne of ["prenom", "nom", "email", "telephone", "budget_min", "budget_max", "stade_projet"]) {
      expect(colonnes("acquereurs"), `acquereurs.${colonne} ne doit pas disparaître`).toContain(colonne);
    }
  });
});

describe("ADR-055 §B — les moteurs et le tunnel commercial restent sur le modèle historique", () => {
  const FICHIERS = listerFichiersSource("src").filter((chemin) => !/\.test\.tsx?$/.test(chemin));

  it("aucun moteur de compatibilité ne consomme le modèle canonique", () => {
    // CURRENT : acquereurs -> matching. FUTURE : projets_acquereur -> matching. La bascule est un
    // lot à part entière, précédé d'un test de caractérisation (ADR-055, stratégie de migration
    // étape 3) — jamais un glissement silencieux.
    const fautifs = FICHIERS.filter((chemin) => chemin.includes(join("lib", "compatibilite"))).filter((chemin) => {
      const contenu = readFileSync(chemin, "utf8");
      return /projetsAcquereur|projetAcquereurRepository|partiesProjet/.test(contenu);
    });
    expect(fautifs, "le moteur de compatibilité doit rester branché sur acquereurs").toEqual([]);
  });

  it("visites et offres restent rattachées au modèle historique", () => {
    // Leur FK acquéreur ne bouge pas dans ce lot : rien ne pointe vers projets_acquereur.
    for (const table of ["visites", "offres", "comptes_rendus_visite", "taches"]) {
      expect(colonnes(table), `${table} ne doit pas être migré vers le modèle canonique`).not.toContain(
        "projet_acquereur_id"
      );
    }
  });

  it("aucun écran ne lit le modèle canonique", () => {
    // Aucune UI dans ce lot : le comportement utilisateur est strictement identique.
    const fautifs = FICHIERS.filter((chemin) => chemin.includes(join("src", "app")) || chemin.includes(join("src", "components")))
      .filter((chemin) => /projetAcquereurRepository|projetsAcquereur|partiesProjet/.test(readFileSync(chemin, "utf8")));
    expect(fautifs, "le modèle canonique est encore une fondation, pas une lecture").toEqual([]);
  });
});
