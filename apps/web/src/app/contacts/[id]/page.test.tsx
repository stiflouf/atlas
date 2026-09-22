import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-054 — périmètre résolu depuis la session (mock modifiable par test pour l'isolation).
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));

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
const FicheContact = (await import("./page")).default;

// ADR-058 — la fiche RENDUE : identité canonique, rôles, projets, dossiers pontés par id réel,
// dossiers contact-only jamais perdus, interactions du contact seul.
const M = `Zfiche${Date.now()}`;

const idsContacts: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsWorkspaces: string[] = [];

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

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

async function unProjetAcquereur(contactId: string) {
  const projet = await creerProjetAcquereur(
    { budgetMin: 300_000, budgetMax: 450_000, criteres: ["balcon", "ascenseur"], stadeProjet: "recherche_active" },
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

async function unDossierAcquereur(surcharge: { nom?: string; contactId?: string; projetAcquereurId?: string }) {
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
    WORKSPACE_TEST
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function unDossierVendeur(surcharge: { contactId?: string; projetVendeurId?: string; ville?: string }) {
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
    WORKSPACE_TEST
  );
  idsProspects.push(prospect.id);
  return prospect;
}

async function rendre(id: string): Promise<string> {
  return renderToStaticMarkup(await FicheContact({ params: Promise.resolve({ id }) }));
}

function section(html: string, titre: string): string | undefined {
  const m = html.match(new RegExp(`<h2[^>]*>${titre}</h2>[\\s\\S]*?(?=<h2|$)`));
  return m?.[0];
}

describe("/contacts/[id] — identité et accès", () => {
  it("rend le header : nom complet canonique, coordonnées, retour vers Contacts", async () => {
    const contact = await unContact({
      nom: `${M} Dupont`,
      prenom: "Jean",
      email: `${M}.jean@example.test`,
      telephone: "0611223344",
    });

    const html = await rendre(contact.id);

    expect(html).toMatch(new RegExp(`<h1[^>]*>Jean ${M} Dupont</h1>`));
    expect(html).toContain(`href="mailto:${M}.jean@example.test"`);
    expect(html).toContain('href="tel:0611223344"');
    expect(html).toContain('href="/contacts"');
    // Le script de relecture de formulaire injecté par React (`null!=f`) n'est pas du contenu.
    expect(html.replace(/<script>[\s\S]*?<\/script>/g, "")).not.toMatch(/undefined|null/);
  });

  it("un Contact sans projet a une fiche valide : identité, aucun rôle, aucune section projet", async () => {
    const contact = await unContact({ nom: `${M} Sansprojet` });

    const html = await rendre(contact.id);

    expect(html).toContain(`${M} Sansprojet`);
    expect(html).not.toContain(">Acquéreur<");
    expect(html).not.toContain(">Vendeur<");
    expect(html).not.toContain("Projets acquéreur");
    expect(html).not.toContain("Projets vendeur");
    expect(html).not.toContain("Dossiers rattachés");
    expect(html).toContain("Aucune coordonnée enregistrée");
  });

  it("l'identité est celle du Contact, jamais celle du dossier rattaché", async () => {
    const contact = await unContact({ nom: `${M} Nouveau Nom` });
    await unDossierAcquereur({ nom: `${M} Ancien Nom`, contactId: contact.id });

    const html = await rendre(contact.id);

    expect(html).toContain(`${M} Nouveau Nom`);
    expect(html).not.toContain("Ancien Nom");
  });

  it("id inconnu : notFound()", async () => {
    await expect(rendre("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(rendre("pas-un-uuid")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("id d'un autre workspace : notFound(), indistinguable d'un id inconnu", async () => {
    const autre = `test-fiche-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre fiche" });
    idsWorkspaces.push(autre);
    const ailleurs = await unContact({ nom: `${M} Ailleurs` }, autre);

    await expect(rendre(ailleurs.id)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);

    workspaceCourantMock.mockResolvedValueOnce(autre);
    expect(await rendre(ailleurs.id)).toContain(`${M} Ailleurs`);
  });
});

describe("/contacts/[id] — rôles, projets et dossiers", () => {
  it("multi-rôle : deux badges, une section par rôle, budget et statut réels", async () => {
    const contact = await unContact({ nom: `${M} Multirole` });
    await unProjetAcquereur(contact.id);
    await unProjetVendeur(contact.id);

    const html = await rendre(contact.id);

    expect(html).toContain(">Acquéreur<");
    expect(html).toContain(">Vendeur<");
    const acq = section(html, "Projets acquéreur")!;
    expect(acq).toContain("300");
    expect(acq).toContain("Recherche active");
    expect(acq).toContain("balcon · ascenseur");
    expect(section(html, "Projets vendeur")).toContain("Prospect");
  });

  it("multi-projets : 2 + 2 projets rendus, sans lien tant qu'aucun dossier ne les décrit", async () => {
    const contact = await unContact({ nom: `${M} Multiprojets` });
    await unProjetAcquereur(contact.id);
    await unProjetAcquereur(contact.id);
    await unProjetVendeur(contact.id);
    await unProjetVendeur(contact.id);

    const html = await rendre(contact.id);

    expect(section(html, "Projets acquéreur")!.match(/Recherche active/g)).toHaveLength(2);
    expect(section(html, "Projets vendeur")!.match(/>Prospect</g)).toHaveLength(2);
    expect(html).not.toMatch(/href="\/clients\//);
    expect(html).not.toMatch(/href="\/prospects-vendeurs\//);
  });

  it("le lien d'un projet acquéreur utilise l'id du DOSSIER, jamais l'id du projet", async () => {
    const contact = await unContact({ nom: `${M} Pontacq` });
    const projet = await unProjetAcquereur(contact.id);
    const dossier = await unDossierAcquereur({ contactId: contact.id, projetAcquereurId: projet.id });

    const html = await rendre(contact.id);

    expect(html).toContain(`href="/clients/${dossier.id}"`);
    expect(html).not.toContain(`/clients/${projet.id}`);
    expect(html).not.toContain("Dossiers rattachés");
    expect(html).toContain("Ouvrir le dossier acquéreur");
  });

  it("le lien d'un projet vendeur utilise l'id du DOSSIER, avec sa localisation", async () => {
    const contact = await unContact({ nom: `${M} Pontvend` });
    const projet = await unProjetVendeur(contact.id);
    const prospect = await unDossierVendeur({ contactId: contact.id, projetVendeurId: projet.id, ville: "Houilles" });

    const html = await rendre(contact.id);

    expect(html).toContain(`href="/prospects-vendeurs/${prospect.id}"`);
    expect(html).not.toContain(`/prospects-vendeurs/${projet.id}`);
    expect(section(html, "Projets vendeur")).toContain("Houilles");
    expect(html).not.toContain("Dossiers rattachés");
  });

  it("les dossiers rattachés sans projet canonique apparaissent dans « Dossiers rattachés », avec leurs liens", async () => {
    const contact = await unContact({ nom: `${M} Contactonly` });
    const dossier = await unDossierAcquereur({ contactId: contact.id });
    const prospect = await unDossierVendeur({ contactId: contact.id, ville: "Sartrouville" });

    const html = await rendre(contact.id);
    const rattaches = section(html, "Dossiers rattachés")!;

    expect(rattaches).toContain(`href="/clients/${dossier.id}"`);
    expect(rattaches).toContain(`href="/prospects-vendeurs/${prospect.id}"`);
    expect(rattaches).toContain("Sartrouville");
    expect(html).not.toContain("Projets acquéreur");
    expect(html).not.toContain("Projets vendeur");
  });
});

// CRM_TIMELINE_V1 — « Dernières interactions » est devenu « Historique » (read model
// listerTimelineContact) : contenu affiché, libellé humain type + sens, contexte cliquable.
describe("/contacts/[id] — historique", () => {
  it("aucun échange : état vide « Aucun échange enregistré » + formulaire « Noter un échange » ouvert", async () => {
    const contact = await unContact({ nom: `${M} Silence` });
    const html = await rendre(contact.id);
    const bloc = section(html, "Historique")!;
    expect(bloc).toContain("Aucun échange enregistré");
    expect(bloc).toContain('<details id="noter-echange" open=""');
    expect(bloc).toContain("+ Noter un échange");
    expect(bloc).toContain('name="echange"');
    expect(bloc).toContain('type="datetime-local"');
    expect(bloc).toContain('name="contenu"');
    // Sans projet ni bien relié : aucun sélecteur de contexte.
    expect(bloc).not.toContain('name="contexte"');
  });

  it("plusieurs interactions : type, sens, contexte et date, du plus récent au plus ancien, celles du contact seul", async () => {
    const contact = await unContact({ nom: `${M} Bavard` });
    const autre = await unContact({ nom: `${M} Autre` });
    const projet = await unProjetAcquereur(contact.id);
    const dossier = await unDossierAcquereur({ contactId: contact.id, projetAcquereurId: projet.id });
    await creerInteraction({ contactId: contact.id, type: "appel", sens: "entrant", survenuLe: "2026-02-01T10:00:00.000Z", contenu: "Rappelle jeudi" });
    await creerInteraction({
      contactId: contact.id,
      type: "email",
      sens: "sortant",
      survenuLe: "2026-06-15T10:00:00.000Z",
      projetAcquereurId: projet.id,
    });
    await creerInteraction({ contactId: autre.id, type: "note", sens: "interne", survenuLe: "2026-07-01T10:00:00.000Z", contenu: "Secret de l'autre" });

    const html = await rendre(contact.id);
    const bloc = section(html, "Historique")!;

    expect(bloc.indexOf("15 juin 2026")).toBeLessThan(bloc.indexOf("1 février 2026"));
    expect(bloc).toContain(">Email envoyé<");
    expect(bloc).toContain(">Appel entrant<");
    expect(bloc).toContain("Rappelle jeudi");
    expect(bloc).toContain(`href="/clients/${dossier.id}"`);
    expect(bloc).toContain(">Projet acquéreur<");
    // « Note interne » n'apparaît que comme option du formulaire, jamais comme item (note d'un autre contact).
    expect(bloc.replace(/<option[^>]*>[^<]*<\/option>/g, "")).not.toContain("Note interne");
    expect(bloc).not.toContain("Secret de l'autre");
    expect(bloc).not.toContain("1 juillet 2026");
    expect(bloc).not.toContain("Aucun échange enregistré");
    // Le sélecteur de contexte propose le projet réellement relié.
    expect(bloc).toContain(`value="projetAcquereur:${projet.id}"`);
  });
});
