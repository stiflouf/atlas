import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

// ADR-054 — même raison que le mock de session juste au-dessus : ces tests portent sur le
// COMPORTEMENT MÉTIER de l'action, pas sur la résolution du périmètre (couverte par ses propres
// tests, src/lib/auth/workspaceCourant.test.ts). Sans ce mock, la résolution tenterait un bootstrap
// d'appartenance pour un `sub` fictif et dépendrait de l'allowlist. Le littéral est celui du
// workspace historique : ce que l'action écrit reste vérifié en base par les assertions.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));
import { eq } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

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
    const bien = await creerBien(bienTest("[test réel] STATUT-ARCHIVE-001"), WORKSPACE_TEST);
    idsCrees.push(bien.id);
    await archiverBien(bien.id);

    await expect(marquerOffreEnCoursAction(formData(bien.id))).rejects.toThrow(/archivé/);
  });

  it("refuse explicitement (throw) retirerOffreAction sur un bien archivé", async () => {
    const bien = await creerBien(bienTest("[test réel] STATUT-ARCHIVE-002"), WORKSPACE_TEST);
    idsCrees.push(bien.id);
    await marquerOffreEnCours(bien.id);
    await archiverBien(bien.id);

    await expect(retirerOffreAction(formData(bien.id))).rejects.toThrow(/archivé/);
  });

  it("refuse explicitement (throw) marquerCompromisSigneAction sur un bien archivé", async () => {
    const bien = await creerBien(bienTest("[test réel] STATUT-ARCHIVE-003"), WORKSPACE_TEST);
    idsCrees.push(bien.id);
    await archiverBien(bien.id);

    await expect(marquerCompromisSigneAction(formData(bien.id))).rejects.toThrow(/archivé/);
  });

  it("refuse explicitement (throw) annulerCompromisAction sur un bien archivé", async () => {
    const bien = await creerBien(bienTest("[test réel] STATUT-ARCHIVE-004"), WORKSPACE_TEST);
    idsCrees.push(bien.id);
    await marquerCompromisSigne(bien.id);
    await archiverBien(bien.id);

    await expect(annulerCompromisAction(formData(bien.id))).rejects.toThrow(/archivé/);
  });
});

describe("statutCommercialBien — garde-fou compromis actif", () => {
  it("refuse explicitement (throw) retirerOffreAction si un compromis est déjà signé", async () => {
    const bien = await creerBien(bienTest("[test réel] STATUT-COMPROMIS-001"), WORKSPACE_TEST);
    idsCrees.push(bien.id);
    await marquerOffreEnCours(bien.id);
    await marquerCompromisSigne(bien.id);

    await expect(retirerOffreAction(formData(bien.id))).rejects.toThrow(/compromis/);

    const inchange = await getBienById(bien.id);
    expect(inchange?.offreEnCoursLe).toBeDefined();
  });
});
