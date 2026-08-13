import type { AlerteCopilote, TypeAlerte } from "@/types/alerte";

// Types dont la génération ne dépend jamais d'un profil fiscal (commercial pur) — jamais absorbés
// quand A1 (profil_fiscal_absent) est présente.
const TYPES_INDEPENDANTS_PROFIL: ReadonlySet<TypeAlerte> = new Set<TypeAlerte>([
  "profil_fiscal_absent",
  "remuneration_manquante",
  "date_encaissement_prevue_manquante",
  "encaissement_attendu_depasse",
]);

// Déduplication par CAUSE RACINE (types/codes), jamais par simple comparaison de texte — un dernier
// filet de sécurité par libellé identique reste en toute fin, mais n'est jamais le mécanisme
// principal (ADR-026).
export function dedupliquerAlertes(alertes: AlerteCopilote[]): AlerteCopilote[] {
  let resultat = alertes;

  // A1 est une cause racine : si aucun profil fiscal n'existe, toute alerte qui ne ferait que
  // reformuler cette même absence (tout ce qui dépend de contexte.fiscal) est supprimée.
  if (resultat.some((a) => a.type === "profil_fiscal_absent")) {
    resultat = resultat.filter((a) => TYPES_INDEPENDANTS_PROFIL.has(a.type));
  }

  // A3 (assiette incomplète) peut absorber A7 (historique run-rate insuffisant) lorsque leur cause
  // est la même couverture insuffisante — jamais D3 (règles futures hypothétiques), cause
  // indépendante explicitement préservée.
  if (resultat.some((a) => a.type === "assiette_incomplete")) {
    resultat = resultat.filter((a) => a.type !== "historique_run_rate_insuffisant");
  }

  // Filet de sécurité n° 1 : même id déterministe = même cause exacte (type + code/année), gardé une
  // seule fois.
  const parId = new Map<string, AlerteCopilote>();
  for (const alerte of resultat) {
    if (!parId.has(alerte.id)) parId.set(alerte.id, alerte);
  }

  // Filet de sécurité n° 2, en tout dernier recours : deux alertes au libellé strictement identique
  // (ex. deux règles composées différentes aboutissant au même texte) ne sont jamais montrées deux
  // fois — mécanisme secondaire, jamais celui qui porte la logique de déduplication.
  const parTitre = new Map<string, AlerteCopilote>();
  for (const alerte of parId.values()) {
    if (!parTitre.has(alerte.titre)) parTitre.set(alerte.titre, alerte);
  }

  return [...parTitre.values()];
}
