"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { archiverBien, desarchiverBien } from "@/lib/bienRepository";
import { marquerHorsPerimetrePourBien } from "@/lib/compatibilite/etatRepository";
import { enqueuerResynchronisationBien } from "@/lib/compatibilite/resynchronisationRepository";
import { traiterDemandeResynchronisation } from "@/lib/compatibilite/traitementResynchronisation";

// id absent/invalide/inexistant -> notFound(), jamais une redirection de succès silencieuse
// (même garde que modifierBienAction).
//
// Archivage (ADR-036) : bascule dans_perimetre_actif = false pour toutes les paires déjà observées
// de ce bien, DANS LA MÊME transaction que l'archivage — un simple UPDATE déterministe, jamais un
// appel à evaluerCompatibilite() (aucun fan-out, rien à isoler, donc pas de passage par le handoff
// ici, voir etatRepository.ts). Aucun événement "nouveau match" n'est bien sûr émis dans ce sens.
export async function archiverBienAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const bien = await getDb().transaction(async (tx) => {
    const bien = await archiverBien(id, tx);
    if (bien) await marquerHorsPerimetrePourBien(bien.id, tx);
    return bien;
  });
  if (!bien) notFound();

  redirect(`/biens/${bien.id}`);
}

// Désarchivage : enqueue une resynchronisation complète (ADR-036) — AUCUNE bascule inline de
// dans_perimetre_actif ici (voir le commentaire de etatRepository.ts) : c'est la resynchronisation
// elle-même qui doit encore lire l'ancien dans_perimetre_actif=false pour détecter correctement la
// transition hors_perimetre → actif comme un nouveau cycle si le statut réévalué est toujours
// compatible. Les données ont pu changer pendant l'archivage sans jamais être réévaluées (le bien
// était exclu de listerBiensActifsPersistes()) — d'où la resynchronisation complète, pas un simple
// flip.
export async function desarchiverBienAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const resultat = await getDb().transaction(async (tx) => {
    const bien = await desarchiverBien(id, tx);
    if (!bien) return undefined;
    const idDemandeResynchronisation = await enqueuerResynchronisationBien(bien.id, tx);
    return { bien, idDemandeResynchronisation };
  });
  if (!resultat) notFound();

  await traiterDemandeResynchronisation(resultat.idDemandeResynchronisation);
  redirect(`/biens/${resultat.bien.id}`);
}
