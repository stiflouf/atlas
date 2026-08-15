// ADR-028. Remplace src/types/action.ts — table `actions` renommée `taches`, migration immédiate,
// aucune période de compatibilité.

// 'en_attente' est réservé pour une future vraie notion métier d'attente (client/notaire/document)
// — jamais dérivé aujourd'hui. Une tâche ouverte sans échéance reste "a_faire" ; "Sans échéance"
// (LABEL_ECHEANCE_ABSENTE ci-dessous) est un libellé d'affichage pour l'échéance manquante, pas un
// statut — ne jamais réutiliser "en_attente" pour ce cas (correction ADR-028).
export type StatutTache = "a_faire" | "terminee" | "annulee" | "en_attente";
export type PrioriteTache = "haute" | "normale" | "basse";
export type TypeTache = "appel" | "email" | "message" | "document" | "relance" | "autre";
// 'automatique' préparé pour une future génération de tâches (ADR-029+) — aucun code actuel ne
// crée de tâche 'automatique' aujourd'hui.
export type OrigineTache = "manuelle" | "automatique";

export const LABEL_STATUT_TACHE: Record<StatutTache, string> = {
  a_faire: "À faire",
  terminee: "Terminée",
  annulee: "Annulée",
  en_attente: "En attente",
};

export const LABEL_ECHEANCE_ABSENTE = "Sans échéance";

export const LABEL_TYPE_TACHE: Record<TypeTache, string> = {
  appel: "Appel",
  email: "Email",
  message: "Message",
  document: "Document",
  relance: "Relance",
  autre: "Autre",
};

export const LABEL_PRIORITE_TACHE: Record<PrioriteTache, string> = {
  haute: "Haute",
  normale: "Normale",
  basse: "Basse",
};

// Cibles réellement supportées par les sept FK dédiées de `taches` (jamais un couple
// objetType/objetId polymorphe sans FK — correction ADR-028, intégrité référentielle prioritaire
// sur la généricité). CibleTache n'est qu'une vue TypeScript/UI dérivée de ces colonnes, jamais une
// donnée stockée séparément.
export type TypeCible =
  | "bien"
  | "acquereur"
  | "prospectVendeur"
  | "visite"
  | "offre"
  | "compromis"
  | "remuneration";

export type CibleTache = { type: TypeCible; id: string };

// Source unique pour toute tâche métier. Les sept champs *Id sont indépendants et tous optionnels,
// mais mutuellement exclusifs en base (CHECK taches_une_seule_cible_check, schema.ts) : au plus un
// est renseigné à la fois. Une tâche sans aucun n'est pas une anomalie (tâche générale).
export type Tache = {
  id: string;
  titre: string;
  contexte?: string;
  type: TypeTache;
  priorite: PrioriteTache;
  echeance?: string;
  origine: OrigineTache;
  // Identifiant MACHINE stable (ex. "relance_prospect_silence_j15"), destiné aux futures règles
  // automatiques pour retrouver/dédupliquer leurs propres tâches — jamais du texte d'affichage
  // (voir `contexte` pour ça). `undefined` pour toute tâche d'origine 'manuelle'.
  origineCode?: string;
  bienId?: string;
  acquereurId?: string;
  prospectVendeurId?: string;
  visiteId?: string;
  offreId?: string;
  compromisId?: string;
  remunerationId?: string;
  creeLe: string;
  termineeLe?: string;
  annuleeLe?: string;
};

// Dérivé de termineeLe/annuleeLe à la lecture, jamais stocké — même principe que
// deriverStatutCommercial (ADR-014) / deriverStatutProspectVendeur (ADR-027). Les deux colonnes
// sont mutuellement exclusives par construction applicative (repository, gel concurrent) : l'ordre
// de vérification ci-dessous ne reflète donc jamais un choix arbitraire entre les deux.
export function deriverStatutTache(tache: Tache): StatutTache {
  if (tache.annuleeLe) return "annulee";
  if (tache.termineeLe) return "terminee";
  return "a_faire";
}

const CHAMPS_CIBLE: { type: TypeCible; champ: keyof Tache }[] = [
  { type: "bien", champ: "bienId" },
  { type: "acquereur", champ: "acquereurId" },
  { type: "prospectVendeur", champ: "prospectVendeurId" },
  { type: "visite", champ: "visiteId" },
  { type: "offre", champ: "offreId" },
  { type: "compromis", champ: "compromisId" },
  { type: "remuneration", champ: "remunerationId" },
];

// Vue générique {type,id} dérivée des sept colonnes dédiées — jamais plus d'une ne devrait être
// renseignée (garanti par le CHECK en base) ; si plusieurs l'étaient malgré tout (données
// corrompues hors du chemin applicatif normal), la première trouvée dans cet ordre fait foi,
// silencieusement, plutôt que de lever une erreur d'affichage.
export function deriverCibleTache(tache: Tache): CibleTache | undefined {
  for (const { type, champ } of CHAMPS_CIBLE) {
    const valeur = tache[champ];
    if (typeof valeur === "string") return { type, id: valeur };
  }
  return undefined;
}

// Préfixe de route pour les seuls types de cible possédant réellement une fiche navigable dans
// Atlas (ADR-039) — volontairement partiel : visite/offre/compromis/remuneration n'ont aucune page
// dédiée aujourd'hui (consultables uniquement depuis la fiche bien qui les héberge), jamais un lien
// factice construit pour elles.
const ROUTE_FICHE_PAR_TYPE_CIBLE: Partial<Record<TypeCible, string>> = {
  bien: "/biens",
  acquereur: "/clients",
  prospectVendeur: "/prospects-vendeurs",
};

// `undefined` = aucune fiche navigable pour ce type de cible (ou aucune cible du tout) — jamais un
// lien construit à l'aveugle. Ne dit rien sur l'archivage de l'entité elle-même : une cible
// archivée reste consultable (ADR-012, une fiche archivée s'affiche, seuls les flux actifs
// l'excluent), la route reste donc valide dans tous les cas.
export function deriverRouteFicheCible(tache: Tache): string | undefined {
  const cible = deriverCibleTache(tache);
  if (!cible) return undefined;
  const prefixe = ROUTE_FICHE_PAR_TYPE_CIBLE[cible.type];
  return prefixe ? `${prefixe}/${cible.id}` : undefined;
}
