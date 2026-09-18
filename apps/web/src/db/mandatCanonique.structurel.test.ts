import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// ADR-055 §F — garanties STRUCTURELLES du mandat canonique. Même patron que les tests structurels
// précédents : inspection du modèle Drizzle réellement construit, aucune base, aucun grep.
//
// Ce qui est protégé ici : le mandat est un CONTRAT DANS LE TEMPS, pas un attribut du bien. Le jour
// où quelqu'un ajoutera « juste un statut » pour éviter une dérivation, ou une unicité sur
// `bien_id` pour « éviter les doublons », l'historique contractuel deviendra inexprimable — et ces
// tests doivent échouer avant que ça n'arrive.

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

describe("ADR-055 §F — le mandat est une entité, pas une colonne du bien", () => {
  it("mandats existe et porte ses propres dates", () => {
    expect(colonnes("mandats")).toEqual(
      expect.arrayContaining(["id", "bien_id", "projet_vendeur_id", "date_debut", "date_fin", "resilie_le"])
    );
  });

  it("mandats est une FEUILLE de biens : bien_id NOT NULL, aucun workspace_id dupliqué", () => {
    // ADR-054 §7 — le périmètre d'un mandat est celui de l'actif sur lequel il porte. Le dupliquer
    // permettrait d'écrire un mandat dans un autre workspace que son bien.
    const mandat = config("mandats");
    expect(mandat.columns.find((colonne) => colonne.name === "bien_id")!.notNull).toBe(true);
    expect(mandat.columns.some((colonne) => colonne.name === "workspace_id")).toBe(false);

    const parents = mandat.foreignKeys
      .map((fk) => fk.reference())
      .filter((reference) => reference.columns.every((colonne) => colonne.notNull))
      .map((reference) => getTableConfig(reference.foreignTable).name);
    expect(parents).toEqual(["biens"]);
  });

  it("un bien peut avoir PLUSIEURS mandats successifs, un projet aussi", () => {
    // L'unicité sur l'une de ces colonnes écraserait l'historique contractuel : un bien remandaté
    // deux ans plus tard, un projet dont le mandat a expiré puis été renouvelé.
    const uniques = config("mandats").uniqueConstraints.map((contrainte) =>
      contrainte.columns.map((colonne) => colonne.name)
    );
    expect(uniques).toEqual([]);
  });

  it("le renouvellement est une relation, jamais une mutation", () => {
    // CAS 7 d'ADR-055 : le successeur référence le mandat remplacé, qui n'est pas modifié.
    const remplace = config("mandats").columns.find((colonne) => colonne.name === "remplace_mandat_id");
    expect(remplace, "un renouvellement doit pouvoir désigner le mandat qu'il remplace").toBeDefined();
    expect(remplace!.notNull, "un premier mandat ne remplace rien").toBe(false);

    const autoReference = config("mandats")
      .foreignKeys.map((fk) => fk.reference())
      .find((reference) => reference.columns.some((colonne) => colonne.name === "remplace_mandat_id"));
    expect(getTableConfig(autoReference!.foreignTable).name).toBe("mandats");
    expect(config("mandats").checks.map((c) => c.name)).toContain("mandats_pas_d_auto_remplacement_check");
  });

  it("aucun statut de mandat stocké : il se dérive des dates (ADR-014, invariant 9)", () => {
    for (const interdit of ["statut", "statut_mandat", "etat", "actif", "est_actif", "remplace"]) {
      expect(colonnes("mandats"), `mandats.${interdit}`).not.toContain(interdit);
    }
  });

  it("aucun identifiant fournisseur (ADR-056)", () => {
    const interdits = ["playiad_id", "hektor_id", "apimo_id", "external_id", "network_id", "numero_reseau", "source_id"];
    expect(colonnes("mandats").filter((colonne) => interdits.includes(colonne))).toEqual([]);
  });

  it("aucun contact n'est embarqué sur le mandat : les mandants sont une relation (parties_mandat)", () => {
    // ADR-060 §16 — la qualité de mandant est portée par la relation `parties_mandat` (lot
    // MANDATE_PARTIES_V1, garanties dans partieMandat.structurel.test.ts), jamais par une colonne du
    // mandat : un mandat à un seul Contact serait une erreur structurelle (couple, indivision).
    const interdits = ["contact_id", "mandant_id", "nom", "prenom", "email", "telephone", "signataire_id"];
    expect(colonnes("mandats").filter((colonne) => interdits.includes(colonne))).toEqual([]);
    expect([...tables.keys()]).toContain("parties_mandat");
  });
});

describe("ADR-055 §F — le modèle historique du mandat reste intact et fait foi", () => {
  const FICHIERS = listerFichiersSource("src").filter((chemin) => !/\.test\.tsx?$/.test(chemin));

  it("biens garde ses colonnes de mandat historiques", () => {
    // Elles restent la source de vérité des écrans et des automatisations. Rien n'est renommé ni
    // supprimé, et aucun `mandat_courant_id` n'est ajouté : « courant » se déduit.
    expect(colonnes("biens")).toContain("statut_mandat");
    expect(colonnes("biens")).toContain("date_mandat");
    expect(colonnes("biens"), "« le mandat courant » se déduit, il ne se stocke pas").not.toContain(
      "mandat_courant_id"
    );
  });

  it("les jalons de mandat du projet vendeur ne sont pas supprimés", () => {
    // `mandat_propose_le` reste légitimement propre au projet : un mandat peut avoir été proposé
    // sans qu'aucun mandat n'ait jamais existé. `mandat_signe_le` deviendra dérivable de
    // `mandats.date_debut`, plus tard, jamais dans ce lot.
    for (const table of ["projets_vendeur", "prospects_vendeurs"]) {
      expect(colonnes(table), `${table}.mandat_propose_le`).toContain("mandat_propose_le");
      expect(colonnes(table), `${table}.mandat_signe_le`).toContain("mandat_signe_le");
    }
  });

  it("ni connecteur, ni relation projet-biens", () => {
    const horsPerimetre = ["projets_vendeur_biens", "mandat_biens"];
    expect([...tables.keys()].filter((nom) => horsPerimetre.includes(nom))).toEqual([]);
  });

  // Lot MANDATE_CANONICAL_UI_V1 (ADR-060 §1) — l'invariant « aucun écran ne lit mandats » est
  // INVERSÉ : les écrans lisent le mandat canonique, mais UNIQUEMENT via les read models
  // workspace-safe (`presentationMandatBien`, `existeMandatCanoniqueDuBien`), jamais la table, et
  // seuls les consommateurs listés ici y touchent. Une page ou un composant supplémentaire qui
  // lirait le mandat doit être ajouté à cette liste en connaissance de cause.
  it("les écrans autorisés lisent le mandat canonique uniquement via les read models workspace-safe", () => {
    const ECRANS = FICHIERS.filter(
      (chemin) => chemin.includes(join("src", "app")) || chemin.includes(join("src", "components"))
    );
    // Jamais la table ni le client DB depuis un écran.
    const lecteursTable = ECRANS.filter((chemin) => /mandats as |mandatsTable|partiesMandatTable|from "@\/db\//.test(readFileSync(chemin, "utf8")));
    expect(lecteursTable, "aucun écran ne lit la table mandats").toEqual([]);

    const CONSOMMATEURS_AUTORISES = [
      join("src", "app", "biens", "[id]", "page.tsx"),
      join("src", "app", "biens", "[id]", "modifier", "page.tsx"),
      join("src", "app", "prospects-vendeurs", "[id]", "page.tsx"),
      join("src", "app", "visites", "[id]", "preparer", "page.tsx"),
      join("src", "components", "mandat", "MandatBienPanel.tsx"),
      join("src", "components", "bien", "BienVendeurMandat.tsx"),
      join("src", "components", "prospectVendeur", "ProspectVendeurBienCree.tsx"),
    ];
    const consommateurs = ECRANS.filter((chemin) =>
      /mandatRepository|partieMandatRepository|presentationMandatBien|from "@\/types\/mandat"|from "@\/types\/partieMandat"/.test(
        readFileSync(chemin, "utf8")
      )
    );
    expect(consommateurs.map((c) => c.replace(/^.*?src\//, "src/")).sort()).toEqual([...CONSOMMATEURS_AUTORISES].sort());

    // Les pages ne lisent que par le read model de présentation (ou l'existence scoped) ; les
    // composants reçoivent tout en props et n'importent aucun repository.
    for (const chemin of consommateurs) {
      const code = readFileSync(chemin, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      if (chemin.includes(join("src", "components"))) {
        expect(code, chemin).not.toMatch(/mandatRepository|partieMandatRepository|chargerPresentationMandatBien/);
      } else {
        const importsRepo = code.match(/import \{([^}]*)\} from "@\/lib\/mandatRepository"/)?.[1] ?? "";
        expect(importsRepo.replace(/\s/g, ""), chemin).toMatch(/^(existeMandatCanoniqueDuBien)?$/);
        expect(code, chemin).not.toMatch(/partieMandatRepository|mandatCourantDuBien|listerMandatsDuBien|getMandatById/);
      }
    }
  });

  it("aucun moteur pur ne consomme le mandat canonique", () => {
    const moteurs = [join("lib", "compatibilite"), join("lib", "opportunites"), join("lib", "alertes"), join("lib", "fiscal")];
    const fautifs = FICHIERS.filter((chemin) => moteurs.some((moteur) => chemin.includes(moteur))).filter((chemin) =>
      /mandatRepository|mandats as |from "@\/types\/mandat"/.test(readFileSync(chemin, "utf8"))
    );
    expect(fautifs, "les moteurs purs restent sur le modèle historique").toEqual([]);
  });

  it("visites et offres ne sont pas rattachées au mandat", () => {
    for (const table of ["visites", "offres", "comptes_rendus_visite", "compromis"]) {
      expect(colonnes(table), table).not.toContain("mandat_id");
    }
  });
});
