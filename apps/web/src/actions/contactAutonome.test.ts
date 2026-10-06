import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// CONTACT_STANDALONE_CREATION_V1 — enregistrer une PERSONNE sans lui inventer de rôle.
//
// Ce que cette suite exerce de bout en bout, sur une vraie base : la création depuis le formulaire,
// l'imposition du périmètre côté serveur, l'absence de tout dossier créé dans l'ombre, puis le fait
// que ce contact né sans projet se comporte comme n'importe quelle identité canonique — retrouvé
// dans le carnet, retrouvé par le sélecteur de tâche, ciblable, et porteur d'un destinataire quand
// il a une adresse.
//
// Ce qu'elle protège SURTOUT : qu'aucune règle d'unicité ne s'installe par accident. Deux personnes
// peuvent partager un email ou un téléphone (ADR-055 §H), et ce lot ne doit pas en décider
// autrement.
const { sessionMock, workspaceMock } = vi.hoisted(() => ({ sessionMock: vi.fn(), workspaceMock: vi.fn() }));
vi.mock("@/lib/auth/sessionAtlas", () => ({ exigerSessionAtlas: () => sessionMock() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: () => workspaceMock() }));

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  prospectsVendeurs: prospectsVendeursTable,
  taches: tachesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContactAction } = await import("./creerContact");
const { rechercherContactsCibleTacheAction } = await import("./rechercherContactsCibleTache");
const { creerTacheAction } = await import("./creerTache");
const { marquerContactFusionne } = await import("@/lib/contactRepository");
const { ETAT_FORMULAIRE_INITIAL } = await import("@/lib/formulaires/etatFormulaire");
const { resoudreContexteCommunicationDepuisTache } = await import(
  "@/lib/communications/resoudreContexteCommunicationDepuisTache"
);
const { getTacheDuWorkspace } = await import("@/lib/tacheRepository");
const ContactsPage = (await import("@/app/contacts/page")).default;
const NouveauContactPage = (await import("@/app/contacts/nouveau/page")).default;
const FicheContact = (await import("@/app/contacts/[id]/page")).default;

const M = `Csc${Date.now()}`;
const WORKSPACE_B = `ws-csc-${Date.now()}`;
let workspaceBCree = false;
const idsContacts: string[] = [];
const idsTaches: string[] = [];

beforeEach(() => {
  sessionMock.mockReset().mockResolvedValue({ sub: "csc-sub", email: "conseiller@example.test" });
  workspaceMock.mockReset().mockResolvedValue(WORKSPACE_TEST);
});

afterAll(async () => {
  if (idsTaches.length > 0) await getDb().delete(tachesTable).where(inArray(tachesTable.id, idsTaches));
  if (idsContacts.length > 0) {
    await getDb().delete(tachesTable).where(inArray(tachesTable.contactId, idsContacts));
    await getDb()
      .update(contactsTable)
      .set({ fusionneDansContactId: null, fusionneLe: null })
      .where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (workspaceBCree) await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
});

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

// `creerContactAction` redirige en cas de succès, et la redirection de Next est une exception : un
// succès se lit donc comme un rejet dont le message est celui de `redirect()`. La preuve du succès
// reste la LIGNE en base, relue juste après.
async function soumettre(champs: Record<string, string>) {
  return creerContactAction(ETAT_FORMULAIRE_INITIAL, formulaire(champs)).catch((erreur) => erreur);
}

async function contactCree(nom: string, workspaceId = WORKSPACE_TEST) {
  const [ligne] = await getDb()
    .select()
    .from(contactsTable)
    .where(and(eq(contactsTable.nom, nom), eq(contactsTable.workspaceId, workspaceId)))
    .limit(1);
  if (ligne) idsContacts.push(ligne.id);
  return ligne;
}

async function tacheCreee(titre: string) {
  const [ligne] = await getDb().select().from(tachesTable).where(eq(tachesTable.titre, titre)).limit(1);
  if (ligne) idsTaches.push(ligne.id);
  return ligne;
}

async function autreWorkspace() {
  if (!workspaceBCree) {
    await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] contact autonome" });
    workspaceBCree = true;
  }
  return WORKSPACE_B;
}

describe("CONTACT_STANDALONE_CREATION_V1 — création d'une personne sans rôle", () => {
  it("T1 — le nom seul suffit : le contact existe, sans prénom, email ni téléphone inventés", async () => {
    const nom = `${M} Minimal`;
    await soumettre({ nom });

    const ligne = await contactCree(nom);
    expect(ligne).toBeDefined();
    expect(ligne.prenom).toBeNull();
    expect(ligne.email).toBeNull();
    expect(ligne.telephone).toBeNull();
    // ADR-059 — toute ligne créée est ACTIVE : jamais un contact né déjà absorbé.
    expect(ligne.fusionneDansContactId).toBeNull();
    expect(ligne.fusionneLe).toBeNull();
  });

  it("T2/T3 — prénom, email et téléphone sont enregistrés tels quels, sans normalisation", async () => {
    const nom = `${M} Complet`;
    await soumettre({ nom, prenom: "Jean", email: "Jean.Complet@Example.Test", telephone: "06 11 22 33 44" });

    const ligne = await contactCree(nom);
    expect(ligne.prenom).toBe("Jean");
    // Ni minuscules forcées, ni espaces retirés : aucune règle de forme n'existe ailleurs dans le
    // produit, et l'inventer ici en créerait une seconde pour la même donnée.
    expect(ligne.email).toBe("Jean.Complet@Example.Test");
    expect(ligne.telephone).toBe("06 11 22 33 44");
  });

  it("un champ optionnel laissé vide devient une ABSENCE, jamais une chaîne vide", async () => {
    const nom = `${M} Vides`;
    await soumettre({ nom, prenom: "", email: "", telephone: "   " });

    const ligne = await contactCree(nom);
    expect(ligne.prenom).toBeNull();
    expect(ligne.email).toBeNull();
    expect(ligne.telephone).toBeNull();
  });

  it("un nom vide ou fait d'espaces est refusé, et rien n'est écrit", async () => {
    // Prénom porteur du marqueur : c'est lui qui prouve qu'aucune ligne n'a été écrite, et il ne
    // doit donc appartenir à aucun autre test de ce fichier.
    const prenom = `${M}-refus`;
    const resultat = await creerContactAction(ETAT_FORMULAIRE_INITIAL, formulaire({ nom: "   ", prenom }));

    expect(resultat.statut).toBe("erreur");
    expect(resultat.statut === "erreur" ? resultat.message : "").toContain("nom est obligatoire");
    const [ligne] = await getDb().select().from(contactsTable).where(eq(contactsTable.prenom, prenom)).limit(1);
    expect(ligne).toBeUndefined();
  });

  it("T4 — le contact appartient au workspace de la SESSION", async () => {
    const nom = `${M} Perimetre`;
    await soumettre({ nom });

    const ligne = await contactCree(nom);
    expect(ligne.workspaceId).toBe(WORKSPACE_TEST);
  });

  it("T5 — un workspaceId envoyé par le client est ignoré : le périmètre reste celui de la session", async () => {
    const autre = await autreWorkspace();
    const nom = `${M} Forge`;
    await soumettre({ nom, workspaceId: autre, workspace_id: autre });

    const ligne = await contactCree(nom);
    expect(ligne.workspaceId).toBe(WORKSPACE_TEST);
    const horsPerimetre = await getDb()
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.workspaceId, autre));
    expect(horsPerimetre).toHaveLength(0);
  });

  it("T12 — la garde de session passe avant toute écriture", async () => {
    sessionMock.mockRejectedValueOnce(new Error("session absente"));
    const nom = `${M} SansSession`;

    await expect(creerContactAction(ETAT_FORMULAIRE_INITIAL, formulaire({ nom }))).rejects.toThrow("session absente");

    const [ligne] = await getDb().select().from(contactsTable).where(eq(contactsTable.nom, nom)).limit(1);
    expect(ligne).toBeUndefined();
  });

  it("T6 — aucun acquéreur, aucun prospect vendeur, aucune partie de projet n'est créé dans l'ombre", async () => {
    const nom = `${M} SansRole`;
    await soumettre({ nom, email: `${M}.sansrole@example.test` });
    const contact = await contactCree(nom);

    expect(await getDb().select().from(acquereursTable).where(eq(acquereursTable.contactId, contact.id))).toHaveLength(0);
    expect(
      await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.contactId, contact.id))
    ).toHaveLength(0);
    expect(
      await getDb().select().from(partiesProjetTable).where(eq(partiesProjetTable.contactId, contact.id))
    ).toHaveLength(0);
  });

  it("T15 — deux contacts peuvent partager un email ET un téléphone : aucune unicité introduite", async () => {
    const email = `${M}.partage@example.test`;
    const telephone = "0699887766";
    await soumettre({ nom: `${M} Homonyme`, email, telephone });
    const premier = await contactCree(`${M} Homonyme`);

    // Même nom, même email, même téléphone : une seconde personne, pas un doublon à fusionner.
    await soumettre({ nom: `${M} Homonyme`, email, telephone });

    const lignes = await getDb()
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.nom, `${M} Homonyme`), eq(contactsTable.workspaceId, WORKSPACE_TEST)));
    expect(lignes).toHaveLength(2);
    for (const l of lignes) if (!idsContacts.includes(l.id)) idsContacts.push(l.id);
    // Deux lignes distinctes : rien n'a été rapproché, rien n'a été fusionné.
    expect(new Set(lignes.map((l) => l.id)).size).toBe(2);
    expect(lignes.every((l) => l.fusionneDansContactId === null)).toBe(true);
    expect(premier.id).toBeDefined();
  });
});

describe("CONTACT_STANDALONE_CREATION_V1 — le contact autonome dans le carnet", () => {
  it("T7/T8 — il apparaît dans les contacts récents, et la recherche le retrouve par nom et par email", async () => {
    const nom = `${M} Carnet`;
    const email = `${M}.carnet@example.test`;
    await soumettre({ nom, prenom: "Alice", email, telephone: "0612345678" });
    await contactCree(nom);

    const recents = renderToStaticMarkup(await ContactsPage({ searchParams: Promise.resolve({}) }));
    expect(recents).toContain(nom);

    const parNom = renderToStaticMarkup(await ContactsPage({ searchParams: Promise.resolve({ q: nom }) }));
    expect(parNom).toContain(nom);

    const parEmail = renderToStaticMarkup(await ContactsPage({ searchParams: Promise.resolve({ q: email }) }));
    expect(parEmail).toContain(nom);

    const parTelephone = renderToStaticMarkup(await ContactsPage({ searchParams: Promise.resolve({ q: "0612345678" }) }));
    expect(parTelephone).toContain(nom);
  });

  it("T16 — un contact autonome d'un autre workspace n'apparaît jamais dans le carnet du workspace courant", async () => {
    const autre = await autreWorkspace();
    workspaceMock.mockResolvedValue(autre);
    const nom = `${M} Etranger`;
    await soumettre({ nom });
    await contactCree(nom, autre);

    workspaceMock.mockResolvedValue(WORKSPACE_TEST);
    const html = renderToStaticMarkup(await ContactsPage({ searchParams: Promise.resolve({ q: nom }) }));
    // Le terme cherché est réaffiché dans le champ de recherche : l'absence se vérifie sur les
    // RÉSULTATS, jamais sur le document entier.
    const resultats = html.match(/<section>[\s\S]*<\/section>/)?.[0] ?? "";
    expect(resultats).toContain("Aucun contact trouvé.");
    expect(resultats.match(/<article\b[\s\S]*?<\/article>/g) ?? []).toHaveLength(0);
  });

  it("l'entrée de création est offerte depuis le carnet, liste pleine comme carnet vide", async () => {
    const htmlPlein = renderToStaticMarkup(await ContactsPage({ searchParams: Promise.resolve({}) }));
    expect(htmlPlein).toContain('href="/contacts/nouveau"');
    expect(htmlPlein).toContain("Nouveau contact");

    // Carnet vide : la recherche d'un terme introuvable ne doit pas être confondue avec l'état vide,
    // qui lui porte le CTA. Le périmètre vierge sert ici d'état vide réel.
    const vierge = `ws-csc-vide-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: vierge, nom: "[test réel] carnet vide" });
    workspaceMock.mockResolvedValue(vierge);
    try {
      const htmlVide = renderToStaticMarkup(await ContactsPage({ searchParams: Promise.resolve({}) }));
      expect(htmlVide).toContain("Aucun contact pour le moment.");
      expect(htmlVide).toContain('href="/contacts/nouveau"');
      // Le message ne promet plus que seuls les acquéreurs et prospects vendeurs y entrent.
      expect(htmlVide).not.toContain("Les personnes que vous enregistrez comme acquéreur ou prospect vendeur");
    } finally {
      workspaceMock.mockResolvedValue(WORKSPACE_TEST);
      await getDb().delete(workspacesTable).where(eq(workspacesTable.id, vierge));
    }
  });

  it("T9 — sa fiche s'affiche sans rôle, sans section projet, et sans jamais écrire « undefined »", async () => {
    const nom = `${M} Fiche`;
    await soumettre({ nom, prenom: "Bob", email: `${M}.fiche@example.test` });
    const contact = await contactCree(nom);

    const html = renderToStaticMarkup(
      await FicheContact({ params: Promise.resolve({ id: contact.id }), searchParams: Promise.resolve({}) })
    );

    expect(html).toContain(nom);
    expect(html).toContain(`href="mailto:${M}.fiche@example.test"`);
    expect(html).not.toContain("Projets acquéreur");
    expect(html).not.toContain("Projets vendeur");
    expect(html).not.toContain("Dossiers rattachés");
    expect(html.replace(/<script>[\s\S]*?<\/script>/g, "")).not.toMatch(/undefined|null/);
    // La fiche Contact est l'écran qui lit le plus de sources (fusions, projets, dossiers,
    // similaires, timeline) : son premier rendu dans ce fichier dépasse le défaut de 5 s.
  }, 30_000);

  it("T17 — chaque champ du formulaire de création porte un label associé à un id réellement présent", () => {
    const html = renderToStaticMarkup(NouveauContactPage());

    const labels = [...html.matchAll(/<label[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)];
    expect(labels.map((m) => m[1]).sort()).toEqual(
      ["contact-email", "contact-nom", "contact-prenom", "contact-telephone"].sort()
    );
    for (const [, id] of labels) expect(html).toContain(`id="${id}"`);

    // Les `name` sont ceux que `parseContactFormData` lit : un label correct sur un name inventé
    // produirait un champ accessible et ignoré.
    for (const name of ["nom", "prenom", "email", "telephone"]) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('href="/contacts"');
    // Aucun id dupliqué dans le document rendu.
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("CONTACT_STANDALONE_CREATION_V1 — le contact autonome comme cible de tâche", () => {
  it("T10/T11/T12bis — le sélecteur le retrouve, et une tâche peut le cibler", async () => {
    const nom = `${M} Cible`;
    await soumettre({ nom, prenom: "Chloé", email: `${M}.cible@example.test` });
    const contact = await contactCree(nom);

    const candidats = await rechercherContactsCibleTacheAction(nom);
    expect(candidats.map((c) => c.id)).toContain(contact.id);
    expect(candidats.find((c) => c.id === contact.id)?.email).toBe(`${M}.cible@example.test`);

    const titre = `${M} envoyer un mail`;
    await creerTacheAction(
      ETAT_FORMULAIRE_INITIAL,
      formulaire({ titre, type: "email", priorite: "normale", contactId: contact.id })
    ).catch((e) => e);

    const ligne = await tacheCreee(titre);
    expect(ligne).toBeDefined();
    expect(ligne.contactId).toBe(contact.id);
    expect(ligne.acquereurId).toBeNull();
    expect(ligne.prospectVendeurId).toBeNull();
    expect(ligne.bienId).toBeNull();
  });

  it("T12 — avec un email, le contexte de communication résout ce destinataire exact", async () => {
    const nom = `${M} AvecEmail`;
    const email = `${M}.avecemail@example.test`;
    await soumettre({ nom, prenom: "David", email });
    const contact = await contactCree(nom);

    const titre = `${M} mail avec adresse`;
    await creerTacheAction(
      ETAT_FORMULAIRE_INITIAL,
      formulaire({ titre, type: "email", priorite: "normale", contactId: contact.id })
    ).catch((e) => e);
    const ligne = await tacheCreee(titre);
    const tache = await getTacheDuWorkspace(ligne.id, WORKSPACE_TEST);

    const contexte = await resoudreContexteCommunicationDepuisTache(tache!, WORKSPACE_TEST);
    expect(contexte.cibleType).toBe("contact");
    expect(contexte.candidats).toHaveLength(1);
    expect(contexte.candidats[0]).toMatchObject({ type: "contact", id: contact.id, email });
  });

  it("T13 — sans email, un destinataire existe mais AUCUNE adresse n'est inventée", async () => {
    const nom = `${M} SansEmail`;
    await soumettre({ nom, telephone: "0600112233" });
    const contact = await contactCree(nom);

    const titre = `${M} mail sans adresse`;
    await creerTacheAction(
      ETAT_FORMULAIRE_INITIAL,
      formulaire({ titre, type: "email", priorite: "normale", contactId: contact.id })
    ).catch((e) => e);
    const ligne = await tacheCreee(titre);
    const tache = await getTacheDuWorkspace(ligne.id, WORKSPACE_TEST);

    const contexte = await resoudreContexteCommunicationDepuisTache(tache!, WORKSPACE_TEST);
    expect(contexte.candidats).toHaveLength(1);
    expect(contexte.candidats[0].email).toBeUndefined();
    // Ni le téléphone, ni le nom, ni quoi que ce soit du texte libre ne devient une adresse.
    expect(JSON.stringify(contexte.candidats[0])).not.toContain("@");
  });

  it("T18 — une fois absorbé, le contact autonome n'est plus proposé comme cible active", async () => {
    const nomAbsorbe = `${M} Absorbe`;
    const nomSurvivant = `${M} Survivant`;
    await soumettre({ nom: nomAbsorbe, email: `${M}.absorbe@example.test` });
    await soumettre({ nom: nomSurvivant, email: `${M}.survivant@example.test` });
    const absorbe = await contactCree(nomAbsorbe);
    const survivant = await contactCree(nomSurvivant);

    expect((await rechercherContactsCibleTacheAction(nomAbsorbe)).map((c) => c.id)).toContain(absorbe.id);

    await marquerContactFusionne(absorbe.id, survivant.id, WORKSPACE_TEST, getDb());

    // ADR-059 — `rechercherContacts` exclut les absorbés en SQL : le sélecteur n'a rien à filtrer
    // lui-même, et ce test vérifie que le contact autonome suit la même règle que les autres.
    expect((await rechercherContactsCibleTacheAction(nomAbsorbe)).map((c) => c.id)).not.toContain(absorbe.id);
  });
});
