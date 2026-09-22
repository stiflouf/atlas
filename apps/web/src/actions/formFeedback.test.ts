import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import { ETAT_FORMULAIRE_INITIAL } from "@/lib/formulaires/etatFormulaire";

// FORM_FEEDBACK_V1 — une famille par action centrale : une saisie invalide revient au formulaire
// comme état `{ statut: "erreur" }` (jamais une exception → error.tsx), une saisie valide suit le
// chemin de succès existant (redirect), une erreur INATTENDUE continue à lever, et la garde de
// session reste fail-closed (personne ne reçoit « Le montant est invalide » sans être connecté).
const { sessionMock, workspaceMock } = vi.hoisted(() => ({ sessionMock: vi.fn(), workspaceMock: vi.fn() }));
vi.mock("@/lib/auth/sessionAtlas", () => ({ exigerSessionAtlas: () => sessionMock() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: () => workspaceMock() }));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  taches: tachesTable,
  offres: offresTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerTacheAction } = await import("./creerTache");
const { ajouterOffreAction } = await import("./offre");
const { ajouterCompromisAction } = await import("./compromis");
const { creerProspectVendeurAction } = await import("./prospectVendeur");
const { ajouterDocumentBienAction } = await import("./ajouterDocumentBien");
const { creerAcquereurAction } = await import("./creerAcquereur");

const M = `[test réel] FORM-FEEDBACK ${Date.now()}`;
const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];

function sessionValide() {
  sessionMock.mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" });
  workspaceMock.mockResolvedValue(WORKSPACE_TEST);
}
sessionValide();

afterAll(async () => {
  sessionValide();
  const prospects = await getDb().select({ id: prospectsVendeursTable.id }).from(prospectsVendeursTable).where(like(prospectsVendeursTable.nom, `%${M}%`));
  const idsProspects = prospects.map((p) => p.id);
  if (idsProspects.length) {
    const evts = await getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(inArray(evenementsMetierTable.prospectVendeurId, idsProspects));
    const idsEvts = evts.map((e) => e.id);
    if (idsEvts.length) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvts));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvts));
    }
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  }
  await getDb().delete(tachesTable).where(like(tachesTable.titre, `%${M}%`));
  if (idsBiens.length) {
    const offres = await getDb().select({ id: offresTable.id }).from(offresTable).where(inArray(offresTable.bienId, idsBiens));
    const idsOffres = offres.map((o) => o.id);
    if (idsOffres.length) {
      const evts = await getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(inArray(evenementsMetierTable.offreId, idsOffres));
      const idsEvts = evts.map((e) => e.id);
      if (idsEvts.length) {
        await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvts));
        await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvts));
      }
      await getDb().delete(offresTable).where(inArray(offresTable.id, idsOffres));
    }
    await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  }
  if (idsAcquereurs.length) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  const contacts = await getDb().select({ id: contactsTable.id }).from(contactsTable).where(like(contactsTable.nom, `%${M}%`));
  const idsContacts = contacts.map((c) => c.id);
  if (idsContacts.length) {
    const parties = await getDb().select({ projetVendeurId: partiesProjetTable.projetVendeurId }).from(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    const idsProjets = [...new Set(parties.map((p) => p.projetVendeurId).filter((id): id is string => !!id))];
    if (idsProjets.length) await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjets));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

function formulaire(champs: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

async function unBien(suffixe: string) {
  const bien = await creerBien(
    { reference: `${M}-${suffixe}`, titre: `${M} ${suffixe}`, type: "appartement", adresse: "1 rue", ville: "Testville", codePostal: "00000", surface: 50, pieces: 3, prix: 300000, statutMandat: "actif", dateMandat: "2026-01-01", caracteristiques: [], description: "" },
    WORKSPACE_TEST
  );
  idsBiens.push(bien.id);
  return bien;
}
async function unAcquereur(suffixe: string) {
  const a = await creerAcquereur(
    { prenom: "Test", nom: `${M} ${suffixe}`, email: `ff-${suffixe}-${Date.now()}@example.com`, telephone: "0600000000", budgetMin: 100000, budgetMax: 400000, criteres: [], stadeProjet: "recherche_active", notes: "", datePremiereContact: "2026-01-01" },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(a.id);
  return a;
}

// Le chemin de succès reste une redirection Next : elle lève (digest NEXT_REDIRECT), on la lit.
async function digestRedirection(promesse: Promise<unknown>): Promise<string> {
  try {
    const etat = await promesse;
    return `etat:${JSON.stringify(etat)}`;
  } catch (erreur) {
    return String((erreur as { digest?: string }).digest ?? (erreur as Error).message);
  }
}

describe("FORM_FEEDBACK_V1 — familles", () => {
  it("Prospect vendeur : nom manquant → état erreur (aucune écriture) ; corrigé → redirection vers la fiche", async () => {
    await expect(creerProspectVendeurAction(ETAT_FORMULAIRE_INITIAL, formulaire({ nom: "   ", prenom: "Camille" }))).resolves.toEqual({
      statut: "erreur",
      message: "Le nom est obligatoire.",
    });
    expect(await getDb().select().from(contactsTable).where(like(contactsTable.nom, `%${M}%`))).toEqual([]);

    expect(await digestRedirection(creerProspectVendeurAction(ETAT_FORMULAIRE_INITIAL, formulaire({ nom: `${M} Vendeur`, prenom: "Camille" })))).toMatch(
      /NEXT_REDIRECT;replace;\/prospects-vendeurs\/[0-9a-f-]{36}/
    );
  });

  it("Offre : montant invalide → état erreur ; valide → redirection vers le bien", async () => {
    const bien = await unBien("OFFRE");
    const acquereur = await unAcquereur("OFFRE");
    await expect(
      ajouterOffreAction(ETAT_FORMULAIRE_INITIAL, formulaire({ bienId: bien.id, acquereurId: acquereur.id, montant: "abc", dateOffre: "2026-08-01" }))
    ).resolves.toEqual({ statut: "erreur", message: "Le montant de l'offre doit être un nombre positif." });
    expect(await digestRedirection(ajouterOffreAction(ETAT_FORMULAIRE_INITIAL, formulaire({ bienId: bien.id, acquereurId: acquereur.id, montant: "290000", dateOffre: "2026-08-01" })))).toContain(
      `NEXT_REDIRECT;replace;/biens/${bien.id}`
    );
  });

  it("Compromis : prix invalide → état erreur", async () => {
    const bien = await unBien("COMPROMIS");
    const acquereur = await unAcquereur("COMPROMIS");
    await expect(
      ajouterCompromisAction(ETAT_FORMULAIRE_INITIAL, formulaire({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: "-1", dateSignature: "2026-08-01" }))
    ).resolves.toEqual({ statut: "erreur", message: "Le prix convenu doit être un nombre positif." });
  });

  it("Tâche : titre manquant → état erreur ; valide → redirection", async () => {
    await expect(creerTacheAction(ETAT_FORMULAIRE_INITIAL, formulaire({ titre: " ", type: "autre", priorite: "normale" }))).resolves.toEqual({
      statut: "erreur",
      message: "Titre requis.",
    });
    expect(await digestRedirection(creerTacheAction(ETAT_FORMULAIRE_INITIAL, formulaire({ titre: `${M} tâche`, type: "autre", priorite: "normale", redirectTo: "/" })))).toContain("NEXT_REDIRECT;replace;/");
  });

  it("Document : fichier trop gros ou type refusé → état erreur, jamais une exception", async () => {
    const bien = await unBien("DOC");
    const gros = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "gros.pdf", { type: "application/pdf" });
    await expect(ajouterDocumentBienAction(ETAT_FORMULAIRE_INITIAL, formulaire({ bienId: bien.id, nom: "DPE", categorie: "diagnostic", fichier: gros }))).resolves.toEqual({
      statut: "erreur",
      message: "Le fichier dépasse la taille maximale autorisée (10 Mo).",
    });
    const texte = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
    await expect(ajouterDocumentBienAction(ETAT_FORMULAIRE_INITIAL, formulaire({ bienId: bien.id, nom: "Notes", categorie: "autre", fichier: texte }))).resolves.toEqual({
      statut: "erreur",
      message: "Type de fichier non autorisé (PDF, JPEG ou PNG uniquement).",
    });
  });

  it("Acquéreur : budget min > max → état erreur (parseur), aucune écriture", async () => {
    await expect(
      creerAcquereurAction(ETAT_FORMULAIRE_INITIAL, formulaire({ prenom: "A", nom: `${M} Acq`, email: "a@example.test", telephone: "0600000000", budgetMin: "500000", budgetMax: "100000", stadeProjet: "recherche_active", datePremiereContact: "2026-01-01" }))
    ).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/budget minimum/) });
    expect(await getDb().select().from(acquereursTable).where(eq(acquereursTable.nom, `${M} Acq`))).toEqual([]);
  });

  it("erreur inattendue (infrastructure) → continue à lever, jamais un état de formulaire", async () => {
    const bien = await unBien("INFRA");
    // Le workspace est résolu APRÈS la garde de session, dans le helper : une panne à cet endroit
    // est une erreur d'infrastructure, pas une saisie — elle doit traverser avecFeedbackFormulaire.
    workspaceMock.mockRejectedValueOnce(new Error("connexion Postgres perdue (simulée)"));
    await expect(creerTacheAction(ETAT_FORMULAIRE_INITIAL, formulaire({ titre: `${M} infra`, type: "autre", priorite: "normale", bienId: bien.id }))).rejects.toThrow(
      "connexion Postgres perdue (simulée)"
    );
  });

  it("absence de session → lève AVANT toute validation de saisie (fail-closed)", async () => {
    sessionMock.mockRejectedValueOnce(new Error("Non authentifié."));
    await expect(creerTacheAction(ETAT_FORMULAIRE_INITIAL, formulaire({ titre: " ", type: "autre", priorite: "normale" }))).rejects.toThrow("Non authentifié.");
    sessionMock.mockRejectedValueOnce(new Error("Non authentifié."));
    await expect(ajouterOffreAction(ETAT_FORMULAIRE_INITIAL, formulaire({ montant: "abc" }))).rejects.toThrow("Non authentifié.");
  });
});
