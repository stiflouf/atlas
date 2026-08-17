import { createHash } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// ADR-049 : comportement métier ici, session Atlas mockée comme valide — le refus anonyme réel est
// couvert séparément par transmissionDossierNotaire.securite.test.ts (jamais deux stratégies de
// mock dans un seul fichier, même convention que creerAcquereur.*.test.ts).
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
  documentsBien: documentsBienTable,
  transmissionsDossierNotaire: transmissionsTable,
} = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis, marquerCompromisAnnule, marquerCompromisRealise } = await import("@/lib/compromisRepository");
const { enregistrerDocumentBien, corrigerClassementDocumentBien } = await import("@/lib/documentBienRepository");
const { ecrireDocument, genererCleStockage } = await import("@/lib/stockageDocuments");
const { listerTransmissionsPourCompromis } = await import("@/lib/transmissionDossierNotaireRepository");
const { enregistrerTransmissionDossierNotaireAction } = await import("./transmissionDossierNotaire");

const idsTransmissionsCrees: string[] = [];
const idsDocumentsCrees: string[] = [];
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsTransmissionsCrees) await getDb().delete(transmissionsTable).where(eq(transmissionsTable.id, id));
  for (const id of idsDocumentsCrees) await getDb().delete(documentsBienTable).where(eq(documentsBienTable.id, id));
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] TRANSMISSION-ACTION-${suffixe}`,
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
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerCompromisDeTest(suffixe: string, bienIdExistant?: string) {
  const bien = bienIdExistant ? { id: bienIdExistant } : await creerBienDeTest(suffixe);
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Transmission Action ${suffixe}`,
    email: `test-réel-transmission-action-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  const compromis = await enregistrerCompromis({
    bienId: bien.id,
    acquereurId: acquereur.id,
    prixConvenu: 300000,
    dateSignature: "2026-08-01",
  });
  idsCompromisCrees.push(compromis.id);
  return { bien, acquereur, compromis };
}

async function creerDocumentDeTest(
  bienId: string,
  suffixe: string,
  contenu: string,
  overrides: Partial<Parameters<typeof enregistrerDocumentBien>[0]> = {}
) {
  const cle = genererCleStockage();
  await ecrireDocument(cle, Buffer.from(contenu));
  const document = await enregistrerDocumentBien({
    bienId,
    nom: `Document ${suffixe}`,
    categorie: "autre",
    nomFichierOriginal: `${suffixe}.pdf`,
    cleStockage: cle,
    tailleOctets: Buffer.byteLength(contenu),
    typeMime: "application/pdf",
    etatVerification: "non_verifie",
    ...overrides,
  });
  idsDocumentsCrees.push(document.id);
  return document;
}

function formData(champs: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) {
    if (Array.isArray(valeur)) valeur.forEach((v) => fd.append(cle, v));
    else fd.set(cle, valeur);
  }
  return fd;
}

describe("enregistrerTransmissionDossierNotaireAction — comportement métier", () => {
  it("enregistre une transmission nominale : compromis en_cours, document sélectionné manuellement, snapshot correct", async () => {
    const { bien, compromis } = await creerCompromisDeTest("NOMINAL");
    const document = await creerDocumentDeTest(bien.id, "NOMINAL", "contenu du document nominal");

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Nominale",
        destinataireNom: "Maître Test",
        destinataireEmail: "maitre@etude-test.fr",
      })
    );
    expect(resultat.statut).toBe("enregistree");

    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    expect(transmissions).toHaveLength(1);
    idsTransmissionsCrees.push(transmissions[0].id);
    expect(transmissions[0].etudeNom).toBe("Étude Nominale");
    expect(transmissions[0].destinataireEmail).toBe("maitre@etude-test.fr");
    expect(transmissions[0].creeParEmail).toBe("conseiller@example.com");
    expect(transmissions[0].manifesteSnapshot.documents).toHaveLength(1);
    expect(transmissions[0].manifesteSnapshot.documents[0].documentId).toBe(document.id);
    expect(transmissions[0].manifesteSnapshot.documents[0].sha256).toBe(
      createHash("sha256").update("contenu du document nominal").digest("hex")
    );
  });

  it("SHA-256 correspond exactement aux octets du fichier, pas à une métadonnée", async () => {
    const { bien, compromis } = await creerCompromisDeTest("SHA256");
    const contenu = "contenu à empreinte connue — 12345";
    const document = await creerDocumentDeTest(bien.id, "SHA256", contenu);
    const attendu = createHash("sha256").update(contenu).digest("hex");

    await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude SHA",
      })
    );

    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    idsTransmissionsCrees.push(...transmissions.map((t) => t.id));
    expect(transmissions[0].manifesteSnapshot.documents[0].sha256).toBe(attendu);
    expect(transmissions[0].manifesteSnapshot.documents[0].sha256).not.toBe(document.id);
  });

  it("compromis 'realise' : nouvelle transmission autorisée (complément administratif post-vente)", async () => {
    const { bien, compromis } = await creerCompromisDeTest("REALISE");
    await marquerCompromisRealise(compromis.id, "2026-09-01");
    const document = await creerDocumentDeTest(bien.id, "REALISE", "contenu compromis realise");

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Post-Vente",
      })
    );
    expect(resultat.statut).toBe("enregistree");
    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    idsTransmissionsCrees.push(...transmissions.map((t) => t.id));
  });

  it("compromis 'annule' : refus explicite, aucune transmission créée", async () => {
    const { bien, compromis } = await creerCompromisDeTest("ANNULE");
    await marquerCompromisAnnule(compromis.id, "2026-08-10", "desaccord_prix");
    const document = await creerDocumentDeTest(bien.id, "ANNULE", "contenu compromis annule");

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Refusée",
      })
    );
    expect(resultat.statut).toBe("echec");
    if (resultat.statut === "echec") expect(resultat.message).toMatch(/annulé/i);

    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    expect(transmissions).toHaveLength(0);
  });

  it("compromis inexistant : refus explicite", async () => {
    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: "00000000-0000-0000-0000-000000000000",
        cleIdempotence: crypto.randomUUID(),
        documentIds: ["00000000-0000-0000-0000-000000000001"],
        etudeNom: "Étude Fantôme",
      })
    );
    expect(resultat.statut).toBe("echec");
  });

  it("Bien archivé : refus explicite d'une nouvelle transmission", async () => {
    const { bien, compromis } = await creerCompromisDeTest("ARCHIVE");
    const document = await creerDocumentDeTest(bien.id, "ARCHIVE", "contenu bien archive");
    await archiverBien(bien.id);

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Bien Archivé",
      })
    );
    expect(resultat.statut).toBe("echec");
    if (resultat.statut === "echec") expect(resultat.message).toMatch(/archivé/i);

    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    expect(transmissions).toHaveLength(0);
  });

  it("étude non renseignée : refus explicite", async () => {
    const { bien, compromis } = await creerCompromisDeTest("SANS-ETUDE");
    const document = await creerDocumentDeTest(bien.id, "SANS-ETUDE", "contenu");

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({ compromisId: compromis.id, cleIdempotence: crypto.randomUUID(), documentIds: [document.id], etudeNom: "" })
    );
    expect(resultat.statut).toBe("echec");
  });

  it("email destinataire invalide : refus explicite", async () => {
    const { bien, compromis } = await creerCompromisDeTest("EMAIL-INVALIDE");
    const document = await creerDocumentDeTest(bien.id, "EMAIL-INVALIDE", "contenu");

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Email Invalide",
        destinataireEmail: "pas-un-email",
      })
    );
    expect(resultat.statut).toBe("echec");
  });

  it("sélection vide : refus explicite, aucune transmission créée", async () => {
    const { compromis } = await creerCompromisDeTest("SELECTION-VIDE");

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({ compromisId: compromis.id, cleIdempotence: crypto.randomUUID(), etudeNom: "Étude Vide" })
    );
    expect(resultat.statut).toBe("echec");
    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    expect(transmissions).toHaveLength(0);
  });

  it("document d'un autre Bien : refus atomique, aucune transmission créée", async () => {
    const { compromis } = await creerCompromisDeTest("AUTRE-BIEN-A");
    const autreBien = await creerBienDeTest("AUTRE-BIEN-B");
    const documentAutreBien = await creerDocumentDeTest(autreBien.id, "AUTRE-BIEN", "contenu autre bien");

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [documentAutreBien.id],
        etudeNom: "Étude Mauvais Bien",
      })
    );
    expect(resultat.statut).toBe("echec");
    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    expect(transmissions).toHaveLength(0);
  });

  it("document rejeté : refus explicite, jamais inclus même sélectionné manuellement", async () => {
    const { bien, compromis } = await creerCompromisDeTest("REJETE");
    const document = await creerDocumentDeTest(bien.id, "REJETE", "contenu rejete", { etatVerification: "rejete" });

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Document Rejeté",
      })
    );
    expect(resultat.statut).toBe("echec");
    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    expect(transmissions).toHaveLength(0);
  });

  it("document douteux (non_verifie) : comportement ADR-030 exact préservé — inclus si sélectionné manuellement, jamais présenté comme validé", async () => {
    const { bien, compromis } = await creerCompromisDeTest("DOUTEUX");
    const document = await creerDocumentDeTest(bien.id, "DOUTEUX", "contenu douteux", { etatVerification: "non_verifie" });

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Document Douteux",
      })
    );
    expect(resultat.statut).toBe("enregistree");

    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    idsTransmissionsCrees.push(...transmissions.map((t) => t.id));
    expect(transmissions[0].manifesteSnapshot.documents[0].etatVerification).toBe("non_verifie");
  });

  it("fichier physique absent du stockage : refus explicite, aucun hash calculable, aucune transmission créée", async () => {
    const { bien, compromis } = await creerCompromisDeTest("FICHIER-ABSENT");
    // Métadonnée créée SANS écrire le fichier correspondant (cleStockage orpheline).
    const document = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Document orphelin",
      categorie: "autre",
      nomFichierOriginal: "orphelin.pdf",
      cleStockage: genererCleStockage(),
      tailleOctets: 100,
      typeMime: "application/pdf",
      etatVerification: "non_verifie",
    });
    idsDocumentsCrees.push(document.id);

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Fichier Absent",
      })
    );
    expect(resultat.statut).toBe("echec");
    if (resultat.statut === "echec") expect(resultat.message).toMatch(/introuvable/i);
    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    expect(transmissions).toHaveLength(0);
  });

  it("taille cumulée > 200 Mo : refus explicite (métadonnée, sans nécessiter un vrai fichier de 200 Mo)", async () => {
    const { bien, compromis } = await creerCompromisDeTest("TROP-GROS");
    const document = await creerDocumentDeTest(bien.id, "TROP-GROS", "petit contenu réel", {
      tailleOctets: 201 * 1024 * 1024,
    });

    const resultat = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Trop Grosse",
      })
    );
    expect(resultat.statut).toBe("echec");
    if (resultat.statut === "echec") expect(resultat.message).toMatch(/200 Mo/);
    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    expect(transmissions).toHaveLength(0);
  });

  it("double submit (même cleIdempotence) : une seule transmission ; nouvelle clé : seconde transmission autorisée", async () => {
    const { bien, compromis } = await creerCompromisDeTest("DOUBLE-SUBMIT");
    const document = await creerDocumentDeTest(bien.id, "DOUBLE-SUBMIT", "contenu double submit");
    const cleIdempotence = crypto.randomUUID();

    const premier = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({ compromisId: compromis.id, cleIdempotence, documentIds: [document.id], etudeNom: "Étude Double Submit" })
    );
    expect(premier.statut).toBe("enregistree");

    const second = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({ compromisId: compromis.id, cleIdempotence, documentIds: [document.id], etudeNom: "Étude Double Submit" })
    );
    expect(second.statut).toBe("deja_enregistree");

    let transmissions = await listerTransmissionsPourCompromis(compromis.id);
    expect(transmissions).toHaveLength(1);

    const troisieme = await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Double Submit",
      })
    );
    expect(troisieme.statut).toBe("enregistree");

    transmissions = await listerTransmissionsPourCompromis(compromis.id);
    idsTransmissionsCrees.push(...transmissions.map((t) => t.id));
    expect(transmissions).toHaveLength(2);
  });

  it("historique : deux transmissions distinctes restent distinctes, jamais fusionnées", async () => {
    const { bien, compromis } = await creerCompromisDeTest("HISTORIQUE");
    const d1 = await creerDocumentDeTest(bien.id, "HISTORIQUE-D1", "contenu d1");
    const d2 = await creerDocumentDeTest(bien.id, "HISTORIQUE-D2", "contenu d2");
    const d3 = await creerDocumentDeTest(bien.id, "HISTORIQUE-D3", "contenu d3");

    await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [d1.id, d2.id],
        etudeNom: "Étude Historique",
      })
    );
    await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [d3.id],
        etudeNom: "Étude Historique",
      })
    );

    const transmissions = await listerTransmissionsPourCompromis(compromis.id);
    idsTransmissionsCrees.push(...transmissions.map((t) => t.id));
    expect(transmissions).toHaveLength(2);
    const complement = transmissions.find((t) => t.manifesteSnapshot.documents.length === 1);
    const initiale = transmissions.find((t) => t.manifesteSnapshot.documents.length === 2);
    expect(complement?.manifesteSnapshot.documents[0].documentId).toBe(d3.id);
    expect(initiale?.manifesteSnapshot.documents.map((d) => d.documentId).sort()).toEqual([d1.id, d2.id].sort());
  });

  it("snapshot immuable : une modification ultérieure du document ne change jamais le manifeste historique déjà transmis", async () => {
    const { bien, compromis } = await creerCompromisDeTest("IMMUTABLE");
    const document = await creerDocumentDeTest(bien.id, "IMMUTABLE", "contenu immuable");

    await enregistrerTransmissionDossierNotaireAction(
      null,
      formData({
        compromisId: compromis.id,
        cleIdempotence: crypto.randomUUID(),
        documentIds: [document.id],
        etudeNom: "Étude Immuable",
      })
    );
    const [avant] = await listerTransmissionsPourCompromis(compromis.id);
    idsTransmissionsCrees.push(avant.id);
    expect(avant.manifesteSnapshot.documents[0].nomOriginal).toBe("IMMUTABLE.pdf");

    // Reclassement complet du document (ADR-029) — le nom, la catégorie, etc. changent réellement
    // en base pour la ligne documents_bien elle-même.
    await corrigerClassementDocumentBien(document.id, {
      bienId: bien.id,
      nom: "Nom complètement différent",
      categorie: "diagnostic",
      typeDocument: null,
      typeDocumentDetail: null,
      dateDocument: null,
      dateFinValidite: null,
      compromisId: null,
      acquereurId: null,
      prospectVendeurId: null,
      coproprieteDeclaree: null,
      adresseDeclaree: null,
      provenance: null,
      etatVerification: "confirme",
    });

    const [apres] = await listerTransmissionsPourCompromis(compromis.id);
    expect(apres.manifesteSnapshot).toEqual(avant.manifesteSnapshot);
    expect(apres.manifesteSnapshot.documents[0].nomOriginal).toBe("IMMUTABLE.pdf");
    expect(apres.manifesteSnapshot.documents[0].categorie).toBe("autre");
    expect(apres.manifesteSnapshot.documents[0].etatVerification).toBe("non_verifie");
  });
});
