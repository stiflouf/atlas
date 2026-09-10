import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// ADR-056 — garanties STRUCTURELLES de la frontière CORE / SYNC ENGINE / CONNECTOR.
//
// Ce que ces tests protègent : « le Core ne dépend de personne » (§9). C'est une règle qu'on ne
// perd jamais d'un coup — on la perd en ajoutant « juste un playiad_id » sur `contacts` parce que
// la jointure était pénible ce jour-là. À partir de là, le Core connaît un fournisseur, et plus
// rien ne le lui fait oublier.

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

// Le CODE seul, commentaires retirés. Sans cela ces tests interdiraient d'expliquer l'interdiction :
// le commentaire qui dit « jamais de rapprochement par email » contient le mot « email », et le
// fichier le mieux documenté deviendrait le premier fautif.
function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function listerFichiersSource(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return listerFichiersSource(chemin);
    return /\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

// Les entités canoniques du modèle ADR-055. Aucune ne doit porter d'identifiant fournisseur.
const CORE_CANONIQUE = ["contacts", "projets_acquereur", "projets_vendeur", "biens", "mandats", "interactions"];

describe("ADR-056 invariant 1/7 — aucun identifiant fournisseur dans le Core", () => {
  it("aucune entité canonique ne porte d'identifiant externe", () => {
    // L'identité canonique d'un objet métier est son uuid interne. Un identifiant externe n'est
    // jamais une PK, jamais une clé métier, jamais une unicité sur une table canonique.
    const interdits = [
      "playiad_id",
      "hektor_id",
      "apimo_id",
      "gmail_id",
      "gmail_message_id",
      "calendar_id",
      "calendar_event_id",
      "external_id",
      "id_externe",
      "network_id",
      "source_id",
      "fournisseur",
      "provider",
    ];
    for (const table of CORE_CANONIQUE) {
      expect(colonnes(table).filter((colonne) => interdits.includes(colonne)), table).toEqual([]);
    }
  });

  it("les exceptions antérieures sont constatées et gelées, pas étendues (ADR-056 §10)", () => {
    // Ces trois-là existaient AVANT cette ADR et ont d'autres sémantiques. Les convertir de force
    // affirmerait des identités que personne n'a constatées ; les ignorer ferait croire qu'elles
    // n'existent pas. Elles sont donc nommées ici, et ce test échouera si l'une disparaît sans
    // décision — ou si une quatrième apparaît sur une entité canonique.
    expect(colonnes("visites"), "corrélation temporaire vers un événement d'agenda").toContain(
      "rendez_vous_calendar_id"
    );
    expect(colonnes("envois_email"), "audit technique d'un envoi sortant (ADR-031-bis)").toContain(
      "gmail_message_id"
    );
    expect(colonnes("memoire_contextuelle"), "hypothèse scorée, pas une assertion d'identité").toContain(
      "identifiant_externe"
    );
    // Aucune n'est une entité canonique d'ADR-055 : la frontière tient.
    for (const table of ["visites", "envois_email", "memoire_contextuelle"]) {
      expect(CORE_CANONIQUE).not.toContain(table);
    }
  });
});

describe("ADR-056 §2/§3 — la couche provenance est séparée et contrainte", () => {
  it("references_externes est une racine avec son appartenance explicite", () => {
    // Deux workspaces peuvent recevoir le même id du même fournisseur : sans workspace_id dans la
    // clé, l'un écraserait l'autre.
    const workspace = config("references_externes").columns.find((c) => c.name === "workspace_id");
    expect(workspace!.notNull).toBe(true);
    expect(workspace!.hasDefault).toBe(false);
  });

  it("une référence désigne exactement une entité canonique, par de vraies FK", () => {
    const reference = config("references_externes");
    // Jamais un couple polymorphe : il ne pourrait porter aucune clé étrangère.
    for (const interdit of ["type_entite_canonique", "id_entite_canonique", "canonical_type", "canonical_id"]) {
      expect(colonnes("references_externes"), `references_externes.${interdit}`).not.toContain(interdit);
    }

    const cibles = reference.foreignKeys
      .map((fk) => fk.reference())
      .map((r) => getTableConfig(r.foreignTable).name)
      .filter((nom) => nom !== "workspaces");
    expect(cibles.sort()).toEqual([...CORE_CANONIQUE].sort());
    expect(reference.checks.map((c) => c.name)).toContain("references_externes_une_seule_cible_check");
  });

  it("l'unicité d'identité externe est portée par la base (invariant 2)", () => {
    const uniques = config("references_externes").uniqueConstraints.map((c) =>
      c.columns.map((colonne) => colonne.name).sort()
    );
    expect(uniques).toEqual([["fournisseur", "id_externe", "type_entite_externe", "workspace_id"]]);
    // Et rien n'empêche une entité de porter plusieurs références (invariant 3) : aucune unicité
    // sur une colonne de cible seule.
    expect(uniques.some((colonnes) => colonnes.includes("contact_id"))).toBe(false);
  });

  it("champs_verrouilles ne verrouille que des entités modifiables, par de vraies FK", () => {
    // `interactions` en est absente : un échange qui a eu lieu n'est pas corrigé par une
    // synchronisation, il n'y a rien à y verrouiller.
    const cibles = config("champs_verrouilles")
      .foreignKeys.map((fk) => fk.reference())
      .map((r) => getTableConfig(r.foreignTable).name)
      .filter((nom) => nom !== "workspaces");
    expect(cibles.sort()).toEqual(["biens", "contacts", "mandats", "projets_acquereur", "projets_vendeur"]);
    expect(config("champs_verrouilles").checks.map((c) => c.name)).toContain(
      "champs_verrouilles_une_seule_cible_check"
    );
    // Aucun fournisseur : un verrou protège la valeur DOMIORA contre TOUTES les sources.
    expect(colonnes("champs_verrouilles")).not.toContain("fournisseur");
  });

  it("memoire_contextuelle et connexions_google restent séparées et intactes", () => {
    // ADR-056 §2 : une hypothèse scorée n'est pas une assertion d'identité.
    expect(colonnes("memoire_contextuelle")).toEqual(
      expect.arrayContaining(["overall_confidence", "statut_validation", "empreinte_contenu"])
    );
    // Un jeton OAuth est un moyen d'accès, jamais une identité métier — et rien de la couche
    // provenance ne stocke de secret.
    expect(tables.has("connexions_google")).toBe(true);
    for (const table of ["references_externes", "champs_verrouilles"]) {
      const secrets = colonnes(table).filter((c) => /token|secret|refresh|acces/.test(c));
      expect(secrets, `${table} ne doit porter aucun secret`).toEqual([]);
    }
  });

  it("aucune table de synchronisation ou de conflit n'est créée par ce lot", () => {
    // `synchronisations_entite` attend le premier connecteur : sans lui, aucune de ses colonnes
    // n'aurait d'écrivain.
    for (const nom of ["synchronisations_entite", "conflits_synchronisation", "connecteurs"]) {
      expect([...tables.keys()], nom).not.toContain(nom);
    }
  });
});

describe("ADR-056 §9 — le Core ne dépend de personne", () => {
  const FICHIERS = listerFichiersSource("src").filter((chemin) => !/\.test\.tsx?$/.test(chemin));
  const REFERENCES_PROVENANCE = /lib\/provenance|referencesExternes|champsVerrouilles|@\/types\/provenance/;

  it("aucun moteur pur ne connaît la provenance ni un fournisseur", () => {
    // Invariant 8 : les moteurs d'intelligence et d'automatisation ne connaissent ni fournisseur ni
    // référence externe.
    const moteurs = [
      join("lib", "compatibilite"),
      join("lib", "opportunites"),
      join("lib", "alertes"),
      join("lib", "fiscal"),
      join("lib", "automatisations"),
    ];
    const fautifs = FICHIERS.filter((chemin) => moteurs.some((moteur) => chemin.includes(moteur))).filter((chemin) =>
      REFERENCES_PROVENANCE.test(readFileSync(chemin, "utf8"))
    );
    expect(fautifs).toEqual([]);
  });

  it("aucun écran ne lit la couche provenance", () => {
    const fautifs = FICHIERS.filter(
      (chemin) => chemin.includes(join("src", "app")) || chemin.includes(join("src", "components"))
    ).filter((chemin) => REFERENCES_PROVENANCE.test(readFileSync(chemin, "utf8")));
    expect(fautifs, "aucune UI de connecteur ni de conflit dans ce lot").toEqual([]);
  });

  it("aucun connecteur réel, aucun SDK fournisseur", () => {
    // Invariant 9 : ajouter une dépendance fournisseur est une décision d'architecture. Et un
    // connecteur nommé n'existe pas : le lot pose les primitives, pas une intégration.
    const paquet = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependances = Object.keys({ ...paquet.dependencies, ...paquet.devDependencies });
    const sdkInterdits = /playiad|hektor|apimo|iad|salesforce|hubspot|@microsoft|googleapis/i;
    expect(dependances.filter((nom) => sdkInterdits.test(nom))).toEqual([]);

    const fichiersProvenance = FICHIERS.filter((chemin) => chemin.includes(join("lib", "provenance")));
    expect(fichiersProvenance.length, "la couche provenance doit exister").toBeGreaterThan(0);
    const fautifs = fichiersProvenance.filter((chemin) => {
      const contenu = readFileSync(chemin, "utf8");
      // Aucun appel réseau : ces modules décident et persistent, ils ne synchronisent pas.
      return /\bfetch\(|https?:\/\//.test(contenu);
    });
    expect(fautifs, "aucune synchronisation réelle dans ce lot").toEqual([]);
  });

  it("la fonction de décision d'import reste pure", () => {
    // Elle est l'endroit où l'invariant 4 est tenu : si elle acquiert un accès base ou réseau, elle
    // cesse d'être exhaustivement testable, et l'invariant devient une intention.
    const contenu = readFileSync(join("src", "lib", "provenance", "decisionImport.ts"), "utf8");
    for (const interdit of ["getDb", "fetch(", "@/db/", "await "]) {
      expect(contenu, `decisionImport ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
  });

  it("le Sync Engine passe par les contrats du Core, jamais par ses tables", () => {
    // §9 : le Sync Engine connaît les repositories, pas le schéma. S'il ouvrait `@/db/schema`, il
    // écrirait des colonnes sans passer par les invariants que le Core tient — et `budgetMin >
    // budgetMax` deviendrait atteignable par un chemin que personne ne relit.
    const contenu = readFileSync(join("src", "lib", "provenance", "appliquerMutationExterne.ts"), "utf8");
    expect(contenu, "le pipeline ne doit pas importer le schéma").not.toContain("@/db/schema");
    // La décision APPLY/IGNORE/CONFLICT n'est pas réimplémentée : elle est appelée.
    expect(contenu).toContain("deciderApplicationValeurExterne");
  });

  it("le Sync Engine ne rapproche par aucune heuristique", () => {
    // ADR-056 §3 : `references_externes` est le SEUL chemin d'identité. Un rapprochement par
    // email ou téléphone fusionne deux personnes que personne n'a demandé de fusionner, et
    // aucune suppression ne défait la fusion une fois les faits recopiés.
    const contenu = codeSeul(join("src", "lib", "provenance", "appliquerMutationExterne.ts"));
    // Bornées des DEUX côtés pour les noms de champs : « nombre de pièces » n'est pas un
    // rapprochement par nom.
    const heuristiques = [/\bemail\b/i, /\btelephone\b/i, /\bnom\b/i, /\badresse\b/i, /\bmatch/i, /\bsimilar/i, /\bfuzzy/i];
    const trouvees = heuristiques.filter((motif) => motif.test(contenu)).map((motif) => motif.source);
    expect(trouvees, "aucun rapprochement par ressemblance dans le pipeline").toEqual([]);
  });

  it("aucun ordonnanceur, aucun lot, aucune synchronisation périodique", () => {
    // Ce lot applique UNE mutation. Un batch ou un cron transformerait un pipeline relisable en
    // une machine qui écrit toute seule, avant qu'aucun conflit ne soit observable par un humain.
    const fichiersProvenance = FICHIERS.filter((chemin) => chemin.includes(join("lib", "provenance")));
    const fautifs = fichiersProvenance.filter((chemin) =>
      /\bcron\b|setInterval|scheduler|\bpoll(ing)?\b|synchroniserTout|batch/i.test(codeSeul(chemin))
    );
    expect(fautifs).toEqual([]);
  });

  it("aucun secret ni en-tête fournisseur dans la couche provenance", () => {
    // Les capacités sont DÉCLARÉES, jamais authentifiées ici : un jeton dans ces modules voudrait
    // dire qu'ils appellent quelqu'un, et la frontière serait déjà franchie.
    const fichiersProvenance = FICHIERS.filter((chemin) => chemin.includes(join("lib", "provenance")));
    const fautifs = fichiersProvenance.filter((chemin) =>
      /access_token|refresh_token|\boauth\b|client_secret|api[_-]?key|Authorization/i.test(codeSeul(chemin))
    );
    expect(fautifs).toEqual([]);
  });

  it("Gmail reste un fournisseur SORTANT : aucun scope de lecture, aucun pull", () => {
    // Le premier fournisseur réel de DOMIORA écrit un fait relationnel à partir d'un envoi. Lire
    // la boîte serait un autre produit, avec un autre consentement et une autre politique de
    // rétention — et la frontière se perdrait le jour où « juste les en-têtes » paraîtrait anodin.
    const SCOPES_INTERDITS = ["gmail.readonly", "gmail.metadata", "gmail.modify", "gmail.compose", "gmail.labels"];
    const PULL_GMAIL = [
      "users/me/messages?",
      "users/me/threads",
      "users/me/history",
      "users/me/labels",
      "users/me/drafts",
      "messages.list",
      "messages.get",
      "historyId",
      "internalDate",
    ];
    const fautifs = FICHIERS.filter((chemin) => {
      const contenu = codeSeul(chemin);
      return [...SCOPES_INTERDITS, ...PULL_GMAIL].some((interdit) => contenu.includes(interdit));
    });
    expect(fautifs, "aucune lecture Gmail dans le code").toEqual([]);

    // Le seul endpoint Gmail du dépôt reste l'envoi.
    const gmail = readFileSync(join("src", "lib", "google", "gmailClient.ts"), "utf8");
    expect(gmail).toContain("gmail/v1/users/me/messages/send");
    // Et le seul scope Gmail demandé reste celui de l'envoi.
    const oauth = readFileSync(join("src", "lib", "google", "oauth.ts"), "utf8");
    expect(oauth).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(oauth).toContain("https://www.googleapis.com/auth/calendar.events.readonly");
  });

  it("le fait canonique tiré d'un envoi Gmail n'emprunte ni le pipeline de mutation ni les verrous", () => {
    // Un email parti est un fait append-only. Il n'a pas de valeur locale à contredire, donc rien
    // à arbitrer : ni `deciderApplicationValeurExterne`, ni `champs_verrouilles` (dont les cinq
    // cibles excluent déjà `interactions`).
    const contenu = codeSeul(join("src", "lib", "communications", "finaliserEnvoiGmail.ts"));
    for (const interdit of ["appliquerMutationExterne", "champVerrouille", "champsVerrouilles", "deciderApplication"]) {
      expect(contenu, `la finalisation ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
    // Elle ne parle pas non plus à Google : elle reçoit un identifiant déjà obtenu.
    expect(contenu).not.toMatch(/\bfetch\(|https?:\/\//);
  });

  it("le rattachement d'un email à une personne passe par une colonne, jamais par une adresse", () => {
    // ADR-055 §H. Deux personnes peuvent partager une adresse, et une adresse peut changer de
    // main : rapprocher là-dessus fusionnerait des gens que personne n'a demandé de fusionner.
    const contenu = codeSeul(join("src", "lib", "communications", "finaliserEnvoiGmail.ts"));
    // Ce qui est interdit, c'est de LIRE une personne par son adresse — pas le mot « email », qui
    // est aussi le type légitime de l'interaction produite.
    for (const motif of [/destinataireEmail/, /\.email\b/, /\btelephone\b/i]) {
      expect(contenu, `aucun rapprochement par ${motif.source}`).not.toMatch(motif);
    }
    // Et elle ne recopie aucun corps ni objet de message : la politique de rétention d'ADR-031-bis
    // reste celle qu'elle était.
    for (const interdit of ["corps", "objet", "contenuHash"]) {
      expect(contenu, `la finalisation ne persiste pas « ${interdit} »`).not.toContain(interdit);
    }
  });

  it("le Core ne dépend pas du Sync Engine", () => {
    // La dépendance est à SENS UNIQUE. Un repository Core, une Server Action ou un moteur qui
    // appellerait le pipeline ferait de la synchronisation une étape d'un flux métier — et le
    // Core cesserait d'être lisible sans connaître les connecteurs.
    const fautifs = FICHIERS.filter((chemin) => !chemin.includes(join("lib", "provenance"))).filter((chemin) =>
      /appliquerMutationExterne|@\/types\/synchronisation/.test(codeSeul(chemin))
    );
    expect(fautifs, "seul un futur connecteur appellera le pipeline").toEqual([]);
  });
});
