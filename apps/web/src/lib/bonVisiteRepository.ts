import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import {
  biens as biensTable,
  bonsVisite as bonsVisiteTable,
  documentsBien as documentsBienTable,
  signaturesBonVisite as signaturesBonVisiteTable,
  visites as visitesTable,
} from "@/db/schema";
import type { BonVisite, RoleSignataire, SignatureBonVisite, SnapshotBonVisite, StatutBonVisite } from "@/types/bonVisite";
import { verrouillerVisite } from "@/lib/visiteRepository";
import { enregistrerDocumentBien } from "@/lib/documentBienRepository";
import { ecrireDocument, genererCleStockage } from "@/lib/stockageDocuments";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";
import { obtenirNomConseiller } from "@/lib/conseiller";
import {
  construireTexteBonVisiteV2,
  TEXTE_CONSENTEMENT_BON_VISITE_V2,
  VERSION_TEMPLATE_BON_VISITE_V2,
} from "@/lib/bonVisite/templateBonVisite";
import { genererPdfBonVisite } from "@/lib/bonVisite/pdfBonVisite";
import { bufferSignatureEstVide } from "@/lib/bonVisite/validationSignatureImage";
import { verrouillerContactActif } from "@/lib/contactActif";

// VISIT_SIGNED_FORM_V1 (ADR-063) — writer/lecteurs du bon de visite signé. WORKSPACE-SAFE au même
// patron que visiteRepository.ts : `bons_visite` ne porte pas sa propre colonne `workspace_id`
// (feuille de `visites`, elle-même feuille de `biens`) — chaque lecture/écriture remonte à
// `biens.workspace_id` par double jointure ; un bon d'un autre workspace est INTROUVABLE.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAILLE_MAX_SIGNATURE_OCTETS = 2 * 1024 * 1024;

type LigneBonVisite = typeof bonsVisiteTable.$inferSelect;
type LigneSignatureBonVisite = typeof signaturesBonVisiteTable.$inferSelect;

function ligneVersBonVisite(ligne: LigneBonVisite): BonVisite {
  return {
    id: ligne.id,
    visiteId: ligne.visiteId,
    version: ligne.version,
    statut: ligne.statut as StatutBonVisite,
    templateVersion: ligne.templateVersion,
    contenuSnapshot: ligne.contenuSnapshot,
    documentId: ligne.documentId ?? undefined,
    hashDocument: ligne.hashDocument ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    signeLe: ligne.signeLe ? ligne.signeLe.toISOString() : undefined,
    annuleLe: ligne.annuleLe ? ligne.annuleLe.toISOString() : undefined,
  };
}

function ligneVersSignatureBonVisite(ligne: LigneSignatureBonVisite): SignatureBonVisite {
  return {
    id: ligne.id,
    bonVisiteId: ligne.bonVisiteId,
    contactId: ligne.contactId ?? undefined,
    roleSignataire: ligne.roleSignataire as RoleSignataire,
    nomSnapshot: ligne.nomSnapshot,
    prenomSnapshot: ligne.prenomSnapshot ?? undefined,
    emailSnapshot: ligne.emailSnapshot ?? undefined,
    provider: "domiora",
    externalSignatureId: ligne.externalSignatureId ?? undefined,
    signatureCleStockage: ligne.signatureCleStockage,
    consentementConfirmeLe: ligne.consentementConfirmeLe.toISOString(),
    signeLe: ligne.signeLe.toISOString(),
    creeLe: ligne.creeLe.toISOString(),
  };
}

// ───────────────────────────── LECTURES (scoped) ─────────────────────────────

export async function getBonVisiteById(id: string, workspaceId: string, executeur: Executeur = getDb()): Promise<BonVisite | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select({ bon: bonsVisiteTable })
    .from(bonsVisiteTable)
    .innerJoin(visitesTable, eq(bonsVisiteTable.visiteId, visitesTable.id))
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(bonsVisiteTable.id, id), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersBonVisite(ligne.bon) : undefined;
}

// Ordre décroissant (version la plus récente en premier) — la fiche Visite n'a besoin que du bon
// courant (le premier de la liste), l'historique complet reste consultable via cette même liste
// (§25 état D).
export async function listerBonsVisitePourVisite(
  visiteId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<BonVisite[]> {
  if (!UUID_REGEX.test(visiteId)) return [];
  const lignes = await executeur
    .select({ bon: bonsVisiteTable })
    .from(bonsVisiteTable)
    .innerJoin(visitesTable, eq(bonsVisiteTable.visiteId, visitesTable.id))
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(bonsVisiteTable.visiteId, visiteId), eq(biensTable.workspaceId, workspaceId)))
    .orderBy(desc(bonsVisiteTable.version));
  return lignes.map((l) => ligneVersBonVisite(l.bon));
}

export async function listerSignaturesPourBonVisite(
  bonVisiteId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<SignatureBonVisite[]> {
  if (!UUID_REGEX.test(bonVisiteId)) return [];
  const lignes = await executeur
    .select({ signature: signaturesBonVisiteTable })
    .from(signaturesBonVisiteTable)
    .innerJoin(bonsVisiteTable, eq(signaturesBonVisiteTable.bonVisiteId, bonsVisiteTable.id))
    .innerJoin(visitesTable, eq(bonsVisiteTable.visiteId, visitesTable.id))
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(signaturesBonVisiteTable.bonVisiteId, bonVisiteId), eq(biensTable.workspaceId, workspaceId)));
  return lignes.map((l) => ligneVersSignatureBonVisite(l.signature));
}

// Dédié au téléchargement (§40) : NE PASSE JAMAIS par `getDocumentBienById` (non scopé workspace,
// gap pré-existant du domaine Documents, hors périmètre de ce lot) — la jointure bon→visite→bien
// porte ICI la seule garantie workspace-safe. Le Route Handler dédié (/api/bons-visite/[id]/document)
// n'a donc jamais besoin de faire confiance à un id de document nu.
export type DocumentBonVisiteTelechargeable = {
  cleStockage: string;
  typeMime: string;
  nomFichierOriginal: string;
  tailleOctets: number;
};

export async function getDocumentBonVisitePourTelechargement(
  bonVisiteId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<DocumentBonVisiteTelechargeable | undefined> {
  if (!UUID_REGEX.test(bonVisiteId)) return undefined;
  const [ligne] = await executeur
    .select({
      cleStockage: documentsBienTable.cleStockage,
      typeMime: documentsBienTable.typeMime,
      nomFichierOriginal: documentsBienTable.nomFichierOriginal,
      tailleOctets: documentsBienTable.tailleOctets,
    })
    .from(bonsVisiteTable)
    .innerJoin(visitesTable, eq(bonsVisiteTable.visiteId, visitesTable.id))
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .innerJoin(documentsBienTable, eq(bonsVisiteTable.documentId, documentsBienTable.id))
    .where(and(eq(bonsVisiteTable.id, bonVisiteId), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne ?? undefined;
}

// ───────────────────────────── VERROU ─────────────────────────────

// `visiteStatut` est lu par la MÊME jointure qui porte déjà la garde workspace — jamais une seconde
// requête. Le verrou reste posé sur `bons_visite` SEUL (`of`), comme avant : verrouiller aussi la
// Visite élargirait la zone de sérialisation sans besoin. Les deux transitions de la Visite sont
// terminales et non réouvrables (ADR-040), donc une lecture non verrouillée ne peut produire qu'un
// faux NÉGATIF transitoire (refus d'une signature pendant qu'une annulation commite juste à côté),
// jamais un faux positif — un bon ne peut pas être signé sur une visite annulée par une course.
type BonVisiteVerrouille =
  | { statut: "verrouille"; ligne: LigneBonVisite; visiteStatut: string }
  | { statut: "introuvable" };

async function verrouillerBonVisite(id: string, workspaceId: string, tx: Executeur): Promise<BonVisiteVerrouille> {
  if (!UUID_REGEX.test(id)) return { statut: "introuvable" };
  const [trouve] = await tx
    .select({ bon: bonsVisiteTable, visiteStatut: visitesTable.statut })
    .from(bonsVisiteTable)
    .innerJoin(visitesTable, eq(bonsVisiteTable.visiteId, visitesTable.id))
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(bonsVisiteTable.id, id), eq(biensTable.workspaceId, workspaceId)))
    .for("update", { of: bonsVisiteTable });
  if (!trouve) return { statut: "introuvable" };
  return { statut: "verrouille", ligne: trouve.bon, visiteStatut: trouve.visiteStatut };
}

// ───────────────────────────── CRÉATION ─────────────────────────────

export type ResultatCreationBonVisite =
  | { statut: "cree"; bonVisite: BonVisite }
  | { statut: "visite_introuvable" }
  | { statut: "visite_annulee" };

// Préconditions (§19) : Visite existe (scoped workspace), Visite non annulée (§35 — une visite
// annulée ne produit jamais de nouveau bon ; réalisée ou planifiée : autorisé, §36/§37). Ne crée
// jamais de document final ici (§19 — un brouillon n'a ni document, ni hash, ni signature).
export async function creerBonVisite(
  visiteId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatCreationBonVisite> {
  return executeur.transaction(async (tx) => {
    // Verrou de la VISITE (réutilise visiteRepository.verrouillerVisite, jamais un second
    // mécanisme) : sérialise toute création de version concurrente pour cette même Visite (§12,
    // "éviter course double version") — pendant que ce verrou est tenu, aucune autre transaction ne
    // peut lire/écrire un bon pour cette Visite en compétition sur le calcul de la version suivante.
    const verrouVisite = await verrouillerVisite(visiteId, workspaceId, tx);
    if (verrouVisite.statut !== "verrouille") return { statut: "visite_introuvable" };
    if (verrouVisite.ligne.statut === "annulee") return { statut: "visite_annulee" };

    const [bien] = await tx
      .select({
        id: biensTable.id,
        reference: biensTable.reference,
        titre: biensTable.titre,
        adresse: biensTable.adresse,
        ville: biensTable.ville,
        codePostal: biensTable.codePostal,
      })
      .from(biensTable)
      .where(eq(biensTable.id, verrouVisite.ligne.bienId))
      .limit(1);
    // Théoriquement impossible (FK CASCADE bien->visite) — défensif, jamais une visite orpheline.
    if (!bien) return { statut: "visite_introuvable" };

    const [{ maxVersion }] = await tx
      .select({ maxVersion: sql<number>`coalesce(max(${bonsVisiteTable.version}), 0)` })
      .from(bonsVisiteTable)
      .where(eq(bonsVisiteTable.visiteId, visiteId));
    const version = Number(maxVersion) + 1;

    const conseillerNom = obtenirNomConseiller();
    const snapshot: SnapshotBonVisite = {
      visite: {
        id: verrouVisite.ligne.id,
        datePrevue: verrouVisite.ligne.datePrevue,
        realiseeLe: verrouVisite.ligne.realiseeLe ? verrouVisite.ligne.realiseeLe.toISOString() : undefined,
      },
      bien: {
        id: bien.id,
        reference: bien.reference,
        titre: bien.titre,
        adresse: bien.adresse,
        ville: bien.ville,
        codePostal: bien.codePostal,
      },
      conseiller: { nom: conseillerNom },
      template: {
        version: VERSION_TEMPLATE_BON_VISITE_V2,
        // Texte substitué ICI, UNE SEULE FOIS, et jamais reconstruit ensuite — ni à l'affichage, ni
        // à la signature (`signerBonVisite` n'écrit jamais `contenuSnapshot`). C'est ce qui rend
        // vraie par construction l'égalité « texte lu par la personne qui signe = texte du snapshot
        // signé = texte du PDF ».
        //
        // La date de visite n'est affirmée que si `realisee_le` est DÉJÀ renseignée à cet instant
        // (bon établi après un compte rendu) ; sinon aucune date de visite n'est affirmée et le
        // constat est daté par l'horodatage serveur de la signature. `datePrevue` n'est jamais un
        // substitut — ce n'est même pas un paramètre du gabarit V2 (templateBonVisite.ts).
        //
        // La signature ne requiert aucun compte rendu préalable et ne touche pas à la Visite :
        // `planifiee → realisee` reste la conséquence exclusive de la création d'un compte rendu
        // (ADR-040 §7, ADR-063 §43).
        texte: construireTexteBonVisiteV2({
          bienReference: bien.reference,
          bienTitre: bien.titre,
          bienAdresse: bien.adresse,
          bienVille: bien.ville,
          bienCodePostal: bien.codePostal,
          dateRealisationISO: verrouVisite.ligne.realiseeLe ? verrouVisite.ligne.realiseeLe.toISOString() : null,
          conseillerNom,
        }),
      },
      consentement: { texte: TEXTE_CONSENTEMENT_BON_VISITE_V2, version: VERSION_TEMPLATE_BON_VISITE_V2 },
    };

    const [ligne] = await tx
      .insert(bonsVisiteTable)
      .values({
        visiteId,
        version,
        statut: "brouillon",
        templateVersion: VERSION_TEMPLATE_BON_VISITE_V2,
        contenuSnapshot: snapshot,
      })
      .returning();
    return { statut: "cree", bonVisite: ligneVersBonVisite(ligne) };
  });
}

// ───────────────────────────── ANNULATION (brouillon uniquement) ─────────────────────────────

export type ResultatAnnulationBonVisite =
  | { statut: "annule"; bonVisite: BonVisite }
  | { statut: "introuvable" }
  | { statut: "non_annulable" };

// §34 : seul un BROUILLON peut être annulé — un bon signé est terminal, jamais "annulé"
// destructivement (aucun chemin ne le permet, aucune régression possible par cette fonction).
export async function annulerBrouillonBonVisite(
  id: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatAnnulationBonVisite> {
  return executeur.transaction(async (tx) => {
    const verrou = await verrouillerBonVisite(id, workspaceId, tx);
    if (verrou.statut !== "verrouille") return { statut: "introuvable" };
    if (verrou.ligne.statut !== "brouillon") return { statut: "non_annulable" };

    const [ligne] = await tx
      .update(bonsVisiteTable)
      .set({ statut: "annule", annuleLe: new Date() })
      .where(and(eq(bonsVisiteTable.id, id), eq(bonsVisiteTable.statut, "brouillon")))
      .returning();
    if (!ligne) return { statut: "non_annulable" };
    return { statut: "annule", bonVisite: ligneVersBonVisite(ligne) };
  });
}

// ───────────────────────────── SIGNATURE ─────────────────────────────

export type NouvelleSignatureBonVisite = {
  bonVisiteId: string;
  contactId?: string;
  nomSignataire: string;
  prenomSignataire?: string;
  emailSignataire?: string;
  roleSignataire: RoleSignataire;
  signatureImagePng: Buffer;
  consentementConfirme: boolean;
};

export type ResultatSignatureBonVisite =
  | { statut: "signe"; bonVisite: BonVisite }
  | { statut: "introuvable" }
  | { statut: "deja_signe" }
  | { statut: "deja_annule" }
  | { statut: "consentement_manquant" }
  | { statut: "signature_vide" }
  | { statut: "signature_trop_grande" }
  | { statut: "contact_introuvable" }
  | { statut: "contact_fusionne" }
  // §35 — une visite annulée n'a pas eu lieu : son bon ne peut pas en attester la réalisation. La
  // création était déjà refusée (`visite_annulee`, creerBonVisite) ; ce refus-ci couvre le cas où la
  // Visite est annulée APRÈS la préparation du brouillon. Un cas normal du parcours, pas une
  // exception technique.
  | { statut: "visite_annulee" };

function nomFichierBonVisite(snapshot: SnapshotBonVisite, date: Date): string {
  const referenceSure = snapshot.bien.reference.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const dateSure = date.toISOString().slice(0, 10);
  return `bon-visite-${referenceSure || "bien"}-${dateSure}.pdf`;
}

// Writer central (§21) : génère et ÉCRIT LE FICHIER (PDF + image de signature) AVANT d'ouvrir la
// transaction DB — filesystem et transaction Postgres ne sont pas atomiques ensemble (avertissement
// explicite du brief). Un fichier écrit puis jamais référencé (transaction perdante, verrou perdu)
// reste un octet mort et inerte sur disque, jamais exposé, jamais servi — c'est le seul des deux
// échecs possibles qui reste sans danger ; l'inverse (une ligne DB "signée" sans fichier sur disque)
// serait une incohérence active. Double signature (§22) : sérialisée par le verrou de ligne DANS la
// transaction — la transaction perdante ne commite JAMAIS aucune ligne (signature/document/event),
// seuls ses fichiers pré-écrits restent orphelins.
export async function signerBonVisite(
  input: NouvelleSignatureBonVisite,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatSignatureBonVisite> {
  if (!input.consentementConfirme) return { statut: "consentement_manquant" };
  if (input.signatureImagePng.byteLength === 0) return { statut: "signature_vide" };
  if (input.signatureImagePng.byteLength > TAILLE_MAX_SIGNATURE_OCTETS) return { statut: "signature_trop_grande" };
  // Défense en profondeur (§29/§44) : revalide indépendamment de l'appelant (Server Action) que le
  // buffer n'est pas un canvas visuellement vide (transparent) — jamais une confiance aveugle dans
  // une validation déjà faite en amont.
  const emptiness = await bufferSignatureEstVide(input.signatureImagePng);
  if (emptiness !== "non_vide") return { statut: "signature_vide" };

  const bonActuel = await getBonVisiteById(input.bonVisiteId, workspaceId, executeur);
  if (!bonActuel) return { statut: "introuvable" };
  if (bonActuel.statut === "signe") return { statut: "deja_signe" };
  if (bonActuel.statut === "annule") return { statut: "deja_annule" };

  // BON_VISITE_V2_VISIT_LIFECYCLE_CORRECTION — la signature n'exige PAS que la Visite soit déjà
  // `realisee`, et ne la fait jamais transiter : le bon se signe à la fin de la visite, le compte
  // rendu vient après (workflow cible ADR-063), et `planifiee → realisee` reste la conséquence
  // exclusive de la création d'un compte rendu (ADR-040 §7, ADR-063 §43 — « jamais un bouton
  // indépendant »). Ce qui garantit l'honnêteté du document n'est donc pas une garde de lifecycle
  // mais le TEXTE lui-même : domiora-v2 n'affirme une date de visite que si `realisee_le` existait
  // à la préparation du bon, sinon il n'en affirme aucune et se fait dater par l'horodatage serveur
  // de la signature (templateBonVisite.ts).
  //
  // Le snapshot n'est JAMAIS reconstruit ici : le texte figé à la préparation est exactement celui
  // que la personne a lu à l'écran (invariant TEXT_SHOWN = TEXT_SIGNED, vrai par construction).
  const signeLe = new Date();
  const nomComplet = [input.prenomSignataire, input.nomSignataire].filter(Boolean).join(" ") || input.nomSignataire;

  const pdfBytes = await genererPdfBonVisite({
    contenuSnapshot: bonActuel.contenuSnapshot,
    bon: { id: bonActuel.id, version: bonActuel.version },
    signataire: { nomComplet, roleSignataire: input.roleSignataire },
    signatureImagePng: input.signatureImagePng,
    signeLe,
  });
  const hashDocument = createHash("sha256").update(pdfBytes).digest("hex");

  const cleStockageSignature = genererCleStockage();
  const cleStockageDocument = genererCleStockage();
  await ecrireDocument(cleStockageSignature, input.signatureImagePng);
  await ecrireDocument(cleStockageDocument, pdfBytes);

  return executeur.transaction(async (tx) => {
    const verrou = await verrouillerBonVisite(input.bonVisiteId, workspaceId, tx);
    if (verrou.statut !== "verrouille") return { statut: "introuvable" };
    if (verrou.ligne.statut === "signe") return { statut: "deja_signe" };
    if (verrou.ligne.statut === "annule") return { statut: "deja_annule" };
    // §35 — une visite annulée entre la préparation du brouillon et ce clic : le document
    // attesterait une visite qui n'a pas eu lieu. Vérifié ICI, sous verrou, dans la transaction qui
    // écrit — jamais seulement sur une lecture préalable hors transaction.
    if (verrou.visiteStatut === "annulee") return { statut: "visite_annulee" };

    // ADR-059 §10 — un contact absorbé est figé : aucune donnée vivante ne s'y rattache plus. Lu
    // SOUS VERROU (verrouillerContactActif), dans CETTE transaction, avant toute écriture — jamais
    // une lecture nue qui laisserait la course ouverte avec le moteur de fusion. contactId reste
    // optionnel (le signataire peut ne pas encore être un Contact canonique, §4) : le contrôle ne
    // s'applique que lorsqu'il est fourni.
    if (input.contactId) {
      const etatContact = await verrouillerContactActif(input.contactId, tx, workspaceId);
      if (etatContact.statut === "introuvable") return { statut: "contact_introuvable" };
      if (etatContact.statut === "fusionne") return { statut: "contact_fusionne" };
    }

    const snapshot = verrou.ligne.contenuSnapshot as SnapshotBonVisite;
    const document = await enregistrerDocumentBien(
      {
        bienId: snapshot.bien.id,
        visiteId: verrou.ligne.visiteId,
        nom: `Bon de visite signé — ${snapshot.bien.reference}`,
        categorie: "commercial",
        nomFichierOriginal: nomFichierBonVisite(snapshot, signeLe),
        cleStockage: cleStockageDocument,
        tailleOctets: pdfBytes.byteLength,
        typeMime: "application/pdf",
        typeDocument: "bon_visite",
        etatVerification: "non_verifie",
      },
      tx
    );

    await tx.insert(signaturesBonVisiteTable).values({
      bonVisiteId: input.bonVisiteId,
      contactId: input.contactId ?? null,
      roleSignataire: input.roleSignataire,
      nomSnapshot: input.nomSignataire,
      prenomSnapshot: input.prenomSignataire ?? null,
      emailSnapshot: input.emailSignataire ?? null,
      provider: "domiora",
      externalSignatureId: null,
      signatureCleStockage: cleStockageSignature,
      consentementConfirmeLe: signeLe,
      signeLe,
    });

    const [ligne] = await tx
      .update(bonsVisiteTable)
      // `contenuSnapshot` n'est JAMAIS réécrit par la signature (§5) — le texte figé à la
      // préparation est celui qui a été lu, imprimé et signé.
      .set({ statut: "signe", documentId: document.id, hashDocument, signeLe })
      .where(and(eq(bonsVisiteTable.id, input.bonVisiteId), eq(bonsVisiteTable.statut, "brouillon")))
      .returning();
    // Perdant de la course (§22) : le verrou a été obtenu, mais un autre gagnant a déjà signé entre
    // la relecture ci-dessus et cet UPDATE — impossible en pratique (le verrou FOR UPDATE bloque
    // toute lecture concurrente jusqu'au commit), gardé en défense en profondeur.
    if (!ligne) return { statut: "deja_signe" };

    await emettreEvenementEtPreparerExecutions({ typeEvenement: "bon_visite_signe", bonVisiteId: ligne.id }, workspaceId, tx);

    return { statut: "signe", bonVisite: ligneVersBonVisite(ligne) };
  });
}
