import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration Postgres réel (ADR-049) — même principe que compromisRepository.test.ts : les
// FK compromis -> biens/acquereurs imposent des ids réels.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
  transmissionsDossierNotaire: transmissionsTable,
} = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { enregistrerCompromis } = await import("./compromisRepository");
const { enregistrerTransmission, getTransmissionParCleIdempotence, listerTransmissionsPourCompromis } = await import(
  "./transmissionDossierNotaireRepository"
);

const idsTransmissionsCrees: string[] = [];
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  // FK transmissions_dossier_notaire.compromis_id sans onDelete (NO ACTION, ADR-049) : purger
  // avant les compromis, sinon la suppression échoue (violation de contrainte).
  for (const id of idsTransmissionsCrees) {
    await getDb().delete(transmissionsTable).where(eq(transmissionsTable.id, id));
  }
  for (const id of idsCompromisCrees) {
    await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  }
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

async function creerCompromisDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] TRANSMISSION-${suffixe}`,
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
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Transmission ${suffixe}`,
    email: `test-réel-transmission-${suffixe}@example.com`,
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

function manifesteSnapshotDeTest(suffixe: string) {
  return {
    manifesteTexte: `Manifeste de test ${suffixe}`,
    documents: [
      {
        documentId: "00000000-0000-0000-0000-000000000001",
        nomExport: "01_Document.pdf",
        nomOriginal: "document.pdf",
        categorie: "autre" as const,
        etatVerification: "confirme" as const,
        tailleOctets: 42,
        sha256: "abc123",
      },
    ],
  };
}

describe("transmissionDossierNotaireRepository (intégration Postgres, ADR-049)", () => {
  it("enregistrerTransmission() persiste une transmission complète et restitue le snapshot sans altération", async () => {
    const { compromis } = await creerCompromisDeTest("001");
    const cleIdempotence = "00000000-0000-0000-0000-0000000a0001";

    const transmission = await enregistrerTransmission({
      compromisId: compromis.id,
      cleIdempotence,
      etudeNom: "Étude Dupont & Associés",
      destinataireNom: "Maître Dupont",
      destinataireEmail: "contact@etude-dupont.fr",
      transmisLe: "2026-09-01T10:00:00.000Z",
      creeParEmail: "conseiller@example.com",
      manifesteSnapshot: manifesteSnapshotDeTest("001"),
    });
    expect(transmission).toBeDefined();
    idsTransmissionsCrees.push(transmission!.id);

    expect(transmission!.compromisId).toBe(compromis.id);
    expect(transmission!.etudeNom).toBe("Étude Dupont & Associés");
    expect(transmission!.destinataireNom).toBe("Maître Dupont");
    expect(transmission!.destinataireEmail).toBe("contact@etude-dupont.fr");
    expect(transmission!.creeParEmail).toBe("conseiller@example.com");
    expect(transmission!.manifesteVersion).toBe(1);
    expect(transmission!.manifesteSnapshot).toEqual(manifesteSnapshotDeTest("001"));
  });

  it("liste plusieurs transmissions pour le même Compromis, triées de la plus récente à la plus ancienne", async () => {
    const { compromis } = await creerCompromisDeTest("002");

    const t1 = await enregistrerTransmission({
      compromisId: compromis.id,
      cleIdempotence: "00000000-0000-0000-0000-0000000a0002",
      etudeNom: "Étude A",
      transmisLe: "2026-09-01T10:00:00.000Z",
      creeParEmail: "conseiller@example.com",
      manifesteSnapshot: manifesteSnapshotDeTest("002a"),
    });
    idsTransmissionsCrees.push(t1!.id);

    const t2 = await enregistrerTransmission({
      compromisId: compromis.id,
      cleIdempotence: "00000000-0000-0000-0000-0000000a0003",
      etudeNom: "Étude B (complément)",
      transmisLe: "2026-09-05T10:00:00.000Z",
      creeParEmail: "conseiller@example.com",
      manifesteSnapshot: manifesteSnapshotDeTest("002b"),
    });
    idsTransmissionsCrees.push(t2!.id);

    const liste = await listerTransmissionsPourCompromis(compromis.id);
    expect(liste.map((t) => t.id)).toEqual([t2!.id, t1!.id]);
  });

  it("même cleIdempotence : une seule ligne, jamais un doublon (double submit)", async () => {
    const { compromis } = await creerCompromisDeTest("003");
    const cleIdempotence = "00000000-0000-0000-0000-0000000a0004";
    const input = {
      compromisId: compromis.id,
      cleIdempotence,
      etudeNom: "Étude Idempotence",
      transmisLe: "2026-09-01T10:00:00.000Z",
      creeParEmail: "conseiller@example.com",
      manifesteSnapshot: manifesteSnapshotDeTest("003"),
    };

    const premiere = await enregistrerTransmission(input);
    expect(premiere).toBeDefined();
    idsTransmissionsCrees.push(premiere!.id);

    const seconde = await enregistrerTransmission(input);
    expect(seconde).toBeUndefined();

    const releue = await getTransmissionParCleIdempotence(cleIdempotence);
    expect(releue?.id).toBe(premiere!.id);

    const liste = await listerTransmissionsPourCompromis(compromis.id);
    expect(liste).toHaveLength(1);
  });

  it("une nouvelle cleIdempotence pour la même sélection/destinataire crée une nouvelle transmission légitime", async () => {
    const { compromis } = await creerCompromisDeTest("004");

    const t1 = await enregistrerTransmission({
      compromisId: compromis.id,
      cleIdempotence: "00000000-0000-0000-0000-0000000a0005",
      etudeNom: "Étude Répétée",
      transmisLe: "2026-09-01T10:00:00.000Z",
      creeParEmail: "conseiller@example.com",
      manifesteSnapshot: manifesteSnapshotDeTest("004"),
    });
    idsTransmissionsCrees.push(t1!.id);

    const t2 = await enregistrerTransmission({
      compromisId: compromis.id,
      cleIdempotence: "00000000-0000-0000-0000-0000000a0006",
      etudeNom: "Étude Répétée",
      transmisLe: "2026-09-02T10:00:00.000Z",
      creeParEmail: "conseiller@example.com",
      manifesteSnapshot: manifesteSnapshotDeTest("004"),
    });
    expect(t2).toBeDefined();
    idsTransmissionsCrees.push(t2!.id);

    const liste = await listerTransmissionsPourCompromis(compromis.id);
    expect(liste).toHaveLength(2);
  });

  it("listerTransmissionsPourCompromis() retourne [] pour un compromis sans transmission ou un id non-UUID", async () => {
    const { compromis } = await creerCompromisDeTest("005");
    await expect(listerTransmissionsPourCompromis(compromis.id)).resolves.toEqual([]);
    await expect(listerTransmissionsPourCompromis("compromis-mock")).resolves.toEqual([]);
  });
});
