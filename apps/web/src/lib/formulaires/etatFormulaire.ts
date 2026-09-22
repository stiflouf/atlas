// FORM_FEEDBACK_V1 — contrat COMMUN et LÉGER entre une Server Action de formulaire et son composant
// (`useActionState`). Trois pièces, rien d'autre : un état, une erreur de SAISIE, un helper.
//
// `ErreurSaisie` appartient à la couche formulaire/action UNIQUEMENT : elle signale une erreur
// utilisateur ATTENDUE (champ manquant, format, montant, entité archivée…) qui doit revenir dans le
// formulaire comme message local, jamais déclencher error.tsx. Les repositories ne la connaissent
// pas : ils gardent leurs résultats typés et leurs exceptions ; l'action TRADUIT.
//
// `avecFeedbackFormulaire` est FAIL-CLOSED : il ne capture QUE `ErreurSaisie`. Tout le reste —
// `redirect()` de Next (NEXT_REDIRECT), garde de session, workspace, DB, stockage, invariant
// impossible, bug — est relancé tel quel et reste porté par error.tsx / les gardes existantes.
// Une erreur inattendue ne devient jamais « { statut: "erreur" } ».

export type EtatFormulaire = { statut: "idle" } | { statut: "erreur"; message: string };

export const ETAT_FORMULAIRE_INITIAL: EtatFormulaire = { statut: "idle" };

export class ErreurSaisie extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurSaisie";
  }
}

export async function avecFeedbackFormulaire(traitement: () => Promise<void | never>): Promise<EtatFormulaire> {
  try {
    await traitement();
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { statut: "erreur", message: erreur.message };
    throw erreur;
  }
  return ETAT_FORMULAIRE_INITIAL;
}
