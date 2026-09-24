import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-047 : session Atlas mockée comme valide pour les tests de comportement métier ci-dessous ;
// le contrôle du refus anonyme est vérifié séparément dans un describe dédié plus bas, avec le
// vrai mécanisme de session (cookies), même patron que src/app/api/documents/[id]/route.test.ts.
const exigerSessionAtlasMock = vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" });
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: () => exigerSessionAtlasMock(),
}));

// ADR-054 — même raison que le mock de session juste au-dessus : ces tests portent sur le
// COMPORTEMENT MÉTIER de l'action, pas sur la résolution du périmètre (couverte par ses propres
// tests, src/lib/auth/workspaceCourant.test.ts). Sans ce mock, la résolution tenterait un bootstrap
// d'appartenance pour un `sub` fictif et dépendrait de l'allowlist. Le littéral est celui du
// workspace historique : ce que l'action écrit reste vérifié en base par les assertions.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const REFERENCE_PREFIX = "[test réel] ADR052-ACTION-GERER";
const { getDb } = await import("@/db/client");
const { biens: biensTable, workspaces: workspacesTable } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { ajouterPhotoBien, listerPhotosBien } = await import("@/lib/photoBienRepository");
const { ecrirePhotoOptimisee, ecrirePhotoOriginale, genererCleStockage } = await import("@/lib/stockagePhotosBien");
const { deplacerPhotoBienAction, supprimerPhotoBienAction } = await import("./gererPhotosBien");

let dirStockageTest: string;

afterAll(async () => {
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
  if (workspaceBCree) await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
  if (dirStockageTest) await rm(dirStockageTest, { recursive: true, force: true });
});

const WORKSPACE_B = `ws-photos-action-${Date.now()}`;
let workspaceBCree = false;

async function autreWorkspace() {
  if (!workspaceBCree) {
    await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] autre workspace photos action" });
    workspaceBCree = true;
  }
  return WORKSPACE_B;
}

async function bienTest(suffixe: string, workspaceId: string = WORKSPACE_TEST) {
  return creerBien({
    reference: `${REFERENCE_PREFIX}-${suffixe}`,
    titre: "Bien de test gestion photos",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  }, workspaceId);
}

async function ajouterPhotoAvecFichiers(bienId: string, suffixe: string, workspaceId: string = WORKSPACE_TEST) {
  const cle = genererCleStockage();
  await ecrirePhotoOriginale(cle, Buffer.from(`original-${suffixe}`));
  await ecrirePhotoOptimisee(cle, Buffer.from(`optimisee-${suffixe}`));
  return ajouterPhotoBien({
    bienId,
    cleStockage: cle,
    nomFichierOriginal: `photo-${suffixe}.jpg`,
    typeMimeOriginal: "image/jpeg",
    tailleOctetsOriginal: 10,
    hashSha256: `hash-${suffixe}`,
  }, workspaceId);
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("deplacerPhotoBienAction / supprimerPhotoBienAction (ADR-052)", () => {
  beforeAll(async () => {
    dirStockageTest = await mkdtemp(path.join(tmpdir(), "atlas-action-gerer-photo-test-"));
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);
  });

  it("monter/descendre : échange bien la position avec le voisin", async () => {
    const bien = await bienTest("MONTER-DESCENDRE");
    const p1 = await ajouterPhotoAvecFichiers(bien.id, "1");
    const p2 = await ajouterPhotoAvecFichiers(bien.id, "2");
    const p3 = await ajouterPhotoAvecFichiers(bien.id, "3");

    await deplacerPhotoBienAction(formData({ bienId: bien.id, photoId: p3.id, direction: "monter" })).catch(
      () => {}
    );
    let galerie = await listerPhotosBien(bien.id);
    expect(galerie.map((p) => p.id)).toEqual([p1.id, p3.id, p2.id]);

    await deplacerPhotoBienAction(formData({ bienId: bien.id, photoId: p1.id, direction: "descendre" })).catch(
      () => {}
    );
    galerie = await listerPhotosBien(bien.id);
    expect(galerie.map((p) => p.id)).toEqual([p3.id, p1.id, p2.id]);
  });

  it("monter en tête / descendre en fin : no-op silencieux, pas d'erreur", async () => {
    const bien = await bienTest("BORNES");
    const p1 = await ajouterPhotoAvecFichiers(bien.id, "1");
    const p2 = await ajouterPhotoAvecFichiers(bien.id, "2");

    await deplacerPhotoBienAction(formData({ bienId: bien.id, photoId: p1.id, direction: "monter" })).catch(
      () => {}
    );
    await deplacerPhotoBienAction(formData({ bienId: bien.id, photoId: p2.id, direction: "descendre" })).catch(
      () => {}
    );

    const galerie = await listerPhotosBien(bien.id);
    expect(galerie.map((p) => p.id)).toEqual([p1.id, p2.id]);
  });

  it("définir comme principale : déplace en position 0, aucune colonne dédiée — juste l'ordre", async () => {
    const bien = await bienTest("PRINCIPALE");
    const p1 = await ajouterPhotoAvecFichiers(bien.id, "1");
    const p2 = await ajouterPhotoAvecFichiers(bien.id, "2");
    const p3 = await ajouterPhotoAvecFichiers(bien.id, "3");

    await deplacerPhotoBienAction(formData({ bienId: bien.id, photoId: p3.id, direction: "principale" })).catch(
      () => {}
    );

    const galerie = await listerPhotosBien(bien.id);
    expect(galerie[0].id).toBe(p3.id);
    expect(galerie.map((p) => p.id)).toEqual([p3.id, p1.id, p2.id]);
  });

  it("supprimerPhotoBienAction : idempotente, ne redirige pas moins d'une fois pour une photo déjà absente", async () => {
    const bien = await bienTest("SUPPRESSION-IDEMPOTENTE");
    const photo = await ajouterPhotoAvecFichiers(bien.id, "1");

    await supprimerPhotoBienAction(formData({ bienId: bien.id, photoId: photo.id })).catch(() => {});
    await expect(listerPhotosBien(bien.id)).resolves.toEqual([]);

    // Deuxième suppression de la même photo : jamais une erreur métier — seule l'exception spéciale
    // de redirect() (comportement normal de fin d'action) est levée, même en l'absence de ligne.
    await expect(
      supprimerPhotoBienAction(formData({ bienId: bien.id, photoId: photo.id }))
    ).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("supprimerPhotoBienAction : supprime réellement les fichiers physiques (original + optimisée)", async () => {
    const bien = await bienTest("SUPPRESSION-FICHIERS");
    const photo = await ajouterPhotoAvecFichiers(bien.id, "1");
    const cheminOriginal = path.join(dirStockageTest, "photos", "originaux", photo.cleStockage);
    const cheminOptimise = path.join(dirStockageTest, "photos", "optimisees", `${photo.cleStockage}.webp`);
    await expect(stat(cheminOriginal)).resolves.toBeDefined();
    await expect(stat(cheminOptimise)).resolves.toBeDefined();

    await supprimerPhotoBienAction(formData({ bienId: bien.id, photoId: photo.id })).catch(() => {});

    await expect(stat(cheminOriginal)).rejects.toThrow();
    await expect(stat(cheminOptimise)).rejects.toThrow();
  });
});

describe("deplacerPhotoBienAction / supprimerPhotoBienAction — contrôle auth réel (ADR-047)", () => {
  it("exigerSessionAtlas() est appelée en première ligne des deux actions (aucun accès sans session)", async () => {
    exigerSessionAtlasMock.mockRejectedValueOnce(new Error("Non authentifié."));
    await expect(deplacerPhotoBienAction(formData({ bienId: "x", photoId: "y", direction: "monter" }))).rejects.toThrow(
      "Non authentifié."
    );

    exigerSessionAtlasMock.mockRejectedValueOnce(new Error("Non authentifié."));
    await expect(supprimerPhotoBienAction(formData({ bienId: "x", photoId: "y" }))).rejects.toThrow(
      "Non authentifié."
    );

    exigerSessionAtlasMock.mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" });
  });
});

// WORKSPACE_SCOPING_V1 (ADR-054) — la suppression d'une photo détruit une LIGNE et DEUX FICHIERS.
// C'est l'opération la plus destructrice du domaine : elle doit prouver l'appartenance par la
// photo elle-même (photo → bien → workspace), jamais par le `bienId` soumis dans le formulaire.
describe("Photos — frontière workspace", () => {
  it("supprimer une photo d'un AUTRE workspace : rien n'est supprimé, ni la ligne ni les fichiers", async () => {
    const bienB = await bienTest("CROSS-SUPPR", await autreWorkspace());
    const photoB = await ajouterPhotoAvecFichiers(bienB.id, "cross-suppr", WORKSPACE_B);

    // Le workspace courant reste "default" (mock global) : on soumet la photo de B.
    await supprimerPhotoBienAction(formData({ bienId: bienB.id, photoId: photoB.id })).catch(() => {});

    const restantes = await listerPhotosBien(bienB.id);
    expect(restantes.map((p) => p.id)).toEqual([photoB.id]);
    await expect(stat(path.join(dirStockageTest, "photos", "originaux", photoB.cleStockage))).resolves.toBeDefined();
    await expect(stat(path.join(dirStockageTest, "photos", "optimisees", `${photoB.cleStockage}.webp`))).resolves.toBeDefined();
  });

  it("le `bienId` soumis ne prouve rien : une photo de B avec le bienId de A n'est pas supprimée", async () => {
    const bienA = await bienTest("CROSS-LEURRE-A");
    const bienB = await bienTest("CROSS-LEURRE-B", await autreWorkspace());
    const photoB = await ajouterPhotoAvecFichiers(bienB.id, "cross-leurre", WORKSPACE_B);

    await supprimerPhotoBienAction(formData({ bienId: bienA.id, photoId: photoB.id })).catch(() => {});

    expect((await listerPhotosBien(bienB.id)).map((p) => p.id)).toEqual([photoB.id]);
  });

  it("réordonner la galerie d'un AUTRE workspace : aucun ordre modifié", async () => {
    const bienB = await bienTest("CROSS-ORDRE", await autreWorkspace());
    const p1 = await ajouterPhotoAvecFichiers(bienB.id, "ordre-1", WORKSPACE_B);
    const p2 = await ajouterPhotoAvecFichiers(bienB.id, "ordre-2", WORKSPACE_B);

    await deplacerPhotoBienAction(formData({ bienId: bienB.id, photoId: p2.id, direction: "principale" })).catch(() => {});

    expect((await listerPhotosBien(bienB.id)).map((p) => p.id)).toEqual([p1.id, p2.id]);
  });
});
