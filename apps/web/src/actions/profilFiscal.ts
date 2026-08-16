"use server";

import { redirect } from "next/navigation";
import { obtenirDossierFiscalDefaut } from "@/lib/dossierFiscalRepository";
import { enregistrerProfilFiscal } from "@/lib/profilFiscalRepository";
import { parseProfilFiscalFormData } from "@/lib/profilFiscalFormulaire";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

// Toujours une insertion (nouvel instantané), jamais une édition — y compris pour une correction
// rétroactive (ADR-023, point 2) : la Server Action ne compare jamais dateDebutValidite à
// l'existant, elle laisse la résolution par date départager (voir profilFiscalRepository).
export async function enregistrerProfilFiscalAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const dossierFiscalId = await obtenirDossierFiscalDefaut();
  const input = parseProfilFiscalFormData(dossierFiscalId, formData);
  await enregistrerProfilFiscal(input);
  redirect("/fiscal");
}
