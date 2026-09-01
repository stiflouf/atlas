// Durée réglementaire du DPE — code de la construction et de l'habitation, art. D126-19 : 10 ans
// pour un DPE établi depuis le 1er juillet 2021. Les régimes transitoires antérieurs sont expirés
// depuis 2024 et ne sont volontairement pas modélisés.
//
// Ce module ne connaît QUE le DPE. Les autres diagnostics (amiante, plomb, gaz, électricité, ERP,
// termites, Carrez, assainissement) ont chacun leur propre régime de validité, parfois conditionné
// au résultat du diagnostic lui-même : leur appliquer 10 ans par généralisation produirait une
// affirmation fausse. Ils resteront saisis à la main tant qu'aucune règle dédiée n'existe.
export const DUREE_VALIDITE_DPE_ANNEES = 10;

// « Valable jusqu'au » est une borne calendaire INCLUSIVE (même convention que calculerEtatExigence
// dans checklistDossier.ts) : un DPE établi le 01/09/2026 couvre jusqu'au 31/08/2036 inclus, soit
// 10 ans moins 1 jour.
//
// Le résultat n'est qu'une SUGGESTION destinée à préremplir un champ libre : le DPE officiel porte
// lui-même une mention « Valable jusqu'au », qui fait foi et que le conseiller doit pouvoir
// recopier telle quelle. Aucun appelant ne doit traiter cette valeur comme une vérité
// réglementaire, ni l'imposer à la place d'une date saisie.
export function dateFinValiditeTheoriqueDpe(dateEtablissementISO: string): string | null {
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateEtablissementISO);
  if (!correspondance) return null;

  const [, annee, mois, jour] = correspondance;
  // Arithmétique en UTC uniquement (jamais l'heure locale de la machine) : la veille du même
  // quantième 10 ans plus tard, y compris quand ce quantième n'existe pas dans l'année d'arrivée
  // (29 février → l'échéance retombe sur le 28 février suivant).
  const echeance = new Date(Date.UTC(Number(annee) + DUREE_VALIDITE_DPE_ANNEES, Number(mois) - 1, Number(jour)));
  if (Number.isNaN(echeance.getTime())) return null;
  echeance.setUTCDate(echeance.getUTCDate() - 1);
  return echeance.toISOString().slice(0, 10);
}
