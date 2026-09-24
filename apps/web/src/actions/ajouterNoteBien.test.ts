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

// Test d'intégration + garde-fou : vérifie qu'un appel direct à ajouterNoteBienAction (contournant
// le formulaire, qui masque déjà l'entrée sur un bien archivé — voir BienTabs.tsx) n'insère
// jamais de note si le bien est archivé. redirect() lève une erreur spéciale (digest
// NEXT_REDIRECT) même hors contexte de requête Next.js réel : on l'avale volontairement, seul
// l'état de la base nous intéresse ici.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { listerNotesPourBien } = await import("@/lib/noteBienRepository");
const { ajouterNoteBienAction } = await import("./ajouterNoteBien");

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
});

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("ajouterNoteBienAction — garde-fou entité archivée", () => {
  it("n'insère aucune note si le bien est archivé, même en appelant l'action directement", async () => {
    const bien = await creerBien({
      reference: "[test réel] NOTE-ARCHIVE",
      titre: "Bien de test",
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
    }, WORKSPACE_TEST);
    idsCrees.push(bien.id);
    await archiverBien(bien.id, WORKSPACE_TEST);

    await ajouterNoteBienAction(formData({ bienId: bien.id, contenu: "Tentative sur bien archivé" })).catch(
      () => {}
    );

    const notes = await listerNotesPourBien(bien.id);
    expect(notes).toEqual([]);
  });
});
