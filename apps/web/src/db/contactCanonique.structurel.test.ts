import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// ADR-055 §A — garanties STRUCTURELLES du modèle canonique, sur le patron déjà utilisé par
// appartenanceWorkspace.structurel.test.ts : inspection du modèle Drizzle réellement construit,
// aucune base de données, aucun grep.
//
// Ces invariants ne sont pas décoratifs. Le jour où quelqu'un ajoutera « juste une colonne `type`
// pour distinguer vendeurs et acquéreurs », ce test doit échouer : c'est exactement la
// simplification qui rendrait le CAS 8 d'ADR-055 (une personne qui cumule les casquettes)
// inexprimable, et qui recréerait la dette que ce lot élimine.

const valeursExportees: unknown[] = Object.values(schema);
const tables = new Map(
  valeursExportees
    .filter((valeur): valeur is PgTable => is(valeur, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return [config.name, config] as const;
    })
);

function colonnes(nomTable: string): string[] {
  const config = tables.get(nomTable);
  if (!config) throw new Error(`Table absente du schéma : ${nomTable}`);
  return config.columns.map((colonne) => colonne.name);
}

describe("ADR-055 — le Contact est une identité, jamais un rôle", () => {
  it("contacts ne porte aucune colonne de rôle, de statut ou de pipeline", () => {
    // Liste volontairement large : ce qui est interdit, c'est la CATÉGORIE « rôle métier stocké »,
    // pas trois noms précis qu'il suffirait de contourner en renommant.
    const interdits = [
      "role",
      "roles",
      "type",
      "type_contact",
      "categorie",
      "statut",
      "statut_vendeur",
      "statut_acquereur",
      "stade_projet",
      "pipeline",
      "est_vendeur",
      "est_acquereur",
      "est_proprietaire",
    ];
    const presents = colonnes("contacts").filter((colonne) => interdits.includes(colonne));

    expect(
      presents,
      "un rôle se DÉRIVE des relations (partie d'un projet, mandant d'un mandat) — le stocker créerait une seconde vérité"
    ).toEqual([]);
  });

  it("contacts ne porte aucune donnée de projet immobilier", () => {
    // PERSONNE ≠ PROJET : budget, secteur et critères décrivent une recherche, pas un humain. Ils
    // appartiennent au futur BuyerProject — aujourd'hui encore `acquereurs`.
    const interdits = [
      "budget_min",
      "budget_max",
      "criteres",
      "pieces_min",
      "surface_min",
      "secteur",
      "motivation",
      "bien_id",
      "mandat_id",
      "score",
    ];
    const presents = colonnes("contacts").filter((colonne) => interdits.includes(colonne));
    expect(presents).toEqual([]);
  });

  it("contacts ne porte aucun identifiant fournisseur (ADR-056)", () => {
    // L'identité canonique est l'`id` interne. Les correspondances externes vivront dans une table
    // dédiée (N références → 1 entité), jamais en colonne ici : une colonne par fournisseur ne
    // saurait pas représenter deux identités d'un même fournisseur, ni survivre à son retrait.
    const suspectes = colonnes("contacts").filter((colonne) =>
      /(playiad|hektor|apimo|netty|externe|external|crm|provider|fournisseur)/i.test(colonne)
    );
    expect(suspectes).toEqual([]);
  });

  it("contacts se limite à l'identité, et rien de plus", () => {
    // Verrouille la surface exacte : ajouter un champ à cette table doit être un geste conscient,
    // qui passe par ce test.
    expect(colonnes("contacts").sort()).toEqual(
      ["cree_le", "email", "id", "nom", "prenom", "telephone", "workspace_id"].sort()
    );
  });

  it("le pont vers l'identité canonique est optionnel des deux côtés", () => {
    // NULLABLE = l'état de toutes les lignes historiques, et il doit le rester tant qu'aucun
    // rattachement humainement validé n'a eu lieu. Le rendre NOT NULL exigerait un backfill, donc
    // des fusions devinées.
    for (const table of ["acquereurs", "prospects_vendeurs"]) {
      const config = tables.get(table)!;
      const pont = config.columns.find((colonne) => colonne.name === "contact_id");
      expect(pont, `${table} doit porter le pont contact_id`).toBeDefined();
      expect(pont!.notNull, `${table}.contact_id doit rester nullable (aucun backfill deviné)`).toBe(false);
    }
  });

  it("les modèles historiques conservent leurs colonnes d'identité (aucune migration destructive)", () => {
    // Ce lot est additif : rien n'est retiré de `acquereurs` ni de `prospects_vendeurs`, qui
    // restent la source de vérité de leurs workflows pendant toute la coexistence.
    for (const champ of ["prenom", "nom", "email", "telephone"]) {
      expect(colonnes("acquereurs"), `acquereurs.${champ}`).toContain(champ);
      expect(colonnes("prospects_vendeurs"), `prospects_vendeurs.${champ}`).toContain(champ);
    }
  });

  it("aucune table de projet, de mandat, d'interaction ou de provenance n'est créée par ce lot", () => {
    // Frontière du lot : ADR-055/056 les décident, aucun ne les construit ici.
    const horsPerimetre = [
      "projets_vendeur",
      "projets_acquereur",
      "parties_projet",
      "mandats",
      "interactions",
      "references_externes",
      "synchronisations_entite",
    ];
    expect([...tables.keys()].filter((nom) => horsPerimetre.includes(nom))).toEqual([]);
  });
});
