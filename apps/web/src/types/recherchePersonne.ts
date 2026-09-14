import type { ResultatRechercheContact } from "./rechercheContact";

// ADR-058 décision 5 — la recherche de personnes rend des résultats de DEUX natures, et le type les
// rend impossibles à confondre : un Contact canonique, ou un dossier historique que personne n'a
// encore rattaché. Une union discriminée, jamais un objet à champs optionnels où `contactId`
// pourrait un jour recevoir l'id d'un dossier.
//
// Un résultat legacy n'est PAS un Contact virtuel : il n'a pas de `contactId`, pas de rôles dérivés,
// pas de résumé de projets. Il porte l'identité telle que le dossier la stocke, et l'id du dossier —
// ce qu'il faut pour l'ouvrir et, si un humain le décide, le rattacher (ADR-055 §H).

export type ResultatContactCanonique = { type: "contact" } & ResultatRechercheContact;

type IdentiteLegacy = {
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
};

export type ResultatLegacyAcquereur = { type: "legacy_acquereur"; acquereurId: string } & IdentiteLegacy;

export type ResultatLegacyVendeur = { type: "legacy_vendeur"; prospectVendeurId: string } & IdentiteLegacy;

export type ResultatRecherchePersonne = ResultatContactCanonique | ResultatLegacyAcquereur | ResultatLegacyVendeur;

export type PageRecherchePersonne = {
  items: ResultatRecherchePersonne[];
  hasMore: boolean;
};
