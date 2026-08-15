import { notFound, redirect } from "next/navigation";
import { getVisiteById } from "@/lib/visiteRepository";

type PageProps = { params: Promise<{ id: string }> };

// Identité URL stable pour une Visite Atlas (ADR-040) — redirige vers la page de préparation
// riche déjà existante (adressée par l'id du rendez-vous Calendar d'origine, jamais dupliquée
// ici : "ne construis pas une grosse nouvelle interface"). Rien ne pointe encore vers cette route
// aujourd'hui (limitation documentée : la tâche "suivi_apres_visite" cible un compte rendu, pas
// une Visite Atlas, voir docs/adr/040-cycle-vie-visite.md) — elle existe comme URL canonique
// stable pour un futur câblage.
export default async function VisitePage({ params }: PageProps) {
  const { id } = await params;
  const visite = await getVisiteById(id);
  if (!visite) notFound();
  redirect(`/visites/${visite.rendezVousCalendarId}/preparer`);
}
