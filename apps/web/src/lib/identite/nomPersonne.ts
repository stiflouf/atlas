// ADR-055 §A + ADR-057 — AFFICHER une personne dont le prénom peut légitimement être inconnu.
//
// `nom` est le seul champ que les deux modèles historiques garantissent, et `contacts.prenom` est
// nullable : « Dupont » sans prénom est un état normal, pas une saisie incomplète. Interpoler
// directement `${personne.prenom} ${personne.nom}` ne produit AUCUNE erreur de typage et affiche
// « undefined Dupont » — c'est précisément le genre de défaut que le compilateur ne rattrape pas.
//
// Le dépôt portait déjà trois fois la même logique (moteur d'opportunités, catalogue de règles,
// hero prospect vendeur). Celle-ci est la version partagée ; les deux autres restent en place tant
// qu'aucun lot ne les traverse — les déplacer sans raison ferait grossir un diff d'identité d'un
// remaniement d'affichage.

export type PersonneAffichable = { prenom?: string; nom: string };

export function nomComplet(personne: PersonneAffichable): string {
  return personne.prenom ? `${personne.prenom} ${personne.nom}` : personne.nom;
}

// Deux initiales quand le prénom est connu, une seule sinon — jamais un espace ni un « ? » à la
// place de l'initiale manquante, qui laisserait croire à une donnée corrompue.
export function initialesPersonne(personne: PersonneAffichable): string {
  const initiales = personne.prenom
    ? `${personne.prenom.charAt(0)}${personne.nom.charAt(0)}`
    : personne.nom.charAt(0);
  return initiales.toUpperCase();
}
