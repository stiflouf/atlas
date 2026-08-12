import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : exerce la vraie base Postgres locale (pas de mock), même principe que
// actionRepository.test.ts. Repli sur le même DATABASE_URL par défaut que drizzle.config.ts si
// non défini par l'environnement.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const {
  creerBien,
  modifierBien,
  listerBiens,
  listerBiensArchives,
  getBienById,
  archiverBien,
  desarchiverBien,
  marquerOffreEnCours,
  retirerOffre,
  marquerCompromisSigne,
  annulerCompromis,
} = await import("./bienRepository");

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
});

function bienTest(surcharge: Partial<Parameters<typeof creerBien>[0]> = {}) {
  return {
    reference: "[test réel] TEST-001",
    titre: "Bien de test",
    type: "appartement" as const,
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif" as const,
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...surcharge,
  };
}

describe("bienRepository (intégration Postgres)", () => {
  it("modifierBien() retourne undefined pour un id non-UUID (bien mocké)", async () => {
    await expect(modifierBien("bien-001", bienTest())).resolves.toBeUndefined();
  });

  it("modifierBien() retourne undefined pour un UUID inexistant", async () => {
    await expect(
      modifierBien("00000000-0000-0000-0000-000000000000", bienTest())
    ).resolves.toBeUndefined();
  });

  it("modifierBien() met à jour les champs et rafraîchit modifieLe", async () => {
    const cree = await creerBien(bienTest());
    idsCrees.push(cree.id);

    const [ligneAvant] = await getDb().select().from(biensTable).where(eq(biensTable.id, cree.id));
    const modifieLeAvant = ligneAvant.modifieLe.getTime();

    await new Promise((r) => setTimeout(r, 10));

    const modifie = await modifierBien(cree.id, bienTest({ titre: "Titre modifié", ascenseur: true }));

    expect(modifie).toBeDefined();
    expect(modifie?.titre).toBe("Titre modifié");
    expect(modifie?.ascenseur).toBe(true);

    const [ligneApres] = await getDb().select().from(biensTable).where(eq(biensTable.id, cree.id));
    expect(ligneApres.modifieLe.getTime()).toBeGreaterThan(modifieLeAvant);
  });

  it("modifierBien() préserve NULL (jamais false) pour un champ tri-état laissé inconnu", async () => {
    const cree = await creerBien(bienTest());
    idsCrees.push(cree.id);

    const modifie = await modifierBien(cree.id, bienTest());

    expect(modifie?.ascenseur).toBeUndefined();
    expect(modifie?.parking).toBeUndefined();
  });

  it("archiverBien()/desarchiverBien() retournent undefined pour un id non-UUID ou inexistant", async () => {
    await expect(archiverBien("bien-001")).resolves.toBeUndefined();
    await expect(archiverBien("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
    await expect(desarchiverBien("bien-001")).resolves.toBeUndefined();
  });

  it("archiver un bien : posé archiveLe, exclu de listerBiens(), présent dans listerBiensArchives(), toujours résolu par getBienById()", async () => {
    const cree = await creerBien(bienTest({ reference: "[test réel] ARCHIVE-001" }));
    idsCrees.push(cree.id);
    expect(cree.archiveLe).toBeUndefined();

    const archive = await archiverBien(cree.id);
    expect(archive?.archiveLe).toBeDefined();

    const actifs = await listerBiens();
    expect(actifs.some((b) => b.id === cree.id)).toBe(false);

    const archives = await listerBiensArchives();
    expect(archives.some((b) => b.id === cree.id)).toBe(true);

    const parId = await getBienById(cree.id);
    expect(parId).toBeDefined();
    expect(parId?.archiveLe).toBeDefined();
  });

  it("désarchiver un bien : archiveLe redevient undefined, réapparaît dans listerBiens()", async () => {
    const cree = await creerBien(bienTest({ reference: "[test réel] ARCHIVE-002" }));
    idsCrees.push(cree.id);
    await archiverBien(cree.id);

    const desarchive = await desarchiverBien(cree.id);
    expect(desarchive?.archiveLe).toBeUndefined();

    const actifs = await listerBiens();
    expect(actifs.some((b) => b.id === cree.id)).toBe(true);
  });

  it("le comptage de bascule démo->réel inclut les biens archivés (pas de repli mock)", async () => {
    const cree = await creerBien(bienTest({ reference: "[test réel] ARCHIVE-003" }));
    idsCrees.push(cree.id);
    await archiverBien(cree.id);

    // Même si CE bien est archivé, tant qu'au moins une ligne réelle existe (lui ou un autre),
    // listerBiens() ne doit jamais retomber sur les mocks data/biens.ts (ids "bien-00x").
    const actifs = await listerBiens();
    expect(actifs.some((b) => b.id === "bien-001")).toBe(false);
  });

  it("marquerOffreEnCours()/marquerCompromisSigne() posent les timestamps, annulerCompromis()/retirerOffre() les effacent", async () => {
    const cree = await creerBien(bienTest({ reference: "[test réel] STATUT-COMM-001" }));
    idsCrees.push(cree.id);
    expect(cree.offreEnCoursLe).toBeUndefined();
    expect(cree.compromisSigneLe).toBeUndefined();

    const avecOffre = await marquerOffreEnCours(cree.id);
    expect(avecOffre?.offreEnCoursLe).toBeDefined();
    expect(avecOffre?.compromisSigneLe).toBeUndefined();

    const avecCompromis = await marquerCompromisSigne(cree.id);
    expect(avecCompromis?.compromisSigneLe).toBeDefined();
    expect(avecCompromis?.offreEnCoursLe).toBeDefined();

    const sansCompromis = await annulerCompromis(cree.id);
    expect(sansCompromis?.compromisSigneLe).toBeUndefined();
    expect(sansCompromis?.offreEnCoursLe).toBeDefined();

    const sansOffre = await retirerOffre(cree.id);
    expect(sansOffre?.offreEnCoursLe).toBeUndefined();

    const parId = await getBienById(cree.id);
    expect(parId?.offreEnCoursLe).toBeUndefined();
    expect(parId?.compromisSigneLe).toBeUndefined();
  });

  it("marquerCompromisSigne() ne pose jamais offreEnCoursLe automatiquement (compromis marqué directement)", async () => {
    const cree = await creerBien(bienTest({ reference: "[test réel] STATUT-COMM-002" }));
    idsCrees.push(cree.id);

    const avecCompromis = await marquerCompromisSigne(cree.id);
    expect(avecCompromis?.compromisSigneLe).toBeDefined();
    expect(avecCompromis?.offreEnCoursLe).toBeUndefined();
  });

  it("les jalons commerciaux retournent undefined pour un id non-UUID ou inexistant", async () => {
    await expect(marquerOffreEnCours("bien-001")).resolves.toBeUndefined();
    await expect(retirerOffre("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
    await expect(marquerCompromisSigne("bien-001")).resolves.toBeUndefined();
    await expect(annulerCompromis("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });
});
