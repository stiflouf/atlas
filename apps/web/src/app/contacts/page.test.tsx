import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-054 — le périmètre est résolu depuis la session, pas testé ici (workspaceCourant.test.ts).
// `mockResolvedValue` reste modifiable par test : c'est ce qui permet de vérifier l'isolation.
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  interactions: interactionsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerProjetVendeur } = await import("@/lib/projetVendeurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { creerInteraction } = await import("@/lib/interactionRepository");
const ContactsPage = (await import("./page")).default;

// ADR-058 — la PAGE rend ce que le read model livre : une carte par personne, deux cartes pour
// deux personnes, quelle que soit la ressemblance de leurs coordonnées. Le marqueur isole les
// contacts de ce fichier dans une base partagée par toute la suite.
const M = `Zpage${Date.now()}`;

const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsWorkspaces: string[] = [];

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

afterAll(async () => {
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

async function unContact(surcharge: Record<string, unknown>, workspace = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge } as never, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function unProjetAcquereur(contactId: string) {
  const projet = await creerProjetAcquereur(
    { budgetMin: 300_000, budgetMax: 450_000, criteres: [], stadeProjet: "recherche_active" },
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

async function rendre(params: { q?: string; page?: string } = {}): Promise<string> {
  return renderToStaticMarkup(await ContactsPage({ searchParams: Promise.resolve(params) }));
}

function cartes(html: string): string[] {
  return [...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map((m) => m[0]);
}

function cartesContenant(html: string, texte: string): string[] {
  return cartes(html).filter((carte) => carte.includes(texte));
}

function liensPagination(html: string): string[] {
  const nav = html.match(/<nav aria-label="Pagination"[\s\S]*?<\/nav>/)?.[0] ?? "";
  return [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

describe("/contacts — recherche et requête vide", () => {
  it("A. q vide rend les contacts récents du workspace", async () => {
    const recent = await unContact({ nom: `${M} Recent` });
    const html = await rendre();

    expect(html).toContain("Contacts récents");
    expect(html).toContain(`${M} Recent`);
    expect(html).not.toContain("Aucun contact");
    expect(recent.id).toBeTruthy();
  });

  it("B. un nom recherché rend le résultat, et le titre contextuel", async () => {
    await unContact({ nom: `${M} Trouve`, prenom: "Jeanne" });
    await unContact({ nom: `${M} Autre` });

    const html = await rendre({ q: `${M} Trouve` });

    expect(html).toContain(`Résultats pour « ${M} Trouve »`);
    expect(html).toContain(`Jeanne ${M} Trouve`);
    expect(html).not.toContain(`${M} Autre`);
  });

  it("la recherche par email et par téléphone rend la personne", async () => {
    const email = `${M}.mail@example.test`;
    const telephone = `07${M.length}112233`;
    await unContact({ nom: `${M} Coordonnees`, email, telephone });

    expect(await rendre({ q: email })).toContain(`${M} Coordonnees`);
    expect(await rendre({ q: telephone })).toContain(`${M} Coordonnees`);
  });

  it("I. aucun résultat rend l'état vide de recherche, jamais une liste silencieuse", async () => {
    const html = await rendre({ q: `${M} zzz-introuvable` });

    expect(html).toContain("Aucun contact trouvé.");
    expect(cartes(html)).toHaveLength(0);
  });
});

describe("/contacts — une carte par personne", () => {
  it("C. un contact acquéreur ET vendeur donne UNE carte portant les deux rôles", async () => {
    const contact = await unContact({ nom: `${M} Multirole` });
    await unProjetAcquereur(contact.id);
    await unProjetVendeur(contact.id);

    const html = await rendre({ q: `${M} Multirole` });
    const [carte, ...autres] = cartesContenant(html, `${M} Multirole`);

    expect(autres).toHaveLength(0);
    expect(carte).toContain(">Acquéreur<");
    expect(carte).toContain(">Vendeur<");
    expect(carte).toContain("300");
    expect(carte).toContain("Recherche active");
    expect(carte).toContain("Prospect");
  });

  it("D. DEUX contacts au même email donnent DEUX cartes, sans fusion ni regroupement", async () => {
    const partage = `${M}.shared@example.test`;
    await unContact({ nom: `${M} Couple A`, email: partage });
    await unContact({ nom: `${M} Couple B`, email: partage });

    const html = await rendre({ q: partage });

    expect(cartesContenant(html, partage)).toHaveLength(2);
    expect(html).toContain(`${M} Couple A`);
    expect(html).toContain(`${M} Couple B`);
    expect(html).not.toMatch(/fusionn|profils/i);
  });

  it("E. DEUX contacts au même téléphone donnent DEUX cartes", async () => {
    const partage = `06${M.length}445566`;
    await unContact({ nom: `${M} Famille A`, telephone: partage });
    await unContact({ nom: `${M} Famille B`, telephone: partage });

    const html = await rendre({ q: partage });

    expect(cartesContenant(html, partage)).toHaveLength(2);
  });

  it("F. un contact sans projet est rendu, sans rôle ni ligne de projet", async () => {
    await unContact({ nom: `${M} Sansprojet` });

    const html = await rendre({ q: `${M} Sansprojet` });
    const [carte] = cartesContenant(html, `${M} Sansprojet`);

    expect(carte).toBeDefined();
    expect(carte).not.toContain(">Acquéreur<");
    expect(carte).not.toContain(">Vendeur<");
    expect(carte).not.toContain("<ul");
  });

  it("G. sans interaction : absence explicite ; avec : la date de la dernière", async () => {
    await unContact({ nom: `${M} Sansechange` });
    const avec = await unContact({ nom: `${M} Avecechange` });
    await creerInteraction({ contactId: avec.id, type: "appel", sens: "sortant", survenuLe: "2026-03-01T10:00:00.000Z" });
    await creerInteraction({ contactId: avec.id, type: "email", sens: "sortant", survenuLe: "2026-06-15T10:00:00.000Z" });

    const [sans] = cartesContenant(await rendre({ q: `${M} Sansechange` }), `${M} Sansechange`);
    expect(sans).toContain("Aucun échange enregistré");
    expect(sans).not.toContain("Dernier échange");

    const [avecCarte] = cartesContenant(await rendre({ q: `${M} Avecechange` }), `${M} Avecechange`);
    expect(avecCarte).toContain("Dernier échange : 15 juin 2026");
  });

  it("un prénom absent ne produit jamais « undefined » ni « null »", async () => {
    await unContact({ nom: `${M} Sansprenom` });
    const [carte] = cartesContenant(await rendre({ q: `${M} Sansprenom` }), `${M} Sansprenom`);
    expect(carte).not.toMatch(/undefined|null/);
  });

  it("email et téléphone présents sont rendus, absents ne laissent aucun lien vide", async () => {
    const email = `${M}.coord@example.test`;
    await unContact({ nom: `${M} Aveccoord`, email, telephone: "0611223344" });
    await unContact({ nom: `${M} Sanscoord` });

    const [avec] = cartesContenant(await rendre({ q: `${M} Aveccoord` }), `${M} Aveccoord`);
    expect(avec).toContain(`href="mailto:${email}"`);
    expect(avec).toContain('href="tel:0611223344"');

    const [sans] = cartesContenant(await rendre({ q: `${M} Sanscoord` }), `${M} Sanscoord`);
    expect(sans).not.toContain("mailto:");
    expect(sans).not.toContain("tel:");
  });

  it("au-delà de deux projets d'un rôle, le surplus est compté et non déroulé", async () => {
    const contact = await unContact({ nom: `${M} Troisprojets` });
    await unProjetAcquereur(contact.id);
    await unProjetAcquereur(contact.id);
    await unProjetAcquereur(contact.id);

    const [carte] = cartesContenant(await rendre({ q: `${M} Troisprojets` }), `${M} Troisprojets`);
    expect(carte).toContain("+ 1 autre");
    expect(carte.match(/Recherche active/g)).toHaveLength(2);
  });

  it("aucune carte ne porte de lien vers une fiche inexistante", async () => {
    await unContact({ nom: `${M} Sanslien` });
    const [carte] = cartesContenant(await rendre({ q: `${M} Sanslien` }), `${M} Sanslien`);
    expect(carte).not.toMatch(/href="\/contacts\//);
    expect(carte).not.toMatch(/href="\/clients\//);
    expect(carte).not.toMatch(/href="\/prospects-vendeurs\//);
  });
});

describe("/contacts — workspace", () => {
  it("H. la page d'un workspace ne rend aucun contact d'un autre workspace", async () => {
    const autre = `test-page-contacts-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre page contacts" });
    idsWorkspaces.push(autre);

    // Même nom des deux côtés : seul le périmètre distingue les deux personnes.
    const emailIci = `${M}.ici@example.test`;
    const emailAilleurs = `${M}.ailleurs@example.test`;
    await unContact({ nom: `${M} Isolation`, email: emailIci });
    await unContact({ nom: `${M} Isolation`, email: emailAilleurs }, autre);

    const htmlIci = await rendre({ q: `${M} Isolation` });
    expect(htmlIci).toContain(emailIci);
    expect(htmlIci).not.toContain(emailAilleurs);

    workspaceCourantMock.mockResolvedValueOnce(autre);
    const htmlAilleurs = await rendre({ q: `${M} Isolation` });
    expect(htmlAilleurs).toContain(emailAilleurs);
    expect(htmlAilleurs).not.toContain(emailIci);
  });

  it("un `workspaceId` passé dans l'URL est ignoré : seul le périmètre de session compte", async () => {
    const autre = `test-page-contacts-url-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre page contacts URL" });
    idsWorkspaces.push(autre);
    await unContact({ nom: `${M} Urlailleurs` }, autre);

    const html = await rendre({ q: `${M} Urlailleurs`, workspaceId: autre } as never);
    expect(cartesContenant(html, `${M} Urlailleurs`)).toHaveLength(0);
    expect(html).toContain("Aucun contact trouvé.");
  });
});

describe("/contacts — pagination", () => {
  // Les 26 contacts nécessaires partagent un préfixe unique : la pagination est testée sur la
  // recherche, pas sur la liste récente que le reste de la suite pollue.
  const P = `${M}Pag`;

  async function preparerVingtSix() {
    for (let i = 0; i < 26; i += 1) await unContact({ nom: `${P} ${String(i).padStart(2, "0")}` });
  }

  it("J/L. hasMore rend « Suivant » avec q conservé, et jamais « Précédent » en page 1", async () => {
    await preparerVingtSix();
    const html = await rendre({ q: P });

    expect(cartes(html)).toHaveLength(25);
    expect(html).toContain("Suivant");
    expect(html).not.toContain("Précédent");
    expect(liensPagination(html)).toEqual([`/contacts?q=${encodeURIComponent(P)}&page=2`]);
  });

  it("K/L. en page 2, « Précédent » est présent avec q conservé, « Suivant » absent", async () => {
    const html = await rendre({ q: P, page: "2" });

    expect(cartes(html)).toHaveLength(1);
    expect(html).toContain("Précédent");
    expect(html).not.toContain("Suivant");
    expect(liensPagination(html)).toEqual([`/contacts?q=${encodeURIComponent(P)}`]);
  });

  it("une page hors bornes redirige vers la première page, q conservé", async () => {
    await expect(rendre({ q: P, page: "99" })).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("sans suite ni page précédente, aucune pagination n'est rendue", async () => {
    await unContact({ nom: `${M} Seul` });
    const html = await rendre({ q: `${M} Seul` });
    expect(html).not.toContain('aria-label="Pagination"');
  });
});
