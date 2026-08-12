import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration + garde-fous : les 4 actions de statut commercial doivent refuser
// explicitement (throw) sur un bien archivé, et retirerOffreAction doit refuser explicitement si
// un compromis est déjà signé — même style que creerAction.test.ts (throw), pas un refus
// silencieux (voir ADR-014).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien, archiverBien, marquerOffreEnCours, marquerCompromisSigne, getBienById } = await import(
  "@/lib/bienRepository"
);
const {
  marquerOffreEnCoursAction,
  retirerOffreAction,
  marquerCompromisSigneAction,
  annulerCompromisAction,
} = await import("./statutCommercialBien");

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
});

function bienTest(reference: string) {
  return {
    reference,
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
  };
}

function formData(id: string): FormData {
  const fd = new FormData();
  fd.set("id", id);
  return fd;
}

describe("statutCommercialBien — garde-fou bien archivé", () => {
  it("refuse explicitement (throw) marquerOffreEnCoursAction sur un bien archivé", async () => {
    const bien = await creerBien(bienTest("[test réel] STATUT-ARCHIVE-001"));
    idsCrees.push(bien.id);
    await archiverBien(bien.id);

    await expect(marquerOffreEnCoursAction(formData(bien.id))).rejects.toThrow(/archivé/);
  });

  it("refuse explicitement (throw) retirerOffreAction sur un bien archivé", async () => {
    const bien = await creerBien(bienTest("[test réel] STATUT-ARCHIVE-002"));
    idsCrees.push(bien.id);
    await marquerOffreEnCours(bien.id);
    await archiverBien(bien.id);

    await expect(retirerOffreAction(formData(bien.id))).rejects.toThrow(/archivé/);
  });

  it("refuse explicitement (throw) marquerCompromisSigneAction sur un bien archivé", async () => {
    const bien = await creerBien(bienTest("[test réel] STATUT-ARCHIVE-003"));
    idsCrees.push(bien.id);
    await archiverBien(bien.id);

    await expect(marquerCompromisSigneAction(formData(bien.id))).rejects.toThrow(/archivé/);
  });

  it("refuse explicitement (throw) annulerCompromisAction sur un bien archivé", async () => {
    const bien = await creerBien(bienTest("[test réel] STATUT-ARCHIVE-004"));
    idsCrees.push(bien.id);
    await marquerCompromisSigne(bien.id);
    await archiverBien(bien.id);

    await expect(annulerCompromisAction(formData(bien.id))).rejects.toThrow(/archivé/);
  });
});

describe("statutCommercialBien — garde-fou compromis actif", () => {
  it("refuse explicitement (throw) retirerOffreAction si un compromis est déjà signé", async () => {
    const bien = await creerBien(bienTest("[test réel] STATUT-COMPROMIS-001"));
    idsCrees.push(bien.id);
    await marquerOffreEnCours(bien.id);
    await marquerCompromisSigne(bien.id);

    await expect(retirerOffreAction(formData(bien.id))).rejects.toThrow(/compromis/);

    const inchange = await getBienById(bien.id);
    expect(inchange?.offreEnCoursLe).toBeDefined();
  });
});
