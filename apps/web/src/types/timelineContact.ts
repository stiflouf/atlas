import type { NatureMetierInteraction, SensInteraction, TypeInteraction } from "@/types/interaction";

// CRM_TIMELINE_V1 — l'HISTORIQUE d'un Contact est un READ MODEL, jamais une table : il fusionne à
// la lecture les `interactions` canoniques (source de vérité des échanges) et les notes legacy du
// journal prospect vendeur (`notes_prospect_vendeur`, qui reste écrite par ses flux historiques —
// ADR-055 §G, stratégie B). Rien n'est persisté, rien n'est migré.
export type SourceTimelineContact = "interaction" | "note_legacy";

export type ContexteTimelineContact = { libelle: string; href: string };

export type ItemTimelineContact = {
  id: string;
  source: SourceTimelineContact;
  type: TypeInteraction;
  sens?: SensInteraction;
  // Date MÉTIER : `interactions.survenu_le` ; pour une note legacy, `cree_le` est la seule date
  // disponible (jamais mélangée avec `cree_le` côté interaction).
  survenuLe: string;
  contenu?: string;
  natureMetier?: NatureMetierInteraction;
  // Objet d'un email Gmail réellement envoyé, lu depuis `envois_email` via `references_externes` —
  // jamais un appel Gmail au rendu, jamais une colonne ajoutée à `interactions`.
  sujet?: string;
  contexte?: ContexteTimelineContact;
};

export const LIMITE_TIMELINE_PAR_DEFAUT = 20;
export const LIMITE_TIMELINE_MAX = 200;
export const PAS_TIMELINE = 20;

// `?timeline=40` : validé serveur — multiples de 20 entre 20 et 200, tout le reste retombe sur 20.
export function limiteTimelineValide(valeur: string | undefined): number {
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < LIMITE_TIMELINE_PAR_DEFAUT || n > LIMITE_TIMELINE_MAX || n % PAS_TIMELINE !== 0) {
    return LIMITE_TIMELINE_PAR_DEFAUT;
  }
  return n;
}

// Les échanges saisissables à la main depuis la fiche Contact : un choix UI combiné (type + sens)
// sur le vocabulaire EXISTANT de `interactions` — aucun nouvel enum. « Rendez-vous » sans sens (ni
// reçu ni émis, convention du schéma) ; « Note interne » = type `note`, sens `interne`.
export type CodeEchangeManuel =
  | "appel_entrant"
  | "appel_sortant"
  | "sms_recu"
  | "sms_envoye"
  | "email_recu"
  | "email_envoye"
  | "rendez_vous"
  | "note_interne";

export type EchangeManuel = { code: CodeEchangeManuel; libelle: string; type: TypeInteraction; sens?: SensInteraction };

export const ECHANGES_MANUELS: readonly EchangeManuel[] = [
  { code: "appel_entrant", libelle: "Appel entrant", type: "appel", sens: "entrant" },
  { code: "appel_sortant", libelle: "Appel sortant", type: "appel", sens: "sortant" },
  { code: "sms_recu", libelle: "SMS reçu", type: "sms", sens: "entrant" },
  { code: "sms_envoye", libelle: "SMS envoyé", type: "sms", sens: "sortant" },
  { code: "email_recu", libelle: "Email reçu", type: "email", sens: "entrant" },
  { code: "email_envoye", libelle: "Email envoyé", type: "email", sens: "sortant" },
  { code: "rendez_vous", libelle: "Rendez-vous", type: "rendez_vous" },
  { code: "note_interne", libelle: "Note interne", type: "note", sens: "interne" },
];

export function echangeManuelParCode(code: string): EchangeManuel | undefined {
  return ECHANGES_MANUELS.find((e) => e.code === code);
}

// Libellé humain d'un item de timeline (type + sens), partagé par la timeline et le formulaire.
export function libelleEchange(type: TypeInteraction, sens?: SensInteraction): string {
  const connu = ECHANGES_MANUELS.find((e) => e.type === type && (e.sens ?? undefined) === (sens ?? undefined));
  if (connu) return connu.libelle;
  const base: Record<TypeInteraction, string> = { appel: "Appel", email: "Email", sms: "SMS", rendez_vous: "Rendez-vous", message: "Message", note: "Note" };
  const suffixe = sens === "entrant" ? " entrant" : sens === "sortant" ? " sortant" : sens === "interne" ? " interne" : "";
  return `${base[type]}${suffixe}`;
}
