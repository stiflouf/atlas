"use server";

import { redirect } from "next/navigation";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { enregistrerOffreAvecLiensEtJalon, getOffreById, changerStatutOffre, listerOffresEnCoursPourPaire } from "@/lib/offreRepository";
import { getCompteRenduVisiteById } from "@/lib/compteRenduVisiteRepository";
import type { StatutOffre } from "@/types/offre";
import { MOTIFS_PERTE, type MotifPerte } from "@/types/motifPerte";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

const TRANSITIONS_VALIDES: StatutOffre[] = ["acceptee", "refusee", "retiree"];

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

// Refus explicite (throw) si le bien ou l'acquéreur est invalide/inexistant/archivé — une offre
// est un nouveau fait métier structuré, jamais posé sur une entité sortie des flux actifs
// (ADR-012/ADR-014/ADR-015). Refuse aussi (throw, avant toute écriture) si un compteRenduVisiteId
// coché ne correspond pas exactement au même bien/acquéreur ou a une dateVisite postérieure à
// dateOffre (ADR-019) — jamais d'inférence, le conseiller ne peut lier que des visites qui
// correspondent réellement. L'offre, ses liens de visite et le jalon offreEnCoursLe sont écrits
// en une seule transaction (enregistrerOffreAvecLiensEtJalon) : un seul geste conseiller, tout ou
// rien.
//
// Doublon accidentel (ADR-044 §17-21) : si une offre 'en_cours' existe déjà pour EXACTEMENT cette
// paire bien/acquéreur, la création est refusée (throw) sauf confirmation explicite
// (`confirmerNouvelleOffreMalgreExistante`) — jamais un blocage définitif (une nouvelle
// proposition à un montant différent reste un scénario métier supporté), et jamais une confiance
// aveugle dans un avertissement déjà affiché côté client : recontrôlé ici à chaque appel, y
// compris pour un POST qui contournerait l'UI.
export async function ajouterOffreAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const bienId = String(formData.get("bienId") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const montant = parseMontant(formData.get("montant"));
  const dateOffre = String(formData.get("dateOffre") ?? "").trim();
  const dateValidite = parseDateOptionnelle(formData.get("dateValidite"));
  const compteRenduVisiteIds = formData.getAll("compteRenduVisiteIds").map(String).filter((id) => id !== "");
  const confirmerMalgreExistante = formData.get("confirmerNouvelleOffreMalgreExistante") != null;

  if (!montant) throw new Error("Le montant de l'offre doit être un nombre positif.");
  if (!dateOffre) throw new Error("La date de l'offre est obligatoire.");

  const [bien, acquereur] = await Promise.all([getBienById(bienId), getClientById(acquereurId)]);
  if (!bien) throw new Error("Bien introuvable.");
  if (bien.archiveLe) throw new Error("Impossible d'ajouter une offre sur un bien archivé.");
  if (!acquereur) throw new Error("Acquéreur introuvable.");
  if (acquereur.archiveLe) throw new Error("Impossible d'ajouter une offre pour un acquéreur archivé.");

  if (!confirmerMalgreExistante) {
    const offresEnCoursExistantes = await listerOffresEnCoursPourPaire(bienId, acquereurId);
    if (offresEnCoursExistantes.length > 0) {
      throw new Error(
        "Une offre en cours existe déjà pour cet acquéreur sur ce bien — confirmez explicitement pour en créer une nouvelle."
      );
    }
  }

  for (const compteRenduVisiteId of compteRenduVisiteIds) {
    const compteRendu = await getCompteRenduVisiteById(compteRenduVisiteId);
    if (!compteRendu) throw new Error("Visite introuvable.");
    if (compteRendu.bienId !== bienId) throw new Error("Cette visite ne concerne pas ce bien.");
    if (compteRendu.acquereurId !== acquereurId) throw new Error("Cette visite ne concerne pas cet acquéreur.");
    if (compteRendu.dateVisite > dateOffre) {
      throw new Error("Une visite postérieure à l'offre ne peut pas y être liée.");
    }
  }

  await enregistrerOffreAvecLiensEtJalon({ bienId, acquereurId, montant, dateOffre, dateValidite }, compteRenduVisiteIds);

  redirect(`/biens/${bienId}`);
}

// Refus explicite (throw) si l'offre est introuvable, si le bien ou l'acquéreur est archivé, ou
// si l'offre n'est plus 'en_cours' (transition déjà résolue — les boutons UI ne l'exposent déjà
// plus, ce garde-fou couvre un appel contourné). Ne modifie jamais offreEnCoursLe/
// compromisSigneLe (couplage unidirectionnel, geste commercial séparé — ADR-014/ADR-015).
// dateDecision obligatoire pour les trois transitions finales (ADR-020) ; motifPerte obligatoire
// uniquement pour refusee/retiree, et refusé explicitement (throw) s'il est fourni pour acceptee —
// jamais déduit, jamais laissé sur une offre acceptée. Aucune inférence d'acteur : seul le motif
// choisi par le conseiller fait foi.
export async function changerStatutOffreAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const offreId = String(formData.get("offreId") ?? "");
  const statut = String(formData.get("statut") ?? "") as StatutOffre;
  const dateDecision = String(formData.get("dateDecision") ?? "").trim();
  const motifPerteBrut = String(formData.get("motifPerte") ?? "").trim();

  if (!TRANSITIONS_VALIDES.includes(statut)) {
    throw new Error("Transition de statut invalide.");
  }
  if (!dateDecision) {
    throw new Error("La date de décision est obligatoire.");
  }

  const offre = await getOffreById(offreId);
  if (!offre) throw new Error("Offre introuvable.");
  if (offre.statut !== "en_cours") {
    throw new Error("Cette offre est déjà dans un statut final.");
  }

  const [bien, acquereur] = await Promise.all([getBienById(offre.bienId), getClientById(offre.acquereurId)]);
  if (bien?.archiveLe) throw new Error("Impossible de modifier une offre sur un bien archivé.");
  if (acquereur?.archiveLe) throw new Error("Impossible de modifier une offre pour un acquéreur archivé.");

  if (statut === "acceptee") {
    if (motifPerteBrut) throw new Error("Un motif de perte n'a pas de sens pour une offre acceptée.");
    await changerStatutOffre(offreId, { statut: "acceptee", dateDecision });
  } else if (statut === "refusee" || statut === "retiree") {
    const motifPerte = parseMotifPerte(motifPerteBrut);
    if (!motifPerte) throw new Error("Le motif de la perte est obligatoire.");
    await changerStatutOffre(offreId, { statut, dateDecision, motifPerte });
  } else {
    throw new Error("Transition de statut invalide.");
  }

  redirect(`/biens/${offre.bienId}`);
}
