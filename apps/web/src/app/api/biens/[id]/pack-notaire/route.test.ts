import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import JSZip from "jszip";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

// ADR-047 : cette route exige désormais une session Atlas. Le comportement métier (génération du
// ZIP) est testé ici en mockant exigerSessionAtlas() comme une session valide — le refus anonyme
// réel est couvert séparément par route.securite.test.ts, qui utilise le vrai helper.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
  documentsBien: documentsBienTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { enregistrerDocumentBien } = await import("@/lib/documentBienRepository");
const { ecrireDocument, genererCleStockage } = await import("@/lib/stockageDocuments");
const { POST } = await import("./route");

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsCompromis: string[] = [];
const idsDocuments: string[] = [];

afterAll(async () => {
  for (const id of idsDocuments) await getDb().delete(documentsBienTable).where(eq(documentsBienTable.id, id));
  for (const id of idsCompromis) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerBienTest(reference: string, overrides: Partial<Parameters<typeof creerBien>[0]> = {}) {
  const bien = await creerBien({
    reference,
    titre: "Bien de test pack notaire",
    type: "appartement",
    adresse: "1 rue Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 3,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...overrides,
  });
  idsBiens.push(bien.id);
  return bien;
}

async function creerAcquereurTest(email: string) {
  const acquereur = await creerAcquereur({
    prenom: "Jean",
    nom: "Martin",
    email,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

function requetePost(bienId: string, documentIds: string[]): Request {
  const formData = new FormData();
  for (const id of documentIds) formData.append("documentIds", id);
  return new Request(`http://localhost/api/biens/${bienId}/pack-notaire`, { method: "POST", body: formData });
}

describe("POST /api/biens/[id]/pack-notaire", () => {
  it("404 si le bien est introuvable", async () => {
    const reponse = await POST(requetePost("00000000-0000-0000-0000-000000000000", []), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(reponse.status).toBe(404);
  });

  it("409 si aucun compromis en cours n'existe pour ce bien (contexte transactionnel incomplet, correction n°2)", async () => {
    const bien = await creerBienTest("[test réel] PACK-NOTAIRE-001");
    const reponse = await POST(requetePost(bien.id, ["quelconque"]), { params: Promise.resolve({ id: bien.id }) });
    expect(reponse.status).toBe(409);
    const corps = await reponse.json();
    expect(corps.erreur).toMatch(/compromis en cours/);
  });

  it("400 si aucun document n'est sélectionné", async () => {
    const bien = await creerBienTest("[test réel] PACK-NOTAIRE-002");
    const acquereur = await creerAcquereurTest("pack-notaire-1@test.local");
    const compromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-02-01",
    });
    idsCompromis.push(compromis.id);

    const reponse = await POST(requetePost(bien.id, []), { params: Promise.resolve({ id: bien.id }) });
    expect(reponse.status).toBe(400);
  });

  it("400 si l'id soumis correspond à un document techniquement interdit (rejete)", async () => {
    const bien = await creerBienTest("[test réel] PACK-NOTAIRE-003");
    const acquereur = await creerAcquereurTest("pack-notaire-2@test.local");
    const compromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-02-01",
    });
    idsCompromis.push(compromis.id);

    const cle = genererCleStockage();
    await ecrireDocument(cle, Buffer.from("contenu"));
    const document = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Titre rejeté",
      categorie: "autre",
      nomFichierOriginal: "titre.pdf",
      cleStockage: cle,
      tailleOctets: 7,
      typeMime: "application/pdf",
      typeDocument: "titre_propriete",
      etatVerification: "rejete",
    });
    idsDocuments.push(document.id);

    const reponse = await POST(requetePost(bien.id, [document.id]), { params: Promise.resolve({ id: bien.id }) });
    expect(reponse.status).toBe(400);
  });

  it("200 : génère un vrai ZIP contenant le document sélectionné manuellement et le manifeste", async () => {
    const bien = await creerBienTest("[test réel] PACK-NOTAIRE-004", { chargeHonoraires: "vendeur" });
    const acquereur = await creerAcquereurTest("pack-notaire-3@test.local");
    const compromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-02-01",
    });
    idsCompromis.push(compromis.id);

    const cle = genererCleStockage();
    await ecrireDocument(cle, Buffer.from("contenu du titre de propriete"));
    // Document non_verifie : pas auto-proposé, mais reste disponible pour un ajout manuel.
    const document = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Titre de propriété",
      categorie: "autre",
      nomFichierOriginal: "titre.pdf",
      cleStockage: cle,
      tailleOctets: 30,
      typeMime: "application/pdf",
      typeDocument: "titre_propriete",
      etatVerification: "non_verifie",
    });
    idsDocuments.push(document.id);

    const reponse = await POST(requetePost(bien.id, [document.id]), { params: Promise.resolve({ id: bien.id }) });
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("Content-Type")).toBe("application/zip");
    expect(reponse.headers.get("Content-Disposition")).toContain("attachment");

    const zipBuffer = Buffer.from(await reponse.arrayBuffer());
    const zip = await JSZip.loadAsync(zipBuffer);
    expect(Object.keys(zip.files)).toContain("01_Titre_de_propriete.pdf");
    expect(Object.keys(zip.files)).toContain("manifeste.txt");
    const contenuFichier = await zip.file("01_Titre_de_propriete.pdf")?.async("string");
    expect(contenuFichier).toBe("contenu du titre de propriete");
    const manifeste = await zip.file("manifeste.txt")?.async("string");
    expect(manifeste).toContain("Acquéreur enregistré : Jean Martin");
  });
});
