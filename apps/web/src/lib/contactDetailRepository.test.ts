import { afterAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-058 — la fiche Contact : tout ce qu'une personne porte, par clés réelles uniquement. Les
// tests de doctrine : identité canonique jamais reprise du dossier, liens par id de dossier réel
// (jamais par id de projet), dossiers contact-only jamais perdus, interactions par contact_id exact.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  contacts: contactsTable,
  interactions: interactionsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerProjetVendeur } = await import("@/lib/projetVendeurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { creerInteraction } = await import("@/lib/interactionRepository");
const { chargerContactDetail, LIMITE_INTERACTIONS_RECENTES } = await import("@/lib/contactDetailRepository");

const M = `Zdetail${Date.now()}`;

const idsContacts: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0)
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsContacts.length > 0) {
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsProjetsA.length > 0)
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  if (idsProjetsV.length > 0)
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjetsV));
  if (idsWorkspaces.length > 0)
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(surcharge: Record<string, unknown> = {}, workspace = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge } as never, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function unProjetAcquereur(contactId: string, stade: "decouverte" | "offre" = "decouverte") {
  const projet = await creerProjetAcquereur(
    { budgetMin: 200_000, budgetMax: 500_000, criteres: ["balcon"], stadeProjet: stade },
    WORKSPACE_TEST
  );
  idsProjetsA.push(projet.id);
  await ajouterPartieProjet({ contactId, projetAcquereurId: projet.id, role: "acquereur" });
  return projet;
}

async function unProjetVendeur(contactId: string) {
  const projet = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
  idsProjetsV.push(projet.id);
  await ajouterPartieProjet({ contactId, projetVendeurId: projet.id, role: "vendeur" });
  return projet;
}

async function unDossierAcquereur(
  surcharge: { nom?: string; contactId?: string; projetAcquereurId?: string },
  workspace = WORKSPACE_TEST
) {
  const dossier = await creerAcquereur(
    {
      prenom: "Ancien",
      nom: `${M} Dossier`,
      email: `${M}.dossier@example.test`,
      telephone: "0600000000",
      budgetMin: 100_000,
      budgetMax: 400_000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
      ...surcharge,
    },
    workspace
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function unDossierVendeur(
  surcharge: { nom?: string; contactId?: string; projetVendeurId?: string; ville?: string },
  workspace = WORKSPACE_TEST
) {
  const prospect = await creerProspectVendeur(
    {
      nom: `${M} Prospect`,
      prenom: undefined,
      email: undefined,
      telephone: undefined,
      origineLead: undefined,
      origineLeadDetail: undefined,
      adresseBienPotentiel: undefined,
      secteurBienPotentiel: undefined,
      ville: undefined,
      codePostal: undefined,
      typeBien: undefined,
      ...surcharge,
    },
    workspace
  );
  idsProspects.push(prospect.id);
  return prospect;
}

describe("chargerContactDetail — accès", () => {
  it("A. un Contact simple : identité, aucun rôle, aucune section", async () => {
    const contact = await unContact({ nom: `${M} Simple`, prenom: "Léa", email: `${M}.simple@example.test` });

    const detail = await chargerContactDetail(contact.id, WORKSPACE_TEST);

    expect(detail).toBeDefined();
    expect(detail!.contact).toMatchObject({ id: contact.id, nom: `${M} Simple`, prenom: "Léa" });
    expect(detail!.roles).toEqual([]);
    expect(detail!.projetsAcquereur).toEqual([]);
    expect(detail!.projetsVendeur).toEqual([]);
    expect(detail!.dossiersAcquereurContactOnly).toEqual([]);
    expect(detail!.dossiersVendeurContactOnly).toEqual([]);
    expect(detail!.interactionsRecentes).toEqual([]);
  });

  it("B. un Contact d'un autre workspace est introuvable, pas interdit", async () => {
    const autre = `test-detail-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre detail" });
    idsWorkspaces.push(autre);
    const ailleurs = await unContact({ nom: `${M} Ailleurs` }, autre);

    expect(await chargerContactDetail(ailleurs.id, WORKSPACE_TEST)).toBeUndefined();
    expect(await chargerContactDetail(ailleurs.id, autre)).toBeDefined();
  });

  it("C. un Contact absent ou un id non UUID : undefined, jamais une erreur", async () => {
    expect(await chargerContactDetail("00000000-0000-4000-8000-000000000000", WORKSPACE_TEST)).toBeUndefined();
    expect(await chargerContactDetail("pas-un-uuid", WORKSPACE_TEST)).toBeUndefined();
  });
});

describe("chargerContactDetail — rôles, projets et dossiers", () => {
  it("D. multi-rôle : deux rôles, un projet de chaque", async () => {
    const contact = await unContact({ nom: `${M} Multirole` });
    await unProjetAcquereur(contact.id);
    await unProjetVendeur(contact.id);

    const detail = (await chargerContactDetail(contact.id, WORKSPACE_TEST))!;

    expect(detail.roles).toEqual(["acquereur", "vendeur"]);
    expect(detail.projetsAcquereur).toHaveLength(1);
    expect(detail.projetsVendeur).toHaveLength(1);
    expect(detail.projetsVendeur[0]!.statut).toBe("prospect");
  });

  it("E. multi-projets : 2 projets acquéreur + 2 projets vendeur, tous rendus", async () => {
    const contact = await unContact({ nom: `${M} Multiprojets` });
    const a1 = await unProjetAcquereur(contact.id, "decouverte");
    const a2 = await unProjetAcquereur(contact.id, "offre");
    const v1 = await unProjetVendeur(contact.id);
    const v2 = await unProjetVendeur(contact.id);

    const detail = (await chargerContactDetail(contact.id, WORKSPACE_TEST))!;

    expect(detail.projetsAcquereur.map((p) => p.projetId).sort()).toEqual([a1.id, a2.id].sort());
    expect(detail.projetsVendeur.map((p) => p.projetId).sort()).toEqual([v1.id, v2.id].sort());
    expect(detail.projetsAcquereur.map((p) => p.stade).sort()).toEqual(["decouverte", "offre"]);
  });

  it("F. le dossier acquéreur qui décrit un projet est porté par ce projet, avec l'id de DOSSIER — jamais l'id de projet", async () => {
    const contact = await unContact({ nom: `${M} Pontacq` });
    const projet = await unProjetAcquereur(contact.id);
    const dossier = await unDossierAcquereur({ contactId: contact.id, projetAcquereurId: projet.id });

    const detail = (await chargerContactDetail(contact.id, WORKSPACE_TEST))!;

    expect(dossier.id).not.toBe(projet.id);
    expect(detail.projetsAcquereur[0]).toMatchObject({ projetId: projet.id, acquereurId: dossier.id });
    // Pas de doublon visuel : le dossier ponté n'est pas aussi listé en contact-only.
    expect(detail.dossiersAcquereurContactOnly).toEqual([]);
  });

  it("G. le dossier vendeur qui décrit un projet est porté par ce projet, avec l'id de DOSSIER et sa localisation", async () => {
    const contact = await unContact({ nom: `${M} Pontvend` });
    const projet = await unProjetVendeur(contact.id);
    const prospect = await unDossierVendeur({ contactId: contact.id, projetVendeurId: projet.id, ville: "Houilles" });

    const detail = (await chargerContactDetail(contact.id, WORKSPACE_TEST))!;

    expect(prospect.id).not.toBe(projet.id);
    expect(detail.projetsVendeur[0]).toMatchObject({
      projetId: projet.id,
      prospectVendeurId: prospect.id,
      localisation: "Houilles",
    });
    expect(detail.dossiersVendeurContactOnly).toEqual([]);
  });

  it("H. un dossier acquéreur rattaché SANS projet canonique n'est pas perdu : contact-only", async () => {
    const contact = await unContact({ nom: `${M} Contactonlyacq` });
    const dossier = await unDossierAcquereur({ contactId: contact.id });

    const detail = (await chargerContactDetail(contact.id, WORKSPACE_TEST))!;

    expect(detail.roles).toEqual([]);
    expect(detail.projetsAcquereur).toEqual([]);
    expect(detail.dossiersAcquereurContactOnly).toEqual([
      { acquereurId: dossier.id, stade: "recherche_active", budgetMin: 100_000, budgetMax: 400_000 },
    ]);
  });

  it("I. un dossier vendeur rattaché SANS projet canonique n'est pas perdu : contact-only", async () => {
    const contact = await unContact({ nom: `${M} Contactonlyvend` });
    const prospect = await unDossierVendeur({ contactId: contact.id, ville: "Sartrouville" });

    const detail = (await chargerContactDetail(contact.id, WORKSPACE_TEST))!;

    expect(detail.projetsVendeur).toEqual([]);
    expect(detail.dossiersVendeurContactOnly).toEqual([
      { prospectVendeurId: prospect.id, statut: "prospect", localisation: "Sartrouville" },
    ]);
  });

  it("un dossier non rattaché d'un autre contact n'entre jamais dans la fiche", async () => {
    const contact = await unContact({ nom: `${M} Etranger`, email: `${M}.etranger@example.test` });
    // Même nom, même email — aucune clé réelle vers ce contact.
    await unDossierAcquereur({ nom: `${M} Etranger` });

    const detail = (await chargerContactDetail(contact.id, WORKSPACE_TEST))!;

    expect(detail.dossiersAcquereurContactOnly).toEqual([]);
    expect(detail.projetsAcquereur).toEqual([]);
  });

  it("J. l'identité affichée est celle du Contact, jamais celle du dossier rattaché", async () => {
    const contact = await unContact({ nom: `${M} Nouveau Nom`, prenom: "Jeanne" });
    await unDossierAcquereur({ nom: `${M} Ancien Nom`, contactId: contact.id });

    const detail = (await chargerContactDetail(contact.id, WORKSPACE_TEST))!;

    expect(detail.contact.nom).toBe(`${M} Nouveau Nom`);
    expect(detail.contact.prenom).toBe("Jeanne");
    expect(JSON.stringify(detail)).not.toContain("Ancien Nom");
  });
});

describe("chargerContactDetail — interactions", () => {
  it("K/M/N. les N dernières interactions, du plus récent au plus ancien, avec leur contexte", async () => {
    const contact = await unContact({ nom: `${M} Interactions` });
    const projet = await unProjetAcquereur(contact.id);
    const total = LIMITE_INTERACTIONS_RECENTES + 2;
    for (let i = 0; i < total; i += 1) {
      const base = {
        contactId: contact.id,
        type: i % 2 === 0 ? ("appel" as const) : ("email" as const),
        sens: "sortant" as const,
        survenuLe: new Date(Date.UTC(2026, 0, 1 + i, 10)).toISOString(),
      };
      await creerInteraction(i === total - 1 ? { ...base, projetAcquereurId: projet.id } : base);
    }

    const detail = (await chargerContactDetail(contact.id, WORKSPACE_TEST))!;
    const dates = detail.interactionsRecentes.map((i) => i.survenuLe);

    expect(detail.interactionsRecentes).toHaveLength(LIMITE_INTERACTIONS_RECENTES);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates[0]).toBe(new Date(Date.UTC(2026, 0, total, 10)).toISOString());
    expect(detail.interactionsRecentes[0]).toMatchObject({ type: "email", sens: "sortant", contexte: "projet_acquereur" });
    expect(detail.interactionsRecentes[1]!.contexte).toBeUndefined();
    expect(detail.interactionsRecentes[0]).not.toHaveProperty("contenu");
  });

  it("L. les interactions d'un autre Contact ne sont jamais rendues, même identité identique", async () => {
    const email = `${M}.jumeau@example.test`;
    const a = await unContact({ nom: `${M} Jumeau`, email });
    const b = await unContact({ nom: `${M} Jumeau`, email });
    await creerInteraction({ contactId: b.id, type: "note", sens: "interne", survenuLe: "2026-05-01T10:00:00.000Z" });

    const detail = (await chargerContactDetail(a.id, WORKSPACE_TEST))!;

    expect(detail.interactionsRecentes).toEqual([]);
  });
});

describe("chargerContactDetail — nombre de requêtes fixe", () => {
  it("O. cinq requêtes, que le contact ait un projet ou six", async () => {
    const peu = await unContact({ nom: `${M} Peu` });
    await unProjetAcquereur(peu.id);

    const beaucoup = await unContact({ nom: `${M} Beaucoup` });
    for (let i = 0; i < 3; i += 1) {
      const projet = await unProjetAcquereur(beaucoup.id);
      await unDossierAcquereur({ contactId: beaucoup.id, projetAcquereurId: projet.id });
    }
    for (let i = 0; i < 3; i += 1) await unProjetVendeur(beaucoup.id);
    await unDossierVendeur({ contactId: beaucoup.id });
    for (let i = 0; i < 4; i += 1) {
      await creerInteraction({ contactId: beaucoup.id, type: "appel", sens: "entrant", survenuLe: `2026-03-0${i + 1}T10:00:00.000Z` });
    }

    const compter = async (contactId: string) => {
      const db = getDb();
      const espion = vi.spyOn(db, "select");
      await chargerContactDetail(contactId, WORKSPACE_TEST, db);
      const n = espion.mock.calls.length;
      espion.mockRestore();
      return n;
    };

    expect(await compter(peu.id)).toBe(5);
    expect(await compter(beaucoup.id)).toBe(5);
  });
});
