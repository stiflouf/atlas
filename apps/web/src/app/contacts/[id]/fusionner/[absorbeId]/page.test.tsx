import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  champsVerrouilles: champsVerrouillesTable,
  contacts: contactsTable,
  interactions: interactionsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  referencesExternes: referencesExternesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { creerInteraction } = await import("@/lib/interactionRepository");
const { enregistrerReferenceExterne } = await import("@/lib/provenance/referenceExterneRepository");
const { verrouillerChamp } = await import("@/lib/provenance/champVerrouilleRepository");
const FusionnerContactsPage = (await import("./page")).default;

// ADR-059 — la page de FUSION rendue : direction explicite, deux colonnes, un choix par conflit
// et aucun ailleurs, verrous visibles, impact, avertissements à acquitter, confirmation finale,
// aucune saisie libre. Hors périmètre ou identique = 404 ; déjà absorbé = état explicite.
const M = `Zpagefusion${Date.now()}`;
let compteur = 0;
const unEmail = () => `${M}.${++compteur}@example.test`;

const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsWorkspaces: string[] = [];

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(referencesExternesTable).where(inArray(referencesExternesTable.contactId, idsContacts));
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsProjetsA.length > 0)
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  if (idsWorkspaces.length > 0)
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(
  surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string } = {},
  workspace = WORKSPACE_TEST
) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge }, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function rendre(survivantId: string, absorbeId: string, query: { fusion?: string; champ?: string } = {}): Promise<string> {
  return renderToStaticMarkup(
    await FusionnerContactsPage({ params: Promise.resolve({ id: survivantId, absorbeId }), searchParams: Promise.resolve(query) })
  );
}

describe("/contacts/[id]/fusionner/[absorbeId] — comparaison", () => {
  it("direction explicite, deux identités, Inverser vers l'URL symétrique sans écriture", async () => {
    const s = await unContact({ nom: `${M} Conservé`, prenom: "Sam", email: unEmail() });
    const a = await unContact({ nom: `${M} Absorbé`, prenom: "Ana", telephone: "0655555555" });
    const html = await rendre(s.id, a.id);
    expect(html).toContain("Contact conservé");
    expect(html).toContain("Contact absorbé");
    expect(html.indexOf("Contact conservé")).toBeLessThan(html.indexOf("Contact absorbé"));
    expect(html).toContain(`Sam ${M} Conservé`);
    expect(html).toContain(`Ana ${M} Absorbé`);
    expect(html).toMatch(new RegExp(`<a[^>]*href="/contacts/${a.id}/fusionner/${s.id}"[^>]*>[^<]*Inverser`));
    expect(html).toContain(`href="/contacts/${s.id}"`);
    const [ligne] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, a.id));
    expect(ligne.fusionneDansContactId).toBeNull();
  });

  it("résolution : radio obligatoire par conflit, aucune radio pour identique ou absence comblée, hidden choix typé", async () => {
    const s = await unContact({ nom: `${M} Même`, prenom: "Jean", email: unEmail() });
    const a = await unContact({ nom: `${M} Même`, prenom: "Jean-Pierre", telephone: "0666666666" });
    const html = await rendre(s.id, a.id);
    // nom identique → hidden, pas de radio.
    expect(html).toContain('type="hidden" name="choix_nom" value="identique"');
    expect(html).not.toContain('name="choix_nom" value="survivant"');
    expect(html).toContain("Identique sur les deux contacts");
    // prénom en conflit → deux radios required, aucune présélectionnée.
    expect(html).toMatch(/<input type="radio" required=""[^>]*name="choix_prenom" value="survivant"/);
    expect(html).toMatch(/<input type="radio" required=""[^>]*name="choix_prenom" value="absorbe"/);
    expect(html).not.toMatch(/name="choix_prenom"[^>]*checked/);
    expect(html).toMatch(/<legend[^>]*>Prénom — deux valeurs différentes/);
    // email / téléphone : une seule valeur → comblée, hidden.
    expect(html).toContain('type="hidden" name="choix_email" value="absence_comblee"');
    expect(html).toContain('type="hidden" name="choix_telephone" value="absence_comblee"');
    expect(html).toContain("Seule valeur renseignée (contact conservé)");
    expect(html).toContain("Seule valeur renseignée (contact absorbé)");
  });

  it("aucune saisie libre d'identité : ni input text, ni textarea", async () => {
    const s = await unContact({ email: unEmail() });
    const a = await unContact({ email: unEmail() });
    const html = await rendre(s.id, a.id);
    expect(html).not.toMatch(/<input[^>]*type="(text|email|tel)"/);
    expect(html).not.toContain("<textarea");
    expect(html.match(/<input[^>]*type="(hidden|radio|checkbox)"/g)?.length).toBeGreaterThan(0);
  });

  it("verrous humains : badge « Modifié manuellement » sur le champ verrouillé seulement", async () => {
    const s = await unContact({ email: unEmail() });
    const a = await unContact({ email: unEmail() });
    await verrouillerChamp({ type: "contact", id: s.id }, "email", WORKSPACE_TEST);
    const html = await rendre(s.id, a.id);
    expect(html.match(/Modifié manuellement/gi)?.length).toBe(2); // badge colonne + mention sous la radio
    expect(html).toContain("Contact conservé · modifié manuellement");
  });

  it("résumé d'impact et participations en double, sans id technique", async () => {
    const s = await unContact({ email: unEmail() });
    const a = await unContact({ email: unEmail() });
    const commun = await creerProjetAcquereur({ budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "recherche_active" }, WORKSPACE_TEST);
    const seul = await creerProjetAcquereur({ budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "recherche_active" }, WORKSPACE_TEST);
    idsProjetsA.push(commun.id, seul.id);
    await ajouterPartieProjet({ contactId: s.id, projetAcquereurId: commun.id, role: "acquereur" });
    await ajouterPartieProjet({ contactId: a.id, projetAcquereurId: commun.id, role: "co_acquereur" });
    await ajouterPartieProjet({ contactId: a.id, projetAcquereurId: seul.id, role: "acquereur" });
    await creerInteraction({ contactId: a.id, type: "note", survenuLe: "2026-03-01T10:00:00.000Z" });
    const html = await rendre(s.id, a.id);
    expect(html).toContain("2 projets concernés");
    expect(html).toContain("1 participation en double sera regroupée");
    expect(html).toContain("1 interaction déplacée");
    expect(html).toContain("0 dossier acquéreur déplacé");
    expect(html).not.toContain(commun.id);
  });

  it("avertissement de références externes : bloc factuel et checkbox d'acquittement portant la clé exacte", async () => {
    const s = await unContact();
    const a = await unContact();
    await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-111`, cible: { type: "contact", id: s.id } }, WORKSPACE_TEST);
    await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-222`, cible: { type: "contact", id: a.id } }, WORKSPACE_TEST);
    const html = await rendre(s.id, a.id);
    expect(html).toContain("Ces deux contacts possèdent des identifiants différents pour playiad (contact)");
    expect(html).toMatch(
      /<input type="checkbox" required=""[^>]*name="acquittement" value="reference_externe_contradictoire:playiad\/contact"/
    );
    expect(html).toContain("Je comprends que les deux identifiants externes seront conservés");
  });

  it("confirmation finale obligatoire, bouton « Fusionner les contacts », formulaire vers la Server Action, snapshots cachés", async () => {
    const s = await unContact({ prenom: "A" });
    const a = await unContact({ prenom: "B" });
    const html = await rendre(s.id, a.id);
    expect(html).toMatch(/<input type="checkbox" required=""[^>]*name="confirmation" value="oui"/);
    expect(html).toContain("Je confirme qu’il s’agit de la même personne");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Fusionner les contacts<\/button>/);
    expect(html).toContain("<form");
    expect(html).toContain(`type="hidden" name="survivantId" value="${s.id}"`);
    expect(html).toContain(`type="hidden" name="absorbeId" value="${a.id}"`);
    expect(html).toContain(`type="hidden" name="survivantModifieLe" value="${s.modifieLe}"`);
    expect(html).toContain(`type="hidden" name="absorbeModifieLe" value="${a.modifieLe}"`);
    expect(html).not.toContain('name="workspaceId"');
    expect(html).not.toContain("Aucun conflit");
  });

  it("aucun conflit : le formulaire reste soumettable et le dit", async () => {
    const s = await unContact({ nom: `${M} Pareil`, email: unEmail() });
    const a = await unContact({ nom: `${M} Pareil`, email: s.email });
    const html = await rendre(s.id, a.id);
    expect(html).toContain("Aucun conflit");
    expect(html).not.toContain('type="radio"');
  });

  it("structure responsive : colonnes en flex-col md:flex-row, aucun tableau", async () => {
    const s = await unContact();
    const a = await unContact();
    const html = await rendre(s.id, a.id);
    expect(html).toContain("flex flex-col md:flex-row");
    expect(html).not.toContain("<table");
  });

  it("message de refus depuis l'URL : affiché, champ concerné nommé, code inconnu ignoré", async () => {
    const s = await unContact({ prenom: "A", email: unEmail() });
    const a = await unContact({ prenom: "B", email: unEmail() });
    const html = await rendre(s.id, a.id, { fusion: "identite_modifiee_entre_temps" });
    expect(html).toMatch(/role="alert"[^>]*>Les informations d’un des contacts ont changé/);
    const avecChamp = await rendre(s.id, a.id, { fusion: "choix_manquant", champ: "prenom" });
    expect(avecChamp).toContain("Choisissez une valeur pour chaque champ en conflit");
    expect(avecChamp).toContain("(Prénom)");
    expect(await rendre(s.id, a.id, { fusion: "n_importe_quoi" })).not.toContain('role="alert"');
  });
});

describe("/contacts/[id]/fusionner/[absorbeId] — accès", () => {
  it("deux contacts sans coordonnée commune : page accessible par URL (la similarité n'autorise rien)", async () => {
    const s = await unContact({ nom: `${M} Durand`, email: unEmail(), telephone: "0611111111" });
    const a = await unContact({ nom: `${M} Lefebvre`, email: unEmail(), telephone: "0622222222" });
    const html = await rendre(s.id, a.id);
    expect(html).toContain("Fusionner deux contacts");
    expect(html).toMatch(/<button[^>]*type="submit"/);
  });

  it("autre workspace, id inconnu ou identique : notFound()", async () => {
    const autre = `${M}-ws`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre fusion" });
    idsWorkspaces.push(autre);
    const s = await unContact();
    const ailleurs = await unContact({}, autre);
    await expect(rendre(s.id, ailleurs.id)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(rendre(s.id, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(rendre(s.id, s.id)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("un des deux déjà absorbé : état explicite « Ce contact n’est plus actif. », aucun formulaire", async () => {
    const s = await unContact();
    const a = await unContact();
    const tiers = await unContact();
    await getDb().update(contactsTable).set({ fusionneDansContactId: tiers.id, fusionneLe: new Date() }).where(eq(contactsTable.id, a.id));
    const html = await rendre(s.id, a.id);
    expect(html).toContain("Ce contact n’est plus actif.");
    expect(html).not.toContain("<form");
    expect(html).toContain(`href="/contacts/${s.id}"`);
    expect(html).toContain(`href="/contacts/${a.id}"`);
  });
});
