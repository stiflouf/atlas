import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-055 §B + ADR-036 + ADR-056 §9 — LA BOUCLE, fermée de bout en bout et en base réelle.
//
// Ce fichier ne prouve pas qu'un repository sait lire `projets_acquereur` (c'est
// profilCompatibiliteRepository.test.ts qui le fait) : il prouve qu'une écriture sur le PROJET
// canonique change réellement le verdict du matching, que le dossier historique n'est pas touché,
// et qu'un recalcul est demandé. Avant ce lot, les trois pouvaient être faux ensemble sans qu'aucun
// test ne bouge — une mutation canonique était écrite dans une table que le moteur ne lisait pas.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  biens: biensTable,
  compatibilitesARessynchroniser,
  compatibilitesBienAcquereurEtat,
  contacts: contactsTable,
  evenementsMetier,
  executionsAutomatisation,
  projetsAcquereur: projetsAcquereurTable,
  referencesExternes: referencesExternesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur, modifierChampProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { enregistrerReferenceExterne } = await import("@/lib/provenance/referenceExterneRepository");
const { appliquerMutationExterne } = await import("@/lib/provenance/appliquerMutationExterne");
const { evaluerCompatibiliteAcquereur } = await import("./orchestration");
const { synchroniserCompatibilitesPourAcquereur } = await import("./synchronisation");

const PRIX_BIEN = 300_000;
const BUDGET_INITIAL = 350_000; // au-dessus du prix -> compatible
const BUDGET_ABAISSE = 250_000; // en dessous du prix -> incompatible

const biensCrees: string[] = [];
const acquereursCrees: string[] = [];
const projetsCrees: string[] = [];
const contactsCrees: string[] = [];

afterAll(async () => {
  if (acquereursCrees.length > 0) {
    // Ordre imposé par les FK : une paire devenue compatible émet un événement métier, qui peut
    // lui-même avoir préparé une exécution d'automatisation.
    const evenements = await getDb()
      .select({ id: evenementsMetier.id })
      .from(evenementsMetier)
      .where(inArray(evenementsMetier.acquereurId, acquereursCrees));
    if (evenements.length > 0) {
      const ids = evenements.map((e) => e.id);
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, ids));
      await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, ids));
    }
    await getDb()
      .delete(compatibilitesARessynchroniser)
      .where(inArray(compatibilitesARessynchroniser.acquereurId, acquereursCrees));
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(inArray(compatibilitesBienAcquereurEtat.acquereurId, acquereursCrees));
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, acquereursCrees));
  }
  if (biensCrees.length > 0) {
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(inArray(compatibilitesBienAcquereurEtat.bienId, biensCrees));
    await getDb().delete(biensTable).where(inArray(biensTable.id, biensCrees));
  }
  if (projetsCrees.length > 0) {
    await getDb()
      .delete(referencesExternesTable)
      .where(inArray(referencesExternesTable.projetAcquereurId, projetsCrees));
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, projetsCrees));
  }
  if (contactsCrees.length > 0) {
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  }
});

// Reproduit EXACTEMENT le graphe que creerAcquereurAction écrit aujourd'hui, et qui vient d'être
// certifié en base de démonstration : contact + projet + partie + dossier rattaché.
async function unAcquereurCanonique(suffixe: string) {
  const contact = await creerContact({ nom: `[test réel] Boucle ${suffixe}` }, WORKSPACE_TEST);
  contactsCrees.push(contact.id);
  const projet = await creerProjetAcquereur(
    { budgetMin: 100_000, budgetMax: BUDGET_INITIAL, criteres: [], stadeProjet: "recherche_active" },
    WORKSPACE_TEST
  );
  projetsCrees.push(projet.id);
  await ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: projet.id, role: "acquereur" });
  const dossier = await creerAcquereur(
    {
      prenom: "Test",
      nom: `[test réel] Boucle ${suffixe}`,
      email: `test-reel-boucle-${suffixe}@example.com`,
      telephone: "0600000000",
      budgetMin: 100_000,
      budgetMax: BUDGET_INITIAL,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
      contactId: contact.id,
      projetAcquereurId: projet.id,
    },
    WORKSPACE_TEST
  );
  acquereursCrees.push(dossier.id);
  return { contact, projet, dossier };
}

async function unBien(suffixe: string) {
  const bien = await creerBien(
    {
      reference: `[test réel] BOUCLE-${suffixe}`,
      titre: "Bien de test lecture canonique",
      type: "appartement",
      adresse: "1 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 3,
      prix: PRIX_BIEN,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    WORKSPACE_TEST
  );
  biensCrees.push(bien.id);
  return bien;
}

async function critereBudget(acquereurId: string, bienId: string) {
  const resultats = await evaluerCompatibiliteAcquereur(acquereurId);
  const pourCeBien = resultats.find((r) => r.bienId === bienId);
  expect(pourCeBien, "le bien de test doit figurer dans le croisement").toBeDefined();
  return pourCeBien!.criteres.find((c) => c.critere === "budget_max")!;
}

// Le synchroniseur évalue l'acquéreur contre TOUS les biens actifs persistés, y compris ceux
// d'autres fichiers de test : l'état doit toujours être relu sur la paire, jamais sur le seul
// acquéreur.
async function etatDeLaPaire(bienId: string, acquereurId: string) {
  const [ligne] = await getDb()
    .select()
    .from(compatibilitesBienAcquereurEtat)
    .where(
      and(
        eq(compatibilitesBienAcquereurEtat.bienId, bienId),
        eq(compatibilitesBienAcquereurEtat.acquereurId, acquereurId)
      )
    );
  return ligne;
}

async function demandesEnAttentePour(acquereurId: string) {
  return getDb()
    .select()
    .from(compatibilitesARessynchroniser)
    .where(eq(compatibilitesARessynchroniser.acquereurId, acquereurId));
}

describe("boucle canonique — le projet acquéreur pilote réellement le matching", () => {
  it("modifier le PROJET seul change le verdict, sans toucher le dossier historique", async () => {
    const { projet, dossier } = await unAcquereurCanonique("moteur");
    const bien = await unBien("moteur");

    // 1. Départ : legacy et canonique disent la même chose — le bien passe le budget.
    expect((await critereBudget(dossier.id, bien.id)).statut).toBe("compatible");

    // 2. On abaisse le budget UNIQUEMENT sur le projet canonique.
    const modifie = await modifierChampProjetAcquereur(projet.id, "budgetMax", BUDGET_ABAISSE);
    expect(modifie?.budgetMax).toBe(BUDGET_ABAISSE);

    // 3. Le dossier historique n'a PAS bougé : aucun double-write n'a été introduit.
    const [ligneLegacy] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, dossier.id));
    expect(ligneLegacy!.budgetMax).toBe(BUDGET_INITIAL);

    // 4. Et pourtant le verdict a changé. C'est CE point qui n'existait pas avant ce lot.
    const critere = await critereBudget(dossier.id, bien.id);
    expect(critere.statut).toBe("incompatible");
    expect(critere.exigenceAcquereur).toBe(BUDGET_ABAISSE);
  });

  it("le synchroniseur ADR-036 observe le même verdict que l'écran", async () => {
    // La mémoire technique et l'affichage doivent lire la même source, sinon un écran montrerait
    // une incompatibilité pendant qu'un événement de compatibilité serait émis derrière.
    const { projet, dossier } = await unAcquereurCanonique("synchro");
    const bien = await unBien("synchro");

    await synchroniserCompatibilitesPourAcquereur(dossier.id, WORKSPACE_TEST);
    expect((await etatDeLaPaire(bien.id, dossier.id))!.dernierStatut).toBe("compatible");

    await modifierChampProjetAcquereur(projet.id, "budgetMax", BUDGET_ABAISSE);
    await synchroniserCompatibilitesPourAcquereur(dossier.id, WORKSPACE_TEST);

    expect((await etatDeLaPaire(bien.id, dossier.id))!.dernierStatut).toBe("incompatible");
  });

  it("écrire un critère canonique DEMANDE le recalcul — jamais un statut périmé silencieux", async () => {
    const { projet, dossier } = await unAcquereurCanonique("invalidation");

    expect(await demandesEnAttentePour(dossier.id)).toHaveLength(0);

    await modifierChampProjetAcquereur(projet.id, "budgetMax", BUDGET_ABAISSE);

    const demandes = await demandesEnAttentePour(dossier.id);
    expect(demandes).toHaveLength(1);
    expect(demandes[0]!.workspaceId).toBe(WORKSPACE_TEST);
    expect(demandes[0]!.traiteeLe).toBeNull();
  });

  it("un projet que AUCUN dossier ne référence n'enfile rien à recalculer", async () => {
    // Rien à invalider n'est pas la même chose qu'invalider tout : une file qui grossit sans
    // consommateur finirait par masquer les vraies demandes.
    const contact = await creerContact({ nom: "[test réel] Boucle orphelin" }, WORKSPACE_TEST);
    contactsCrees.push(contact.id);
    const projet = await creerProjetAcquereur(
      { budgetMin: 100_000, budgetMax: BUDGET_INITIAL, criteres: [], stadeProjet: "decouverte" },
      WORKSPACE_TEST
    );
    projetsCrees.push(projet.id);

    const avant = await getDb().select().from(compatibilitesARessynchroniser);
    await modifierChampProjetAcquereur(projet.id, "budgetMax", BUDGET_ABAISSE);
    const apres = await getDb().select().from(compatibilitesARessynchroniser);

    expect(apres.length).toBe(avant.length);
  });
});

describe("boucle complète — une mutation Sync Engine change le matching (ADR-056 §9)", () => {
  it("reference_externe -> appliquerMutationExterne -> projet -> moteur", async () => {
    const { projet, dossier } = await unAcquereurCanonique("sync");
    const bien = await unBien("sync");

    // Le connecteur n'existe pas : seule sa DÉCLARATION de capacité est nécessaire, et ce lot n'en
    // fabrique aucun (ADR-056 invariant 9). L'identité externe est enregistrée par la primitive
    // existante — aucun rapprochement par email ou nom n'est possible ni tenté.
    await enregistrerReferenceExterne(
      {
        fournisseur: "connecteur_de_test",
        typeEntiteExterne: "buyer",
        idExterne: `test-reel-sync-${dossier.id}`,
        cible: { type: "projet_acquereur", id: projet.id },
      },
      WORKSPACE_TEST
    );

    expect((await critereBudget(dossier.id, bien.id)).statut).toBe("compatible");

    const resultat = await appliquerMutationExterne(
      {
        fournisseur: "connecteur_de_test",
        typeEntiteExterne: "buyer",
        idExterne: `test-reel-sync-${dossier.id}`,
        typeEntiteCanonique: "projet_acquereur",
        champ: "budgetMax",
        valeurExterne: BUDGET_ABAISSE,
      },
      {
        connecteur: { fournisseur: "connecteur_de_test", capacites: { projet_acquereur: "pull" } },
        sourceDeVerite: "externe",
      },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("appliquee");

    // Le dossier historique reste la source du workflow, et personne ne l'a mis à jour en douce.
    const [ligneLegacy] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, dossier.id));
    expect(ligneLegacy!.budgetMax).toBe(BUDGET_INITIAL);

    // Le recalcul est demandé, dans la transaction du Sync Engine.
    expect(await demandesEnAttentePour(dossier.id)).toHaveLength(1);

    // Et le verdict métier a effectivement changé.
    expect((await critereBudget(dossier.id, bien.id)).statut).toBe("incompatible");
  });
});
