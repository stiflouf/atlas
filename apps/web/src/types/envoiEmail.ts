import type { IntentionCommunication } from "@/lib/communications/contexteCommunication";

// Audit TECHNIQUE d'une tentative d'envoi Gmail (ADR-031-bis) — jamais un fait CRM (voir
// notes_prospect_vendeur, ADR-027, pour le fait CRM correspondant). Le corps complet du message
// n'est jamais persisté ici.
export type EnvoiEmail = {
  id: string;
  destinataireEmail: string;
  objet: string;
  contenuHash: string;
  fournisseur: string;
  bienId?: string;
  tacheId?: string;
  origineIntention?: IntentionCommunication;
  gmailMessageId?: string;
  demarreLe: string;
  reussiLe?: string;
  echoueLe?: string;
  incertainLe?: string;
  erreurTechnique?: string;
};

// `incertain` distinct d'`echec` (ADR-031-bis) : une rupture réseau/timeout survenue APRÈS le
// déclenchement de l'appel Gmail ne permet jamais de conclure — jamais assimilé à un échec net.
export type EtatEnvoiEmail = "envoye" | "echec" | "incertain" | "en_cours";

// Dérivé des trois timestamps terminaux, jamais stocké séparément — même principe que
// deriverStatutTache (ADR-028). Les trois timestamps sont mutuellement exclusifs par construction
// applicative (gel concurrent, envoiEmailRepository.ts), jamais une contrainte SQL.
export function deriverEtatEnvoiEmail(envoi: EnvoiEmail): EtatEnvoiEmail {
  if (envoi.reussiLe) return "envoye";
  if (envoi.echoueLe) return "echec";
  if (envoi.incertainLe) return "incertain";
  return "en_cours";
}
