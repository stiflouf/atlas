import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { ETAT_FORMULAIRE_INITIAL } from "@/lib/formulaires/etatFormulaire";

// ADR-055 §B — COEXISTENCE côté vendeur : une création réelle alimente le modèle canonique complet
// (personne, projet de vente, participation) sans que rien du comportement historique ne change.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetVendeur, getProjetVendeurById } = await import("@/lib/projetVendeurRepository");
const { ajouterPartieProjet, listerPartiesDuProjetVendeur } = await import("@/lib/partieProjetRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { creerProspectVendeurAction } = await import("./prospectVendeur");

const MARQUEUR = "[test réel] PROJET-VENDEUR-COEXISTENCE";

afterAll(async () => {
  await getDb().delete(prospectsVendeursTable).where(like(prospectsVendeursTable.nom, `%${MARQUEUR}%`));

  // Nettoyage depuis les CONTACTS, comme côté acquéreur : un prospect déjà supprimé laisserait
  // sinon des parties orphelines qui bloquent la suppression des contacts (FK parties -> contacts).
  const contactsMarques = await getDb()
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(like(contactsTable.nom, `%${MARQUEUR}%`));
  const idsContacts = contactsMarques.map((contact) => contact.id);
  if (idsContacts.length > 0) {
    const parties = await getDb()
      .select({ projetVendeurId: partiesProjetTable.projetVendeurId })
      .from(partiesProjetTable)
      .where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    const idsProjets = parties.map((partie) => partie.projetVendeurId).filter((id): id is string => id !== null);
    if (idsProjets.length > 0) {
      await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, [...new Set(idsProjets)]));
    }
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

function formulaire(nom: string): FormData {
  const formData = new FormData();
  formData.set("nom", nom);
  formData.set("prenom", "Dominique");
  formData.set("email", "vendeur.coexistence@example.test");
  formData.set("telephone", "0633333333");
  formData.set("origineLead", "recommandation");
  formData.set("origineLeadDetail", "Ancien client");
  formData.set("ville", "Lyon");
  formData.set("typeBien", "maison");
  return formData;
}

describe("ADR-055 §B — une création prospect vendeur alimente le modèle canonique complet", () => {
  it("crée Contact + SellerProject + partie vendeur + ligne historique, tous reliés", async () => {
    const nom = `${MARQUEUR} NOMINAL`;
    await creerProspectVendeurAction(ETAT_FORMULAIRE_INITIAL, formulaire(nom)).catch(() => {}); // redirect() attendu

    // 1. Comportement historique intact : l'opportunité existe avec exactement les champs soumis.
    const [prospect] = await getDb()
      .select()
      .from(prospectsVendeursTable)
      .where(eq(prospectsVendeursTable.nom, nom));
    expect(prospect).toBeDefined();
    expect(prospect.prenom).toBe("Dominique");
    expect(prospect.origineLead).toBe("recommandation");
    // La description du bien reste sur le modèle historique : elle n'est PAS montée sur le projet.
    expect(prospect.ville).toBe("Lyon");
    expect(prospect.typeBien).toBe("maison");

    // 2. Les deux ponts sont posés.
    expect(prospect.contactId).not.toBeNull();
    expect(prospect.projetVendeurId).not.toBeNull();

    // 3. Le projet canonique porte le parcours, et RIEN de l'identité ni du bien.
    const projet = await getProjetVendeurById(prospect.projetVendeurId!);
    expect(projet).toBeDefined();
    expect(projet!.origineLead).toBe("recommandation");
    expect(projet!.origineLeadDetail).toBe("Ancien client");
    expect(projet).not.toHaveProperty("nom");
    expect(projet).not.toHaveProperty("ville");
    // Aucun jalon posé à la création : le statut dérivé reste "prospect".
    expect(projet!.qualifieLe).toBeUndefined();

    // 4. Le rôle est porté par la participation, jamais par la personne.
    const parties = await listerPartiesDuProjetVendeur(projet!.id);
    expect(parties).toHaveLength(1);
    expect(parties[0].contactId).toBe(prospect.contactId);
    expect(parties[0].role).toBe("vendeur");
    expect(parties[0].projetAcquereurId).toBeUndefined();
  });

  it("les lignes historiques antérieures restent non rattachées : aucun backfill", async () => {
    const nom = `${MARQUEUR} HISTORIQUE`;
    const prospect = await creerProspectVendeur({ nom }, WORKSPACE_TEST);

    const [ligne] = await getDb()
      .select()
      .from(prospectsVendeursTable)
      .where(eq(prospectsVendeursTable.id, prospect.id));
    expect(ligne.contactId).toBeNull();
    expect(ligne.projetVendeurId).toBeNull();
  });

  it("un échec en fin de transaction ne laisse ni contact, ni projet, ni partie orphelins", async () => {
    // Panne RÉELLE, provoquée par Postgres et non par un mock : la dernière écriture vise un
    // workspace inexistant, la FK `prospects_vendeurs.workspace_id -> workspaces` la rejette. Les
    // trois écritures canoniques ont déjà eu lieu dans la transaction à ce moment-là.
    //
    // Ce scénario est joué sur les repositories plutôt que sur la Server Action parce que TOUS les
    // champs saisissables du formulaire vendeur sont validés avant d'atteindre Postgres
    // (`parseProspectVendeurFormData` vérifie origineLead et typeBien) : aucune donnée d'entrée ne
    // peut y déclencher une panne base. C'est une bonne propriété du parsing, pas un trou de test —
    // la séquence exécutée ici est exactement celle de `creerProspectVendeurAction`.
    const nom = `${MARQUEUR} ROLLBACK`;

    await expect(
      getDb().transaction(async (tx) => {
        const contact = await creerContact({ nom }, WORKSPACE_TEST, tx);
        const projet = await creerProjetVendeur({ origineLead: "panneau" }, WORKSPACE_TEST, tx);
        await ajouterPartieProjet({ contactId: contact.id, projetVendeurId: projet.id, role: "vendeur" }, tx);
        return creerProspectVendeur({ nom, contactId: contact.id, projetVendeurId: projet.id }, "workspace-inexistant", tx);
      })
    ).rejects.toThrow();

    expect(await getDb().select().from(contactsTable).where(eq(contactsTable.nom, nom))).toEqual([]);
    expect(await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.nom, nom))).toEqual([]);

    // Aucune partie ne subsiste : sans elle, un projet rescapé serait une vente sans vendeur.
    const partiesRestantes = await getDb()
      .select()
      .from(partiesProjetTable)
      .innerJoin(contactsTable, eq(partiesProjetTable.contactId, contactsTable.id))
      .where(eq(contactsTable.nom, nom));
    expect(partiesRestantes).toEqual([]);
  });
});
