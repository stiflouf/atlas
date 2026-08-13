"use server";

import { notFound, redirect } from "next/navigation";
import {
  getProspectVendeurById,
  creerProspectVendeur,
  modifierProspectVendeur,
  qualifierProspectVendeur,
  enregistrerEstimationProspectVendeur,
  planifierRdvEstimationProspectVendeur,
  marquerRdvEstimationRealiseProspectVendeur,
  proposerMandatProspectVendeur,
  signerMandatProspectVendeur,
  marquerProspectVendeurPerdu,
  archiverProspectVendeur,
  desarchiverProspectVendeur,
  mettreAJourProchaineActionProspectVendeur,
} from "@/lib/prospectVendeurRepository";
import { ajouterNoteProspectVendeur } from "@/lib/noteProspectVendeurRepository";
import { parseProspectVendeurFormData, parseSignatureMandatFormData } from "@/lib/prospectVendeurFormulaire";
import { parseMontantCentimes } from "@/types/remuneration";
import { deriverStatutProspectVendeur } from "@/types/prospectVendeur";
import { MOTIFS_PERTE_PROSPECT_VENDEUR, type MotifPerteProspectVendeur } from "@/types/motifPerteProspectVendeur";
import { TYPES_NOTE_PROSPECT_VENDEUR, type TypeNoteProspectVendeur } from "@/types/noteProspectVendeur";
import type { ProspectVendeur } from "@/types/prospectVendeur";

function parseDateOptionnelle(valeur: FormDataEntryValue | null): string | undefined {
  const date = String(valeur ?? "").trim();
  return date !== "" ? date : undefined;
}

// <input type="datetime-local"> -> Date. rdv_estimation_prevu_le/realise_le portent l'heure
// (ADR-027, correction n° 3) — jamais tronqués à une simple date.
function parseDateHeure(valeur: FormDataEntryValue | null): Date | undefined {
  const brut = String(valeur ?? "").trim();
  if (!brut) return undefined;
  const date = new Date(brut);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// Guard partagée par tous les jalons de pipeline (ADR-027) : aucune séquence stricte imposée entre
// qualification/estimation/rendez-vous/mandat proposé, seuls perte et signature sont terminaux.
async function chargerProspectPourJalon(id: string): Promise<ProspectVendeur> {
  const prospect = await getProspectVendeurById(id);
  if (!prospect) notFound();
  const statut = deriverStatutProspectVendeur(prospect);
  if (statut === "perdu") throw new Error("Ce prospect est marqué perdu — aucun jalon ne peut plus être posé.");
  if (statut === "mandat_signe") throw new Error("Le mandat est déjà signé — aucun jalon ne peut plus être posé.");
  return prospect;
}

export async function creerProspectVendeurAction(formData: FormData): Promise<void> {
  const prospect = await creerProspectVendeur(parseProspectVendeurFormData(formData));
  redirect(`/prospects-vendeurs/${prospect.id}`);
}

export async function modifierProspectVendeurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  const prospect = await modifierProspectVendeur(id, parseProspectVendeurFormData(formData));
  if (!prospect) notFound();
  redirect(`/prospects-vendeurs/${prospect.id}`);
}

export async function qualifierProspectVendeurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  await chargerProspectPourJalon(id);
  await qualifierProspectVendeur(id);
  redirect(`/prospects-vendeurs/${id}`);
}

export async function enregistrerEstimationProspectVendeurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  await chargerProspectPourJalon(id);

  const estimationProposeeCentimes = parseMontantCentimes(String(formData.get("estimationProposeeCentimes") ?? ""));
  if (estimationProposeeCentimes === undefined || estimationProposeeCentimes <= 0) {
    throw new Error("Le montant de l'estimation doit être un nombre positif.");
  }
  const estimationProposeeLe = parseDateOptionnelle(formData.get("estimationProposeeLe"));
  if (!estimationProposeeLe) throw new Error("La date de l'estimation est obligatoire.");

  await enregistrerEstimationProspectVendeur(id, estimationProposeeCentimes, estimationProposeeLe);
  redirect(`/prospects-vendeurs/${id}`);
}

export async function planifierRdvEstimationProspectVendeurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  await chargerProspectPourJalon(id);

  const rdvEstimationPrevuLe = parseDateHeure(formData.get("rdvEstimationPrevuLe"));
  if (!rdvEstimationPrevuLe) throw new Error("La date et l'heure du rendez-vous sont obligatoires.");

  await planifierRdvEstimationProspectVendeur(id, rdvEstimationPrevuLe);
  redirect(`/prospects-vendeurs/${id}`);
}

export async function marquerRdvEstimationRealiseProspectVendeurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  await chargerProspectPourJalon(id);

  const rdvEstimationRealiseLe = parseDateHeure(formData.get("rdvEstimationRealiseLe"));
  if (!rdvEstimationRealiseLe) throw new Error("La date et l'heure du rendez-vous réalisé sont obligatoires.");

  await marquerRdvEstimationRealiseProspectVendeur(id, rdvEstimationRealiseLe);
  redirect(`/prospects-vendeurs/${id}`);
}

export async function proposerMandatProspectVendeurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  await chargerProspectPourJalon(id);
  await proposerMandatProspectVendeur(id);
  redirect(`/prospects-vendeurs/${id}`);
}

// ADR-027, correction n° 6 : aucune valeur fictive — parseSignatureMandatFormData rejette
// explicitement toute soumission dont un champ obligatoire de `biens` serait vide, pré-rempli ou
// non. Transaction atomique portée par le repository (signerMandatProspectVendeur) : bien créé et
// mandatSigneLe/bienId posés ensemble, ou aucun des deux.
export async function signerMandatProspectVendeurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  await chargerProspectPourJalon(id);

  const donneesBien = parseSignatureMandatFormData(formData);
  const resultat = await signerMandatProspectVendeur(id, donneesBien);
  if (!resultat) notFound();

  redirect(`/biens/${resultat.bien.id}`);
}

export async function marquerProspectVendeurPerduAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const prospect = await getProspectVendeurById(id);
  if (!prospect) notFound();
  if (deriverStatutProspectVendeur(prospect) === "mandat_signe") {
    throw new Error("Le mandat est déjà signé — impossible de marquer ce prospect comme perdu.");
  }

  const motifPerte = String(formData.get("motifPerte") ?? "") as MotifPerteProspectVendeur;
  if (!MOTIFS_PERTE_PROSPECT_VENDEUR.includes(motifPerte)) throw new Error("Le motif de perte est obligatoire.");
  const datePerte = parseDateOptionnelle(formData.get("datePerte"));
  if (!datePerte) throw new Error("La date de perte est obligatoire.");

  await marquerProspectVendeurPerdu(id, motifPerte, datePerte);
  redirect(`/prospects-vendeurs/${id}`);
}

export async function archiverProspectVendeurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  const prospect = await archiverProspectVendeur(id);
  if (!prospect) notFound();
  redirect(`/prospects-vendeurs/${id}`);
}

export async function desarchiverProspectVendeurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  const prospect = await desarchiverProspectVendeur(id);
  if (!prospect) notFound();
  redirect(`/prospects-vendeurs/${id}`);
}

// ADR-027, correction n° 2 : le type choisi détermine si dernier_contact_le avance (voir
// noteProspectVendeurRepository.ajouterNoteProspectVendeur) — aucune logique dupliquée ici.
export async function ajouterNoteProspectVendeurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const type = String(formData.get("type") ?? "") as TypeNoteProspectVendeur;
  if (!TYPES_NOTE_PROSPECT_VENDEUR.includes(type)) throw new Error("Type de note invalide.");
  const contenu = String(formData.get("contenu") ?? "").trim();
  if (!contenu) throw new Error("Le contenu de la note ne peut pas être vide.");

  await ajouterNoteProspectVendeur(id, type, contenu);
  redirect(`/prospects-vendeurs/${id}`);
}

export async function mettreAJourProchaineActionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const prochaineAction = parseDateOptionnelle(formData.get("prochaineAction"));
  const prochaineActionLe = parseDateOptionnelle(formData.get("prochaineActionLe"));
  if (prochaineActionLe !== undefined && prochaineAction === undefined) {
    throw new Error("Une échéance de prochaine action suppose un libellé de prochaine action.");
  }

  const prospect = await mettreAJourProchaineActionProspectVendeur(id, prochaineAction, prochaineActionLe);
  if (!prospect) notFound();
  redirect(`/prospects-vendeurs/${id}`);
}
