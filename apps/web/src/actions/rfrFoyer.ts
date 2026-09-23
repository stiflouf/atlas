"use server";

import { redirect } from "next/navigation";
import { obtenirDossierFiscalDefaut } from "@/lib/dossierFiscalRepository";
import { enregistrerRfrFoyer } from "@/lib/rfrFoyerRepository";
import { parseMontantCentimes } from "@/types/remuneration";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { ErreurSaisie, avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

// Parts saisies en usage courant (1,5 part) converties en centièmes exacts (150) par manipulation
// de chaîne, jamais une multiplication flottante — même principe que parseMontantCentimes
// (ADR-021) appliqué au nombre de parts (ADR-023, point 4).
// Même tolérance de saisie que les montants (DEMO_UX_HARDENING_V1) : « 1 5 » collé depuis un
// tableur n'est pas une valeur différente de « 1,5 ». Aucun séparateur de milliers ici — un nombre
// de parts ne dépasse jamais la dizaine.
function parsePartsCentiemes(valeur: FormDataEntryValue | null): number | undefined {
  const brut = String(valeur ?? "").replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d+([.,]\d{1,2})?$/.test(brut)) return undefined;
  const [entier, decimale = ""] = brut.split(/[.,]/);
  const centiemes = Number(entier + decimale.padEnd(2, "0"));
  return Number.isSafeInteger(centiemes) && centiemes > 0 ? centiemes : undefined;
}

// Table entièrement optionnelle (ADR-023, point 3) : cette action n'est jamais appelée
// automatiquement, seulement si le conseiller choisit explicitement de renseigner son RFR pour
// suivre son éligibilité au versement libératoire.
export async function enregistrerRfrFoyerAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const anneeRfr = Number(formData.get("anneeRfr"));
    if (!Number.isInteger(anneeRfr) || anneeRfr < 2000 || anneeRfr > new Date().getFullYear()) {
      throw new ErreurSaisie("Année de RFR invalide.");
    }

    const rfrFoyerCentimes = parseMontantCentimes(String(formData.get("rfrFoyer") ?? ""));
    if (rfrFoyerCentimes === undefined) {
      throw new ErreurSaisie("RFR du foyer invalide — attendu un nombre positif ou nul, par exemple 45 000 ou 45000,50.");
    }

    const nombrePartsCentiemes = parsePartsCentiemes(formData.get("nombreParts"));
    if (nombrePartsCentiemes === undefined) {
      throw new ErreurSaisie("Nombre de parts invalide — attendu un nombre strictement positif, par exemple 1,5.");
    }

    const dossierFiscalId = await obtenirDossierFiscalDefaut();
    await enregistrerRfrFoyer(dossierFiscalId, anneeRfr, rfrFoyerCentimes, nombrePartsCentiemes);

    redirect("/fiscal");
  });
}
