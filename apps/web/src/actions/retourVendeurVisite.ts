"use server";

import { redirect } from "next/navigation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { enregistrerRetourVendeurVisite } from "@/lib/retourVendeurVisiteRepository";
import type { TypeInteraction } from "@/types/interaction";

const CANAUX_VALIDES: TypeInteraction[] = ["appel", "email", "sms", "rendez_vous", "message", "note"];

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

// SELLER_FEEDBACK_INTERACTION_V1 (ADR-063) — le retour vendeur devient un fait CRM canonique
// (Interaction), jamais seulement une tâche cochée. Toute la validation métier (Visite realisee,
// vendeur canonique résolu, contact actif, idempotence) vit dans le writer transactionnel — cette
// Action ne fait que parser le formulaire et rediriger.
export async function enregistrerRetourVendeurVisiteAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const visiteId = String(formData.get("visiteId") ?? "");
  if (!visiteId) redirect("/");

  const canalValeur = String(formData.get("canal") ?? "appel");
  const canal: TypeInteraction = CANAUX_VALIDES.includes(canalValeur as TypeInteraction) ? (canalValeur as TypeInteraction) : "appel";
  const note = parseTexteOptionnel(formData.get("note"));

  const resultat = await enregistrerRetourVendeurVisite({ visiteId, canal, note }, workspaceId);
  if (resultat.statut !== "enregistre") redirect(`/visites/${visiteId}?erreurRetourVendeur=${resultat.statut}`);
  redirect(`/visites/${visiteId}`);
}
