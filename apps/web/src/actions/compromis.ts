"use server";

import { redirect } from "next/navigation";
import { getBienById, marquerCompromisSigne } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { getOffreById } from "@/lib/offreRepository";
import {
  enregistrerCompromis,
  getCompromisById,
  changerStatutCompromis,
  marquerCompromisRealise,
  listerCompromisPourBien,
} from "@/lib/compromisRepository";
import type { StatutCompromis } from "@/types/compromis";

const TRANSITIONS_VALIDES: StatutCompromis[] = ["realise", "annule"];

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
export async function ajouterCompromisAction(formData: FormData): Promise<void> {
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
  }

  await enregistrerCompromis({ bienId, acquereurId, offreId, prixConvenu, dateSignature, dateActe });
  await marquerCompromisSigne(bienId);

  redirect(`/biens/${bienId}`);
}

// Refus explicite (throw) si le compromis est introuvable, si le bien ou l'acquéreur est
// archivé, si le compromis n'est plus 'en_cours', ou (transition 'realise' uniquement) si
// dateActeReelle est absente/invalide — une vente ne doit jamais être marquée 'realise' sans date
// réelle (ADR-017). L'écriture statut+dateActeReelle est atomique (marquerCompromisRealise).
// Ne modifie jamais compromisSigneLe, l'archivage du bien, ni stadeProjet de l'acquéreur —
// gestes commerciaux volontairement séparés (ADR-014/ADR-016/ADR-017).
export async function changerStatutCompromisAction(formData: FormData): Promise<void> {
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
    await changerStatutCompromis(compromisId, statut);
  }

  redirect(`/biens/${compromisActuel.bienId}`);
}
