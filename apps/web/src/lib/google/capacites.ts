import { lireConnexionGoogle } from "./connexion";
import { SCOPE_CALENDAR_READONLY, SCOPE_GMAIL_SEND } from "./oauth";

export type CapacitesGoogle = { calendarAutorise: boolean; gmailAutorise: boolean };

// Dérivé UNIQUEMENT du `scope` réellement stocké (retourné par Google au dernier consentement) —
// jamais déduit du fait qu'une route d'autorisation a été appelée (ADR-031-bis, correction
// explicite). Découpage en Set plutôt qu'un `.includes()` sur la chaîne brute : une comparaison de
// sous-chaîne risquerait un faux positif entre deux scopes dont l'un serait un préfixe de l'autre.
//
// Statut OPTIMISTE, pas une vérification live : reflète ce qui a été accordé lors du dernier
// consentement, pas un appel de contrôle à Google. Si l'accès a été révoqué directement depuis le
// compte Google du conseiller entre-temps, ce statut reste "autorisé" jusqu'au prochain échec réel
// (voir gmailClient.ts) — ne jamais le présenter comme une garantie de fonctionnement immédiat.
export async function chargerCapacitesGoogle(): Promise<CapacitesGoogle> {
  const connexion = await lireConnexionGoogle();
  if (!connexion) return { calendarAutorise: false, gmailAutorise: false };

  const scopes = new Set(connexion.scope.split(" ").filter(Boolean));
  return {
    calendarAutorise: scopes.has(SCOPE_CALENDAR_READONLY),
    gmailAutorise: scopes.has(SCOPE_GMAIL_SEND),
  };
}
