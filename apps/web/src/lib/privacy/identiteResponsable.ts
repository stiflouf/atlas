// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — identité du responsable du traitement, et la
// distinction entre ce que la base contient et ce qui suffit pour informer une personne.
//
// DEUX ÉTATS, et ils ne se confondent jamais :
//
//   IdentiteResponsablePartielle — ce que la base porte. Tous les champs peuvent être absents, et
//     c'est l'état normal d'un workspace à la sortie de la migration 0059.
//   IdentiteResponsableComplete — une identité dont le minimum requis est réuni, obtenue
//     uniquement en franchissant `identiteResponsablePrete`. Le type porte la garantie, de sorte
//     qu'un appelant ne peut pas afficher une identité incomplète en croyant l'avoir vérifiée.
//
// AUCUN REPLI, JAMAIS. Ni `workspaces.nom`, ni `ATLAS_ADVISOR_DISPLAY_NAME`, ni « DOMIORA », ni
// « Conseiller DOMIORA » ne peuvent tenir lieu de responsable du traitement. Afficher un nom par
// défaut désignerait comme responsable quelqu'un qui ne l'est pas — l'erreur exacte que le modèle
// WORKSPACE_LEGAL_CONTROLLER existe pour éviter. Une identité incomplète n'est pas affichée.

export interface IdentiteResponsablePartielle {
  readonly controllerLegalName: string | null;
  readonly controllerLegalForm: string | null;
  readonly controllerTradeName: string | null;
  readonly controllerAddressLine1: string | null;
  readonly controllerAddressLine2: string | null;
  readonly controllerPostalCode: string | null;
  readonly controllerCity: string | null;
  readonly controllerCountryCode: string | null;
  readonly controllerSiren: string | null;
  readonly privacyRightsEmail: string | null;
  readonly dpoName: string | null;
  readonly dpoEmail: string | null;
  readonly privacyIdentityModifieLe: Date | null;
}

// Le MINIMUM pour qu'une personne concernée sache qui traite ses données et comment exercer ses
// droits : qui (nom légal), où (adresse exploitable), et par quel canal s'adresser (email droits).
//
// Ce qui n'en fait PAS partie, et pourquoi :
//   - SIREN : utile à l'identification d'une entreprise, mais une personne physique en EI peut
//     légitimement n'en pas avoir à déclarer ici, et son absence n'empêche pas d'identifier le
//     responsable ni de le joindre ;
//   - forme juridique et nom commercial : précisions, pas identifiants ;
//   - DPO : il n'est pas toujours requis d'en désigner un, et exiger ce champ rendrait une notice
//     impossible pour un responsable qui n'y est pas tenu.
export type IdentiteResponsableComplete = IdentiteResponsablePartielle & {
  readonly controllerLegalName: string;
  readonly controllerAddressLine1: string;
  readonly controllerPostalCode: string;
  readonly controllerCity: string;
  readonly controllerCountryCode: string;
  readonly privacyRightsEmail: string;
};

// « Adresse exploitable » = de quoi écrire au responsable : une voie, un code postal, une ville, un
// pays. La seconde ligne reste optionnelle (complément, bâtiment) et son absence n'empêche rien.
function renseigne(valeur: string | null): valeur is string {
  return valeur !== null && valeur.trim() !== "";
}

export const CHAMPS_REQUIS_POUR_NOTICE = [
  "controllerLegalName",
  "controllerAddressLine1",
  "controllerPostalCode",
  "controllerCity",
  "controllerCountryCode",
  "privacyRightsEmail",
] as const satisfies readonly (keyof IdentiteResponsablePartielle)[];

export type ChampRequisPourNotice = (typeof CHAMPS_REQUIS_POUR_NOTICE)[number];

// Les champs qui manquent, et non un simple booléen : l'écran de configuration doit pouvoir dire
// lesquels, et un message « identité incomplète » sans liste serait inutilisable.
export function champsManquantsPourNotice(
  identite: IdentiteResponsablePartielle
): readonly ChampRequisPourNotice[] {
  return CHAMPS_REQUIS_POUR_NOTICE.filter((champ) => !renseigne(identite[champ]));
}

// Prédicat de type : après lui, le minimum est garanti par le compilateur autant que par
// l'exécution.
export function identiteResponsablePrete(
  identite: IdentiteResponsablePartielle
): identite is IdentiteResponsableComplete {
  return champsManquantsPourNotice(identite).length === 0;
}

export type EtatIdentiteResponsable = "INCOMPLETE" | "PRETE_POUR_LA_NOTICE";

export function etatIdentiteResponsable(identite: IdentiteResponsablePartielle): EtatIdentiteResponsable {
  return identiteResponsablePrete(identite) ? "PRETE_POUR_LA_NOTICE" : "INCOMPLETE";
}

export const LIBELLES_CHAMPS_REQUIS: Readonly<Record<ChampRequisPourNotice, string>> = Object.freeze({
  controllerLegalName: "Nom légal du responsable du traitement",
  controllerAddressLine1: "Adresse",
  controllerPostalCode: "Code postal",
  controllerCity: "Ville",
  controllerCountryCode: "Pays",
  privacyRightsEmail: "Adresse d'exercice des droits",
});
