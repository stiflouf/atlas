// VISIT_SIGNED_FORM_V1 (ADR-063) — un seul template DOMIORA par défaut en V1, mais `version` reste
// un identifiant de configuration, jamais une valeur codée en dur dans un composant : le jour où un
// template par workspace/réseau/pays est nécessaire, seul ce fichier change (§6 du brief).
//
// Texte volontairement MINIMAL et NEUTRE (§7) : une trace interne de visite, jamais une clause
// d'exclusivité, jamais une affirmation de valeur juridique. Configuration produit, pas un avis
// juridique — à faire relire par un juriste avant tout usage réel au-delà de ce lot.
export const VERSION_TEMPLATE_BON_VISITE_V1 = "domiora-v1";

// BON_VISITE_LEGAL_HARDENING_V2 — version COURANTE pour tout nouveau bon. domiora-v1 n'est ni
// supprimé ni migré : les bons déjà créés portent leur texte substitué figé dans leur snapshot, et
// ce fichier reste le seul endroit où une version produit du texte. Un bon domiora-v1 encore en
// brouillon continue de se signer sous les règles domiora-v1 (aucun durcissement rétroactif).
export const VERSION_TEMPLATE_BON_VISITE_V2 = "domiora-v2";

// Titre DESSINÉ par le générateur PDF, déduit de la version snapshotée — jamais une chaîne choisie
// par l'appelant. Le laisser hors du corps du texte évite de l'afficher deux fois (le PDF dessine
// déjà un titre) tout en le gardant déterministe : à partir d'un snapshot, le document est
// reconstructible à l'identique.
const TITRES_DOCUMENT: Record<string, string> = {
  [VERSION_TEMPLATE_BON_VISITE_V1]: "BON DE VISITE",
  [VERSION_TEMPLATE_BON_VISITE_V2]: "BON DE VISITE – ATTESTATION DE VISITE",
};

export function titreDocumentBonVisite(versionTemplate: string): string {
  return TITRES_DOCUMENT[versionTemplate] ?? TITRES_DOCUMENT[VERSION_TEMPLATE_BON_VISITE_V1];
}

// Formule de consentement : SOURCE UNIQUE partagée par l'UI de signature, le snapshot figé et le
// PDF (§5 du lot V2). Dupliquer ce littéral dans React puis dans le PDF rendrait indémontrable
// l'égalité « texte présenté = texte accepté = texte imprimé ».
export const TEXTE_CONSENTEMENT_BON_VISITE_V2 =
  "Je reconnais avoir pris connaissance du présent bon de visite, confirme l'exactitude des " +
  "informations relatives à la visite et appose volontairement ma signature.";

// Formule historiquement affichée par le formulaire domiora-v1, conservée telle quelle pour les
// brouillons v1 encore ouverts — jamais reconstruite depuis la formule V2, qui dit autre chose.
export const TEXTE_CONSENTEMENT_BON_VISITE_V1 =
  "Je reconnais avoir pris connaissance du texte ci-dessus et je le signe volontairement.";

export function texteConsentementPourVersion(versionTemplate: string): string {
  return versionTemplate === VERSION_TEMPLATE_BON_VISITE_V2
    ? TEXTE_CONSENTEMENT_BON_VISITE_V2
    : TEXTE_CONSENTEMENT_BON_VISITE_V1;
}

export type ParametresTexteBonVisite = {
  bienReference: string;
  bienTitre: string;
  bienAdresse: string;
  bienVille: string;
  bienCodePostal: string;
  datePrevue: string;
  conseillerNom: string;
};

function formatDateFr(dateCivileISO: string): string {
  return new Date(`${dateCivileISO}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Le texte substitué (jamais seulement la version) est ce qui est figé dans le snapshot du bon
// (§5) — un futur changement de ce template ne modifie jamais un bon déjà créé.
export function construireTexteBonVisite(params: ParametresTexteBonVisite): string {
  return [
    "Bon de visite",
    "",
    `Le bien "${params.bienTitre}" (réf. ${params.bienReference}), situé ${params.bienAdresse}, ` +
      `${params.bienCodePostal} ${params.bienVille}, a été visité le ${formatDateFr(params.datePrevue)} ` +
      `en présence de ${params.conseillerNom}, représentant l'agence.`,
    "",
    "Ce document constitue une trace interne de la visite réalisée avec le concours de l'agence. " +
      "Il ne constitue ni un contrat, ni un avis juridique, et n'emporte aucune obligation d'achat " +
      "ni de vente.",
  ].join("\n");
}

// ───────────────────────────── domiora-v2 ─────────────────────────────

export type ParametresTexteBonVisiteV2 = {
  bienReference: string;
  bienTitre: string;
  bienAdresse: string;
  bienVille: string;
  bienCodePostal: string;
  // `visites.realisee_le` quand la Visite est DÉJÀ réalisée au moment où le bon est préparé (bon
  // établi après le compte rendu), `null` sinon — le cas normal du terrain, où le bon se signe à la
  // fin de la visite, avant tout compte rendu (workflow cible ADR-063).
  //
  // JAMAIS `date_prevue` : une intention de planification ne prouve pas qu'une visite a eu lieu.
  // JAMAIS écrite ni exigée par la signature : la transition `planifiee → realisee` reste la
  // conséquence exclusive de la création d'un compte rendu (ADR-040/063 §43).
  dateRealisationISO: string | null;
  conseillerNom: string;
};

// Affiche la date CIVILE de réalisation dans le fuseau du conseiller — un instant UTC rendu brut
// ("2026-06-01T23:30:00Z") daterait la visite de la veille ou du lendemain selon le lecteur.
function formatDateRealisation(dateRealisationISO: string): string {
  return new Date(dateRealisationISO).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

// V2 (BON_VISITE_LEGAL_HARDENING_V2) — corrige trois faiblesses de domiora-v1, sans ajouter aucune
// donnée que DOMIORA ne possède pas (ni agence, ni mandat, ni carte professionnelle) :
//   - plus aucune date de visite AFFIRMÉE qui ne soit pas prouvée en base : soit la date de
//     réalisation enregistrée, soit aucune date — jamais la date prévue ;
//   - « représentant l'agence » disparaît : aucune entité agence n'est structurée dans DOMIORA, donc
//     rien ne permettrait de le démontrer (voir ADVISER_IDENTITY_MODEL_V1, non implémenté) ;
//   - « trace interne » et « avis juridique » disparaissent : un document signé par un tiers et
//     remis à lui n'est pas une note interne, et le bon n'a pas à se qualifier lui-même.
// Ce qu'il continue de NE PAS faire : aucune clause de commission ou de pénalité, aucune obligation
// de traiter exclusivement par le conseiller, et aucune affirmation sur le niveau réglementaire de
// la signature (garde structurelle : bonVisite.structurel.test.ts).
//
// DEUX FORMULATIONS, choisies UNE SEULE FOIS à la préparation du bon et jamais recalculées
// ensuite — c'est ce qui garantit, par construction, que le texte lu par la personne qui signe est
// exactement celui que le snapshot signé et le PDF contiennent (aucune reprojection, aucune date
// qui apparaîtrait entre la lecture et le clic) :
//   - Visite déjà réalisée : la date enregistrée est citée.
//   - Visite pas encore réalisée (cas normal du terrain) : AUCUNE date de visite n'est affirmée.
//     Le constat est porté par la signature elle-même, dont la date et l'heure serveur sont
//     imprimées au bas du PDF (pdfBonVisite.ts) et conservées en base (`signatures_bon_visite`).
//     Le bon désigne alors la visite par le bien et par sa propre référence, jamais par une date
//     que DOMIORA ne peut pas prouver.
export function construireTexteBonVisiteV2(params: ParametresTexteBonVisiteV2): string {
  const designation =
    `Le bien « ${params.bienTitre} » (réf. ${params.bienReference}), situé ${params.bienAdresse}, ` +
    `${params.bienCodePostal} ${params.bienVille}, `;
  const premierParagraphe = params.dateRealisationISO
    ? `${designation}a été visité le ${formatDateRealisation(params.dateRealisationISO)} ` +
      `avec le concours de ${params.conseillerNom}.`
    : `${designation}a été visité avec le concours de ${params.conseillerNom}.`;

  return [
    premierParagraphe,
    "",
    "Le présent document a pour objet de constater la réalisation de cette visite et l'intervention " +
      "du professionnel dans la présentation du bien. Il est daté par l'horodatage de signature " +
      "figurant au bas du document.",
    "",
    "Il ne vaut ni mandat, ni offre ou promesse d'achat, ni engagement d'acquérir ou de vendre. " +
      "Il ne crée, par lui-même, aucune obligation de rémunération à la charge du visiteur.",
  ].join("\n");
}
