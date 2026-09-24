import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
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
  if (idsVisites.length || idsBons.length) {
    const filtre = or(
      idsVisites.length ? inArray(evenementsMetier.visiteId, idsVisites) : undefined,
      idsBons.length ? inArray(evenementsMetier.bonVisiteId, idsBons) : undefined
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

async function visiteDeTest(nom: string) {
  const bien = await bienDeTest(`[test réel] BON-VISITE-${nom}`);
  const acquereur = await acquereurDeTest(`BONVISITE${nom}`);
  const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-06-01" }, WORKSPACE_TEST);
  if (resultat.statut !== "creee") throw new Error("création de visite attendue");
  idsVisites.push(resultat.visite.id);
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
