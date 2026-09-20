// VISIT_SIGNED_FORM_V1 (ADR-063) — un seul template DOMIORA par défaut en V1, mais `version` reste
// un identifiant de configuration, jamais une valeur codée en dur dans un composant : le jour où un
// template par workspace/réseau/pays est nécessaire, seul ce fichier change (§6 du brief).
//
// Texte volontairement MINIMAL et NEUTRE (§7) : une trace interne de visite, jamais une clause
// d'exclusivité, jamais une affirmation de valeur juridique. Configuration produit, pas un avis
// juridique — à faire relire par un juriste avant tout usage réel au-delà de ce lot.
export const VERSION_TEMPLATE_BON_VISITE_V1 = "domiora-v1";

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
