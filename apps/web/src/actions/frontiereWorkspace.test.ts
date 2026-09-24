import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import { ETAT_FORMULAIRE_INITIAL } from "@/lib/formulaires/etatFormulaire";

// WORKSPACE_SCOPING_V1 (ADR-054) — la preuve, pas la garde structurelle : deux workspaces réels,
// des identifiants du workspace B soumis depuis une session du workspace A. Aucune écriture ne
// doit avoir lieu, et le refus doit être indistinguable d'un identifiant qui n'existe pas.
//
// Ces tests portent sur les MUTATIONS durcies par ce lot. Le périmètre de session est piloté par
// le mock ci-dessous, comme dans actions/mandat.test.ts.
const { sessionMock, workspaceMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  workspaceMock: vi.fn(),
}));
vi.mock("@/lib/auth/sessionAtlas", () => ({ exigerSessionAtlas: () => sessionMock() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: () => workspaceMock() }));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  biens: biensTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  documentsBien: documentsBienTable,
  notesBien: notesBienTable,
  photosBien: photosBienTable,
  prospectsVendeurs: prospectsVendeursTable,
  taches: tachesTable,
  visites: visitesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien, getBienById } = await import("@/lib/bienRepository");
const { creerAcquereur, getClientById } = await import("@/lib/clientRepository");
const { creerTache, getTacheById, getTacheDuWorkspace } = await import("@/lib/tacheRepository");
const { creerProspectVendeur, getProspectVendeurDuWorkspace } = await import("@/lib/prospectVendeurRepository");
const { creerVisite } = await import("@/lib/visiteRepository");
const { archiverBienAction, desarchiverBienAction } = await import("./archivageBien");
const { archiverAcquereurAction, desarchiverAcquereurAction } = await import("./archivageAcquereur");
const { marquerOffreEnCoursAction, marquerCompromisSigneAction } = await import("./statutCommercialBien");
const { terminerTacheAction } = await import("./terminerTache");
const { annulerTacheAction } = await import("./annulerTache");
const { creerTacheAction } = await import("./creerTache");
const { ajouterNoteBienAction } = await import("./ajouterNoteBien");
const { enregistrerCompteRenduVisiteAction } = await import("./enregistrerCompteRenduVisite");
const { modifierBienAction } = await import("./modifierBien");
const { ajouterDocumentBienAction, corrigerClassementDocumentBienAction } = await import("./ajouterDocumentBien");
const { ajouterPhotoBienAction } = await import("./ajouterPhotoBien");
const { listerDocumentsPourBien } = await import("@/lib/documentBienRepository");
const { listerPhotosBien } = await import("@/lib/photoBienRepository");

const M = `Zfrontiere${Date.now()}`;
const WORKSPACE_B = `ws-frontiere-${Date.now()}`;
let compteur = 0;
const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsTaches: string[] = [];
const idsProspects: string[] = [];
let workspaceBCree = false;

beforeEach(() => {
  sessionMock.mockReset().mockResolvedValue({ sub: "frontiere-sub", email: "conseiller@example.test" });
  // Session du workspace A : c'est depuis lui qu'on tente d'atteindre les entités de B.
  workspaceMock.mockReset().mockResolvedValue(WORKSPACE_TEST);
});

// Les cas « aucun fichier écrit » ont besoin d'une racine de stockage à eux : elle doit rester
// VIDE à la fin, ce qui n'aurait aucun sens dans le dossier de dev partagé.
let dirStockageTest: string;

beforeAll(async () => {
  dirStockageTest = await mkdtemp(path.join(tmpdir(), "atlas-frontiere-workspace-"));
  vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dirStockageTest, { recursive: true, force: true });
});

afterAll(async () => {
  if (idsBiens.length > 0) {
    await getDb().delete(photosBienTable).where(inArray(photosBienTable.bienId, idsBiens));
    await getDb().delete(documentsBienTable).where(inArray(documentsBienTable.bienId, idsBiens));
    await getDb().delete(comptesRendusVisiteTable).where(inArray(comptesRendusVisiteTable.bienId, idsBiens));
    await getDb().delete(visitesTable).where(inArray(visitesTable.bienId, idsBiens));
    await getDb().delete(notesBienTable).where(inArray(notesBienTable.bienId, idsBiens));
    await getDb().delete(tachesTable).where(inArray(tachesTable.bienId, idsBiens));
  }
  if (idsTaches.length > 0) await getDb().delete(tachesTable).where(inArray(tachesTable.id, idsTaches));
  if (idsProspects.length > 0) await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (workspaceBCree) await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
});

async function autreWorkspace() {
  if (!workspaceBCree) {
    await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] frontière B" });
    workspaceBCree = true;
  }
  return WORKSPACE_B;
}

async function unBien(workspaceId: string) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `${M}-BIEN-${compteur}`,
      titre: "Bien frontière",
      type: "appartement",
      adresse: "1 rue de la Frontière",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat: "actif" as const,
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  return bien;
}

async function unAcquereur(workspaceId: string) {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: "Frontière",
      nom: `${M} Acquereur ${compteur}`,
      email: `${M}.${compteur}@example.test`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "recherche_active" as const,
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

// Les actions se terminent par redirect()/notFound(), qui lèvent par conception.
const soumettre = (p: Promise<unknown>) => p.catch(() => undefined);

describe("Frontière workspace — mutations sur un Bien", () => {
  it("archiver puis désarchiver un bien de B depuis A : aucune bascule d'archivage", async () => {
    const bienB = await unBien(await autreWorkspace());

    await soumettre(archiverBienAction(formulaire({ id: bienB.id })));
    expect((await getBienById(bienB.id))?.archiveLe).toBeUndefined();

    // Et dans l'autre sens, sur un bien réellement archivé dans B.
    workspaceMock.mockResolvedValue(WORKSPACE_B);
    await soumettre(archiverBienAction(formulaire({ id: bienB.id })));
    expect((await getBienById(bienB.id))?.archiveLe).toBeDefined();

    workspaceMock.mockResolvedValue(WORKSPACE_TEST);
    await soumettre(desarchiverBienAction(formulaire({ id: bienB.id })));
    expect((await getBienById(bienB.id))?.archiveLe).toBeDefined();
  });

  it("poser un jalon commercial sur un bien de B depuis A : aucun jalon écrit", async () => {
    const bienB = await unBien(await autreWorkspace());

    await soumettre(marquerOffreEnCoursAction(formulaire({ id: bienB.id })));
    await soumettre(marquerCompromisSigneAction(formulaire({ id: bienB.id })));

    const relu = await getBienById(bienB.id);
    expect(relu?.offreEnCoursLe).toBeUndefined();
    expect(relu?.compromisSigneLe).toBeUndefined();
  });

  it("modifier un bien de B depuis A : aucun champ réécrit", async () => {
    const bienB = await unBien(await autreWorkspace());
    // Le géocodage est neutralisé : il s'exécute AVANT le périmètre (la commune est résolue pour
    // construire le payload), et il n'a rien à voir avec ce qu'on prouve ici.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [] }), { status: 200 })));

    await soumettre(
      modifierBienAction(
        ETAT_FORMULAIRE_INITIAL,
        formulaire({
          id: bienB.id,
          titre: "Titre volé",
          type: "appartement",
          adresse: "1 rue de la Frontière",
          ville: "Testville",
          codePostal: "00000",
          surface: "50",
          pieces: "2",
          prix: "999999",
          statutMandat: "actif",
          dateMandat: "2026-01-01",
        })
      )
    );
    vi.unstubAllGlobals();

    const relu = await getBienById(bienB.id);
    expect(relu?.titre).toBe("Bien frontière");
    expect(relu?.prix).toBe(300000);
  });

  it("ajouter une note à un bien de B depuis A : aucune note créée", async () => {
    const bienB = await unBien(await autreWorkspace());

    await soumettre(ajouterNoteBienAction(formulaire({ bienId: bienB.id, contenu: "Note indiscrète" })));

    const notes = await getDb().select().from(notesBienTable).where(eq(notesBienTable.bienId, bienB.id));
    expect(notes).toEqual([]);
  });
});

describe("Frontière workspace — mutations sur un Acquéreur", () => {
  it("archiver puis désarchiver un acquéreur de B depuis A : aucune bascule", async () => {
    const acquereurB = await unAcquereur(await autreWorkspace());

    await soumettre(archiverAcquereurAction(formulaire({ id: acquereurB.id })));
    expect((await getClientById(acquereurB.id))?.archiveLe).toBeUndefined();

    workspaceMock.mockResolvedValue(WORKSPACE_B);
    await soumettre(archiverAcquereurAction(formulaire({ id: acquereurB.id })));
    expect((await getClientById(acquereurB.id))?.archiveLe).toBeDefined();

    workspaceMock.mockResolvedValue(WORKSPACE_TEST);
    await soumettre(desarchiverAcquereurAction(formulaire({ id: acquereurB.id })));
    expect((await getClientById(acquereurB.id))?.archiveLe).toBeDefined();
  });
});

describe("Frontière workspace — Tâches", () => {
  it("terminer ou annuler une tâche de B depuis A : statut inchangé", async () => {
    const tacheB = await creerTache({ titre: `${M} tâche B`, type: "autre", priorite: "normale", origine: "manuelle" }, await autreWorkspace());
    idsTaches.push(tacheB.id);

    await soumettre(terminerTacheAction(formulaire({ id: tacheB.id, redirectTo: "/" })));
    await soumettre(annulerTacheAction(formulaire({ id: tacheB.id, redirectTo: "/" })));

    const relue = await getTacheById(tacheB.id);
    expect(relue?.termineeLe).toBeUndefined();
    expect(relue?.annuleeLe).toBeUndefined();
  });

  it("créer une tâche de A visant un bien de B : refus, aucune tâche créée", async () => {
    const bienB = await unBien(await autreWorkspace());

    const etat = await creerTacheAction(
      { statut: "idle" },
      formulaire({ titre: `${M} tâche croisée`, type: "autre", priorite: "normale", bienId: bienB.id, redirectTo: "/" })
    );

    expect(etat.statut).toBe("erreur");
    const taches = await getDb().select().from(tachesTable).where(eq(tachesTable.bienId, bienB.id));
    expect(taches).toEqual([]);
  });

  it("créer une tâche de A visant un acquéreur de B : refus, aucune tâche créée", async () => {
    const acquereurB = await unAcquereur(await autreWorkspace());

    const etat = await creerTacheAction(
      { statut: "idle" },
      formulaire({ titre: `${M} tâche croisée acq`, type: "autre", priorite: "normale", acquereurId: acquereurB.id, redirectTo: "/" })
    );

    expect(etat.statut).toBe("erreur");
    expect(await getDb().select().from(tachesTable).where(eq(tachesTable.acquereurId, acquereurB.id))).toEqual([]);
  });

  // Troisième cible supportée par `creerTacheAction` : elle doit répondre comme les deux autres,
  // sans quoi le prospect vendeur resterait le seul chemin ouvert vers un dossier fantôme.
  it("créer une tâche de A visant un prospect vendeur de B : refus, aucune tâche créée", async () => {
    const prospectB = await creerProspectVendeur({ nom: `${M} Prospect B` }, await autreWorkspace());
    idsProspects.push(prospectB.id);

    const etat = await creerTacheAction(
      { statut: "idle" },
      formulaire({
        titre: `${M} tâche croisée prospect`,
        type: "autre",
        priorite: "normale",
        prospectVendeurId: prospectB.id,
        redirectTo: "/",
      })
    );

    expect(etat).toEqual({ statut: "erreur", message: "Impossible d'ajouter une tâche à un prospect vendeur archivé." });
    expect(
      await getDb().select().from(tachesTable).where(eq(tachesTable.prospectVendeurId, prospectB.id))
    ).toEqual([]);
  });
});

// §22 — le point le plus coûteux d'une frontière manquée : un fichier écrit (ou effacé) pour le
// compte d'un autre workspace. La preuve n'est pas « la ligne est absente » mais « la racine de
// stockage est restée vide ».
describe("Frontière workspace — documents et photos d'un Bien de B", () => {
  it("ajouter un document sur un bien de B depuis A : aucune métadonnée, aucun fichier écrit", async () => {
    const bienB = await unBien(await autreWorkspace());
    const fichier = new File([new Uint8Array([1, 2, 3])], "diag.pdf", { type: "application/pdf" });
    const fd = formulaire({ bienId: bienB.id, nom: "Diagnostic indiscret", categorie: "diagnostic" });
    fd.set("fichier", fichier);

    const etat = await ajouterDocumentBienAction(ETAT_FORMULAIRE_INITIAL, fd).catch(() => undefined);

    expect(etat).toEqual({ statut: "erreur", message: "Bien introuvable." });
    await expect(listerDocumentsPourBien(bienB.id)).resolves.toEqual([]);
    await expect(readdir(dirStockageTest)).resolves.toEqual([]);
  });

  it("ajouter une photo sur un bien de B depuis A : aucune ligne, aucun original ni WebP", async () => {
    const bienB = await unBien(await autreWorkspace());
    const fd = formulaire({ bienId: bienB.id });
    fd.set("fichier", new File([new Uint8Array([255, 216, 255])], "photo.jpg", { type: "image/jpeg" }));

    const resultat = await ajouterPhotoBienAction(fd);

    expect(resultat).toEqual({ succes: false, erreur: "Bien introuvable." });
    await expect(listerPhotosBien(bienB.id)).resolves.toEqual([]);
    await expect(readdir(dirStockageTest)).resolves.toEqual([]);
  });

  // §9 — la correction de classement est la seule opération capable de faire changer de bien un
  // document DÉJÀ écrit : les deux extrémités doivent être prouvées, pas seulement la source.
  it("reclasser un document de A vers un bien de B : refus, rattachement inchangé", async () => {
    const bienA = await unBien(WORKSPACE_TEST);
    const bienB = await unBien(await autreWorkspace());
    const fd = formulaire({ bienId: bienA.id, nom: "Diagnostic", categorie: "diagnostic" });
    fd.set("fichier", new File([new Uint8Array([4, 5, 6])], "diag.pdf", { type: "application/pdf" }));
    await soumettre(ajouterDocumentBienAction(ETAT_FORMULAIRE_INITIAL, fd));

    const [document] = await listerDocumentsPourBien(bienA.id);
    expect(document).toBeDefined();

    const etat = await corrigerClassementDocumentBienAction(
      ETAT_FORMULAIRE_INITIAL,
      formulaire({
        id: document.id,
        bienId: bienB.id,
        nom: "Diagnostic déplacé",
        categorie: "diagnostic",
        typeDocument: "dpe",
        etatVerification: "confirme",
      })
    ).catch(() => undefined);

    expect(etat).toEqual({ statut: "erreur", message: "Bien introuvable." });
    await expect(listerDocumentsPourBien(bienB.id)).resolves.toEqual([]);
    const [inchange] = await listerDocumentsPourBien(bienA.id);
    expect(inchange.bienId).toBe(bienA.id);
    expect(inchange.nom).toBe("Diagnostic");
  });
});

describe("Frontière workspace — Compte rendu de visite", () => {
  it("enregistrer un compte rendu depuis A sur une visite de B : aucun compte rendu, même pas « sans lien »", async () => {
    const workspaceB = await autreWorkspace();
    const bienB = await unBien(workspaceB);
    const acquereurB = await unAcquereur(workspaceB);
    const visite = await creerVisite({ bienId: bienB.id, acquereurId: acquereurB.id, datePrevue: "2026-06-01" }, workspaceB);
    if (visite.statut !== "creee") throw new Error("visite attendue");

    await soumettre(
      enregistrerCompteRenduVisiteAction(
        formulaire({
          bienId: bienB.id,
          acquereurId: acquereurB.id,
          visiteId: visite.visite.id,
          dateVisite: "2026-06-01",
          retour: "Retour indiscret",
          interet: "interesse",
        })
      )
    );

    const comptesRendus = await getDb()
      .select()
      .from(comptesRendusVisiteTable)
      .where(eq(comptesRendusVisiteTable.bienId, bienB.id));
    expect(comptesRendus).toEqual([]);

    const [visiteRelue] = await getDb().select().from(visitesTable).where(eq(visitesTable.id, visite.visite.id));
    expect(visiteRelue.statut).toBe("planifiee");
  });
});

// §23 — les lecteurs scopés créés par ce lot : trouvé dans SON workspace, introuvable ailleurs, et
// un identifiant inexistant donne exactement le même résultat.
describe("Frontière workspace — lecteurs scopés", () => {
  it("getTacheDuWorkspace : trouvée dans A, introuvable depuis B, comme un id inexistant", async () => {
    const tacheA = await creerTache({ titre: `${M} tâche A`, type: "autre", priorite: "normale", origine: "manuelle" }, WORKSPACE_TEST);
    idsTaches.push(tacheA.id);

    expect((await getTacheDuWorkspace(tacheA.id, WORKSPACE_TEST))?.id).toBe(tacheA.id);
    expect(await getTacheDuWorkspace(tacheA.id, await autreWorkspace())).toBeUndefined();
    expect(await getTacheDuWorkspace("00000000-0000-4000-8000-000000000000", WORKSPACE_TEST)).toBeUndefined();
  });

  it("getProspectVendeurDuWorkspace : même contrat", async () => {
    const prospectA = await creerProspectVendeur({ nom: `${M} Prospect A` }, WORKSPACE_TEST);
    idsProspects.push(prospectA.id);

    expect((await getProspectVendeurDuWorkspace(prospectA.id, WORKSPACE_TEST))?.id).toBe(prospectA.id);
    expect(await getProspectVendeurDuWorkspace(prospectA.id, await autreWorkspace())).toBeUndefined();
    expect(await getProspectVendeurDuWorkspace("00000000-0000-4000-8000-000000000000", WORKSPACE_TEST)).toBeUndefined();
  });
});
