"use server";

import { notFound, redirect } from "next/navigation";
import {
  annulerCompromis,
  getBienById,
  marquerCompromisSigne,
  marquerOffreEnCours,
  retirerOffre,
} from "@/lib/bienRepository";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { existeOffreCanoniqueDuBien } from "@/lib/offreRepository";
import { listerCompromisPourBien } from "@/lib/compromisRepository";

// ADR-061 §12 — LEGACY_ACTIONS_POLICY (C) : dès qu'une entité canonique existe pour le bien (une
// Offre pour les jalons d'offre, un Compromis pour les jalons de compromis), ces actions n'écrivent
// PLUS RIEN — le fait commercial n'a qu'un writer, celui de l'entité canonique — et redirigent
// simplement. Elles restent le seul chemin pour un bien legacy sans entité canonique. Le
// masquage UI est porté par BienStatutAction (props `offreCanonique` / `compromisCanonique`).

// Refus explicite (throw) si le bien est archivé — un jalon commercial est un nouveau fait
// métier sur le dossier, jamais posé sur une entité sortie des flux actifs (ADR-012), même
// principe que creerAction. Les boutons sont déjà masqués côté UI sur un bien archivé ; ce
// garde-fou couvre un appel contourné.
async function verifierBienNonArchive(id: string) {
  const bien = await getBienById(id);
  if (!bien) notFound();
  if (bien.archiveLe) {
    throw new Error("Impossible de modifier le statut commercial d'un bien archivé.");
  }
  return bien;
}

export async function marquerOffreEnCoursAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  await verifierBienNonArchive(id);
  if (await existeOffreCanoniqueDuBien(id, workspaceId)) redirect(`/biens/${id}`);
  await marquerOffreEnCours(id);

  redirect(`/biens/${id}`);
}

// Refus explicite si un compromis est déjà signé — retirer l'offre créerait une incohérence
// (compromis signé sans offre sous-jacente). ADR-014.
export async function retirerOffreAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const bien = await verifierBienNonArchive(id);
  if (await existeOffreCanoniqueDuBien(id, workspaceId)) redirect(`/biens/${id}`);
  if (bien.compromisSigneLe) {
    throw new Error("Impossible de retirer l'offre : un compromis est déjà signé sur ce bien.");
  }
  await retirerOffre(id);

  redirect(`/biens/${id}`);
}

// Ne pose jamais offreEnCoursLe automatiquement : un compromis peut être marqué directement.
export async function marquerCompromisSigneAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  await verifierBienNonArchive(id);
  if ((await listerCompromisPourBien(id, workspaceId)).length > 0) redirect(`/biens/${id}`);
  await marquerCompromisSigne(id);

  redirect(`/biens/${id}`);
}

export async function annulerCompromisAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  await verifierBienNonArchive(id);
  if ((await listerCompromisPourBien(id, workspaceId)).length > 0) redirect(`/biens/${id}`);
  await annulerCompromis(id);

  redirect(`/biens/${id}`);
}
