"use server";

import { redirect } from "next/navigation";
import { getBienById, marquerOffreEnCours } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { enregistrerOffre, getOffreById, changerStatutOffre } from "@/lib/offreRepository";
import type { StatutOffre } from "@/types/offre";

const TRANSITIONS_VALIDES: StatutOffre[] = ["acceptee", "refusee", "retiree"];

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
// (ADR-012/ADR-014/ADR-015). Couplage unidirectionnel : pose offreEnCoursLe sur le bien dans la
// même action, un seul geste conseiller.
export async function ajouterOffreAction(formData: FormData): Promise<void> {
  const bienId = String(formData.get("bienId") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const montant = parseMontant(formData.get("montant"));
  const dateOffre = String(formData.get("dateOffre") ?? "").trim();
  const dateValidite = parseDateOptionnelle(formData.get("dateValidite"));

  if (!montant) throw new Error("Le montant de l'offre doit être un nombre positif.");
  if (!dateOffre) throw new Error("La date de l'offre est obligatoire.");

  const [bien, acquereur] = await Promise.all([getBienById(bienId), getClientById(acquereurId)]);
  if (!bien) throw new Error("Bien introuvable.");
  if (bien.archiveLe) throw new Error("Impossible d'ajouter une offre sur un bien archivé.");
  if (!acquereur) throw new Error("Acquéreur introuvable.");
  if (acquereur.archiveLe) throw new Error("Impossible d'ajouter une offre pour un acquéreur archivé.");

  await enregistrerOffre({ bienId, acquereurId, montant, dateOffre, dateValidite });
  await marquerOffreEnCours(bienId);

  redirect(`/biens/${bienId}`);
}

// Refus explicite (throw) si l'offre est introuvable, si le bien ou l'acquéreur est archivé, ou
// si l'offre n'est plus 'en_cours' (transition déjà résolue — les boutons UI ne l'exposent déjà
// plus, ce garde-fou couvre un appel contourné). Ne modifie jamais offreEnCoursLe/
// compromisSigneLe (couplage unidirectionnel, geste commercial séparé — ADR-014/ADR-015).
export async function changerStatutOffreAction(formData: FormData): Promise<void> {
  const offreId = String(formData.get("offreId") ?? "");
  const statut = String(formData.get("statut") ?? "") as StatutOffre;

  if (!TRANSITIONS_VALIDES.includes(statut)) {
    throw new Error("Transition de statut invalide.");
  }

  const offre = await getOffreById(offreId);
  if (!offre) throw new Error("Offre introuvable.");
  if (offre.statut !== "en_cours") {
    throw new Error("Cette offre est déjà dans un statut final.");
  }

  const [bien, acquereur] = await Promise.all([getBienById(offre.bienId), getClientById(offre.acquereurId)]);
  if (bien?.archiveLe) throw new Error("Impossible de modifier une offre sur un bien archivé.");
  if (acquereur?.archiveLe) throw new Error("Impossible de modifier une offre pour un acquéreur archivé.");

  await changerStatutOffre(offreId, statut);

  redirect(`/biens/${offre.bienId}`);
}
