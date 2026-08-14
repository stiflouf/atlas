// Secteur de recherche géographique d'un acquéreur (ADR-035) — une commune/arrondissement
// explicitement sélectionné par le conseiller. `codeInsee` est l'identifiant canonique (citycode
// IGN, chaîne — jamais un entier, la Corse porte des codes non numériques "2A"/"2B") ; seul ce
// champ participe à la décision de compatibilité. `nomCommune`/`codePostal` ne servent qu'à
// l'affichage, jamais comparés — pour corriger un secteur, le conseiller le supprime et en
// sélectionne un nouveau (jamais d'édition libre de nomCommune/codePostal, voir ADR-035).
export type SecteurRecherche = {
  id: string;
  acquereurId: string;
  codeInsee: string;
  nomCommune: string;
  codePostal: string;
  creeLe: string;
};
