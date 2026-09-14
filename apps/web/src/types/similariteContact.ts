import type { RoleContact } from "./rechercheContact";

// ADR-055 §H — le contrat de SORTIE de la détection de Contacts potentiellement similaires.
//
// Un SIGNAL est un fait vérifiable (« même email »), jamais une conclusion (« doublon »). Deux
// personnes partagent légitimement une adresse ou un numéro ; ce type ne porte donc ni score, ni
// pourcentage, ni verdict — seulement les faits qui ont fait remonter le candidat, pour qu'un
// humain décide.
//
// `nom_prenom` est une CORROBORATION : il ne fait jamais remonter un candidat seul (deux homonymes
// ne sont pas une personne), il s'ajoute à un signal fort déjà présent.
export type SignalSimilariteContact = "email" | "telephone" | "nom_prenom";

export type ContactSimilaire = {
  contactId: string;
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  // Jamais vide, et contient toujours `email` ou `telephone`.
  signaux: SignalSimilariteContact[];
  // Dérivés de `parties_projet`, même sémantique que la recherche : projets non archivés.
  roles: RoleContact[];
  nbProjets: number;
};
