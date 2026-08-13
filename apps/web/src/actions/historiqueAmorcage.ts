"use server";

import { redirect } from "next/navigation";
import { obtenirDossierFiscalDefaut } from "@/lib/dossierFiscalRepository";
import { enregistrerHistoriqueAmorcage } from "@/lib/historiqueAmorcageRepository";
import { parseMontantCentimes } from "@/types/remuneration";

// Refuse explicitement une année hors bornes, un montant invalide, ou une date de fin de
// couverture absente/hors de l'année pour l'année en cours. Pour une année révolue, la couverture
// est nécessairement totale : date_fin_couverture posée automatiquement au 31 décembre, jamais
// demandée (voir schema.ts, historique_amorcage) — seul le formulaire de l'année en cours expose
// réellement le champ.
export async function enregistrerHistoriqueAmorcageAction(formData: FormData): Promise<void> {
  const anneeEnCours = new Date().getFullYear();
  const annee = Number(formData.get("annee"));
  if (!Number.isInteger(annee) || annee < 2000 || annee > anneeEnCours) {
    throw new Error("Année invalide.");
  }

  const montantEncaisseCentimes = parseMontantCentimes(String(formData.get("montantEncaisse") ?? "").trim());
  if (montantEncaisseCentimes === undefined) {
    throw new Error("Montant encaissé invalide — doit être un nombre positif ou nul.");
  }

  const dateFinCouverture =
    annee < anneeEnCours ? `${annee}-12-31` : String(formData.get("dateFinCouverture") ?? "").trim();
  if (!dateFinCouverture) {
    throw new Error("La date de fin de couverture est obligatoire pour l'année en cours.");
  }
  if (Number(dateFinCouverture.slice(0, 4)) !== annee) {
    throw new Error("La date de fin de couverture doit tomber dans l'année déclarée.");
  }

  const dossierFiscalId = await obtenirDossierFiscalDefaut();
  await enregistrerHistoriqueAmorcage(dossierFiscalId, annee, montantEncaisseCentimes, dateFinCouverture);

  redirect("/fiscal");
}
