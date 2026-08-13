import { produireAlertesDonnees } from "@/lib/alertes/reglesDonnees";
import { produireAlertesCommercial } from "@/lib/alertes/reglesCommercial";
import { produireAlertesFiscal } from "@/lib/alertes/reglesFiscal";
import { produireAlertesProjection } from "@/lib/alertes/reglesProjection";
import { dedupliquerAlertes } from "@/lib/alertes/deduplication";
import { trierParPriorite } from "@/lib/alertes/priorite";
import type { ContexteAlertes } from "@/lib/alertes/contexte";
import type { AlerteCopilote } from "@/types/alerte";

// Point d'entrée du moteur d'alertes (ADR-026) : contexte déjà chargé (chargerContexteAlertes,
// aucune requête Drizzle ici) -> règles pures -> alertes brutes -> déduplication causale -> priorité
// déterministe -> résultat. Aucune alerte n'est jamais persistée, aucune n'est produite par un LLM.
export function produireAlertes(contexte: ContexteAlertes): AlerteCopilote[] {
  const alertesBrutes: AlerteCopilote[] = [
    ...produireAlertesDonnees(contexte),
    ...produireAlertesCommercial(contexte),
    ...produireAlertesFiscal(contexte),
    ...produireAlertesProjection(contexte),
  ];
  return trierParPriorite(dedupliquerAlertes(alertesBrutes));
}
