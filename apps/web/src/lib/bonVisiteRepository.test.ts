import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

let dirStockageTest: string;
beforeAll(async () => {
  dirStockageTest = await mkdtemp(path.join(tmpdir(), "atlas-bon-visite-test-"));
});
afterAll(async () => {
  await rm(dirStockageTest, { recursive: true, force: true });
});

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  contacts: contactsTable,
  champsVerrouilles: champsVerrouillesTable,
  visites: visitesTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  bonsVisite: bonsVisiteTable,
  signaturesBonVisite: signaturesBonVisiteTable,
  documentsBien: documentsBienTable,
  evenementsMetier,
  executionsAutomatisation,
} = await import("@/db/schema");
const { creerBien, modifierBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerContact, modifierIdentiteContact } = await import("@/lib/contactRepository");
const { creerVisite, annulerVisite } = await import("@/lib/visiteRepository");
const { creerCompteRenduEtRealiserVisite } = await import("@/lib/compteRenduVisiteRepository");
const {
  creerBonVisite,
  annulerBrouillonBonVisite,
  signerBonVisite,
  getBonVisiteById,
  listerBonsVisitePourVisite,
  listerSignaturesPourBonVisite,
  getDocumentBonVisitePourTelechargement,
} = await import("@/lib/bonVisiteRepository");
const { lireDocument } = await import("@/lib/stockageDocuments");
const {
  TEXTE_CONSENTEMENT_BON_VISITE_V2,
  VERSION_TEMPLATE_BON_VISITE_V1,
  VERSION_TEMPLATE_BON_VISITE_V2,
  construireTexteBonVisite,
} = await import("@/lib/bonVisite/templateBonVisite");
const { texteVisiblePdfDeTest } = await import("@/lib/bonVisite/texteVisiblePdfDeTest");

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsContacts: string[] = [];
const idsVisites: string[] = [];

async function pngSignatureFactice(): Promise<Buffer> {
  return sharp({ create: { width: 12, height: 12, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 255 } } })
    .png()
    .toBuffer();
}

async function pngTransparentFactice(): Promise<Buffer> {
  return sharp({ create: { width: 12, height: 12, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
}

afterAll(async () => {
  // evenements_metier référence bons_visite/visites en NO ACTION (migration 0051) — purgé avant la
  // suppression cascade des biens, même patron déjà établi (catalogueRegles.nouveauMatch.test.ts,
  // visite.annulerReporter.test.ts).
  const bonsCrees = idsVisites.length
    ? await getDb().select({ id: bonsVisiteTable.id }).from(bonsVisiteTable).where(inArray(bonsVisiteTable.visiteId, idsVisites))
    : [];
  const idsBons = bonsCrees.map((b) => b.id);
  // `visite_realisee` cible `compteRenduVisiteId` (ADR-041 §5), jamais la Visite : un test qui crée
  // un compte rendu (T7 — le CR reste possible après la signature) laisse donc un événement que ni
  // `visiteId` ni `bonVisiteId` ne retrouvent, et qui bloque la suppression en cascade du Bien.
  // Retrouvés par `bienId` et non par `visiteId` : `comptes_rendus_visite.visite_id` est ON DELETE
  // SET NULL, donc une purge partielle antérieure peut l'avoir déjà vidé.
  const comptesRendusCrees = idsBiens.length
    ? await getDb()
        .select({ id: comptesRendusVisiteTable.id })
        .from(comptesRendusVisiteTable)
        .where(inArray(comptesRendusVisiteTable.bienId, idsBiens))
    : [];
  const idsComptesRendus = comptesRendusCrees.map((c) => c.id);
  if (idsVisites.length || idsBons.length || idsComptesRendus.length) {
    const filtre = or(
      idsVisites.length ? inArray(evenementsMetier.visiteId, idsVisites) : undefined,
      idsBons.length ? inArray(evenementsMetier.bonVisiteId, idsBons) : undefined,
      idsComptesRendus.length ? inArray(evenementsMetier.compteRenduVisiteId, idsComptesRendus) : undefined
    );
    const evenements = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtre);
    const idsEvenements = evenements.map((e) => e.id);
    if (idsEvenements.length) {
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvenements));
      await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, idsEvenements));
    }
  }
  // modifierIdentiteContact (ADR-056, verrouillerChamp) pose un champs_verrouilles à chaque valeur
  // effectivement modifiée — purgé avant la suppression du contact (test "le Contact du signataire
  // change après signature").
  if (idsContacts.length) {
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    // Auto-référence contacts.fusionne_dans_contact_id (test garde contact actif) — désamorcée avant
    // suppression, sinon l'ordre absorbé/survivant devient significatif pour rien.
    await getDb()
      .update(contactsTable)
      .set({ fusionneDansContactId: null, fusionneLe: null })
      .where(inArray(contactsTable.id, idsContacts));
  }
  if (idsComptesRendus.length) {
    await getDb().delete(comptesRendusVisiteTable).where(inArray(comptesRendusVisiteTable.id, idsComptesRendus));
  }
  // visites CASCADE vers bons_visite CASCADE vers signatures_bon_visite — dont
  // signatures_bon_visite.contact_id référence contacts en NO ACTION : les visites doivent donc
  // disparaître AVANT les contacts, jamais l'inverse.
  for (const id of idsVisites) await getDb().delete(visitesTable).where(eq(visitesTable.id, id));
  for (const id of idsContacts) await getDb().delete(contactsTable).where(eq(contactsTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

beforeEach(() => {
  process.env.ATLAS_DOCUMENT_STORAGE_DIR = dirStockageTest;
});
afterEach(() => {
  delete process.env.ATLAS_DOCUMENT_STORAGE_DIR;
});

async function bienDeTest(reference: string) {
  const bien = await creerBien(
    {
      reference,
      titre: "Bien bon de visite",
      type: "appartement",
      adresse: "1 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 3,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    WORKSPACE_TEST
  );
  idsBiens.push(bien.id);
  return bien;
}

async function acquereurDeTest(nom: string) {
  const acquereur = await creerAcquereur(
    {
      prenom: "Jean",
      nom,
      email: `${nom.toLowerCase()}@test.local`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

// Instant de réalisation volontairement DIFFÉRENT de `datePrevue` (2026-06-01) : tout test qui
// confondrait les deux dates dans le texte du bon échoue au lieu de passer par coïncidence.
const REALISEE_LE_TEST = new Date("2026-06-04T08:15:00Z");

// `planifiee` par défaut — l'état nominal du terrain : le bon se signe à la fin de la visite, avant
// tout compte rendu (BON_VISITE_V2_VISIT_LIFECYCLE_CORRECTION). Les tests du cas inverse (bon
// établi APRÈS un compte rendu) passent `{ realisee: true }`. L'UPDATE direct installe alors l'ÉTAT
// attendu sans dépendre du domaine Compte rendu (seul writer réel de cette transition en
// production, ADR-040) : la fixture ne teste pas cette transition, elle en suppose le résultat.
async function visiteDeTest(nom: string, { realisee = false }: { realisee?: boolean } = {}) {
  const bien = await bienDeTest(`[test réel] BON-VISITE-${nom}`);
  const acquereur = await acquereurDeTest(`BONVISITE${nom}`);
  const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-06-01" }, WORKSPACE_TEST);
  if (resultat.statut !== "creee") throw new Error("création de visite attendue");
  idsVisites.push(resultat.visite.id);
  if (realisee) {
    await getDb()
      .update(visitesTable)
      .set({ statut: "realisee", realiseeLe: REALISEE_LE_TEST })
      .where(eq(visitesTable.id, resultat.visite.id));
  }
  return { bien, acquereur, visite: resultat.visite };
}

describe("bonVisiteRepository — création (§47)", () => {
  it("crée un brouillon v1 avec snapshot, sans document ni signature", async () => {
    const { visite, bien } = await visiteDeTest("CREATION1");
    const resultat = await creerBonVisite(visite.id, WORKSPACE_TEST);
    expect(resultat.statut).toBe("cree");
    if (resultat.statut !== "cree") return;
    expect(resultat.bonVisite.statut).toBe("brouillon");
    expect(resultat.bonVisite.version).toBe(1);
    expect(resultat.bonVisite.contenuSnapshot.bien.id).toBe(bien.id);
    expect(resultat.bonVisite.contenuSnapshot.bien.adresse).toBe(bien.adresse);
    expect(resultat.bonVisite.contenuSnapshot.template.texte).toContain(bien.reference);
    expect(resultat.bonVisite.documentId).toBeUndefined();
    expect(resultat.bonVisite.hashDocument).toBeUndefined();
    expect(resultat.bonVisite.signeLe).toBeUndefined();

    const relu = await getBonVisiteById(resultat.bonVisite.id, WORKSPACE_TEST);
    expect(relu?.contenuSnapshot.bien.id).toBe(bien.id);
  });

  it("§35 — refuse la création si la Visite est annulée", async () => {
    const { visite } = await visiteDeTest("ANNULEE1");
    await annulerVisite(visite.id, WORKSPACE_TEST);
    const resultat = await creerBonVisite(visite.id, WORKSPACE_TEST);
    expect(resultat.statut).toBe("visite_annulee");
  });

  it("§36 — autorise la création même si la Visite n'est que planifiée (pas besoin d'être réalisée)", async () => {
    const { visite } = await visiteDeTest("PLANIFIEE1");
    const resultat = await creerBonVisite(visite.id, WORKSPACE_TEST);
    expect(resultat.statut).toBe("cree");
  });

  it("introuvable pour une Visite inexistante", async () => {
    const resultat = await creerBonVisite("00000000-0000-0000-0000-000000000000", WORKSPACE_TEST);
    expect(resultat.statut).toBe("visite_introuvable");
  });
});

describe("bonVisiteRepository — versioning (§12/§33/§53)", () => {
  it("v2 après annulation du brouillon v1 ; v1 reste consultable, inchangé", async () => {
    const { visite } = await visiteDeTest("VERSION1");
    const r1 = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r1.statut !== "cree") throw new Error("v1 attendu");
    await annulerBrouillonBonVisite(r1.bonVisite.id, WORKSPACE_TEST);
    const r2 = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r2.statut !== "cree") throw new Error("v2 attendu");
    expect(r2.bonVisite.version).toBe(2);

    const liste = await listerBonsVisitePourVisite(visite.id, WORKSPACE_TEST);
    expect(liste.map((b) => b.version)).toEqual([2, 1]);
    const v1Relu = await getBonVisiteById(r1.bonVisite.id, WORKSPACE_TEST);
    expect(v1Relu?.statut).toBe("annule");
  });

  it("deux créations réellement concurrentes pour la même Visite : versions distinctes, jamais de collision", async () => {
    const { visite } = await visiteDeTest("VERSIONCONC1");
    const [a, b] = await Promise.all([creerBonVisite(visite.id, WORKSPACE_TEST), creerBonVisite(visite.id, WORKSPACE_TEST)]);
    expect(a.statut).toBe("cree");
    expect(b.statut).toBe("cree");
    if (a.statut !== "cree" || b.statut !== "cree") return;
    expect(new Set([a.bonVisite.version, b.bonVisite.version])).toEqual(new Set([1, 2]));
  });
});

describe("bonVisiteRepository — annulation brouillon (§34)", () => {
  it("annule un brouillon", async () => {
    const { visite } = await visiteDeTest("ANNULBROUILLON1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const resultat = await annulerBrouillonBonVisite(r.bonVisite.id, WORKSPACE_TEST);
    expect(resultat.statut).toBe("annule");
  });

  it("refuse d'annuler un bon déjà signé (destructif interdit)", async () => {
    const { visite } = await visiteDeTest("ANNULSIGNE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const signatureBuffer = await pngSignatureFactice();
    const signature = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        prenomSignataire: "Marie",
        roleSignataire: "principal",
        signatureImagePng: signatureBuffer,
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(signature.statut).toBe("signe");

    const resultat = await annulerBrouillonBonVisite(r.bonVisite.id, WORKSPACE_TEST);
    expect(resultat.statut).toBe("non_annulable");
    expect((await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST))?.statut).toBe("signe");
  });
});

describe("bonVisiteRepository — signature (§48)", () => {
  it("signe : statut signe, signeLe posé, signature enregistrée, document final + hash, event bon_visite_signe", async () => {
    const { visite } = await visiteDeTest("SIGNATURE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const signatureBuffer = await pngSignatureFactice();

    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        prenomSignataire: "Marie",
        emailSignataire: "marie.dupont@test.local",
        roleSignataire: "principal",
        signatureImagePng: signatureBuffer,
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("signe");
    if (resultat.statut !== "signe") return;
    expect(resultat.bonVisite.signeLe).toBeDefined();
    expect(resultat.bonVisite.documentId).toBeDefined();
    expect(resultat.bonVisite.hashDocument).toMatch(/^[0-9a-f]{64}$/);

    const signatures = await listerSignaturesPourBonVisite(r.bonVisite.id, WORKSPACE_TEST);
    expect(signatures).toHaveLength(1);
    expect(signatures[0].nomSnapshot).toBe("Dupont");
    expect(signatures[0].consentementConfirmeLe).toBeDefined();

    const document = await getDocumentBonVisitePourTelechargement(r.bonVisite.id, WORKSPACE_TEST);
    expect(document?.typeMime).toBe("application/pdf");
    const fichier = await lireDocument(document!.cleStockage);
    expect(fichier?.subarray(0, 4).toString()).toBe("%PDF");

    const [ligneDocumentsBien] = await getDb().select().from(documentsBienTable).where(eq(documentsBienTable.id, resultat.bonVisite.documentId!));
    expect(ligneDocumentsBien.visiteId).toBe(visite.id);
    expect(ligneDocumentsBien.typeDocument).toBe("bon_visite");

    const [evenement] = await getDb().select().from(evenementsMetier).where(eq(evenementsMetier.bonVisiteId, r.bonVisite.id));
    expect(evenement?.typeEvenement).toBe("bon_visite_signe");
  });

  it("refuse un consentement manquant, aucune écriture", async () => {
    const { visite } = await visiteDeTest("SANSCONSENT1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: false,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("consentement_manquant");
    expect((await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST))?.statut).toBe("brouillon");
  });

  it("§29/§56 — refuse une signature vide (canvas entièrement transparent), pas seulement une chaîne non vide", async () => {
    const { visite } = await visiteDeTest("SIGVIDE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngTransparentFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    // Le writer lui-même revalide l'absence de trait (bufferSignatureEstVide), en défense en
    // profondeur de la validation déjà faite par l'appelant (§29/§44) — jamais une confiance
    // aveugle dans un buffer PNG non vide au sens octets mais visuellement transparent.
    expect(resultat.statut).toBe("signature_vide");
    expect((await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST))?.statut).toBe("brouillon");
  });

  it("§57 — refuse une signature dépassant la taille maximale", async () => {
    const { visite } = await visiteDeTest("SIGTROPGRANDE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const bufferEnorme = Buffer.alloc(3 * 1024 * 1024, 1);
    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: bufferEnorme,
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("signature_trop_grande");
  });

  it("refuse de signer un bon déjà signé", async () => {
    const { visite } = await visiteDeTest("DEJASIGNE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const entree = {
      bonVisiteId: r.bonVisite.id,
      nomSignataire: "Dupont",
      roleSignataire: "principal" as const,
      signatureImagePng: await pngSignatureFactice(),
      consentementConfirme: true,
    };
    const premier = await signerBonVisite(entree, WORKSPACE_TEST);
    expect(premier.statut).toBe("signe");
    const second = await signerBonVisite(entree, WORKSPACE_TEST);
    expect(second.statut).toBe("deja_signe");
  });

  it("refuse de signer un bon annulé", async () => {
    const { visite } = await visiteDeTest("SIGNERANNULE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    await annulerBrouillonBonVisite(r.bonVisite.id, WORKSPACE_TEST);
    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("deja_annule");
  });
});

describe("bonVisiteRepository — double signature réellement concurrente (§22/§49)", () => {
  it("un seul gagnant, un seul document, un seul event bon_visite_signe", async () => {
    const { visite } = await visiteDeTest("COURSE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");

    const [a, b] = await Promise.all([
      signerBonVisite(
        {
          bonVisiteId: r.bonVisite.id,
          nomSignataire: "Course A",
          roleSignataire: "principal",
          signatureImagePng: await pngSignatureFactice(),
          consentementConfirme: true,
        },
        WORKSPACE_TEST
      ),
      signerBonVisite(
        {
          bonVisiteId: r.bonVisite.id,
          nomSignataire: "Course B",
          roleSignataire: "principal",
          signatureImagePng: await pngSignatureFactice(),
          consentementConfirme: true,
        },
        WORKSPACE_TEST
      ),
    ]);
    const uneSeuleGagne = (a.statut === "signe") !== (b.statut === "signe");
    expect(uneSeuleGagne).toBe(true);

    const signatures = await listerSignaturesPourBonVisite(r.bonVisite.id, WORKSPACE_TEST);
    expect(signatures).toHaveLength(1);
    const evenements = await getDb().select().from(evenementsMetier).where(eq(evenementsMetier.bonVisiteId, r.bonVisite.id));
    expect(evenements).toHaveLength(1);
  });
});

describe("bonVisiteRepository — immutabilité (§11/§50)", () => {
  it("un bon signé ne peut plus être re-signé (contenu figé), le hash reste stable", async () => {
    const { visite } = await visiteDeTest("IMMUABLE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const premier = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    if (premier.statut !== "signe") throw new Error("signature attendue");
    const hashInitial = premier.bonVisite.hashDocument;

    const second = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Un Autre Nom",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(second.statut).toBe("deja_signe");

    const relu = await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST);
    expect(relu?.hashDocument).toBe(hashInitial);
    const signatures = await listerSignaturesPourBonVisite(r.bonVisite.id, WORKSPACE_TEST);
    expect(signatures).toHaveLength(1);
    expect(signatures[0].nomSnapshot).toBe("Dupont");
  });
});

describe("bonVisiteRepository — snapshot figé (§31/§32/§51/§52)", () => {
  it("le Contact du signataire change après signature : le snapshot signé reste inchangé", async () => {
    const { visite } = await visiteDeTest("CONTACTCHANGE1");
    const contact = await creerContact({ nom: "AvantFusion", prenom: "Paul", email: "paul@test.local", telephone: undefined }, WORKSPACE_TEST);
    idsContacts.push(contact.id);
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");

    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        contactId: contact.id,
        nomSignataire: "AvantFusion",
        prenomSignataire: "Paul",
        emailSignataire: "paul@test.local",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("signe");

    await modifierIdentiteContact(contact.id, { nom: "ApresChangement", prenom: "Paul", email: "paul@test.local", telephone: undefined }, WORKSPACE_TEST);

    const signatures = await listerSignaturesPourBonVisite(r.bonVisite.id, WORKSPACE_TEST);
    expect(signatures[0].nomSnapshot).toBe("AvantFusion");
  });

  it("le Bien change après signature : le snapshot du bon reste inchangé", async () => {
    const { visite, bien } = await visiteDeTest("BIENCHANGE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const adresseAvant = r.bonVisite.contenuSnapshot.bien.adresse;

    await modifierBien(bien.id, {
      reference: bien.reference,
      titre: bien.titre,
      type: bien.type,
      adresse: "999 avenue Modifiée",
      ville: bien.ville,
      codePostal: bien.codePostal,
      surface: bien.surface,
      pieces: bien.pieces,
      prix: bien.prix,
      statutMandat: bien.statutMandat,
      dateMandat: bien.dateMandat,
      caracteristiques: bien.caracteristiques,
      description: bien.description,
    }, WORKSPACE_TEST);

    const relu = await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST);
    expect(relu?.contenuSnapshot.bien.adresse).toBe(adresseAvant);
    expect(relu?.contenuSnapshot.bien.adresse).not.toBe("999 avenue Modifiée");
  });
});

describe("bonVisiteRepository — garde contact actif (ADR-059 §10)", () => {
  it("refuse de signer avec un contact absorbé (fusionné) — aucune écriture", async () => {
    const { visite } = await visiteDeTest("CONTACTFUSION1");
    const survivant = await creerContact({ nom: "Survivant", prenom: "Paul", email: "survivant@test.local", telephone: undefined }, WORKSPACE_TEST);
    const absorbe = await creerContact({ nom: "Absorbe", prenom: "Paul", email: "absorbe@test.local", telephone: undefined }, WORKSPACE_TEST);
    idsContacts.push(survivant.id, absorbe.id);
    // Simule directement l'état "absorbé" (ADR-059) sans rejouer tout le moteur de fusion, déjà
    // testé par ailleurs (fusionContactRepository.test.ts) — seul le COMPORTEMENT DE LA GARDE est
    // exercé ici.
    await getDb().update(contactsTable).set({ fusionneDansContactId: survivant.id, fusionneLe: new Date() }).where(eq(contactsTable.id, absorbe.id));

    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        contactId: absorbe.id,
        nomSignataire: "Absorbe",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("contact_fusionne");
    expect((await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST))?.statut).toBe("brouillon");
    expect(await listerSignaturesPourBonVisite(r.bonVisite.id, WORKSPACE_TEST)).toEqual([]);
  });

  it("refuse de signer avec un contactId inexistant", async () => {
    const { visite } = await visiteDeTest("CONTACTINTROUVABLE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        contactId: "00000000-0000-0000-0000-000000000000",
        nomSignataire: "Inconnu",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("contact_introuvable");
  });

  it("signer sans contactId reste autorisé (le signataire peut ne pas être un Contact, §4)", async () => {
    const { visite } = await visiteDeTest("SANSCONTACT1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "SansContact",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("signe");
  });
});

describe("bonVisiteRepository — isolation workspace (§18/§54)", () => {
  const AUTRE_WORKSPACE = "un-autre-workspace-inexistant";

  it("un bon d'un autre workspace est introuvable en lecture", async () => {
    const { visite } = await visiteDeTest("WORKSPACE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    expect(await getBonVisiteById(r.bonVisite.id, AUTRE_WORKSPACE)).toBeUndefined();
    expect(await listerBonsVisitePourVisite(visite.id, AUTRE_WORKSPACE)).toEqual([]);
  });

  it("la création est refusée (Visite introuvable) depuis un autre workspace", async () => {
    const { visite } = await visiteDeTest("WORKSPACE2");
    const resultat = await creerBonVisite(visite.id, AUTRE_WORKSPACE);
    expect(resultat.statut).toBe("visite_introuvable");
  });

  it("la signature est refusée (introuvable) depuis un autre workspace", async () => {
    const { visite } = await visiteDeTest("WORKSPACE3");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      AUTRE_WORKSPACE
    );
    expect(resultat.statut).toBe("introuvable");
  });

  it("le document signé n'est pas téléchargeable depuis un autre workspace", async () => {
    const { visite } = await visiteDeTest("WORKSPACE4");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(await getDocumentBonVisitePourTelechargement(r.bonVisite.id, AUTRE_WORKSPACE)).toBeUndefined();
  });
});

describe("bonVisiteRepository — Visite archivée / historique (§35, archivage bien)", () => {
  it("un bon déjà signé reste accessible même si le Bien est archivé depuis", async () => {
    const { visite, bien } = await visiteDeTest("ARCHIVE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    await archiverBien(bien.id, WORKSPACE_TEST);
    const relu = await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST);
    expect(relu?.statut).toBe("signe");
  });
});

describe("bonVisiteRepository — contraintes DB (§46, migration)", () => {
  it("UNIQUE(visite_id, version) est réellement imposée en base", async () => {
    const { visite } = await visiteDeTest("UNIQUEDB1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    await expect(
      getDb().insert(bonsVisiteTable).values({
        visiteId: visite.id,
        version: r.bonVisite.version,
        statut: "brouillon",
        templateVersion: "domiora-v1",
        contenuSnapshot: r.bonVisite.contenuSnapshot,
      })
    ).rejects.toThrow();
  });

  it("l'index unique partiel (type_evenement, bon_visite_id) est réellement imposé en base", async () => {
    const { visite } = await visiteDeTest("UNIQUEEVT1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    await expect(
      getDb().insert(evenementsMetier).values({
        workspaceId: WORKSPACE_TEST,
        typeEvenement: "bon_visite_signe",
        bonVisiteId: r.bonVisite.id,
      })
    ).rejects.toThrow();
  });

  it("bons_visite_coherence_statut_check refuse un statut 'signe' sans documentId/hash/signeLe", async () => {
    const { visite } = await visiteDeTest("COHERENCE1");
    await expect(
      getDb().insert(bonsVisiteTable).values({
        visiteId: visite.id,
        version: 1,
        statut: "signe",
        templateVersion: "domiora-v1",
        contenuSnapshot: { visite: { id: visite.id, datePrevue: "2026-01-01" }, bien: { id: "x", reference: "x", titre: "x", adresse: "x", ville: "x", codePostal: "x" }, conseiller: { nom: "x" }, template: { version: "x", texte: "x" } },
      })
    ).rejects.toThrow();
  });
});

// ───────────────── BON_VISITE_V2_VISIT_LIFECYCLE_CORRECTION ─────────────────

describe("bonVisiteRepository — domiora-v2 : création et snapshot", () => {
  // I2
  it("un nouveau bon est créé en domiora-v2, colonne et snapshot cohérents", async () => {
    const { visite } = await visiteDeTest("V2CREATION1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    expect(r.bonVisite.templateVersion).toBe(VERSION_TEMPLATE_BON_VISITE_V2);
    expect(r.bonVisite.contenuSnapshot.template.version).toBe(VERSION_TEMPLATE_BON_VISITE_V2);
  });

  // T6 — le consentement est figé dès la préparation du bon, pas reconstruit à la lecture.
  it("le snapshot porte la formule de consentement V2, mot pour mot", async () => {
    const { visite } = await visiteDeTest("V2CONSENT1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    expect(r.bonVisite.contenuSnapshot.consentement?.texte).toBe(TEXTE_CONSENTEMENT_BON_VISITE_V2);
    expect(r.bonVisite.contenuSnapshot.consentement?.version).toBe(VERSION_TEMPLATE_BON_VISITE_V2);

    const relu = await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST);
    expect(relu?.contenuSnapshot.consentement?.texte).toBe(TEXTE_CONSENTEMENT_BON_VISITE_V2);
  });

  // T1/T2 — visite encore planifiée : aucune date de visite n'est affirmée, et surtout pas la date
  // prévue (2026-06-01).
  it("visite planifiée : le texte n'affirme aucune date de visite, jamais la date prévue", async () => {
    const { visite } = await visiteDeTest("V2PLANIFIEE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const texte = r.bonVisite.contenuSnapshot.template.texte;
    expect(texte).toContain("a été visité avec le concours de");
    expect(texte).not.toContain("1 juin 2026");
    expect(texte).not.toMatch(/a été visité le/);
    expect(r.bonVisite.contenuSnapshot.visite.realiseeLe).toBeUndefined();
  });

  // T8 — bon établi APRÈS un compte rendu : la date enregistrée est citée, jamais la date prévue.
  it("visite déjà réalisée : le texte cite la date de réalisation enregistrée", async () => {
    const { visite } = await visiteDeTest("V2REALISEE1", { realisee: true });
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    expect(r.bonVisite.contenuSnapshot.template.texte).toContain("a été visité le 4 juin 2026");
    expect(r.bonVisite.contenuSnapshot.template.texte).not.toContain("1 juin 2026");
    expect(r.bonVisite.contenuSnapshot.visite.realiseeLe).toBe(REALISEE_LE_TEST.toISOString());
  });
});

describe("bonVisiteRepository — la signature n'exige ni ne provoque la réalisation", () => {
  // T1/T6 — le cœur de la correction : signer un bon sur une visite PLANIFIÉE, sans aucun compte
  // rendu préalable, et sans qu'aucun compte rendu ne soit créé au passage.
  it("signe une visite planifiée sans compte rendu, et n'en crée aucun", async () => {
    const { visite, bien, acquereur } = await visiteDeTest("V2SIGNPLANIFIEE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");

    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        prenomSignataire: "Marie",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("signe");

    // T6 — aucun compte rendu créé, et la Visite reste PLANIFIÉE : la signature ne touche pas au
    // lifecycle (ADR-040 §7 / ADR-063 §43 — `realisee` vient du seul compte rendu).
    const [ligneVisite] = await getDb().select().from(visitesTable).where(eq(visitesTable.id, visite.id));
    expect(ligneVisite.statut).toBe("planifiee");
    expect(ligneVisite.realiseeLe).toBeNull();
    const comptesRendus = await getDb()
      .select()
      .from(comptesRendusVisiteTable)
      .where(eq(comptesRendusVisiteTable.visiteId, visite.id));
    expect(comptesRendus).toHaveLength(0);

    // I5 — l'horodatage de signature reste posé par le serveur, et c'est lui qui date le constat.
    const relu = await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST);
    expect(relu?.signeLe).toBeDefined();
    expect(relu?.hashDocument).toMatch(/^[0-9a-f]{64}$/);

    // T7 — le compte rendu reste possible APRÈS la signature, et c'est lui qui réalise la visite.
    const cr = await creerCompteRenduEtRealiserVisite(
      {
        bienId: bien.id,
        acquereurId: acquereur.id,
        visiteId: visite.id,
        dateVisite: "2026-06-01",
        retour: "Visite effectuée, retour à chaud positif.",
        interet: "a_reflechir",
      },
      WORKSPACE_TEST
    );
    expect(cr.statut).toBe("cree");
    const [apresCr] = await getDb().select().from(visitesTable).where(eq(visitesTable.id, visite.id));
    expect(apresCr.statut).toBe("realisee");
    expect(apresCr.realiseeLe).not.toBeNull();

    // T4 — le snapshot signé n'a PAS été réécrit par la réalisation postérieure : le document
    // atteste ce qui a été lu et signé, pas ce que la base a appris ensuite.
    const relapres = await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST);
    expect(relapres?.contenuSnapshot.template.texte).toBe(relu?.contenuSnapshot.template.texte);
  });

  // T4/T5 — TEXT_SHOWN = TEXT_SIGNED : le texte figé à la préparation est, caractère pour
  // caractère, celui du snapshot signé et celui imprimé dans le PDF.
  it("le texte préparé est exactement le texte signé et le texte du PDF", async () => {
    const { visite } = await visiteDeTest("V2TEXTEIDENT1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const textePrepare = r.bonVisite.contenuSnapshot.template.texte;

    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("signe");

    const relu = await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST);
    expect(relu?.contenuSnapshot.template.texte).toBe(textePrepare);

    const document = await getDocumentBonVisitePourTelechargement(r.bonVisite.id, WORKSPACE_TEST);
    const fichier = await lireDocument(document!.cleStockage);
    const texteVisible = texteVisiblePdfDeTest(fichier!);
    // Comparaison ligne par ligne : le PDF coupe les lignes pour la mise en page.
    for (const ligne of textePrepare.split("\n").filter(Boolean)) {
      for (const mot of ligne.split(" ")) expect(texteVisible).toContain(mot);
    }
    expect(texteVisible).toContain(VERSION_TEMPLATE_BON_VISITE_V2);
    expect(texteVisible).toContain(r.bonVisite.id);

    // Assertions NÉGATIVES portées sur le texte réellement extrait du PDF, pas sur le snapshot :
    // avec `realiseeLe` NULL, le document ne doit affirmer aucune date de visite. La date prévue de
    // la fixture (2026-06-01 → « 1 juin 2026 ») ne doit apparaître nulle part, et la formulation
    // qui introduirait une date de visite ne doit pas être présente.
    expect(texteVisible).not.toContain("1 juin 2026");
    expect(texteVisible).not.toContain("2026-06-01");
    expect(texteVisible).not.toMatch(/a été visité le/);
    // Seule date du document : l'horodatage serveur de la signature, explicitement libellé.
    expect(texteVisible).toMatch(/Signé le \d{1,2} \S+ \d{4} à \d{2}:\d{2}/);

    // T13 — le hash reste celui du fichier réellement écrit.
    expect(createHash("sha256").update(fichier!).digest("hex")).toBe(relu?.hashDocument);
  });

  // T8 — `realiseeLe` n'est JAMAIS écrasé : la signature ne l'écrit pas, même quand il existe.
  it("visite déjà réalisée : realiseeLe est conservé tel quel par la signature", async () => {
    const { visite } = await visiteDeTest("V2NOOVERWRITE1", { realisee: true });
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("signe");
    const [ligneVisite] = await getDb().select().from(visitesTable).where(eq(visitesTable.id, visite.id));
    expect(ligneVisite.realiseeLe?.toISOString()).toBe(REALISEE_LE_TEST.toISOString());
    expect(ligneVisite.statut).toBe("realisee");
  });

  // T9/§35 — visite annulée APRÈS la préparation du brouillon : signature refusée, et T10 : aucun
  // état métier incohérent laissé derrière.
  it("visite annulée après préparation : signature refusée, aucune écriture", async () => {
    const { visite } = await visiteDeTest("V2ANNULEEAPRES1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    await annulerVisite(visite.id, WORKSPACE_TEST);

    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("visite_annulee");

    const relu = await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST);
    expect(relu?.statut).toBe("brouillon");
    expect(relu?.documentId).toBeUndefined();
    expect(relu?.hashDocument).toBeUndefined();
    expect(await listerSignaturesPourBonVisite(r.bonVisite.id, WORKSPACE_TEST)).toHaveLength(0);
    // La Visite n'est jamais "dé-annulée" pour débloquer la signature.
    const [ligneVisite] = await getDb().select().from(visitesTable).where(eq(visitesTable.id, visite.id));
    expect(ligneVisite.statut).toBe("annulee");
  });

  // I1/T11 — un brouillon domiora-v1 historique reste signable et inaltéré.
  it("un brouillon domiora-v1 historique reste signable et inaltéré", async () => {
    const { visite, bien } = await visiteDeTest("V1LEGACY1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");

    const texteV1 = construireTexteBonVisite({
      bienReference: bien.reference,
      bienTitre: bien.titre,
      bienAdresse: bien.adresse,
      bienVille: bien.ville,
      bienCodePostal: bien.codePostal,
      datePrevue: "2026-06-01",
      conseillerNom: r.bonVisite.contenuSnapshot.conseiller.nom,
    });
    await getDb()
      .update(bonsVisiteTable)
      .set({
        templateVersion: VERSION_TEMPLATE_BON_VISITE_V1,
        contenuSnapshot: {
          visite: { id: visite.id, datePrevue: "2026-06-01" },
          bien: r.bonVisite.contenuSnapshot.bien,
          conseiller: r.bonVisite.contenuSnapshot.conseiller,
          template: { version: VERSION_TEMPLATE_BON_VISITE_V1, texte: texteV1 },
        },
      })
      .where(eq(bonsVisiteTable.id, r.bonVisite.id));

    const resultat = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("signe");

    const relu = await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST);
    expect(relu?.contenuSnapshot.template.version).toBe(VERSION_TEMPLATE_BON_VISITE_V1);
    expect(relu?.contenuSnapshot.template.texte).toBe(texteV1);
    expect(relu?.contenuSnapshot.consentement).toBeUndefined();

    const document = await getDocumentBonVisitePourTelechargement(r.bonVisite.id, WORKSPACE_TEST);
    const texte = texteVisiblePdfDeTest((await lireDocument(document!.cleStockage))!);
    expect(texte).not.toContain("ATTESTATION DE VISITE");
    expect(texte).not.toContain("Consentement");
  });

  // Les deux versions coexistent sur une même Visite, sans migration ni réécriture.
  it("deux versions de bon, v1 historique et v2 courant, coexistent sur la même Visite", async () => {
    const { visite } = await visiteDeTest("V1V2COEXIST1");
    const premier = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (premier.statut !== "cree") throw new Error("v1 attendu");
    await getDb()
      .update(bonsVisiteTable)
      .set({ templateVersion: VERSION_TEMPLATE_BON_VISITE_V1 })
      .where(eq(bonsVisiteTable.id, premier.bonVisite.id));
    await annulerBrouillonBonVisite(premier.bonVisite.id, WORKSPACE_TEST);

    // I11/T16 — le versionnement par Visite reste intact.
    const second = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (second.statut !== "cree") throw new Error("v2 attendu");
    expect(second.bonVisite.version).toBe(2);
    expect(second.bonVisite.templateVersion).toBe(VERSION_TEMPLATE_BON_VISITE_V2);

    const bons = await listerBonsVisitePourVisite(visite.id, WORKSPACE_TEST);
    expect(bons.map((b) => b.templateVersion).sort()).toEqual([
      VERSION_TEMPLATE_BON_VISITE_V1,
      VERSION_TEMPLATE_BON_VISITE_V2,
    ]);
  });
});
