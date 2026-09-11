import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-057 — un prénom INCONNU reste inconnu. `contacts.prenom` est nullable, et « Dupont » sans
// prénom est un état normal (ADR-055 §A : `nom` est le seul champ que les deux modèles
// garantissent). La projection le traduisait en chaîne vide — une absence déguisée en valeur, la
// même altération de sens qu'un repli champ par champ, mais plus discrète.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable, contacts: contactsTable } = await import("@/db/schema");
const { creerAcquereur, getClientById, listerClients } = await import("@/lib/clientRepository");
const { creerContact } = await import("@/lib/contactRepository");
const { nomComplet, initialesPersonne } = await import("@/lib/identite/nomPersonne");

const idsAcquereurs: string[] = [];
const idsContacts: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) {
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  }
  if (idsContacts.length > 0) {
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

async function unDossier(suffixe: string, contactId?: string) {
  const dossier = await creerAcquereur(
    {
      prenom: "PrenomLegacy",
      nom: `[test réel] Nullable ${suffixe}`,
      email: "legacy@example.test",
      telephone: "0600000000",
      budgetMin: 100_000,
      budgetMax: 400_000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
      contactId,
    },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

describe("ADR-057 — un prénom canonique absent le reste", () => {
  it("A. Contact sans prénom -> le profil effectif n'en a pas", async () => {
    const contact = await creerContact({ nom: "Dupont" }, WORKSPACE_TEST);
    idsContacts.push(contact.id);
    const dossier = await unDossier("sans-prenom", contact.id);

    const relu = await getClientById(dossier.id);

    expect(relu?.nom).toBe("Dupont");
    expect(relu?.prenom).toBeUndefined();
    // Surtout pas la chaîne vide : une absence n'est pas une valeur.
    expect(relu?.prenom).not.toBe("");
  });

  it("B. dossier historique sans Contact : comportement inchangé", async () => {
    const dossier = await unDossier("historique");
    const relu = await getClientById(dossier.id);
    expect(relu?.prenom).toBe("PrenomLegacy");
  });

  it("C. Contact sans prénom ALORS QUE le dossier en a un : aucun repli", async () => {
    // Le cœur de la règle d'agrégat, appliqué au dernier champ qui y échappait.
    const contact = await creerContact({ nom: "Dupont", email: "canonique@example.test" }, WORKSPACE_TEST);
    idsContacts.push(contact.id);
    const dossier = await unDossier("sans-repli", contact.id);

    const relu = await getClientById(dossier.id);

    expect(relu?.prenom).toBeUndefined();
    // Le dossier porte bien encore son prénom — le test ne passe pas par accident.
    const [ligne] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, dossier.id));
    expect(ligne!.prenom).toBe("PrenomLegacy");
  });

  it("les listes servent la même absence que la fiche", async () => {
    const contact = await creerContact({ nom: "Dupont" }, WORKSPACE_TEST);
    idsContacts.push(contact.id);
    const dossier = await unDossier("liste", contact.id);

    const dansLaListe = (await listerClients()).find((c) => c.id === dossier.id);
    expect(dansLaListe?.prenom).toBeUndefined();
  });
});

describe("ADR-057 — affichage d'une personne sans prénom", () => {
  it("D. le nom seul, jamais « undefined Dupont » ni un espace en tête", () => {
    expect(nomComplet({ nom: "Dupont" })).toBe("Dupont");
    expect(nomComplet({ nom: "Dupont", prenom: undefined })).toBe("Dupont");
    expect(nomComplet({ nom: "Dupont", prenom: "Jeanne" })).toBe("Jeanne Dupont");
    for (const rendu of [nomComplet({ nom: "Dupont" }), nomComplet({ nom: "Dupont", prenom: undefined })]) {
      expect(rendu).not.toMatch(/undefined|null/);
      expect(rendu.startsWith(" ")).toBe(false);
    }
  });

  it("les initiales tombent à une seule lettre plutôt qu'à un trou", () => {
    expect(initialesPersonne({ nom: "Dupont" })).toBe("D");
    expect(initialesPersonne({ nom: "Dupont", prenom: "Jeanne" })).toBe("JD");
  });
});
