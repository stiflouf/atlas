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

  it("aucune table de synchronisation n'existe encore", () => {
    const horsPerimetre = ["projets_vendeur_biens"];
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

  it("une seule porte connaît le modèle canonique, et ce n'est plus le moteur", () => {
    // La bascule annoncée par ADR-055 (stratégie de migration, étape 3) a eu lieu pour les CRITÈRES
    // acquéreur : `projets_acquereur` fait foi dès qu'une ligne `acquereurs` est rattachée, en
    // lecture comme en écriture humaine. Ce test ne dit donc plus « personne ne lit le canonique »
    // — il dit où cette connaissance a le droit de vivre. Une seconde porte signifierait deux
    // règles de source, qui divergeront sans que rien ne le signale.
    //
    // `lib/compatibilite` n'en fait plus partie : la règle a été extraite dans
    // `criteresAcquereurEffectifs`, que le matching ET l'affichage consomment. Ne restent ici que
    // les chemins qui NOMMENT le projet pour l'invalider ou l'écrire, jamais pour arbitrer la source.
    const porteurs = FICHIERS.filter((chemin) => {
      const contenu = readFileSync(chemin, "utf8");
      return /projetsAcquereurTable|partiesProjetTable/.test(contenu);
    });
    expect(porteurs.sort(), "seuls le pont, la règle de source et les writers canoniques").toEqual(
      [
        join("src", "lib", "criteresAcquereurEffectifs.ts"),
        join("src", "lib", "projetAcquereurRepository.ts"),
        join("src", "lib", "partieProjetRepository.ts"),
        // ADR-055 §H — le rattachement d'un dossier historique crée la partie manquante quand un
        // projet canonique existe déjà. Il nomme donc la table pour la LIRE et l'écrire, jamais
        // pour arbitrer une source de critères.
        join("src", "lib", "rattachementContact.ts"),
        // ADR-058 — la recherche de personnes lit les projets pour en RÉSUMER le stade dans un
        // résultat, jamais pour arbitrer d'où viennent les critères d'un acquéreur.
        join("src", "lib", "rechercheContactRepository.ts"),
        // ADR-058 — la fiche Contact lit les projets du contact pour les AFFICHER (stade, budget,
        // critères canoniques), lecture seule, sans jamais reprendre un critère sur le dossier.
        join("src", "lib", "contactDetailRepository.ts"),
        // `interactions` est une feuille de `contacts` qui peut CONTEXTUALISER un projet
        // (ADR-055 §G) : elle nomme la table pour sa FK, jamais pour lire un critère.
        join("src", "lib", "interactionRepository.ts"),
        // ADR-059 — le moteur de fusion REPOINTE les participations de l'absorbé vers le survivant
        // et dédouble celles d'un projet commun : il nomme la table pour sa FK `contact_id`, jamais
        // pour lire ou arbitrer un critère.
        join("src", "lib", "fusionContactRepository.ts"),
        join("src", "lib", "provenance", "champVerrouilleRepository.ts"),
        join("src", "lib", "provenance", "referenceExterneRepository.ts"),
      ].sort()
    );
    // La contrepartie — le moteur lui-même n'importe ni base, ni repository, ni résolution — est
    // verrouillée par lib/compatibilite/lectureCanonique.structurel.test.ts, qui neutralise les
    // commentaires avant d'inspecter. La dupliquer ici sur le fichier brut ferait échouer le module
    // le mieux documenté au seul motif qu'il explique l'interdiction.
  });

  it("visites et offres restent rattachées au modèle historique", () => {
    // Leur FK acquéreur ne bouge pas dans ce lot : rien ne pointe vers projets_acquereur.
    for (const table of ["visites", "offres", "comptes_rendus_visite", "taches"]) {
      expect(colonnes(table), `${table} ne doit pas être migré vers le modèle canonique`).not.toContain(
        "projet_acquereur_id"
      );
    }
  });

  it("aucun écran ne lit le modèle canonique directement", () => {
    // ADR-058 — une seule exception, et elle ne lit ni table ni repository : la carte de résultat
    // de `/contacts` affiche `projetsAcquereur`, un champ du read model `ResultatRechercheContact`.
    // Qu'elle n'importe ni `@/db/` ni un repository est verrouillé par
    // src/app/contacts/page.structurel.test.ts. Tout le reste de l'UI reste sur le modèle historique.
    const ecransReadModel = [
      join("src", "components", "contact", "ContactResultatCard.tsx"),
      // La fiche Contact affiche `projetsAcquereur`, un champ de `ContactDetail` (contactDetailRepository) ;
      // verrouillée par src/app/contacts/[id]/page.structurel.test.ts.
      join("src", "app", "contacts", "[id]", "page.tsx"),
    ];
    const fautifs = FICHIERS.filter((chemin) => chemin.includes(join("src", "app")) || chemin.includes(join("src", "components")))
      .filter((chemin) => !ecransReadModel.some((exception) => chemin.endsWith(exception)))
      .filter((chemin) => /projetAcquereurRepository|projetsAcquereur|partiesProjet/.test(readFileSync(chemin, "utf8")));
    expect(fautifs, "le modèle canonique est encore une fondation, pas une lecture").toEqual([]);
  });
});
