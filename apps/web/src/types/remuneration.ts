import type { StatutCompromis } from "@/types/compromis";

// Montants en centimes entiers (jamais un flottant) — voir ADR-021 : première donnée financière
// précise d'Atlas, divergence assumée avec compromis.prixConvenu/offres.montant (euros entiers).
export type Remuneration = {
  id: string;
  compromisId: string;
  montantHonorairesTotalCentimes?: number;
  montantRemunerationConseillerCentimes: number;
  dateEncaissementPrevue?: string;
  dateEncaissementReelle?: string;
  creeLe: string;
  modifieLe?: string;
};

// Création : dateEncaissementReelle volontairement absente de ce type — elle ne peut être posée que
// par marquerRemunerationEncaissee (transition dédiée), jamais fournie à la création.
export type NouvelleRemuneration = Omit<
  Remuneration,
  "id" | "creeLe" | "modifieLe" | "dateEncaissementReelle"
>;

// Correction (avant encaissement) : remplacement complet des trois champs corrigibles, jamais un
// patch partiel — montantHonorairesTotalCentimes/dateEncaissementPrevue en number|null / string|null
// (jamais optionnels) pour qu'une remise à NULL explicite soit distinguable d'un "ne pas toucher" qui
// n'existe pas dans cette API.
export type ChampsCorrectionRemuneration = {
  montantRemunerationConseillerCentimes: number;
  montantHonorairesTotalCentimes: number | null;
  dateEncaissementPrevue: string | null;
};

export type EtatRemuneration = "previsionnelle" | "associee_vente_finalisee" | "encaissee";

export const LABEL_ETAT_REMUNERATION: Record<EtatRemuneration, string> = {
  previsionnelle: "Prévisionnelle",
  associee_vente_finalisee: "Associée à une vente finalisée",
  encaissee: "Encaissée",
};

// Dérivé de compromis.statut + remuneration.dateEncaissementReelle — jamais stocké (ADR-021).
// États mutuellement exclusifs : 'annule' retourne toujours undefined, même si dateEncaissementReelle
// est présente (donnée incohérente en théorie impossible via marquerRemunerationEncaisseeAction, qui
// exige statutCompromis === 'realise' — mais la garde reste explicite ici pour ne jamais afficher
// 'encaissee' sur un compromis annulé par une autre voie que celle prévue). Sinon 'encaissee' dès que
// dateEncaissementReelle est posée sur un compromis realise ; sinon 'associee_vente_finalisee' pour
// un compromis realise non encaissé ; sinon 'previsionnelle' pour un compromis en_cours. La ligne
// sort du prévisionnel actif sur un compromis annulé — l'appelant teste ce cas séparément s'il veut
// afficher "liée à un compromis annulé".
export function deriverEtatRemuneration(
  remuneration: Remuneration,
  statutCompromis: StatutCompromis
): EtatRemuneration | undefined {
  if (statutCompromis === "annule") return undefined;
  if (statutCompromis === "realise" && remuneration.dateEncaissementReelle) return "encaissee";
  if (statutCompromis === "realise") return "associee_vente_finalisee";
  return "previsionnelle"; // en_cours
}

// Parsing texte -> centimes entiers, sans jamais passer par une multiplication flottante
// ("12487.36" * 100 en JS produit 1248735.9999999998). Accepte "." et "," comme séparateur
// décimal. Découpage en partie entière / partie décimale par manipulation de chaîne, complétée à
// 2 décimales, puis Number() sur une chaîne d'entier uniquement. Rejette tout ce qui n'est pas un
// nombre positif à au plus 2 décimales, ou dont le résultat dépasserait Number.MAX_SAFE_INTEGER
// (retourne undefined — l'appelant (action) transforme ça en erreur explicite).
export function parseMontantCentimes(valeur: string): number | undefined {
  const brut = valeur.trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(brut)) return undefined;
  const [entier, decimale = ""] = brut.split(/[.,]/);
  const centimes = Number(entier + decimale.padEnd(2, "0"));
  return Number.isSafeInteger(centimes) ? centimes : undefined;
}

// Affichage uniquement, jamais réutilisé comme valeur intermédiaire ailleurs (pas de round-trip
// centimes -> euros -> centimes) : division entière + modulo, jamais une conversion flottante
// partagée avec la logique métier.
export function formatMontantCentimes(centimes: number): string {
  const euros = Math.floor(centimes / 100);
  const cents = String(centimes % 100).padStart(2, "0");
  return `${euros.toLocaleString("fr-FR")},${cents} €`;
}
