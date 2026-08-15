"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { archiverAcquereur, desarchiverAcquereur } from "@/lib/clientRepository";
import { marquerHorsPerimetrePourAcquereur } from "@/lib/compatibilite/etatRepository";
import { enqueuerResynchronisationAcquereur } from "@/lib/compatibilite/resynchronisationRepository";
import { traiterDemandeResynchronisation } from "@/lib/compatibilite/traitementResynchronisation";

// id absent/invalide/inexistant -> notFound(), jamais une redirection de succès silencieuse
// (même garde que modifierAcquereurAction).
//
// Archivage (ADR-036) : bascule dans_perimetre_actif = false pour toutes les paires déjà observées
// de cet acquéreur, DANS LA MÊME transaction — voir archiverBienAction pour le raisonnement
// symétrique complet.
export async function archiverAcquereurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const acquereur = await getDb().transaction(async (tx) => {
    const acquereur = await archiverAcquereur(id, tx);
    if (acquereur) await marquerHorsPerimetrePourAcquereur(acquereur.id, tx);
    return acquereur;
  });
  if (!acquereur) notFound();

  redirect(`/clients/${acquereur.id}`);
}

// Désarchivage : enqueue une resynchronisation complète — voir desarchiverBienAction pour le
// raisonnement symétrique complet (aucune bascule inline de dans_perimetre_actif ici).
export async function desarchiverAcquereurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const resultat = await getDb().transaction(async (tx) => {
    const acquereur = await desarchiverAcquereur(id, tx);
    if (!acquereur) return undefined;
    const idDemandeResynchronisation = await enqueuerResynchronisationAcquereur(acquereur.id, tx);
    return { acquereur, idDemandeResynchronisation };
  });
  if (!resultat) notFound();

  await traiterDemandeResynchronisation(resultat.idDemandeResynchronisation);
  redirect(`/clients/${resultat.acquereur.id}`);
}
