import { ErreurSaisie } from "@/lib/formulaires/etatFormulaire";
import type { IdentiteResponsablePartielle } from "./identiteResponsable";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — frontière du formulaire d'identité du responsable.
//
// Même patron que `contactFormulaire.ts` : un input HTML vide arrive en `""`, les colonnes sont
// nullables, et une chaîne vide doit donc repartir en ABSENCE. Ici l'absence est `null` et non
// `undefined` — les colonnes sont lues et réécrites explicitement, et un champ vidé par
// l'utilisateur doit remettre la colonne à NULL, pas la laisser inchangée.
//
// AUCUN champ n'est obligatoire à l'enregistrement, et c'est délibéré : le propriétaire doit pouvoir
// enregistrer une identité partielle, la compléter plus tard, et voir entre-temps ce qui manque.
// Refuser une saisie partielle le forcerait à tout réunir d'un coup, ou à inventer une valeur pour
// franchir le formulaire. La complétude est une question distincte, portée par
// `identiteResponsablePrete`.
//
// Ce qui est validé, en revanche, c'est la FORME de ce qui est fourni : un SIREN qui n'en est pas
// un, un code pays qui n'en est pas un, une adresse d'exercice des droits qui n'est pas une adresse
// — ces valeurs seraient plus nuisibles qu'une absence, parce qu'elles paraissent renseignées.

type ChampsModifiables = Omit<IdentiteResponsablePartielle, "privacyIdentityModifieLe">;

function texteOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : null;
}

// Validation d'email VOLONTAIREMENT minimale : une partie locale, un arobase, un domaine pointé,
// aucun espace. Le dépôt ne normalise ni ne valide aucun email ailleurs
// (`contactFormulaire.ts` : « Aucune normalisation d'email ou de téléphone : elle n'existe nulle
// part ailleurs dans le produit »), mais ces deux adresses-ci ont une fonction particulière — elles
// sont le canal d'exercice des droits publié aux personnes concernées. Une adresse fautive y rend
// ce canal inopérant sans que personne ne s'en aperçoive.
//
// Aucune tentative de valider la norme complète : une expression régulière prétendant couvrir
// RFC 5322 rejetterait des adresses valides, ce qui serait pire.
const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const SIREN_REGEX = /^[0-9]{9}$/;
const CODE_PAYS_REGEX = /^[A-Z]{2}$/;

function emailOuNull(valeur: FormDataEntryValue | null, libelle: string): string | null {
  const email = texteOuNull(valeur);
  if (email === null) return null;
  if (!EMAIL_REGEX.test(email)) throw new ErreurSaisie(`${libelle} n'est pas une adresse email valide.`);
  return email;
}

export function parseIdentiteResponsableFormData(formData: FormData): ChampsModifiables {
  // Espaces et points de séparation tolérés à la saisie (« 123 456 789 ») : la valeur stockée reste
  // les neuf chiffres seuls, ce que le CHECK SQL exige.
  const sirenBrut = texteOuNull(formData.get("controllerSiren"));
  const siren = sirenBrut === null ? null : sirenBrut.replace(/[\s.]/g, "");
  if (siren !== null && !SIREN_REGEX.test(siren)) {
    throw new ErreurSaisie("Le SIREN doit comporter exactement 9 chiffres.");
  }

  // Majuscules imposées plutôt que refusées : « fr » est une saisie juste dans une casse
  // différente, et la corriger vaut mieux que la rejeter.
  const paysBrut = texteOuNull(formData.get("controllerCountryCode"));
  const pays = paysBrut === null ? null : paysBrut.toUpperCase();
  if (pays !== null && !CODE_PAYS_REGEX.test(pays)) {
    throw new ErreurSaisie("Le code pays doit comporter exactement 2 lettres (par exemple FR).");
  }

  return {
    controllerLegalName: texteOuNull(formData.get("controllerLegalName")),
    controllerLegalForm: texteOuNull(formData.get("controllerLegalForm")),
    controllerTradeName: texteOuNull(formData.get("controllerTradeName")),
    controllerAddressLine1: texteOuNull(formData.get("controllerAddressLine1")),
    controllerAddressLine2: texteOuNull(formData.get("controllerAddressLine2")),
    controllerPostalCode: texteOuNull(formData.get("controllerPostalCode")),
    controllerCity: texteOuNull(formData.get("controllerCity")),
    controllerCountryCode: pays,
    controllerSiren: siren,
    privacyRightsEmail: emailOuNull(formData.get("privacyRightsEmail"), "L'adresse d'exercice des droits"),
    dpoName: texteOuNull(formData.get("dpoName")),
    dpoEmail: emailOuNull(formData.get("dpoEmail"), "L'adresse du délégué à la protection des données"),
  };
}
