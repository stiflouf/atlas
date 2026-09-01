// Vocabulaire des onglets de la fiche Bien (DEMO-DOCS-UX-01).
//
// Module volontairement NEUTRE — ni "use client", ni "use server" : il est importé à la fois par
// la page (Server Component, qui valide le paramètre d'URL) et par BienTabs (Client Component, qui
// rend les onglets). Exporter cette fonction depuis BienTabs lui-même ne marche pas : tout export
// d'un module "use client" devient une référence client, et l'appeler côté serveur lève
// « Attempted to call ongletBienValide() from the server but ongletBienValide is on the client ».
// Erreur invisible pour tsc, les tests unitaires et `next build` — seuls les E2E l'ont attrapée.

export const ONGLETS_BIEN = [
  "contexte",
  "historique",
  "notes",
  "visites",
  "documents",
  "offres",
  "compromis",
  "taches",
] as const;

export type OngletBien = (typeof ONGLETS_BIEN)[number];

// Valide une valeur d'URL arbitraire. Toute valeur inconnue retombe sur "contexte" : un lien
// bricolé ou périmé ne doit jamais produire une fiche sans onglet actif.
export function ongletBienValide(valeur: string | undefined): OngletBien {
  return ONGLETS_BIEN.includes(valeur as OngletBien) ? (valeur as OngletBien) : "contexte";
}
