"use server";

import { createHash } from "node:crypto";
import { getBienById } from "@/lib/bienRepository";
import { getCompromisById } from "@/lib/compromisRepository";
import { ErreurStockageDocumentsIndisponible, lireDocument } from "@/lib/stockageDocuments";
import {
  calculerPackNotaire,
  chargerContextePackNotaire,
  genererManifestePackNotaire,
  genererNomExport,
} from "@/lib/documents/packNotaire";
import { MAX_TAILLE_PACK_OCTETS } from "@/lib/documents/genererZipPackNotaire";
import { enregistrerTransmission, getTransmissionParCleIdempotence } from "@/lib/transmissionDossierNotaireRepository";
import type { DocumentBien } from "@/types/documentBien";
import type { DocumentManifesteSnapshot, ManifesteSnapshot } from "@/types/transmissionDossierNotaire";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

export type ResultatActionTransmission =
  | { statut: "idle" }
  | { statut: "enregistree" }
  | { statut: "deja_enregistree" }
  | { statut: "echec"; message: string };

// Volontairement simple, même convention que src/lib/google/mimeEmail.ts — dupliquée localement
// plutôt qu'importée : ADR-049 ne dépend jamais du module Gmail (aucun envoi réel ici).
const EMAIL_REGEX = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;

function texteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

// Déclaration explicite du conseiller ("j'ai transmis ce dossier") — jamais un transport réel des
// octets par Atlas (ADR-049 §1). Revalide intégralement le Compromis/Bien/documents côté serveur,
// exactement comme le Route Handler de génération ZIP (ADR-030), jamais confiance dans un champ
// caché non revérifié (§25 : empêche un POST rattaché à un autre Compromis que celui affiché).
export async function enregistrerTransmissionDossierNotaireAction(
  _etatPrecedent: ResultatActionTransmission | null,
  formData: FormData
): Promise<ResultatActionTransmission> {
  await exigerSessionAtlas();
  // Rappelée pour capturer l'email (creeParEmail) : le test structurel ADR-047 exige que la garde
  // apparaisse nue comme toute première instruction — la lecture est idempotente (cookie), un
  // second appel n'a aucun effet de bord ni coût de sécurité.
  const session = await exigerSessionAtlas();

  const compromisId = texteOptionnel(formData.get("compromisId"));
  const cleIdempotence = texteOptionnel(formData.get("cleIdempotence"));
  const documentIds = formData.getAll("documentIds").map(String);
  const etudeNom = texteOptionnel(formData.get("etudeNom"));
  const destinataireNom = texteOptionnel(formData.get("destinataireNom"));
  const destinataireEmail = texteOptionnel(formData.get("destinataireEmail"));
  const transmisLeSaisi = texteOptionnel(formData.get("transmisLe"));

  if (!compromisId || !cleIdempotence) {
    return { statut: "echec", message: "Requête invalide — dossier ou clé d'enregistrement manquante." };
  }
  if (!etudeNom) {
    return { statut: "echec", message: "Le nom de l'étude est obligatoire." };
  }
  if (destinataireEmail && !EMAIL_REGEX.test(destinataireEmail)) {
    return { statut: "echec", message: "Adresse email du destinataire invalide." };
  }
  if (documentIds.length === 0) {
    return { statut: "echec", message: "Sélectionnez au moins un document — une transmission sans document n'est pas enregistrée." };
  }

  // transmisLe : date DÉCLARÉE par le conseiller (distincte de creeLe, horodatage serveur de
  // l'enregistrement lui-même). Fallback sur l'instant serveur si absente/invalide ; jamais dans le
  // futur (au-delà d'une courte tolérance d'horloge cliente).
  const maintenant = new Date();
  let transmisLe = maintenant;
  if (transmisLeSaisi) {
    const parsed = new Date(transmisLeSaisi);
    if (Number.isNaN(parsed.getTime())) {
      return { statut: "echec", message: "Date de transmission invalide." };
    }
    if (parsed.getTime() > maintenant.getTime() + 5 * 60 * 1000) {
      return { statut: "echec", message: "La date de transmission ne peut pas être dans le futur." };
    }
    transmisLe = parsed;
  }

  const compromis = await getCompromisById(compromisId);
  if (!compromis) return { statut: "echec", message: "Compromis introuvable." };
  if (compromis.statut === "annule") {
    return { statut: "echec", message: "Ce compromis est annulé — aucune nouvelle transmission ne peut y être rattachée." };
  }

  const bien = await getBienById(compromis.bienId);
  if (!bien) return { statut: "echec", message: "Bien introuvable." };
  if (bien.archiveLe) {
    return { statut: "echec", message: "Ce bien est archivé — aucune nouvelle transmission ne peut être enregistrée." };
  }

  const contexte = await chargerContextePackNotaire(compromis.bienId);
  if (!contexte) return { statut: "echec", message: "Contexte du dossier introuvable." };
  const { ctx, documents } = contexte;

  // Le Compromis soumis doit être exactement celui que le contexte Pack aurait lui-même déterminé
  // — jamais un autre Compromis du même Bien substitué via un champ caché falsifié (§25).
  if (ctx.compromisActuel?.id !== compromisId) {
    return { statut: "echec", message: "Ce compromis ne correspond plus au contexte actuel de ce dossier." };
  }

  const pack = calculerPackNotaire(ctx, documents);
  const idsAutorises = new Set([...pack.selectionProposee, ...pack.documentsDisponibles].map((d) => d.id));
  const documentsParId = new Map(documents.map((d) => [d.id, d]));
  const documentsSelectionnes: DocumentBien[] = [];
  for (const idDemande of documentIds) {
    const doc = documentsParId.get(idDemande);
    if (!doc || !idsAutorises.has(idDemande)) {
      const nom = doc?.nom ?? idDemande;
      return { statut: "echec", message: `« ${nom} » ne peut pas être inclus dans cette transmission — enregistrement annulé.` };
    }
    documentsSelectionnes.push(doc);
  }

  const tailleTotale = documentsSelectionnes.reduce((total, d) => total + d.tailleOctets, 0);
  if (tailleTotale > MAX_TAILLE_PACK_OCTETS) {
    return {
      statut: "echec",
      message: `La sélection dépasse la taille maximale autorisée (${Math.round(MAX_TAILLE_PACK_OCTETS / (1024 * 1024))} Mo).`,
    };
  }

  // Snapshot entièrement construit AVANT le premier INSERT (§31) — tout hash manquant annule
  // l'enregistrement dans son ensemble, jamais une ligne partielle.
  const documentsSnapshot: DocumentManifesteSnapshot[] = [];
  for (const [index, doc] of documentsSelectionnes.entries()) {
    let contenu: Buffer | undefined;
    try {
      contenu = await lireDocument(doc.cleStockage);
    } catch (erreur) {
      // ADR-050 : stockage indisponible/mal configuré, distinct d'un document précis manquant
      // (ci-dessous) — aucun INSERT n'a encore eu lieu, aucune transmission partielle possible.
      if (erreur instanceof ErreurStockageDocumentsIndisponible) {
        return {
          statut: "echec",
          message: "Le stockage documentaire est indisponible — enregistrement annulé, aucune transmission créée.",
        };
      }
      throw erreur;
    }
    if (!contenu) {
      return {
        statut: "echec",
        message: `« ${doc.nom} » est introuvable dans le stockage — enregistrement annulé, aucun hash n'a pu être calculé.`,
      };
    }
    documentsSnapshot.push({
      documentId: doc.id,
      nomExport: genererNomExport(doc, index, ctx),
      nomOriginal: doc.nomFichierOriginal,
      categorie: doc.categorie,
      typeDocument: doc.typeDocument,
      etatVerification: doc.etatVerification,
      tailleOctets: doc.tailleOctets,
      sha256: createHash("sha256").update(contenu).digest("hex"),
    });
  }

  const manifesteSnapshot: ManifesteSnapshot = {
    manifesteTexte: genererManifestePackNotaire(ctx, pack, documentsSelectionnes),
    documents: documentsSnapshot,
  };

  const transmission = await enregistrerTransmission({
    compromisId,
    cleIdempotence,
    etudeNom,
    destinataireNom,
    destinataireEmail,
    transmisLe: transmisLe.toISOString(),
    creeParEmail: session.email,
    manifesteSnapshot,
  });

  if (!transmission) {
    // Conflit sur cleIdempotence : un double submit du même geste, jamais une seconde ligne.
    const existante = await getTransmissionParCleIdempotence(cleIdempotence);
    if (!existante) return { statut: "echec", message: "Transmission introuvable." };
    return { statut: "deja_enregistree" };
  }

  return { statut: "enregistree" };
}
