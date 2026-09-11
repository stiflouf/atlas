// ADR-034 + ADR-055 §B — le contrat d'ENTRÉE acquéreur du moteur de compatibilité, indépendant du
// stockage. Le moteur reçoit ce profil ; il ne sait pas, et ne doit jamais savoir, si les valeurs
// viennent du PROJET canonique (`projets_acquereur`), du dossier historique (`acquereurs`) ou d'un
// futur connecteur. La résolution de source a lieu AVANT lui (voir
// lib/compatibilite/profilCompatibiliteRepository.ts).
//
// AUCUNE IDENTITÉ HUMAINE : ni nom, ni prénom, ni email, ni téléphone, ni contact canonique. Un
// moteur de matching décide si un bien correspond à une recherche — savoir qui porte cette
// recherche ne change aucune de ses règles, et l'exposer ici inviterait la première règle qui
// « juste pour l'explication » lirait un nom.
//
// `id` est TOUJOURS l'identifiant du DOSSIER acquéreur, jamais celui du projet canonique : c'est
// lui que `ResultatCompatibilite.acquereurId` porte, que `compatibilites_bien_acquereur_etat`
// mémorise et que `evenements_metier` référence. Substituer l'id du projet renommerait
// silencieusement toutes les paires déjà observées.
//
// Champs volontairement ABSENTS, parce qu'aucun critère ne les lit :
//   - `budgetMin` — ADR-034 lui refuse explicitement toute sémantique de compatibilité (un bien
//     moins cher que le minimum n'est jamais incompatible pour ce seul motif) ;
//   - `criteres` — texte libre, qu'ADR-008 interdit à toute décision automatique ;
//   - `stadeProjet`, `archiveLe` — le parcours commercial et le cycle de vie sont filtrés par les
//     appelants (listerClientsActifsPersistes, etc.), jamais par une règle de compatibilité.
// Les poser ici produirait des champs morts que la première règle tentée finirait par lire.
export type ProfilCompatibiliteAcquereur = {
  id: string;
  budgetMax: number;
  // Absent = non documenté, jamais interprété comme une valeur négative (ADR-009) — même
  // discipline que `ProfilAcquereur` et `ProjetAcquereur`, dont ce type est la projection commune.
  piecesMin?: number;
  surfaceMin?: number;
  accessibiliteRequise?: boolean;
  necessiteParking?: boolean;
  necessiteExterieur?: boolean;
};
