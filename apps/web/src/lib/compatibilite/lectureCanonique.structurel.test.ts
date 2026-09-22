import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { join } from "node:path";

// ADR-055 §B — garanties STRUCTURELLES du pont de LECTURE canonique. Ce que ces tests protègent
// n'est pas un comportement (les tests d'intégration s'en chargent) mais une FRONTIÈRE, et une
// frontière ne se perd jamais d'un coup : elle se perd le jour où « juste pour ce cas-là » un
// critère manquant est repris du dossier historique, ou où le moteur lit lui-même une table parce
// que la résolution était pénible à passer en paramètre.

function listerFichiersSource(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return listerFichiersSource(chemin);
    return /\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

// Le CODE seul : sans cela ces tests interdiraient d'expliquer l'interdiction — le commentaire qui
// dit « jamais de repli champ par champ » contient les mots surveillés (même précaution que
// provenanceCanonique.structurel.test.ts).
function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const MOTEUR = [
  join("src", "lib", "compatibilite", "evaluerCompatibilite.ts"),
  join("src", "lib", "compatibilite", "criteres.ts"),
];

const RESOLUTION = join("src", "lib", "criteresAcquereurEffectifs.ts");

describe("ADR-034 — le moteur reste pur et ignore le stockage", () => {
  it("n'importe ni base, ni repository, ni résolution de source", () => {
    // Y compris la résolution qu'introduit ce lot : un moteur qui saurait résoudre lui-même sa
    // source pourrait décider, paire par paire, laquelle utiliser — exactement la dualité que ce
    // lot fait disparaître de ses règles.
    const interdits = [
      /@\/db\//,
      /drizzle-orm/,
      /Repository/,
      /profilCompatibiliteRepository/,
      /lib\/provenance/,
      /@\/types\/provenance/,
      /synchronisation/,
      /appliquerMutationExterne/,
    ];
    for (const chemin of MOTEUR) {
      const code = codeSeul(chemin);
      for (const interdit of interdits) {
        expect(interdit.test(code), `${chemin} ne doit pas référencer ${interdit}`).toBe(false);
      }
    }
  });

  it("son contrat d'entrée acquéreur n'est plus le type du dossier historique", () => {
    // `ProfilAcquereur` porte nom, email et téléphone : le passer au moteur maintenait un couplage
    // au dossier ET donnait à toute règle future un accès à l'identité humaine.
    for (const chemin of MOTEUR) {
      const code = codeSeul(chemin);
      expect(code, chemin).toContain("ProfilCompatibiliteAcquereur");
      expect(code, chemin).not.toContain("ProfilAcquereur;");
    }
  });

  it("le profil de compatibilité ne porte aucune identité humaine", () => {
    const code = codeSeul(join("src", "types", "profilCompatibiliteAcquereur.ts"));
    for (const champ of ["prenom", "nom:", "email", "telephone", "contactId", "notes"]) {
      expect(code, `profil de compatibilité : ${champ}`).not.toContain(champ);
    }
  });
});

describe("ADR-055 §B — la règle de source est appliquée au même endroit, une seule fois", () => {
  const FICHIERS = listerFichiersSource("src").filter((chemin) => !/\.test\.tsx?$/.test(chemin));

  it("tout appelant du moteur passe par la résolution de source", () => {
    // Un appelant qui passerait directement un `ProfilAcquereur` compilerait sans erreur (le type
    // du dossier est structurellement compatible) et matcherait silencieusement sur des critères
    // legacy pour un acquéreur canonique. C'est précisément le bug que ce lot corrige : seul un
    // test structurel peut l'empêcher de revenir.
    const appelants = FICHIERS.filter((chemin) => {
      const code = codeSeul(chemin);
      return /evaluerCompatibilite\s*\(/.test(code) && !MOTEUR.includes(chemin);
    });
    expect(appelants.length, "au moins un appelant doit exister").toBeGreaterThan(0);

    const sansResolution = appelants.filter((chemin) => !/profilCompatibiliteRepository/.test(codeSeul(chemin)));
    expect(sansResolution).toEqual([]);
  });

  it("dans la chaîne du moteur, un seul module sait qu'il existe deux stockages", () => {
    // Ailleurs dans le produit, `projet_acquereur_id` est nommé par les chemins qui l'écrivent ou
    // le déclarent (schéma, création, provenance, parties de projet) — c'est leur travail. Ce qui
    // est verrouillé ici est plus étroit et plus important : DANS la chaîne du moteur, une seule
    // porte connaît le pont. Une seconde signifierait deux règles de source, qui divergeront.
    const chaine = FICHIERS.filter((chemin) => chemin.includes(join("lib", "compatibilite")));
    const connaissentLePont = chaine.filter((chemin) => /projetAcquereurId|projet_acquereur_id/.test(codeSeul(chemin)));
    // Seule l'INVALIDATION y reste : elle doit remonter du projet vers les dossiers qui le
    // référencent. La résolution de source, elle, a quitté ce dossier pour `criteresAcquereurEffectifs`,
    // partagée avec l'affichage — le moteur n'en est plus que l'un des deux consommateurs.
    expect(connaissentLePont).toEqual([join("src", "lib", "compatibilite", "resynchronisationRepository.ts")]);
  });

  it("aucun repli champ par champ dans la résolution", () => {
    // La forme interdite : `projet.piecesMin ?? acquereur.piecesMin`. Le repli est au niveau de
    // l'AGRÉGAT, jamais du champ — un NULL canonique est une information, pas un trou.
    const code = codeSeul(RESOLUTION);
    expect(code).not.toMatch(/projet\.\w+\s*\?\?\s*acquereur\./);
    expect(code).not.toMatch(/acquereur\.\w+\s*\?\?\s*projet\./);
  });
});

describe("ADR-055 §B — l'écriture humaine suit la même règle de source", () => {
  const FICHIERS = listerFichiersSource("src").filter((chemin) => !/\.test\.tsx?$/.test(chemin));
  const REGLE = join("src", "lib", "criteresAcquereurEffectifs.ts");

  it("la règle de source n'est écrite qu'une fois, et les deux projections en dépendent", () => {
    // L'affichage et le matching répondent à la même question. Deux implémentations de la règle
    // finiraient par y répondre différemment — et l'écart serait invisible, chacune étant verte de
    // son côté.
    const jointure = /leftJoin\(\s*projetsAcquereurTable/;
    const porteurs = FICHIERS.filter((chemin) => jointure.test(codeSeul(chemin)));
    // La recherche de personnes (ADR-058) joint elle aussi le projet, mais pour en RÉSUMER le stade
    // et le budget dans un résultat — jamais pour arbitrer d'où viennent les critères d'un
    // acquéreur. C'est cette dernière question qui n'a le droit d'avoir qu'une seule réponse.
    // La fiche Contact (ADR-058) joint le projet pour la même raison : afficher le projet canonique
    // tel quel, jamais arbitrer entre projet et dossier.
    // La préparation de fusion (ADR-059) joint le projet pour lire `archive_le` — rôle dérivé et
    // compte de projets actifs, même sémantique que la recherche — jamais un critère.
    // La timeline Contact (CRM_TIMELINE_V1) joint le projet pour lister les contextes actifs d'un
    // échange et en résumer le libellé (budget max affiché tel quel) — jamais arbitrer une source.
    expect(porteurs.sort()).toEqual(
      [
        REGLE,
        join("src", "lib", "rechercheContactRepository.ts"),
        join("src", "lib", "contactDetailRepository.ts"),
        join("src", "lib", "preparationFusionContactRepository.ts"),
        join("src", "lib", "timelineContactRepository.ts"),
      ].sort()
    );

    for (const projection of [
      join("src", "lib", "compatibilite", "profilCompatibiliteRepository.ts"),
      join("src", "lib", "clientRepository.ts"),
    ]) {
      expect(codeSeul(projection), projection).toContain("criteresAcquereurEffectifs");
    }
  });

  it("aucun repli champ par champ, dans aucune des deux projections", () => {
    for (const chemin of [
      REGLE,
      join("src", "lib", "compatibilite", "profilCompatibiliteRepository.ts"),
      join("src", "lib", "clientRepository.ts"),
    ]) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/projet\.\w+\s*\?\?\s*acquereur\./);
      expect(code, chemin).not.toMatch(/criteres\.\w+\s*\?\?\s*acquereur\./);
    }
  });

  it("la Server Action passe par les writers Core, jamais par Drizzle", () => {
    // Un UPDATE direct depuis l'action contournerait l'invariant budget du Core ET son invalidation
    // ADR-036 — deux garanties qui ne vivent que dans le writer canonique.
    const code = codeSeul(join("src", "actions", "modifierAcquereur.ts"));
    expect(code).not.toMatch(/drizzle-orm/);
    expect(code).not.toMatch(/@\/db\/schema/);
    expect(code).toContain("modifierCriteresProjetAcquereur");
  });

  it("l'édition ne canonicalise jamais un dossier historique", () => {
    // Rattacher l'historique est un geste explicite, réservé à son propre lot : une édition ne doit
    // pas pouvoir créer un Contact ou un projet au passage.
    const code = codeSeul(join("src", "actions", "modifierAcquereur.ts"));
    for (const createur of ["creerContact", "creerProjetAcquereur", "ajouterPartieProjet"]) {
      expect(code, createur).not.toContain(createur);
    }
  });

  it("aucun écran ne connaît le Sync Engine", () => {
    // L'action pose un verrou humain (ADR-056 §4) : c'est une primitive du Core de provenance, pas
    // le pipeline d'import. La frontière tient tant qu'aucune UI n'appelle `appliquerMutationExterne`.
    const fautifs = FICHIERS.filter(
      (chemin) => chemin.includes(join("src", "app")) || chemin.includes(join("src", "components"))
    ).filter((chemin) => /appliquerMutationExterne|contratConnecteur/.test(codeSeul(chemin)));
    expect(fautifs).toEqual([]);
  });
});

describe("ADR-057 — l'identité canonique suit la même discipline", () => {
  const FICHIERS = listerFichiersSource("src").filter((chemin) => !/\.test\.tsx?$/.test(chemin));
  const REGLE_IDENTITE = join("src", "lib", "identiteContactEffective.ts");

  it("la règle de source d'identité n'est écrite qu'une fois", () => {
    // Même raison que pour les critères : l'affichage, l'email sortant et l'écriture répondent à la
    // même question. Deux implémentations y répondraient différemment, et l'écart serait invisible.
    const jointure = /leftJoin\(\s*contactsTable/;
    expect(FICHIERS.filter((chemin) => jointure.test(codeSeul(chemin)))).toEqual([REGLE_IDENTITE]);
  });

  it("aucun repli champ par champ sur l'identité", () => {
    // La forme interdite : `contact.email ?? acquereur.email`. Un NULL canonique est une
    // information — « on ne connaît pas son adresse » — pas un trou à combler.
    for (const chemin of [REGLE_IDENTITE, join("src", "lib", "clientRepository.ts")]) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/contact\.\w+\s*\?\?\s*acquereur\./);
      expect(code, chemin).not.toMatch(/identite\.\w+\s*\?\?\s*acquereur\./);
      expect(code, chemin).not.toMatch(/identite\.email\s*\?\?/);
      expect(code, chemin).not.toMatch(/identite\.telephone\s*\?\?/);
    }
  });

  it("la Server Action passe par le writer Core Contact, jamais par Drizzle", () => {
    const code = codeSeul(join("src", "actions", "modifierAcquereur.ts"));
    expect(code).not.toMatch(/contactsTable|@\/db\/schema/);
    expect(code).toContain("modifierIdentiteContact");
  });

  it("le writer Contact exige un workspace et n'est pas contournable", () => {
    // Un seul UPDATE de `contacts` dans tout le produit, et il vérifie le périmètre.
    const porteurs = FICHIERS.filter((chemin) => /update\(\s*contactsTable/.test(codeSeul(chemin)));
    expect(porteurs).toEqual([join("src", "lib", "contactRepository.ts")]);
    const code = codeSeul(join("src", "lib", "contactRepository.ts"));
    expect(code).toContain("workspaceId");
    expect(code).toContain("autre workspace");
  });

  it("aucune déduplication : le Contact ne se cherche jamais par email ou téléphone", () => {
    // `creerContact` crée TOUJOURS une nouvelle ligne. Un « find or create » sur une adresse
    // fusionnerait un couple qui la partage — une fusion à tort ne se corrige pas.
    const code = codeSeul(join("src", "lib", "contactRepository.ts"));
    for (const interdit of ["findOrCreate", "trouverOuCreer", "rapprocher", "fusionner", "dedup"]) {
      expect(code, interdit).not.toContain(interdit);
    }
    expect(code).not.toMatch(/where\([^)]*contactsTable\.(email|telephone)/);
  });

  it("Gmail ne connaît pas la coexistence : il consomme la projection", () => {
    // Le flux de communication ne doit jamais interroger `contacts` lui-même — il reçoit un
    // `ProfilAcquereur` déjà projeté par le repository.
    const communications = FICHIERS.filter((chemin) => chemin.includes(join("lib", "communications")));
    const fautifs = communications.filter((chemin) =>
      /contactsTable|identiteContactEffective|getContactById/.test(codeSeul(chemin))
    );
    expect(fautifs).toEqual([]);
  });

  it("les deux côtés du CRM partagent UNE règle d'identité, jamais deux copies", () => {
    // Acquéreur et vendeur ne diffèrent que par la table qui porte le pont. Deux modules de
    // résolution divergeraient au premier ajustement, et l'écart serait invisible — chaque copie
    // restant verte de son côté. Une personne n'a pas deux identités selon le rôle sous lequel on
    // la regarde ; le code ne doit pas pouvoir le contredire.
    for (const projection of [
      join("src", "lib", "clientRepository.ts"),
      join("src", "lib", "prospectVendeurRepository.ts"),
    ]) {
      expect(codeSeul(projection), projection).toContain("identiteContactEffective");
    }
    // Un SEUL writer Contact, transverse : pas de writer d'identité spécifique au vendeur.
    const FICHIERS_LIB = FICHIERS.filter((chemin) => chemin.includes(join("src", "lib")));
    const writers = FICHIERS_LIB.filter((chemin) => /update\(\s*contactsTable/.test(codeSeul(chemin)));
    expect(writers).toEqual([join("src", "lib", "contactRepository.ts")]);
  });

  it("aucune absence canonique n'est traduite en chaîne vide dans le domaine", () => {
    // `contacts.prenom`/`email`/`telephone` sont nullables : une absence est une information. La
    // convertir en `""` la déguise en valeur — plus discret qu'un repli champ par champ, aussi faux.
    // La conversion reste légitime à la FRONTIÈRE d'un input HTML contrôlé, jamais dans un
    // repository ni dans une règle.
    for (const chemin of [
      join("src", "lib", "clientRepository.ts"),
      join("src", "lib", "prospectVendeurRepository.ts"),
      join("src", "lib", "identiteContactEffective.ts"),
    ]) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/identite\.\w+\s*\?\?\s*""/);
      expect(code, chemin).not.toMatch(/prenom:\s*[\w.]+\s*\?\?\s*""/);
    }
  });

  it("les deux Server Actions d'identité exigent le workspace courant", () => {
    for (const action of [
      join("src", "actions", "modifierAcquereur.ts"),
      join("src", "actions", "prospectVendeur.ts"),
    ]) {
      expect(codeSeul(action), action).toContain("exigerWorkspaceCourant");
    }
  });

  it("le Sync Engine ne connaît toujours pas Contact", () => {
    // `references_externes` et `champs_verrouilles` acceptent déjà une cible `contact` ; le pipeline
    // d'application, lui, reste limité au projet acquéreur. L'étendre est un lot à part entière.
    const code = codeSeul(join("src", "types", "synchronisation.ts"));
    expect(code).toContain('typeEntiteCanonique: "projet_acquereur"');
    expect(code).not.toMatch(/typeEntiteCanonique:\s*"contact"/);
  });
});

describe("ADR-055 §H — rattacher est un geste humain, jamais une déduction", () => {
  const FICHIERS = listerFichiersSource("src").filter((chemin) => !/\.test\.tsx?$/.test(chemin));
  const RATTACHEMENT = join("src", "lib", "rattachementContact.ts");

  it("aucun chemin d'écriture ne rapproche par email, téléphone ou nom", () => {
    // La recherche de candidats a le droit de filtrer sur ces colonnes — c'est une aide à la
    // reconnaissance humaine. Ce qui est interdit, c'est qu'un rattachement en DÉCOULE.
    const code = codeSeul(RATTACHEMENT);
    for (const interdit of ["findOrCreate", "trouverOuCreer", "fusionner", "dedup", "score", "similarite"]) {
      expect(code, interdit).not.toContain(interdit);
    }
    // Le rattachement ne prend qu'un identifiant de contact choisi : jamais une identité à résoudre.
    expect(code).toMatch(/rattacher\(\s*\n?\s*dossier: Dossier,\s*\n?\s*dossierId: string,\s*\n?\s*contactId: string/);
  });

  it("le rattachement refuse de remplacer un contact déjà posé", () => {
    // Changer la personne canonique d'un dossier emporterait tout son historique relationnel : ce
    // geste-là aura ses propres garanties, il n'est pas un effet de bord de celui-ci.
    const code = codeSeul(RATTACHEMENT);
    expect(code).toContain("deja_rattache");
    // La garde de concurrence ET le refus de relink vivent dans le même `WHERE`.
    expect(code).toMatch(/isNull\(dossier\.contactId\)/);
  });

  it("le rattachement ne fabrique jamais de projet canonique", () => {
    const code = codeSeul(RATTACHEMENT);
    for (const createur of ["creerProjetAcquereur", "creerProjetVendeur"]) {
      expect(code, createur).not.toContain(createur);
    }
  });

  it("les écrans de rattachement passent par les Server Actions, jamais par le repository", () => {
    const ecrans = FICHIERS.filter(
      (chemin) => chemin.includes(join("src", "app")) || chemin.includes(join("src", "components"))
    );
    const fautifs = ecrans.filter((chemin) => /rattacherAcquereurAuContact|rattacherProspectVendeurAuContact|creerContactEtRattacher/.test(codeSeul(chemin)));
    expect(fautifs).toEqual([]);
  });
});

describe("ADR-058 — la recherche ne fusionne jamais deux personnes", () => {
  const RECHERCHE = join("src", "lib", "rechercheContactRepository.ts");

  it("aucune déduplication par email ou téléphone", () => {
    // La pente naturelle de cet écran : regrouper deux lignes qui « se ressemblent ». Ce serait la
    // fusion silencieuse qu'ADR-055 §H interdit, déguisée en confort d'affichage.
    const code = codeSeul(RECHERCHE);
    expect(code).not.toMatch(/groupBy\([^)]*email/i);
    expect(code).not.toMatch(/groupBy\([^)]*telephone/i);
    expect(code).not.toMatch(/distinct/i);
    expect(code).not.toMatch(/new Set\([^)]*email/i);
    // Le seul `groupBy` légitime agrège les interactions PAR CONTACT.
    expect(code).toContain("groupBy(interactionsTable.contactId)");
  });

  it("le workspace est obligatoire, jamais optionnel ni avec repli", () => {
    const code = codeSeul(RECHERCHE);
    expect(code).toMatch(/workspaceId: string;/);
    expect(code).not.toMatch(/workspaceId\?:/);
    expect(code).not.toMatch(/workspaceId\s*(=|\?\?)\s*["'`]/);
    expect(code).toContain("eq(contactsTable.workspaceId, params.workspaceId)");
  });

  it("aucune requête par contact : les agrégats sont batchés", () => {
    // Une page de 25 résultats doit coûter autant qu'une page d'un seul.
    const code = codeSeul(RECHERCHE);
    expect(code).not.toMatch(/for\s*\([^)]*\)\s*{[^}]*await executeur/);
    expect(code).not.toMatch(/\.map\([^)]*=>\s*executeur/);
    for (const batch of ["inArray(partiesProjetTable.contactId, contactIds)", "inArray(interactionsTable.contactId, contactIds)"]) {
      expect(code, batch).toContain(batch);
    }
  });

  it("la recherche ignore la provenance et les dossiers legacy", () => {
    // Provider-agnostique (ADR-058 décision 7) et sans UNION legacy : ce sera son propre lot.
    const code = codeSeul(RECHERCHE);
    for (const interdit of ["referencesExternes", "lib/provenance", "acquereursTable", "prospectsVendeursTable"]) {
      expect(code, interdit).not.toContain(interdit);
    }
  });

  it("aucun terme de recherche n'est journalisé", () => {
    // Une requête peut contenir un email ou un téléphone.
    const code = codeSeul(RECHERCHE);
    expect(code).not.toMatch(/console\.\w+/);
  });

  it("la règle de statut vendeur n'est pas réécrite en SQL", () => {
    const code = codeSeul(RECHERCHE);
    expect(code).toContain("deriverStatutProspectVendeur");
    for (const jalon of ["mandat_signe", "mandat_propose", "'perdu'"]) {
      expect(code, jalon).not.toContain(jalon);
    }
  });
});

describe("ce lot ne migre ni ne duplique rien", () => {
  it("le pont de lecture n'a étendu aucune des deux tables qu'il lit", () => {
    // Énoncé DIRECT de l'invariant, et non un comptage global des fichiers de migration : le compte
    // était un proxy commode tant que rien d'autre ne bougeait, mais il échouait à la première
    // migration sans rapport (ordre total du journal de scan, ADR-033) — et un test qui échoue pour
    // une raison étrangère à ce qu'il protège finit par être ajusté sans être lu.
    const colonnes = (table: PgTable) => getTableConfig(table).columns.map((c) => c.name).sort();
    expect(colonnes(schema.projetsAcquereur)).toEqual(
      [
        "id", "workspace_id", "budget_min", "budget_max", "criteres", "stade_projet", "pieces_min",
        "surface_min", "accessibilite_requise", "necessite_parking", "necessite_exterieur",
        "cree_le", "archive_le",
      ].sort()
    );
    // Les deux ponts restent nullables et seuls : lire le canonique n'a demandé aucune colonne de
    // plus sur le dossier historique.
    const dossier = colonnes(schema.acquereurs);
    expect(dossier).toContain("contact_id");
    expect(dossier).toContain("projet_acquereur_id");
    expect(dossier.filter((c) => /^(projet|contact).*_id$/.test(c))).toEqual(["contact_id", "projet_acquereur_id"]);
  });

  it("aucun backfill : le pont reste nullable et personne ne le remplit en masse", () => {
    const FICHIERS = listerFichiersSource("src").filter((chemin) => !/\.test\.tsx?$/.test(chemin));
    const fautifs = FICHIERS.filter((chemin) => /backfill|rattacherHistorique|migrerAcquereurs/i.test(codeSeul(chemin)));
    expect(fautifs).toEqual([]);
  });

  it("le writer canonique n'écrit jamais dans le dossier historique", () => {
    // Aucun miroir canonical -> legacy ni legacy -> canonical n'est introduit : le but est que le
    // canonique devienne consommable, pas qu'il soit recopié.
    const code = codeSeul(join("src", "lib", "projetAcquereurRepository.ts"));
    expect(code).not.toContain("acquereursTable");
    expect(code).not.toContain("@/lib/clientRepository");
  });
});
