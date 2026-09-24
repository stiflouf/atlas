import { getCompromisById } from "@/lib/compromisRepository";
import { getProspectVendeurDuWorkspace } from "@/lib/prospectVendeurRepository";

export type CandidatRattachementsDocument = {
  bienId: string;
  compromisId?: string | null;
  acquereurId?: string | null;
  prospectVendeurId?: string | null;
};

// Refus explicite (throw), ADR-029 : des FK valides séparément ne suffisent pas — un compromis,
// un acquéreur ou un prospect vendeur bien réels mais rattachés au mauvais bien seraient acceptés
// par les seules FK. Appelée par ajouterDocumentBienAction et corrigerClassementDocumentBienAction
// (jamais par le repository, qui reste une insertion/mise à jour pure, même séparation que
// ajouterCompromisAction/offreId, ADR-016) — ces comparaisons croisées ne sont pas exprimables en
// CHECK SQL (inter-tables).
export async function validerCoherenceRattachementsDocument(
  candidat: CandidatRattachementsDocument,
  workspaceId: string
): Promise<void> {
  const { bienId, compromisId, acquereurId, prospectVendeurId } = candidat;

  if (compromisId) {
    const compromis = await getCompromisById(compromisId, workspaceId);
    if (!compromis) throw new Error("Compromis introuvable pour ce rattachement.");
    if (compromis.bienId !== bienId) {
      throw new Error("Ce compromis n'appartient pas au bien de ce document.");
    }
    if (acquereurId && compromis.acquereurId !== acquereurId) {
      throw new Error("L'acquéreur rattaché ne correspond pas à l'acquéreur de ce compromis.");
    }
  }

  if (prospectVendeurId) {
    // WORKSPACE_SCOPING_V1 — le prospect vendeur est une racine : il est résolu dans le périmètre,
    // comme le compromis juste au-dessus.
    const prospectVendeur = await getProspectVendeurDuWorkspace(prospectVendeurId, workspaceId);
    if (!prospectVendeur) throw new Error("Prospect vendeur introuvable pour ce rattachement.");
    if (prospectVendeur.bienId !== bienId) {
      throw new Error("Ce prospect vendeur n'est pas le vendeur ayant converti ce bien.");
    }
  }
}
