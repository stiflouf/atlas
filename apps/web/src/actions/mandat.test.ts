import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-060 §13, §16 — les Server Actions Mandat (lot MANDATE_CANONICAL_UI_V1) : session, workspace de
// SESSION, parsing, writer, résultat typé rapporté à l'écran (`?mandat=`), redirection vers la fiche
// du bien. Cross-workspace = notFound(). `date_fin` jamais touchée par la résiliation. Après une
// résiliation, la présentation ne retombe jamais sur le legacy « actif ».
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { biens: biensTable, contactFusions: contactFusionsTable, contacts: contactsTable, mandats: mandatsTable, partiesMandat: partiesMandatTable, workspaces: workspacesTable } = await import("@/db/schema");
const { creerBien, getBienById } = await import("@/lib/bienRepository");
const { creerContact } = await import("@/lib/contactRepository");
const { creerMandat, creerMandatSuccesseur, getMandatById, listerMandatsDuBien } = await import("@/lib/mandatRepository");
const { ajouterPartieMandat, listerPartiesMandat } = await import("@/lib/partieMandatRepository");
const { chargerPresentationMandatBien, statutMandatEffectif } = await import("@/lib/presentationMandatBien");
const { fusionnerContacts } = await import("@/lib/fusionContactRepository");
const {
  ajouterPartieMandatAction,
  enregistrerMandatExistantAction,
  modifierMandatAction,
  modifierRolePartieMandatAction,
  resilierMandatAction,
  retirerPartieMandatAction,
} = await import("./mandat");

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

const M = `Zactionmandat${Date.now()}`;
const biensCrees: string[] = [];
const contactsCrees: string[] = [];
const workspacesCrees: string[] = [];
let compteur = 0;

async function unBien(workspaceId = WORKSPACE_TEST, statutMandat: "actif" | "suspendu" | "expire" = "actif") {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] ACTION-MANDAT-${compteur}-${Date.now()}`,
      titre: "Bien action mandat",
      type: "appartement",
      adresse: "1 rue des Actions",
      ville: "Testville",
      codePostal: "00000",
      surface: 40,
      pieces: 2,
      prix: 200000,
      statutMandat,
      dateMandat: "2026-01-15",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  biensCrees.push(bien.id);
  return bien;
}

async function unContact(nom = `${M} Contact`, workspaceId = WORKSPACE_TEST) {
  const contact = await creerContact({ nom }, workspaceId);
  contactsCrees.push(contact.id);
  return contact;
}

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-action-mandat-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace actions mandat" });
  workspacesCrees.push(id);
  return id;
}

afterAll(async () => {
  if (biensCrees.length > 0) {
    const mandats = (await getDb().select({ id: mandatsTable.id }).from(mandatsTable).where(inArray(mandatsTable.bienId, biensCrees))).map((m) => m.id);
    if (mandats.length > 0) await getDb().delete(partiesMandatTable).where(inArray(partiesMandatTable.mandatId, mandats));
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, biensCrees));
    await getDb().delete(biensTable).where(inArray(biensTable.id, biensCrees));
  }
  if (contactsCrees.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, contactsCrees));
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, contactsCrees));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  }
  if (workspacesCrees.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
});

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

// `redirect()` et `notFound()` lèvent par conception (Next.js) : on capture le digest.
async function soumettre(action: (fd: FormData) => Promise<void>, fd: FormData): Promise<string> {
  try {
    await action(fd);
    return "aucune";
  } catch (erreur) {
    return String((erreur as { digest?: string }).digest ?? (erreur as Error).message);
  }
}

describe("modifierMandatAction", () => {
  it("succès : type, numéro, terme, exclusivité modifiés ; prise d'effet intacte ; redirection vers la fiche", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-15", type: "simple" });
    const issue = await soumettre(
      modifierMandatAction,
      formulaire({ mandatId: mandat.id, bienId: bien.id, typeMandat: "semi_exclusif", numeroMandat: " M-77 ", dateFinMandat: "2026-12-31", exclusiviteJusquAu: "2026-06-30" })
    );
    expect(issue).toContain(`NEXT_REDIRECT;replace;/biens/${bien.id}#mandat`);
    const relu = (await getMandatById(mandat.id, WORKSPACE_TEST))!;
    expect(relu).toMatchObject({ type: "semi_exclusif", numero: "M-77", dateFin: "2026-12-31", exclusiviteJusquAu: "2026-06-30", dateDebut: "2026-01-15" });
  });

  // DEMO_UX_HARDENING_V1 — une saisie invalide n'éjecte plus sur error.tsx : elle emprunte le canal
  // de refus déjà en place (`?mandat=saisie_invalide`), affiché par MandatBienPanel. Rien n'est écrit.
  it("validation : type absent ou hors vocabulaire, date mal formée → ?mandat=saisie_invalide, rien d'écrit", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-15", type: "simple" });
    expect(await soumettre(modifierMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, typeMandat: "" }))).toContain("?mandat=saisie_invalide");
    expect(await soumettre(modifierMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, typeMandat: "reseau" }))).toContain("?mandat=saisie_invalide");
    expect(await soumettre(modifierMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, typeMandat: "simple", dateFinMandat: "31/12/2026" }))).toContain("?mandat=saisie_invalide");
    expect((await getMandatById(mandat.id, WORKSPACE_TEST))!.type).toBe("simple");
  });

  it("dates incohérentes → rapportées à l'écran (?mandat=dates_incoherentes), rien d'écrit", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-15", type: "simple" });
    const issue = await soumettre(modifierMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, typeMandat: "exclusif", dateFinMandat: "2025-01-01" }));
    expect(issue).toContain(`/biens/${bien.id}?mandat=dates_incoherentes`);
    expect((await getMandatById(mandat.id, WORKSPACE_TEST))!.type).toBe("simple");
  });

  it("mandat résilié ou remplacé → refus rapporté ; autre workspace ou inconnu → notFound()", async () => {
    const bien = await unBien();
    const ancien = await creerMandat({ bienId: bien.id, dateDebut: "2025-01-01", type: "simple" });
    await creerMandatSuccesseur(ancien.id, { dateDebut: "2026-01-15", type: "simple" });
    expect(await soumettre(modifierMandatAction, formulaire({ mandatId: ancien.id, bienId: bien.id, typeMandat: "exclusif" }))).toContain("?mandat=remplace");

    const bien2 = await unBien();
    const resilie = await creerMandat({ bienId: bien2.id, dateDebut: "2026-01-15", type: "simple" });
    await soumettre(resilierMandatAction, formulaire({ mandatId: resilie.id, bienId: bien2.id, resilieLe: "2026-02-01" }));
    expect(await soumettre(modifierMandatAction, formulaire({ mandatId: resilie.id, bienId: bien2.id, typeMandat: "exclusif" }))).toContain("?mandat=resilie");

    const autre = await unAutreWorkspace("modifier");
    workspaceCourantMock.mockResolvedValueOnce(autre);
    expect(await soumettre(modifierMandatAction, formulaire({ mandatId: resilie.id, bienId: bien2.id, typeMandat: "exclusif" }))).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await soumettre(modifierMandatAction, formulaire({ mandatId: "00000000-0000-4000-8000-000000000000", bienId: bien2.id, typeMandat: "exclusif" }))).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

describe("resilierMandatAction", () => {
  it("succès avec et sans motif : resilie_le posé, date_fin intacte, le mandat quitte le courant, jamais de retour au legacy actif", async () => {
    const bien = await unBien(WORKSPACE_TEST, "actif");
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-15", dateFin: "2026-12-31", type: "exclusif" });
    const issue = await soumettre(resilierMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, resilieLe: "2026-03-01", motifResiliation: "  Vendeur renonce  " }));
    expect(issue).toContain(`NEXT_REDIRECT;replace;/biens/${bien.id}#mandat`);
    const relu = (await getMandatById(mandat.id, WORKSPACE_TEST))!;
    expect(relu).toMatchObject({ resilieLe: "2026-03-01", motifResiliation: "Vendeur renonce", dateFin: "2026-12-31" });

    const presentation = await chargerPresentationMandatBien((await getBienById(bien.id))!, WORKSPACE_TEST, "2026-06-15");
    expect(presentation.mode).toBe("canonique");
    if (presentation.mode !== "canonique") return;
    expect(presentation.mandatCourant).toBeUndefined();
    expect(presentation.historique.map((m) => m.statut)).toEqual(["resilie"]);
    expect(statutMandatEffectif(presentation).libelle).toBe("Aucun mandat en cours");
    expect((await getBienById(bien.id))!.statutMandat, "le legacy reste stocké mais n'est plus lu").toBe("actif");

    const bien2 = await unBien();
    const sansMotif = await creerMandat({ bienId: bien2.id, dateDebut: "2026-01-15", type: "simple" });
    await soumettre(resilierMandatAction, formulaire({ mandatId: sansMotif.id, bienId: bien2.id, resilieLe: "2026-03-01", motifResiliation: "   " }));
    expect((await getMandatById(sansMotif.id, WORKSPACE_TEST))!.motifResiliation).toBeUndefined();
  });

  it("date absente ou mal formée → refus avant écriture ; date avant la prise d'effet → ?mandat=date_incoherente", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-15", type: "simple" });
    expect(await soumettre(resilierMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, resilieLe: "" }))).toContain("?mandat=saisie_invalide");
    expect(await soumettre(resilierMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, resilieLe: "01/03/2026" }))).toContain("?mandat=saisie_invalide");
    expect(await soumettre(resilierMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, resilieLe: "2025-12-31" }))).toContain("?mandat=date_incoherente");
    expect((await getMandatById(mandat.id, WORKSPACE_TEST))!.resilieLe).toBeUndefined();
  });

  it("déjà résilié, remplacé → refus rapporté ; autre workspace → notFound()", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-15", type: "simple" });
    await soumettre(resilierMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, resilieLe: "2026-02-01" }));
    expect(await soumettre(resilierMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, resilieLe: "2026-03-01" }))).toContain("?mandat=deja_resilie");
    expect((await getMandatById(mandat.id, WORKSPACE_TEST))!.resilieLe, "la première résiliation reste").toBe("2026-02-01");

    const bien2 = await unBien();
    const ancien = await creerMandat({ bienId: bien2.id, dateDebut: "2025-01-01", type: "simple" });
    await creerMandatSuccesseur(ancien.id, { dateDebut: "2026-01-15", type: "simple" });
    expect(await soumettre(resilierMandatAction, formulaire({ mandatId: ancien.id, bienId: bien2.id, resilieLe: "2026-02-01" }))).toContain("?mandat=remplace");

    const autre = await unAutreWorkspace("resilier");
    workspaceCourantMock.mockResolvedValueOnce(autre);
    expect(await soumettre(resilierMandatAction, formulaire({ mandatId: ancien.id, bienId: bien2.id, resilieLe: "2026-02-01" }))).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

describe("enregistrerMandatExistantAction", () => {
  it("legacy-only → mandat canonique créé avec les faits SOUMIS (date explicite), bascule en mode canonique", async () => {
    const bien = await unBien(WORKSPACE_TEST, "actif");
    expect((await chargerPresentationMandatBien(bien, WORKSPACE_TEST, "2026-06-15")).mode).toBe("legacy");
    const issue = await soumettre(
      enregistrerMandatExistantAction,
      formulaire({ bienId: bien.id, dateDebutMandat: "2026-01-20", typeMandat: "exclusif", numeroMandat: "REG-1", dateFinMandat: "2027-01-19" })
    );
    expect(issue).toContain(`NEXT_REDIRECT;replace;/biens/${bien.id}#mandat`);
    const mandats = await listerMandatsDuBien(bien.id, WORKSPACE_TEST, "2026-06-15");
    expect(mandats).toHaveLength(1);
    // La date soumise, pas `biens.date_mandat` (2026-01-15) : aucune copie silencieuse.
    expect(mandats[0]).toMatchObject({ dateDebut: "2026-01-20", type: "exclusif", numero: "REG-1", dateFin: "2027-01-19", statut: "actif" });
    const presentation = await chargerPresentationMandatBien(bien, WORKSPACE_TEST, "2026-06-15");
    expect(presentation.mode).toBe("canonique");
  });

  it("date ou type absents → refus avant écriture ; canonique déjà présent → ?mandat=mandat_canonique_existant", async () => {
    const bien = await unBien();
    expect(await soumettre(enregistrerMandatExistantAction, formulaire({ bienId: bien.id, dateDebutMandat: "", typeMandat: "simple" }))).toContain("?mandat=saisie_invalide");
    expect(await soumettre(enregistrerMandatExistantAction, formulaire({ bienId: bien.id, dateDebutMandat: "2026-01-01", typeMandat: "" }))).toContain("?mandat=saisie_invalide");
    expect(await listerMandatsDuBien(bien.id, WORKSPACE_TEST)).toEqual([]);
    await soumettre(enregistrerMandatExistantAction, formulaire({ bienId: bien.id, dateDebutMandat: "2026-01-01", typeMandat: "simple" }));
    expect(await soumettre(enregistrerMandatExistantAction, formulaire({ bienId: bien.id, dateDebutMandat: "2026-01-01", typeMandat: "simple" }))).toContain("?mandat=mandat_canonique_existant");
    expect(await listerMandatsDuBien(bien.id, WORKSPACE_TEST)).toHaveLength(1);
  });

  it("double submit concurrent → exactement un mandat", async () => {
    const bien = await unBien();
    const fd = () => formulaire({ bienId: bien.id, dateDebutMandat: "2026-01-01", typeMandat: "simple" });
    const issues = await Promise.all([soumettre(enregistrerMandatExistantAction, fd()), soumettre(enregistrerMandatExistantAction, fd())]);
    expect(issues.filter((i) => i.includes("NEXT_REDIRECT;replace;/biens/") && !i.includes("?mandat="))).toHaveLength(1);
    expect(issues.filter((i) => i.includes("?mandat=mandat_canonique_existant"))).toHaveLength(1);
    expect(await listerMandatsDuBien(bien.id, WORKSPACE_TEST)).toHaveLength(1);
  });

  it("bien d'un autre workspace, inconnu ou id invalide → notFound(), rien d'écrit", async () => {
    const autre = await unAutreWorkspace("enregistrer");
    const ailleurs = await unBien(autre);
    expect(await soumettre(enregistrerMandatExistantAction, formulaire({ bienId: ailleurs.id, dateDebutMandat: "2026-01-01", typeMandat: "simple" }))).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await soumettre(enregistrerMandatExistantAction, formulaire({ bienId: "00000000-0000-4000-8000-000000000000", dateDebutMandat: "2026-01-01", typeMandat: "simple" }))).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await soumettre(enregistrerMandatExistantAction, formulaire({ bienId: "pas-un-uuid", dateDebutMandat: "2026-01-01", typeMandat: "simple" }))).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await getDb().select().from(mandatsTable).where(eq(mandatsTable.bienId, ailleurs.id))).toEqual([]);
  });
});

describe("parties de mandat — ajouter, changer de rôle, retirer", () => {
  it("ajouter mandant, mandant, représentant ; doublon → ?mandat=deja_partie ; rôle invalide → refus", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-15", type: "simple" });
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const c = await unContact(`${M} C`);
    for (const [contact, role] of [[a, "mandant"], [b, "mandant"], [c, "representant"]] as const) {
      const issue = await soumettre(ajouterPartieMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, contactId: contact.id, role }));
      expect(issue).toContain(`NEXT_REDIRECT;replace;/biens/${bien.id}#mandat`);
    }
    expect(await soumettre(ajouterPartieMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, contactId: a.id, role: "representant" }))).toContain("?mandat=deja_partie");
    expect(await soumettre(ajouterPartieMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, contactId: a.id, role: "notaire" }))).toMatch(/rôle est obligatoire/);
    const parties = await listerPartiesMandat(mandat.id, WORKSPACE_TEST);
    expect(parties.map((p) => [p.contactId, p.role])).toEqual([[a.id, "mandant"], [b.id, "mandant"], [c.id, "representant"]]);
  });

  it("contact absorbé → ?mandat=contact_fusionne ; contact d'un autre workspace → ?mandat=contact_introuvable ; mandat d'un autre workspace → notFound()", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-15", type: "simple" });
    const s = await unContact(`${M} S`);
    const absorbe = await unContact(`${M} Absorbé`);
    const fusion = await fusionnerContacts({
      workspaceId: WORKSPACE_TEST,
      contactSurvivantId: s.id,
      contactAbsorbeId: absorbe.id,
      identiteAttendueSurvivant: { nom: s.nom, modifieLe: s.modifieLe },
      identiteAttendueAbsorbe: { nom: absorbe.nom, modifieLe: absorbe.modifieLe },
      identiteFinale: { nom: s.nom },
      choixParChamp: { nom: "survivant", prenom: "identique", email: "identique", telephone: "identique" },
      acteur: {},
    });
    expect(fusion.statut).toBe("fusionne");
    expect(await soumettre(ajouterPartieMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, contactId: absorbe.id, role: "mandant" }))).toContain("?mandat=contact_fusionne");

    const autre = await unAutreWorkspace("partie");
    const etranger = await unContact(`${M} Étranger`, autre);
    expect(await soumettre(ajouterPartieMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, contactId: etranger.id, role: "mandant" }))).toContain("?mandat=contact_introuvable");

    workspaceCourantMock.mockResolvedValueOnce(autre);
    expect(await soumettre(ajouterPartieMandatAction, formulaire({ mandatId: mandat.id, bienId: bien.id, contactId: s.id, role: "mandant" }))).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await listerPartiesMandat(mandat.id, WORKSPACE_TEST)).toEqual([]);
  });

  it("changer de rôle (même ligne, cree_le intact) puis retirer ; autre workspace → notFound() ; le contact reste", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-15", type: "simple" });
    const a = await unContact(`${M} Rôle`);
    const ajout = await ajouterPartieMandat(mandat.id, { contactId: a.id, role: "representant" }, WORKSPACE_TEST);
    if (ajout.statut !== "ajoutee") throw new Error(ajout.statut);

    const autre = await unAutreWorkspace("role");
    workspaceCourantMock.mockResolvedValueOnce(autre);
    expect(await soumettre(modifierRolePartieMandatAction, formulaire({ partieId: ajout.partie.id, bienId: bien.id, role: "mandant" }))).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await soumettre(modifierRolePartieMandatAction, formulaire({ partieId: ajout.partie.id, bienId: bien.id, role: "mandant" }))).toContain(`NEXT_REDIRECT;replace;/biens/${bien.id}#mandat`);
    const [partie] = await listerPartiesMandat(mandat.id, WORKSPACE_TEST);
    expect(partie).toMatchObject({ id: ajout.partie.id, role: "mandant", creeLe: ajout.partie.creeLe });

    workspaceCourantMock.mockResolvedValueOnce(autre);
    expect(await soumettre(retirerPartieMandatAction, formulaire({ partieId: ajout.partie.id, bienId: bien.id }))).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await listerPartiesMandat(mandat.id, WORKSPACE_TEST)).toHaveLength(1);
    expect(await soumettre(retirerPartieMandatAction, formulaire({ partieId: ajout.partie.id, bienId: bien.id }))).toContain(`NEXT_REDIRECT;replace;/biens/${bien.id}#mandat`);
    expect(await listerPartiesMandat(mandat.id, WORKSPACE_TEST)).toEqual([]);
    expect(await getDb().select().from(contactsTable).where(eq(contactsTable.id, a.id))).toHaveLength(1);
    expect(await soumettre(retirerPartieMandatAction, formulaire({ partieId: ajout.partie.id, bienId: bien.id }))).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
