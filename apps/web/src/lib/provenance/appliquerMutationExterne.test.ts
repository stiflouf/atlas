import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { DescripteurConnecteur } from "./contratConnecteur";
import type { MutationExterneNormalisee } from "@/types/synchronisation";

// ADR-056 §9 — le pipeline de bout en bout, contre une vraie base. Chaque test vérifie DEUX choses :
// la décision rendue, et l'état réel du Core après coup — parce qu'un pipeline qui rend « conflit »
// tout en ayant écrit serait plus dangereux qu'un pipeline qui échoue franchement.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  champsVerrouilles: champsVerrouillesTable,
  contacts: contactsTable,
  projetsAcquereur: projetsAcquereurTable,
  referencesExternes: referencesExternesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur, getProjetAcquereurById } = await import("@/lib/projetAcquereurRepository");
const { enregistrerReferenceExterne } = await import("./referenceExterneRepository");
const { verrouillerChamp } = await import("./champVerrouilleRepository");
const { appliquerMutationExterne } = await import("./appliquerMutationExterne");

// Aucun faux connecteur : un `FakePlayiadConnector` testerait une architecture imaginaire contre
// elle-même. Un descripteur littéral est exactement ce qu'un vrai connecteur déclarera.
const CONNECTEUR_PULL: DescripteurConnecteur = {
  fournisseur: "source_de_test",
  capacites: { projet_acquereur: "pull", contact: "bidirectionnel" },
};
const CONNECTEUR_LECTURE_SEULE: DescripteurConnecteur = {
  fournisseur: "source_de_test",
  capacites: { projet_acquereur: "read_only" },
};
// Capacité OMISE, et non déclarée restrictive : le cas le plus courant en pratique, puisqu'il
// suffit d'ajouter une entité au modèle sans toucher au descripteur.
const CONNECTEUR_SANS_CAPACITE: DescripteurConnecteur = {
  fournisseur: "source_de_test",
  capacites: { contact: "pull" },
};

const projetsCrees: string[] = [];
const contactsCrees: string[] = [];
const workspacesCrees: string[] = [];
let compteur = 0;

async function unProjetReference(workspaceId: string = WORKSPACE_TEST) {
  compteur += 1;
  const projet = await creerProjetAcquereur(
    { budgetMin: 100_000, budgetMax: 450_000, criteres: ["jardin"], stadeProjet: "decouverte" },
    workspaceId
  );
  projetsCrees.push(projet.id);
  const idExterne = `ext-projet-${compteur}-${Date.now()}`;
  await enregistrerReferenceExterne(
    {
      fournisseur: "source_de_test",
      typeEntiteExterne: "buyer",
      idExterne,
      cible: { type: "projet_acquereur", id: projet.id },
    },
    workspaceId
  );
  return { projet, idExterne };
}

function mutation(
  idExterne: string,
  champ: MutationExterneNormalisee["champ"],
  valeurExterne: unknown
): MutationExterneNormalisee {
  return {
    fournisseur: "source_de_test",
    typeEntiteExterne: "buyer",
    idExterne,
    typeEntiteCanonique: "projet_acquereur",
    champ,
    valeurExterne,
  };
}

// Les identifiants présents, triés : l'ordre des lignes rendues par Postgres n'est pas garanti,
// et un test de non-création qui dépendrait de cet ordre serait faux un jour sur dix.
async function idsDe(table: typeof projetsAcquereurTable | typeof contactsTable): Promise<string[]> {
  const lignes = await getDb().select({ id: table.id }).from(table);
  return lignes.map((ligne) => ligne.id).sort();
}

afterAll(async () => {
  if (projetsCrees.length > 0) {
    await getDb()
      .delete(referencesExternesTable)
      .where(inArray(referencesExternesTable.projetAcquereurId, projetsCrees));
    await getDb()
      .delete(champsVerrouillesTable)
      .where(inArray(champsVerrouillesTable.projetAcquereurId, projetsCrees));
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, projetsCrees));
  }
  if (contactsCrees.length > 0) {
    await getDb().delete(referencesExternesTable).where(inArray(referencesExternesTable.contactId, contactsCrees));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  }
  if (workspacesCrees.length > 0) {
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
  }
});

describe("Sync Engine — refus AVANT toute lecture ou écriture", () => {
  it("refuse quand le connecteur n'a pas déclaré pouvoir importer ce type d'entité", async () => {
    // ADR-056 invariant 6 : l'omission vaut refus, et `read_only` ne suffit pas — « peut être
    // interrogé » n'est pas « ce qu'il renvoie entre dans le Core ».
    const { idExterne, projet } = await unProjetReference();

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 470_000),
      { connecteur: CONNECTEUR_LECTURE_SEULE, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("capacite_refusee");
    expect((await getProjetAcquereurById(projet.id))!.budgetMax).toBe(450_000);
  });

  it("refuse quand le connecteur ne déclare RIEN pour ce type d'entité", async () => {
    // « Non configuré n'est pas en panne », mais ce n'est pas davantage une autorisation tacite :
    // l'omission est le chemin par lequel une capacité non voulue s'obtient par oubli.
    const { idExterne, projet } = await unProjetReference();

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 470_000),
      { connecteur: CONNECTEUR_SANS_CAPACITE, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("capacite_refusee");
    expect((await getProjetAcquereurById(projet.id))!.budgetMax).toBe(450_000);
  });

  it("refuse un champ hors de la liste fermée, même si la colonne existe", async () => {
    // `stadeProjet` est une vraie colonne, et un vrai champ verrouillable — mais PAS un champ
    // synchronisable : le parcours commercial du conseiller ne recule pas parce qu'un CRM tiers
    // est en retard. Le type l'interdit à la compilation ; ce test prouve qu'un appelant
    // JavaScript, ou un `as` de complaisance, ne passe pas non plus.
    const { idExterne, projet } = await unProjetReference();

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "stadeProjet" as MutationExterneNormalisee["champ"], "offre"),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("mutation_invalide");
    expect((await getProjetAcquereurById(projet.id))!.stadeProjet).toBe("decouverte");
  });

  it("refuse un type de valeur incompatible, sans laisser Postgres décider", async () => {
    const { idExterne, projet } = await unProjetReference();

    for (const valeur of ["bonjour", 12.5, -1, null, undefined, {}]) {
      const resultat = await appliquerMutationExterne(
        mutation(idExterne, "budgetMax", valeur),
        { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
        WORKSPACE_TEST
      );
      expect(resultat.statut, `valeur ${String(valeur)}`).toBe("mutation_invalide");
    }
    expect((await getProjetAcquereurById(projet.id))!.budgetMax).toBe(450_000);
  });

  it("accepte null là où le champ canonique est optionnel", async () => {
    // « non documenté » est une information, distincte d'un champ absent du payload — lequel ne
    // produit simplement aucune mutation.
    const { idExterne, projet } = await unProjetReference();

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "necessiteParking", null),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );
    // La valeur locale est déjà absente : rien à écrire.
    expect(resultat.statut).toBe("ignoree");
    expect((await getProjetAcquereurById(projet.id))!.necessiteParking).toBeUndefined();
  });
});

describe("Sync Engine — résolution d'identité, sans création ni déduplication", () => {
  it("une identité inconnue ne crée RIEN", async () => {
    const projetsAvant = await idsDe(projetsAcquereurTable);
    const contactsAvant = await idsDe(contactsTable);

    const resultat = await appliquerMutationExterne(
      mutation("jamais-vu", "budgetMax", 470_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("identite_inconnue");
    // Aucune entité canonique n'a été fabriquée pour l'occasion : décider qu'un inconnu mérite une
    // fiche est un geste d'import, avec ses propres règles — pas un effet de bord de la synchro.
    expect(await idsDe(projetsAcquereurTable)).toEqual(projetsAvant);
    expect(await idsDe(contactsTable)).toEqual(contactsAvant);
    // Et aucune référence externe n'a été « apprise » au passage.
    const references = await getDb()
      .select()
      .from(referencesExternesTable)
      .where(eq(referencesExternesTable.idExterne, "jamais-vu"));
    expect(references).toEqual([]);
  });

  it("refuse une référence qui pointe vers un autre type canonique", async () => {
    // Aucune conversion automatique : une référence vers un contact ne devient pas un projet.
    const contact = await creerContact({ nom: "[test réel] Cible contact" }, WORKSPACE_TEST);
    contactsCrees.push(contact.id);
    const idExterne = `ext-contact-${Date.now()}`;
    await enregistrerReferenceExterne(
      { fournisseur: "source_de_test", typeEntiteExterne: "buyer", idExterne, cible: { type: "contact", id: contact.id } },
      WORKSPACE_TEST
    );

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 470_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("cible_inattendue");
  });

  it("ne rapproche RIEN par ressemblance : un jumeau parfait reste un inconnu", async () => {
    // Le seul chemin d'identité est `references_externes`. Un projet identique en tout point —
    // même budget, mêmes critères, même workspace — et un contact portant le même email ne
    // rendent pas l'identité externe résoluble. C'est le refus d'ADR-056 §3 : un rapprochement
    // heuristique crée des fusions silencieuses qu'aucun humain n'a demandées, et qu'aucune
    // suppression ne défait.
    const { projet } = await unProjetReference();
    const contact = await creerContact({ nom: "[test réel] Jumeau", email: "jumeau@example.test" }, WORKSPACE_TEST);
    contactsCrees.push(contact.id);

    const resultat = await appliquerMutationExterne(
      mutation(`ext-inconnu-${Date.now()}`, "budgetMax", 470_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("identite_inconnue");
    expect((await getProjetAcquereurById(projet.id))!.budgetMax).toBe(450_000);
  });

  it("l'identité d'un autre workspace n'est pas visible", async () => {
    const [autreWorkspace] = await getDb()
      .insert(workspacesTable)
      .values({ id: "workspace-test-sync", nom: "[test réel] autre workspace" })
      .returning();
    workspacesCrees.push(autreWorkspace.id);
    const { idExterne, projet } = await unProjetReference(autreWorkspace.id);

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 470_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("identite_inconnue");
    expect((await getProjetAcquereurById(projet.id))!.budgetMax).toBe(450_000);
  });
});

describe("Sync Engine — la décision gouverne l'écriture", () => {
  it("applique une valeur différente sur un champ libre, et ne touche que lui", async () => {
    const { idExterne, projet } = await unProjetReference();

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 470_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    expect(resultat).toMatchObject({ statut: "appliquee", champ: "budgetMax", valeurPrecedente: 450_000 });
    const relu = (await getProjetAcquereurById(projet.id))!;
    expect(relu.budgetMax).toBe(470_000);
    // TOUT le reste est intact : une mutation porte sur un champ, pas sur une entité.
    expect(relu.budgetMin).toBe(100_000);
    expect(relu.criteres).toEqual(["jardin"]);
    expect(relu.stadeProjet).toBe("decouverte");
  });

  it("ignore une valeur identique, sans écrire", async () => {
    const { idExterne, projet } = await unProjetReference();
    const avant = (await getProjetAcquereurById(projet.id))!;

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 450_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("ignoree");
    expect(await getProjetAcquereurById(projet.id)).toEqual(avant);
  });

  it("compare les listes par leur contenu, pas par leur référence mémoire", async () => {
    // Sans cela, `criteres` serait réécrit à chaque pull et aucun replay ne serait idempotent.
    const { idExterne } = await unProjetReference();

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "criteres", ["jardin"]),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("ignoree");
  });

  it("REFUSE d'écraser un champ verrouillé, et rend le conflit observable", async () => {
    // Le cas fondateur d'ADR-056, joué par le pipeline complet.
    const { idExterne, projet } = await unProjetReference();
    await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 470_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );
    await verrouillerChamp({ type: "projet_acquereur", id: projet.id }, "budgetMax", WORKSPACE_TEST);

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 450_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("conflit");
    if (resultat.statut !== "conflit") throw new Error("statut inattendu");
    expect(resultat.conflit).toMatchObject({
      champ: "budgetMax",
      valeurLocale: 470_000,
      valeurExterne: 450_000,
      fournisseur: "source_de_test",
      idExterne,
    });
    // Tout ce qu'un humain doit voir pour trancher, et rien de secret.
    expect(resultat.conflit.raison).toContain("humain");
    // Le Core n'a PAS bougé.
    expect((await getProjetAcquereurById(projet.id))!.budgetMax).toBe(470_000);
  });

  it("un accord sur un champ verrouillé reste un « ignorer », pas un conflit", async () => {
    // Si la source finit par proposer la valeur corrigée, il n'y a plus rien à arbitrer : déclarer
    // un conflit ici produirait du bruit permanent sur des données d'accord.
    const { idExterne, projet } = await unProjetReference();
    await verrouillerChamp({ type: "projet_acquereur", id: projet.id }, "budgetMax", WORKSPACE_TEST);

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 450_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("ignoree");
  });

  it("quand DOMIORA fait foi, l'écart est signalé sans être appliqué", async () => {
    const { idExterne, projet } = await unProjetReference();

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 470_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "domiora" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("conflit");
    expect((await getProjetAcquereurById(projet.id))!.budgetMax).toBe(450_000);
  });
});

describe("Sync Engine — idempotence et invariants du Core", () => {
  it("rejouer la même mutation applique une fois, puis ignore", async () => {
    const { idExterne, projet } = await unProjetReference();
    const entree = mutation(idExterne, "budgetMax", 470_000);
    const contexte = { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" as const };

    expect((await appliquerMutationExterne(entree, contexte, WORKSPACE_TEST)).statut).toBe("appliquee");
    expect((await appliquerMutationExterne(entree, contexte, WORKSPACE_TEST)).statut).toBe("ignoree");
    expect((await appliquerMutationExterne(entree, contexte, WORKSPACE_TEST)).statut).toBe("ignoree");
    expect((await getProjetAcquereurById(projet.id))!.budgetMax).toBe(470_000);
  });

  it("refuse une valeur qui violerait un invariant métier, sans rien persister", async () => {
    // `budgetMin > budgetMax` est techniquement un entier valide, et métier-ement impossible. Une
    // donnée douteuse est abandonnée entière, jamais « réparée ».
    const { idExterne, projet } = await unProjetReference();

    const resultat = await appliquerMutationExterne(
      mutation(idExterne, "budgetMin", 900_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("refus_metier");
    const relu = (await getProjetAcquereurById(projet.id))!;
    expect(relu.budgetMin).toBe(100_000);
    expect(relu.budgetMax).toBe(450_000);
  });

  it("une écriture refusée par le Core ne laisse aucune trace partielle", async () => {
    // Le pipeline n'a qu'UNE écriture, mais elle est précédée dans la même transaction de lectures
    // qui décident : ce test vérifie qu'un refus survenu APRÈS ces lectures laisse la ligne
    // strictement identique, jusqu'aux champs voisins.
    const { idExterne, projet } = await unProjetReference();
    const avant = await getDb().select().from(projetsAcquereurTable).where(eq(projetsAcquereurTable.id, projet.id));

    await appliquerMutationExterne(
      mutation(idExterne, "budgetMin", 900_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    const apres = await getDb().select().from(projetsAcquereurTable).where(eq(projetsAcquereurTable.id, projet.id));
    expect(apres).toEqual(avant);
  });

  it("n'écrit jamais de verrou : importer n'est pas décider", async () => {
    const { idExterne, projet } = await unProjetReference();
    await appliquerMutationExterne(
      mutation(idExterne, "budgetMax", 470_000),
      { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" },
      WORKSPACE_TEST
    );

    const verrous = await getDb()
      .select()
      .from(champsVerrouillesTable)
      .where(eq(champsVerrouillesTable.projetAcquereurId, projet.id));
    expect(verrous, "un import ne pose pas de verrou humain").toEqual([]);
  });

  it("applique les autres champs supportés avec leur type propre", async () => {
    const { idExterne, projet } = await unProjetReference();
    const contexte = { connecteur: CONNECTEUR_PULL, sourceDeVerite: "externe" as const };

    expect((await appliquerMutationExterne(mutation(idExterne, "piecesMin", 4), contexte, WORKSPACE_TEST)).statut).toBe(
      "appliquee"
    );
    expect(
      (await appliquerMutationExterne(mutation(idExterne, "surfaceMin", 72.5), contexte, WORKSPACE_TEST)).statut
    ).toBe("appliquee");
    expect(
      (await appliquerMutationExterne(mutation(idExterne, "necessiteExterieur", true), contexte, WORKSPACE_TEST))
        .statut
    ).toBe("appliquee");
    expect(
      (await appliquerMutationExterne(mutation(idExterne, "criteres", ["jardin", "calme"]), contexte, WORKSPACE_TEST))
        .statut
    ).toBe("appliquee");

    const relu = (await getProjetAcquereurById(projet.id))!;
    expect(relu.piecesMin).toBe(4);
    expect(relu.surfaceMin).toBe(72.5);
    expect(relu.necessiteExterieur).toBe(true);
    expect(relu.criteres).toEqual(["jardin", "calme"]);
    // Les champs jamais touchés le sont restés.
    expect(relu.budgetMax).toBe(450_000);
    expect(relu.accessibiliteRequise).toBeUndefined();
  });
});
