import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
import { eq } from "drizzle-orm";

// Test d'intégration + garde-fou : même principe que ajouterNoteBien.test.ts. Vérifie qu'un appel
// direct à ajouterDocumentBienAction (contournant le formulaire, qui masque déjà l'entrée sur un
// bien archivé et restreint déjà le type de fichier via `accept` — voir BienTabs.tsx) n'écrit
// jamais sur disque ni n'insère de métadonnée si le bien est archivé, si le type MIME n'est pas
// dans la liste blanche, ou si le fichier dépasse 10 Mo.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, compromis: compromisTable, acquereurs: acquereursTable } = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { listerDocumentsPourBien, getDocumentBienById } = await import("@/lib/documentBienRepository");
const { ajouterDocumentBienAction, corrigerClassementDocumentBienAction } = await import("./ajouterDocumentBien");

const idsCrees: string[] = [];
const idsCompromisCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCompromisCrees) {
    await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
  for (const id of idsCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
});

async function creerBienDeTest(reference: string) {
  const bien = await creerBien({
    reference,
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
  });
  idsCrees.push(bien.id);
  return bien;
}

function formDataAvecFichier(
  champs: Record<string, string>,
  fichier: File | null
): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  if (fichier) fd.set("fichier", fichier);
  return fd;
}

describe("ajouterDocumentBienAction — garde-fous", () => {
  it("n'insère aucun document si le bien est archivé, même en appelant l'action directement", async () => {
    const bien = await creerBienDeTest("[test réel] DOC-ARCHIVE");
    await archiverBien(bien.id);

    const fichier = new File([new Uint8Array([1, 2, 3])], "diag.pdf", { type: "application/pdf" });
    await ajouterDocumentBienAction(
      formDataAvecFichier({ bienId: bien.id, nom: "Diagnostic", categorie: "diagnostic" }, fichier)
    ).catch(() => {});

    await expect(listerDocumentsPourBien(bien.id)).resolves.toEqual([]);
  });

  it("n'insère aucun document si le type MIME n'est pas dans la liste blanche", async () => {
    const bien = await creerBienDeTest("[test réel] DOC-MIME-INTERDIT");

    const fichier = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
    await ajouterDocumentBienAction(
      formDataAvecFichier({ bienId: bien.id, nom: "Notes", categorie: "autre" }, fichier)
    ).catch(() => {});

    await expect(listerDocumentsPourBien(bien.id)).resolves.toEqual([]);
  });

  it("n'insère aucun document si le fichier dépasse 10 Mo", async () => {
    const bien = await creerBienDeTest("[test réel] DOC-TROP-GROS");

    const fichier = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "gros.pdf", {
      type: "application/pdf",
    });
    await ajouterDocumentBienAction(
      formDataAvecFichier({ bienId: bien.id, nom: "Trop gros", categorie: "autre" }, fichier)
    ).catch(() => {});

    await expect(listerDocumentsPourBien(bien.id)).resolves.toEqual([]);
  });

  it("n'insère aucun document si aucun fichier n'est fourni", async () => {
    const bien = await creerBienDeTest("[test réel] DOC-SANS-FICHIER");

    await ajouterDocumentBienAction(
      formDataAvecFichier({ bienId: bien.id, nom: "Sans fichier", categorie: "autre" }, null)
    ).catch(() => {});

    await expect(listerDocumentsPourBien(bien.id)).resolves.toEqual([]);
  });

  it("refuse explicitement (throw) un compromisId rattaché à un autre bien (ADR-029)", async () => {
    const bienDuDocument = await creerBienDeTest("[test réel] DOC-COHER-001");
    const bienDuCompromis = await creerBienDeTest("[test réel] DOC-COHER-002");
    const acquereur = await creerAcquereur({
      prenom: "Jean",
      nom: "Test",
      email: "doc-coher@test.local",
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "decouverte",
      notes: "",
      datePremiereContact: "2026-01-01",
    });
    idsAcquereursCrees.push(acquereur.id);
    const compromis = await enregistrerCompromis({
      bienId: bienDuCompromis.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-02-01",
    });
    idsCompromisCrees.push(compromis.id);

    const fichier = new File([new Uint8Array([1, 2, 3])], "diag.pdf", { type: "application/pdf" });
    await expect(
      ajouterDocumentBienAction(
        formDataAvecFichier(
          { bienId: bienDuDocument.id, nom: "Diagnostic", categorie: "diagnostic", compromisId: compromis.id },
          fichier
        )
      )
    ).rejects.toThrow(/n'appartient pas au bien/);

    await expect(listerDocumentsPourBien(bienDuDocument.id)).resolves.toEqual([]);
  });
});

describe("corrigerClassementDocumentBienAction — remplacement complet, jamais le fichier", () => {
  it("corrige le classement sans jamais toucher au fichier physique", async () => {
    const bien = await creerBienDeTest("[test réel] DOC-CORRECTION-001");
    const fichier = new File([new Uint8Array([1, 2, 3])], "diag.pdf", { type: "application/pdf" });
    await ajouterDocumentBienAction(
      formDataAvecFichier({ bienId: bien.id, nom: "Diagnostic", categorie: "diagnostic" }, fichier)
    ).catch(() => {});

    const [document] = await listerDocumentsPourBien(bien.id);
    expect(document).toBeDefined();

    await corrigerClassementDocumentBienAction(
      formDataAvecFichier(
        {
          id: document.id,
          bienId: bien.id,
          nom: "Diagnostic reclassé",
          categorie: "diagnostic",
          typeDocument: "dpe",
          etatVerification: "confirme",
        },
        null
      )
    ).catch(() => {});

    const corrige = await getDocumentBienById(document.id);
    expect(corrige).toMatchObject({
      nom: "Diagnostic reclassé",
      typeDocument: "dpe",
      etatVerification: "confirme",
      cleStockage: document.cleStockage,
      nomFichierOriginal: document.nomFichierOriginal,
    });
  });
});
