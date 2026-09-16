import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { Contact } from "@/types/contact";

// ADR-054 — périmètre résolu depuis la session.
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  champsVerrouilles: champsVerrouillesTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { fusionnerContacts } = await import("@/lib/fusionContactRepository");
const FicheContact = (await import("./page")).default;

// ADR-059 — « Contacts fusionnés » sur la fiche du SURVIVANT : nom d'alors, date, conseiller, lien
// vers la fiche historique. Rien de technique, rien sans fusion, rien sur une fiche absorbée.
const M = `Zsurvivant${Date.now()}`;
const idsContacts: string[] = [];

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

async function unContact(surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string }) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge }, WORKSPACE_TEST);
  idsContacts.push(contact.id);
  return contact;
}

const identite = (c: Contact) => ({ nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, modifieLe: c.modifieLe });

// Fusion réelle par le moteur ; le survivant garde entièrement son identité (l'absorbé n'a ni email
// ni téléphone commun : `survivant` partout où les deux existent, sinon absence comblée).
async function fusionner(survivant: Contact, absorbe: Contact, acteur: { sub?: string; email?: string }) {
  const champ = (k: "prenom" | "email" | "telephone") => {
    const vs = survivant[k];
    const va = absorbe[k];
    if (vs === va) return { choix: "identique" as const, valeur: vs };
    if (vs === undefined || va === undefined) return { choix: "absence_comblee" as const, valeur: vs ?? va };
    return { choix: "survivant" as const, valeur: vs };
  };
  const prenom = champ("prenom");
  const email = champ("email");
  const telephone = champ("telephone");
  const resultat = await fusionnerContacts({
    workspaceId: WORKSPACE_TEST,
    contactSurvivantId: survivant.id,
    contactAbsorbeId: absorbe.id,
    identiteAttendueSurvivant: identite(survivant),
    identiteAttendueAbsorbe: identite(absorbe),
    identiteFinale: { nom: survivant.nom, prenom: prenom.valeur, email: email.valeur, telephone: telephone.valeur },
    choixParChamp: { nom: "survivant", prenom: prenom.choix, email: email.choix, telephone: telephone.choix },
    acteur,
  });
  if (resultat.statut !== "fusionne") throw new Error(`fusion refusée : ${resultat.statut}`);
  return resultat;
}

async function rendre(id: string): Promise<string> {
  return renderToStaticMarkup(await FicheContact({ params: Promise.resolve({ id }) }));
}

describe("/contacts/[id] — « Contacts fusionnés » sur le survivant", { timeout: 30_000 }, () => {
  it("I/K/M. B → A : section, nom historique de B, date, conseiller, lien vers /contacts/B — sans donnée technique ni coordonnées d'alors", async () => {
    const a = await unContact({ nom: `${M} Martin`, prenom: "Alice", email: `${M}.alice@example.test`, telephone: "0600000001" });
    const b = await unContact({ nom: `${M} Durand`, prenom: "Bob", email: `${M}.bob@example.test`, telephone: "0699999999" });
    const { fusionId } = await fusionner(a, b, { sub: "google-sub-secret", email: "conseiller@example.test" });
    await getDb().update(contactFusionsTable).set({ fusionneLe: new Date("2026-09-15T08:00:00.000Z") }).where(eq(contactFusionsTable.id, fusionId));

    const html = await rendre(a.id);
    expect(html).toContain("Contacts fusionnés");
    expect(html).toContain("Ces anciennes fiches ont été regroupées avec ce contact.");
    expect(html).toContain(`Bob ${M} Durand`);
    expect(html).toMatch(/Fusionné le <time dateTime="2026-09-15T08:00:00.000Z">15 septembre 2026<\/time> par conseiller@example.test/);
    expect(html).toMatch(new RegExp(`<a[^>]*href="/contacts/${b.id}"[^>]*>[^<]*Voir le contact fusionné`));
    // La section vient AVANT les projets, APRÈS l'en-tête.
    expect(html.indexOf("Contacts fusionnés")).toBeGreaterThan(html.indexOf(`/contacts/${a.id}/modifier`));
    expect(html.indexOf("Contacts fusionnés")).toBeLessThan(html.indexOf("Dernières interactions"));

    // Rien de technique, et les coordonnées d'alors de B restent sur sa propre fiche.
    for (const interdit of ["google-sub-secret", `${M}.bob@example.test`, "0699999999", fusionId, "ids_deplaces", "idsDeplaces", "choix_par_champ", "avertissements", "identite_finale"]) {
      expect(html, interdit).not.toContain(interdit);
    }
    // Le survivant garde sa fiche ordinaire.
    expect(html).toContain(`Alice ${M} Martin`);
    expect(html).toContain(`${M}.alice@example.test`);
    expect(html).not.toContain("Ce contact a été fusionné");
  });

  it("acteur absent : « Fusionné le … » sans « par »", async () => {
    const a = await unContact({ nom: `${M} SansActeur`, prenom: "Alice" });
    const b = await unContact({ nom: `${M} Anonyme` });
    await fusionner(a, b, {});
    const html = await rendre(a.id);
    expect(html).toMatch(/Fusionné le <time[^>]*>[^<]+<\/time><\/p>/);
    expect(html).not.toContain(" par ");
  });

  it("C/D. B, C → A : deux entrées, la plus récente d'abord, chacune avec son lien", async () => {
    const a = await unContact({ nom: `${M} Multi`, prenom: "Alice" });
    const b = await unContact({ nom: `${M} Ancienne` });
    const c = await unContact({ nom: `${M} Recente` });
    const fb = await fusionner(a, b, {});
    const fc = await fusionner(a, c, {});
    await getDb().update(contactFusionsTable).set({ fusionneLe: new Date("2026-09-01T08:00:00.000Z") }).where(eq(contactFusionsTable.id, fb.fusionId));
    await getDb().update(contactFusionsTable).set({ fusionneLe: new Date("2026-09-10T08:00:00.000Z") }).where(eq(contactFusionsTable.id, fc.fusionId));
    const html = await rendre(a.id);
    expect(html.indexOf(`${M} Recente`)).toBeLessThan(html.indexOf(`${M} Ancienne`));
    expect(html).toContain(`href="/contacts/${b.id}"`);
    expect(html).toContain(`href="/contacts/${c.id}"`);
  });

  it("J. sans fusion : aucune section", async () => {
    const a = await unContact({ nom: `${M} Seul`, prenom: "Alice" });
    const html = await rendre(a.id);
    expect(html).not.toContain("Contacts fusionnés");
    expect(html).not.toContain("Voir le contact fusionné");
  });

  it("L. A → B → C : la fiche de C liste B seulement ; la fiche absorbée de B reste la page fusionnée, sans section", async () => {
    const c = await unContact({ nom: `${M} Final`, prenom: "Alice" });
    const b = await unContact({ nom: `${M} Milieu` });
    const a = await unContact({ nom: `${M} Origine` });
    await fusionner(b, a, {});
    await fusionner(c, b, {});

    const htmlC = await rendre(c.id);
    expect(htmlC).toContain(`href="/contacts/${b.id}"`);
    expect(htmlC).not.toContain(`${M} Origine`);
    expect(htmlC).not.toContain(a.id);

    const htmlB = await rendre(b.id);
    expect(htmlB).toContain("Ce contact a été fusionné avec un autre contact.");
    expect(htmlB).toMatch(new RegExp(`<a[^>]*href="/contacts/${c.id}"[^>]*>[^<]*Voir le contact actif`));
    expect(htmlB).not.toContain("Contacts fusionnés");
    expect(htmlB).not.toContain(a.id);
  });
});
