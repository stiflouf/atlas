import type { FaitsMandat } from "@/lib/mandatRepository";
import { estTypeMandat } from "@/types/mandat";
import { ErreurSaisie } from "@/lib/formulaires/etatFormulaire";

// ADR-060 §16 — les FAITS contractuels qu'un formulaire humain saisit pour un mandat canonique :
// type (obligatoire, vocabulaire fermé), numéro, terme et borne d'exclusivité (facultatifs).
// Validation serveur stricte : une valeur hors vocabulaire est un refus, jamais un repli sur
// `simple`. Aucune durée n'est persistée : un formulaire qui saisirait une durée la convertirait en
// terme ICI, avant le repository (§6) — aucun formulaire ne le fait aujourd'hui.
function parseDateOptionnelle(valeur: FormDataEntryValue | null): string | undefined {
  const brut = String(valeur ?? "").trim();
  if (brut === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(brut)) throw new ErreurSaisie(`Date de mandat invalide : ${brut}`);
  return brut;
}

// Une date exigée par un geste humain (prise d'effet à l'enregistrement, date de résiliation) :
// absente ou mal formée, c'est un refus nommé — jamais la date du jour posée d'autorité.
export function parseDateObligatoire(valeur: FormDataEntryValue | null, libelle: string): string {
  const date = parseDateOptionnelle(valeur);
  if (date === undefined) throw new ErreurSaisie(`${libelle} : la date est obligatoire (AAAA-MM-JJ).`);
  return date;
}

// ADR-060 §8 — motif facultatif : vide = absent, jamais "".
export function parseMotifResiliation(valeur: FormDataEntryValue | null): string | undefined {
  const motif = String(valeur ?? "").trim();
  return motif === "" ? undefined : motif;
}

export function parseFaitsMandatFormData(formData: FormData): FaitsMandat {
  const type = String(formData.get("typeMandat") ?? "").trim();
  if (!estTypeMandat(type)) {
    throw new ErreurSaisie("Le type de mandat est obligatoire : simple, exclusif ou semi-exclusif.");
  }
  const numero = String(formData.get("numeroMandat") ?? "").trim();
  const dateFin = parseDateOptionnelle(formData.get("dateFinMandat"));
  const exclusiviteJusquAu = parseDateOptionnelle(formData.get("exclusiviteJusquAu"));
  return {
    type,
    numero: numero === "" ? undefined : numero,
    dateFin,
    exclusiviteJusquAu,
  };
}
