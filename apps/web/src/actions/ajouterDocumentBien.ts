"use server";

import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { redirect } from "next/navigation";
import { getBienDuWorkspace } from "@/lib/bienRepository";
import {
  corrigerClassementDocumentBien,
  enregistrerDocumentBien,
  getDocumentBienDuWorkspace,
} from "@/lib/documentBienRepository";
import { validerCoherenceRattachementsDocument } from "@/lib/documents/coherenceRattachementDocument";
import { ecrireDocument, genererCleStockage } from "@/lib/stockageDocuments";
import {
  TYPES_DOCUMENT,
  type CategorieDocument,
  type ChampsCorrectionDocumentBien,
  type EtatVerificationDocument,
  type TypeDocument,
} from "@/types/documentBien";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { ErreurSaisie, avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

const CATEGORIES_VALIDES: CategorieDocument[] = [
  "mandat",
  "diagnostic",
  "copropriete",
  "technique",
  "commercial",
  "compromis",
  "autre",
];
const ETATS_VERIFICATION_VALIDES: EtatVerificationDocument[] = ["non_verifie", "confirme", "a_verifier", "rejete"];

// V1 : liste blanche volontairement restreinte (pas d'archives, pas de bureautique) — voir ADR
// stockage local V1.
const TYPES_MIME_AUTORISES = ["application/pdf", "image/jpeg", "image/png"];
const TAILLE_MAX_OCTETS = 10 * 1024 * 1024;

function parseCategorie(valeur: FormDataEntryValue | null): CategorieDocument {
  return CATEGORIES_VALIDES.includes(valeur as CategorieDocument) ? (valeur as CategorieDocument) : "autre";
}

function parseTypeDocumentOptionnel(valeur: FormDataEntryValue | null): TypeDocument | undefined {
  return TYPES_DOCUMENT.includes(valeur as TypeDocument) ? (valeur as TypeDocument) : undefined;
}

function parseEtatVerification(valeur: FormDataEntryValue | null): EtatVerificationDocument {
  return ETATS_VERIFICATION_VALIDES.includes(valeur as EtatVerificationDocument)
    ? (valeur as EtatVerificationDocument)
    : "non_verifie";
}

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

function parseTexteOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : null;
}

// Refus explicite (throw) si le bien est introuvable/archivé, si le fichier est absent/vide, hors
// liste blanche MIME ou trop volumineux, ou si un rattachement renseigné (compromisId/
// acquereurId/prospectVendeurId) est incohérent avec le bien (ADR-029 — des FK valides séparément
// ne suffisent pas). Le fichier n'est écrit sur disque qu'après validation complète — jamais
// avant, jamais si l'insertion DB qui suit pourrait échouer sur un bien/rattachement invalide.
export async function ajouterDocumentBienAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const bienId = String(formData.get("bienId") ?? "");
    const nom = String(formData.get("nom") ?? "").trim();
    const categorie = parseCategorie(formData.get("categorie"));
    const fichier = formData.get("fichier");

    if (!bienId) throw new ErreurSaisie("Bien introuvable.");
    if (!nom) throw new ErreurSaisie("Le nom du document est obligatoire.");
    if (!(fichier instanceof File) || fichier.size === 0) {
      throw new ErreurSaisie("Un fichier est obligatoire.");
    }
    if (fichier.size > TAILLE_MAX_OCTETS) {
      throw new ErreurSaisie("Le fichier dépasse la taille maximale autorisée (10 Mo).");
    }
    if (!TYPES_MIME_AUTORISES.includes(fichier.type)) {
      throw new ErreurSaisie("Type de fichier non autorisé (PDF, JPEG ou PNG uniquement).");
    }

    // WORKSPACE_SCOPING_V1 (ADR-054) — le bien est prouvé dans le périmètre AVANT toute écriture
    // disque : un bien d'un autre workspace ne laisse aucun fichier orphelin derrière lui.
    const workspaceId = await exigerWorkspaceCourant();
    const bien = await getBienDuWorkspace(bienId, workspaceId);
    if (!bien) throw new ErreurSaisie("Bien introuvable.");
    if (bien.archiveLe) throw new ErreurSaisie("Impossible d'ajouter un document sur un bien archivé.");

    const compromisId = parseTexteOptionnel(formData.get("compromisId"));
    const acquereurId = parseTexteOptionnel(formData.get("acquereurId"));
    const prospectVendeurId = parseTexteOptionnel(formData.get("prospectVendeurId"));

    await validerCoherenceRattachementsDocument({ bienId, compromisId, acquereurId, prospectVendeurId }, workspaceId);

    const cleStockage = genererCleStockage();
    const octets = Buffer.from(await fichier.arrayBuffer());
    await ecrireDocument(cleStockage, octets);
    await enregistrerDocumentBien({
      bienId,
      nom,
      categorie,
      nomFichierOriginal: fichier.name,
      cleStockage,
      tailleOctets: fichier.size,
      typeMime: fichier.type,
      typeDocument: parseTypeDocumentOptionnel(formData.get("typeDocument")),
      typeDocumentDetail: parseTexteOptionnel(formData.get("typeDocumentDetail")),
      dateDocument: parseTexteOptionnel(formData.get("dateDocument")),
      dateFinValidite: parseTexteOptionnel(formData.get("dateFinValidite")),
      compromisId,
      acquereurId,
      prospectVendeurId,
      coproprieteDeclaree: parseTexteOptionnel(formData.get("coproprieteDeclaree")),
      adresseDeclaree: parseTexteOptionnel(formData.get("adresseDeclaree")),
      provenance: parseTexteOptionnel(formData.get("provenance")),
      etatVerification: "non_verifie",
    });

    redirect(`/biens/${bienId}?onglet=documents`);
  });
}

// Correction de classement (ADR-029) : remplacement complet des champs corrigibles, jamais un
// patch partiel — un champ vidé dans le formulaire repasse explicitement à NULL. Ne touche jamais
// au fichier physique (immuable, ADR-013). Refus explicite si le document est introuvable, si le
// bien cible est introuvable/archivé, ou si un rattachement renseigné est incohérent avec le bien
// cible.
export async function corrigerClassementDocumentBienAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    // WORKSPACE_SCOPING_V1 (ADR-054) — LES DEUX extrémités sont prouvées dans le périmètre : le
    // document corrigé ET le bien de destination. Sans cela, un classement pouvait déplacer un
    // document d'un workspace vers un autre — la seule opération du produit capable de faire
    // franchir une frontière d'appartenance à une ligne existante.
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    const documentActuel = await getDocumentBienDuWorkspace(id, workspaceId);
    if (!documentActuel) throw new ErreurSaisie("Document introuvable.");

    const bienId = String(formData.get("bienId") ?? "").trim();
    const nom = String(formData.get("nom") ?? "").trim();
    if (!bienId) throw new ErreurSaisie("Le bien est obligatoire.");
    if (!nom) throw new ErreurSaisie("Le nom du document est obligatoire.");

    const bien = await getBienDuWorkspace(bienId, workspaceId);
    if (!bien) throw new ErreurSaisie("Bien introuvable.");
    if (bien.archiveLe) throw new ErreurSaisie("Impossible de rattacher un document à un bien archivé.");

    const compromisId = parseTexteOuNull(formData.get("compromisId"));
    const acquereurId = parseTexteOuNull(formData.get("acquereurId"));
    const prospectVendeurId = parseTexteOuNull(formData.get("prospectVendeurId"));

    await validerCoherenceRattachementsDocument({ bienId, compromisId, acquereurId, prospectVendeurId }, workspaceId);

    const champs: ChampsCorrectionDocumentBien = {
      bienId,
      nom,
      categorie: parseCategorie(formData.get("categorie")),
      typeDocument: parseTypeDocumentOptionnel(formData.get("typeDocument")) ?? null,
      typeDocumentDetail: parseTexteOuNull(formData.get("typeDocumentDetail")),
      dateDocument: parseTexteOuNull(formData.get("dateDocument")),
      dateFinValidite: parseTexteOuNull(formData.get("dateFinValidite")),
      compromisId,
      acquereurId,
      prospectVendeurId,
      coproprieteDeclaree: parseTexteOuNull(formData.get("coproprieteDeclaree")),
      adresseDeclaree: parseTexteOuNull(formData.get("adresseDeclaree")),
      provenance: parseTexteOuNull(formData.get("provenance")),
      etatVerification: parseEtatVerification(formData.get("etatVerification")),
    };

    const resultat = await corrigerClassementDocumentBien(id, champs);
    if (!resultat) throw new ErreurSaisie("Document introuvable.");

    redirect(`/biens/${bienId}?onglet=documents`);
  });
}
