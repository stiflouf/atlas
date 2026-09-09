// ADR-055 §A — identité canonique d'une personne, indépendante de tout dossier.
//
// Ce type ne porte AUCUN rôle métier (vendeur, acquéreur, propriétaire, apporteur…) : un rôle est
// une conséquence des relations, jamais un attribut de la personne. Il ne porte pas davantage de
// donnée de projet (budget, secteur recherché, motivation, jalon commercial) — celles-ci
// appartiennent aux projets, qui restent aujourd'hui `acquereurs` et `prospects_vendeurs`.
//
// `workspaceId` n'apparaît volontairement pas ici : l'appartenance est une propriété
// d'infrastructure (ADR-054), pas une donnée métier affichable — même choix que `Bien` et
// `ProfilAcquereur`, qui ne l'exposent pas non plus.
export type Contact = {
  id: string;
  // Seul champ obligatoire : c'est le seul que les deux modèles historiques garantissent (voir le
  // commentaire de `contacts` dans db/schema.ts).
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  creeLe: string;
};
