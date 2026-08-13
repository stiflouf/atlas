// Vocabulaire V1 de l'origine d'un lead vendeur (ADR-027) — jamais inventée : NULL = non
// déterminée, aucune valeur sentinelle 'inconnu' (contrairement à profil_fiscal, il n'y a pas de
// distinction utile ici entre "jamais demandé" et "demandé, ne sait pas"). `origineLeadDetail`
// (texte libre, sur ProspectVendeur) précise une valeur du vocabulaire fermé sans le faire
// exploser (ex. "Facebook", "SeLoger" sous 'reseaux_sociaux'/'site_web').
export const ORIGINES_LEAD = [
  "recommandation",
  "ancien_client",
  "site_web",
  "reseaux_sociaux",
  "prospection_terrain",
  "panneau",
  "salon_evenement",
  "apport_affaire",
  "autre",
] as const;

export type OrigineLead = (typeof ORIGINES_LEAD)[number];

export const LABEL_ORIGINE_LEAD: Record<OrigineLead, string> = {
  recommandation: "Recommandation",
  ancien_client: "Ancien client",
  site_web: "Site web",
  reseaux_sociaux: "Réseaux sociaux",
  prospection_terrain: "Prospection terrain",
  panneau: "Panneau",
  salon_evenement: "Salon / événement",
  apport_affaire: "Apport d'affaire",
  autre: "Autre",
};
