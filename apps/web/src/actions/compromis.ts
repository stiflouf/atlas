"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getBienById, marquerCompromisSigne } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { getOffreById } from "@/lib/offreRepository";
import {
  enregistrerCompromis,
  getCompromisById,
  getCompromisParOffreId,
  marquerCompromisAnnule,
  marquerCompromisRealise,
  modifierDateActeCompromis,
  listerCompromisPourBien,
} from "@/lib/compromisRepository";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";
import { traiterExecutionsEnAttente } from "@/lib/automatisations/moteur";
import type { StatutCompromis } from "@/types/compromis";
import { MOTIFS_PERTE, type MotifPerte } from "@/types/motifPerte";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

const TRANSITIONS_VALIDES: StatutCompromis[] = ["realise", "annule"];

function parseMotifPerte(valeur: FormDataEntryValue | null): MotifPerte | undefined {
  return MOTIFS_PERTE.includes(valeur as MotifPerte) ? (valeur as MotifPerte) : undefined;
}

function parseMontant(valeur: FormDataEntryValue | null): number | undefined {
  const montant = Number(valeur);
  return Number.isFinite(montant) && montant > 0 ? montant : undefined;
}

function parseDateOptionnelle(valeur: FormDataEntryValue | null): string | undefined {
  const date = String(valeur ?? "").trim();
  return date !== "" ? date : undefined;
}

function parseOffreIdOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const id = String(valeur ?? "").trim();
  return id !== "" ? id : undefined;
}

// Refus explicite (throw) si le bien/acquéreur est invalide ou archivé, si un compromis est déjà
// en_cours pour ce bien (garde d'unicité applicative, ADR-016), ou si l'offre liée ne correspond
// pas au bien/acquéreur/statut attendu. Couplage : pose compromisSigneLe sur le bien dans la
// même action, un seul geste conseiller.
//
// Transaction unique englobant l'enregistrement du compromis, la pose de compromisSigneLe et
// l'émission de l'événement `compromis_signe` (ADR-032, correction validée) : corrige une absence
// d'atomicité préexistante entre les deux premières écritures (auparavant deux appels séquentiels
// non transactionnels) en même temps qu'elle y accroche le moteur d'automatisations.
export async function ajouterCompromisAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const bienId = String(formData.get("bienId") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const prixConvenu = parseMontant(formData.get("prixConvenu"));
  const dateSignature = String(formData.get("dateSignature") ?? "").trim();
  const dateActe = parseDateOptionnelle(formData.get("dateActe"));
  const offreId = parseOffreIdOptionnel(formData.get("offreId"));

  if (!prixConvenu) throw new Error("Le prix convenu doit être un nombre positif.");
  if (!dateSignature) throw new Error("La date de signature est obligatoire.");

  const [bien, acquereur] = await Promise.all([getBienById(bienId), getClientById(acquereurId)]);
  if (!bien) throw new Error("Bien introuvable.");
  if (bien.archiveLe) throw new Error("Impossible d'ajouter un compromis sur un bien archivé.");
  if (!acquereur) throw new Error("Acquéreur introuvable.");
  if (acquereur.archiveLe) throw new Error("Impossible d'ajouter un compromis pour un acquéreur archivé.");

  const compromisExistants = await listerCompromisPourBien(bienId);
  if (compromisExistants.some((c) => c.statut === "en_cours")) {
    throw new Error("Un compromis est déjà en cours pour ce bien.");
  }

  if (offreId) {
    const offre = await getOffreById(offreId);
    if (!offre) throw new Error("Offre introuvable.");
    if (offre.bienId !== bienId) throw new Error("Cette offre ne concerne pas ce bien.");
    if (offre.acquereurId !== acquereurId) throw new Error("Cette offre ne concerne pas cet acquéreur.");
    if (offre.statut !== "acceptee") throw new Error("Cette offre n'est pas acceptée.");
    // ADR-045 — en V1, une Offre acceptée ne peut être l'origine structurée que d'au plus un
    // Compromis. Garde applicative stricte, sans confirmation possible pour la contourner
    // (contrairement au doublon Offre×Offre d'ADR-044) : recontrôlée ici à chaque appel, jamais
    // une confiance dans un état affiché au GET.
    const compromisExistantPourOffre = await getCompromisParOffreId(offreId);
    if (compromisExistantPourOffre) {
      throw new Error("Cette offre est déjà associée à un compromis.");
    }
  }

  const idsExecutionsATraiter = await getDb().transaction(async (tx) => {
    let compromis;
    try {
      compromis = await enregistrerCompromis({ bienId, acquereurId, offreId, prixConvenu, dateSignature, dateActe }, tx);
    } catch (erreur) {
      // Défense en profondeur (ADR-047) : les gardes applicatives ci-dessus couvrent le cas
      // séquentiel normal, mais une écriture concurrente peut passer les deux gardes avant que
      // cette transaction ne s'exécute. Les contraintes DB protègent alors l'invariant — traduites
      // ici en un message identique aux gardes applicatives, jamais une erreur Postgres brute.
      const cause = erreur instanceof Error ? erreur.cause : undefined;
      if (cause && typeof cause === "object" && "constraint_name" in cause) {
        if (cause.constraint_name === "compromis_offre_id_unique") {
          throw new Error("Cette offre est déjà associée à un compromis.");
        }
        if (cause.constraint_name === "compromis_bien_id_en_cours_unique") {
          throw new Error("Un compromis est déjà en cours pour ce bien.");
        }
      }
      throw erreur;
    }
    await marquerCompromisSigne(bienId, tx);
    const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions(
      { typeEvenement: "compromis_signe", compromisId: compromis.id },
      tx
    );
    return idsExecutionsATraiter;
  });
  await traiterExecutionsEnAttente(idsExecutionsATraiter);

  redirect(`/biens/${bienId}`);
}

// Refus explicite (throw) si le compromis est introuvable, si le bien ou l'acquéreur est
// archivé, si le compromis n'est plus 'en_cours', ou (transition 'realise' uniquement) si
// dateActeReelle est absente/invalide — une vente ne doit jamais être marquée 'realise' sans date
// réelle (ADR-017). L'écriture statut+dateActeReelle est atomique (marquerCompromisRealise).
// Transition 'annule' (ADR-020) : dateAnnulation et motifAnnulation obligatoires, refus explicite
// sinon, aucune écriture — écriture atomique via marquerCompromisAnnule. Aucune inférence
// d'acteur : seul le motif choisi par le conseiller fait foi.
// Ne modifie jamais compromisSigneLe, l'archivage du bien, ni stadeProjet de l'acquéreur —
// gestes commerciaux volontairement séparés (ADR-014/ADR-016/ADR-017).
export async function changerStatutCompromisAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const compromisId = String(formData.get("compromisId") ?? "");
  const statut = String(formData.get("statut") ?? "") as StatutCompromis;

  if (!TRANSITIONS_VALIDES.includes(statut)) {
    throw new Error("Transition de statut invalide.");
  }

  const compromisActuel = await getCompromisById(compromisId);
  if (!compromisActuel) throw new Error("Compromis introuvable.");
  if (compromisActuel.statut !== "en_cours") {
    throw new Error("Ce compromis est déjà dans un statut final.");
  }

  const [bien, acquereur] = await Promise.all([
    getBienById(compromisActuel.bienId),
    getClientById(compromisActuel.acquereurId),
  ]);
  if (bien?.archiveLe) throw new Error("Impossible de modifier un compromis sur un bien archivé.");
  if (acquereur?.archiveLe) throw new Error("Impossible de modifier un compromis pour un acquéreur archivé.");

  if (statut === "realise") {
    const dateActeReelle = parseDateOptionnelle(formData.get("dateActeReelle"));
    if (!dateActeReelle) {
      throw new Error("La date réelle de signature de l'acte est obligatoire pour marquer une vente réalisée.");
    }
    await marquerCompromisRealise(compromisId, dateActeReelle);
  } else {
    const dateAnnulation = parseDateOptionnelle(formData.get("dateAnnulation"));
    if (!dateAnnulation) {
      throw new Error("La date d'annulation est obligatoire.");
    }
    const motifAnnulation = parseMotifPerte(formData.get("motifAnnulation"));
    if (!motifAnnulation) {
      throw new Error("Le motif de l'annulation est obligatoire.");
    }
    await marquerCompromisAnnule(compromisId, dateAnnulation, motifAnnulation);
  }

  redirect(`/biens/${compromisActuel.bienId}`);
}

// Modification de la date d'acte PRÉVUE (ADR-046) — jamais une transition de statut, action
// séparée et volontairement distincte de changerStatutCompromisAction. Refus explicite (throw) si
// le compromis est introuvable, si le bien ou l'acquéreur est archivé, ou si le compromis n'est
// plus 'en_cours' — les statuts terminaux (realise/annule) représentent l'historique constaté,
// jamais rétrospectivement modifié via ce chemin (seule dateActeReelle, posée atomiquement avec la
// transition 'realise', fait foi à ce stade). Relit le compromis à chaque appel, jamais une
// confiance dans un état affiché au GET : une course entre l'affichage du formulaire et sa
// soumission (le compromis devient 'realise'/'annule' entre-temps) est donc refusée ici, pas
// seulement masquée côté UI. `dateActe` reste nullable : un champ vide efface explicitement la
// date (report sans nouvelle date connue) — jamais remplacé par une estimation inventée.
export async function modifierDateActeAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const compromisId = String(formData.get("compromisId") ?? "");
  const dateActe = parseDateOptionnelle(formData.get("dateActe"));

  const compromisActuel = await getCompromisById(compromisId);
  if (!compromisActuel) throw new Error("Compromis introuvable.");
  if (compromisActuel.statut !== "en_cours") {
    throw new Error("La date d'acte prévue n'est modifiable que pour un compromis en cours.");
  }

  const [bien, acquereur] = await Promise.all([
    getBienById(compromisActuel.bienId),
    getClientById(compromisActuel.acquereurId),
  ]);
  if (bien?.archiveLe) throw new Error("Impossible de modifier un compromis sur un bien archivé.");
  if (acquereur?.archiveLe) throw new Error("Impossible de modifier un compromis pour un acquéreur archivé.");

  await modifierDateActeCompromis(compromisId, dateActe);

  redirect(`/biens/${compromisActuel.bienId}`);
}
