"use server";

import { redirect } from "next/navigation";
import { obtenirDossierFiscalDefaut } from "@/lib/dossierFiscalRepository";
import { enregistrerRfrFoyer } from "@/lib/rfrFoyerRepository";
import { parseMontantCentimes } from "@/types/remuneration";

// Parts saisies en usage courant (1,5 part) converties en centièmes exacts (150) par manipulation
// de chaîne, jamais une multiplication flottante — même principe que parseMontantCentimes
// (ADR-021) appliqué au nombre de parts (ADR-023, point 4).
function parsePartsCentiemes(valeur: FormDataEntryValue | null): number | undefined {
  const brut = String(valeur ?? "").trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(brut)) return undefined;
  const [entier, decimale = ""] = brut.split(/[.,]/);
  const centiemes = Number(entier + decimale.padEnd(2, "0"));
  return Number.isSafeInteger(centiemes) && centiemes > 0 ? centiemes : undefined;
}

// Table entièrement optionnelle (ADR-023, point 3) : cette action n'est jamais appelée
// automatiquement, seulement si le conseiller choisit explicitement de renseigner son RFR pour
// suivre son éligibilité au versement libératoire.
export async function enregistrerRfrFoyerAction(formData: FormData): Promise<void> {
  const anneeRfr = Number(formData.get("anneeRfr"));
  if (!Number.isInteger(anneeRfr) || anneeRfr < 2000 || anneeRfr > new Date().getFullYear()) {
    throw new Error("Année de RFR invalide.");
  }

  const rfrFoyerCentimes = parseMontantCentimes(String(formData.get("rfrFoyer") ?? "").trim());
  if (rfrFoyerCentimes === undefined) {
    throw new Error("RFR du foyer invalide — doit être un nombre positif ou nul.");
  }

  const nombrePartsCentiemes = parsePartsCentiemes(formData.get("nombreParts"));
  if (nombrePartsCentiemes === undefined) {
    throw new Error("Nombre de parts invalide — doit être un nombre strictement positif.");
  }

  const dossierFiscalId = await obtenirDossierFiscalDefaut();
  await enregistrerRfrFoyer(dossierFiscalId, anneeRfr, rfrFoyerCentimes, nombrePartsCentiemes);

  redirect("/fiscal");
}
