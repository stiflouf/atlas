// VISIT_NATIVE_ENTRY_V1 — provenance d'ouverture d'une fiche Visite, ENUM FERMÉ. Une valeur d'URL
// ou de formulaire hors de cette liste retombe sur `undefined` (retour Aujourd'hui) : jamais un
// chemin arbitraire relu depuis la requête, aucune redirection ouverte possible.
export const RETOURS_VISITE = ["bien", "acquereur"] as const;
export type RetourVisite = (typeof RETOURS_VISITE)[number];

export function retourVisiteValide(valeur: string | undefined): RetourVisite | undefined {
  return RETOURS_VISITE.includes(valeur as RetourVisite) ? (valeur as RetourVisite) : undefined;
}

export function routeVisiteAvecRetour(visiteId: string, retour: RetourVisite | undefined): string {
  return retour ? `/visites/${visiteId}?retour=${retour}` : `/visites/${visiteId}`;
}

// Lien « retour » de la fiche Visite : le Bien (onglet Visites) ou l'acquéreur d'où l'on vient,
// sinon Aujourd'hui (comportement historique). Les ids viennent de la Visite déjà résolue dans le
// workspace de session — jamais de la requête.
export function lienRetourFicheVisite(
  retour: RetourVisite | undefined,
  visite: { bienId: string; acquereurId: string }
): { href: string; label: string } {
  if (retour === "bien") return { href: `/biens/${visite.bienId}?onglet=visites`, label: "Retour au bien" };
  if (retour === "acquereur") return { href: `/clients/${visite.acquereurId}`, label: "Retour à l'acquéreur" };
  return { href: "/", label: "Aujourd'hui" };
}
