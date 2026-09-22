import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import {
  acquereurs as acquereursTable,
  biens as biensTable,
  contacts as contactsTable,
  envoisEmail as envoisEmailTable,
  interactions as interactionsTable,
  mandats as mandatsTable,
  notesProspectVendeur as notesProspectVendeurTable,
  partiesMandat as partiesMandatTable,
  partiesProjet as partiesProjetTable,
  projetsAcquereur as projetsAcquereurTable,
  projetsVendeur as projetsVendeurTable,
  prospectsVendeurs as prospectsVendeursTable,
  referencesExternes as referencesExternesTable,
  visites as visitesTable,
} from "@/db/schema";
import type { NatureMetierInteraction, SensInteraction, TypeInteraction } from "@/types/interaction";
import type { TypeNoteProspectVendeur } from "@/types/noteProspectVendeur";
import { LIMITE_TIMELINE_MAX, LIMITE_TIMELINE_PAR_DEFAUT, type ContexteTimelineContact, type ItemTimelineContact } from "@/types/timelineContact";

// CRM_TIMELINE_V1 — READ MODEL de l'historique d'un Contact. Lecture seule, rien n'est persisté.
//
// Deux sources, une seule liste :
//   1. `interactions` (échanges canoniques : manuels, Gmail, retour vendeur) — feuilles du Contact ;
//   2. `notes_prospect_vendeur` (journal legacy, ADR-027) — lues UNIQUEMENT via les prospects
//      vendeurs qui portent ce Contact dans ce workspace (stratégie B : jamais migrées, jamais
//      dupliquées en écriture ; `ProspectVendeurJournal` continue d'y écrire).
//
// BORNES — chaque source est lue avec `LIMIT limite` (tri par date métier décroissante), puis les
// deux listes sont fusionnées, triées, dédoublonnées et tronquées à `limite`. Aucun item du top-N
// global ne peut manquer : un item qui figure dans les N premiers de l'union figure forcément dans
// les N premiers de sa propre source. Jamais tout l'historique chargé puis tranché en JS.
//
// WORKSPACE — le Contact est d'abord résolu dans le workspace demandé ; hors workspace, la timeline
// est vide (la page, elle, a déjà répondu 404). Les notes legacy passent par des prospects filtrés
// `workspace_id`.
//
// GMAIL — le sujet d'un email envoyé est lu par `interactions` → `references_externes`
// (fournisseur gmail, cible interaction) → `envois_email.gmail_message_id` : jamais un appel Gmail.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOURNISSEUR_GMAIL = "gmail";

// Préfixe EXACT écrit par `envoyerEmailGmailAction` dans le journal prospect (note legacy de type
// `email`) — la seule forme reconnue comme trace legacy d'un envoi Gmail.
const PREFIXE_NOTE_LEGACY_GMAIL = "Email envoyé — Objet : ";
// Garde temporelle SUPPLÉMENTAIRE du rapprochement (jamais sa clé) : la note et l'interaction sont
// écrites par la même Server Action, à quelques secondes d'intervalle.
const FENETRE_RAPPROCHEMENT_GMAIL_MS = 10 * 60 * 1000;

const TYPE_LEGACY_VERS_INTERACTION: Record<TypeNoteProspectVendeur, TypeInteraction> = {
  appel: "appel",
  email: "email",
  sms: "sms",
  rendez_vous: "rendez_vous",
  autre_interaction: "message",
  note_interne: "note",
};

function normaliserSujet(sujet: string): string {
  return sujet.trim().replace(/\s+/g, " ").toLowerCase();
}

function libelleBien(bien: { titre: string; ville: string } | null): string | undefined {
  return bien ? `${bien.titre} — ${bien.ville}` : undefined;
}

async function contactDuWorkspace(contactId: string, workspaceId: string, executeur: Executeur): Promise<boolean> {
  if (!UUID_REGEX.test(contactId)) return false;
  const [ligne] = await executeur
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne !== undefined;
}

type ItemInteraction = ItemTimelineContact & { source: "interaction"; gmail?: { sujetNormalise: string } };
type ItemNoteLegacy = ItemTimelineContact & { source: "note_legacy"; legacyGmailSujet?: string };

async function lireInteractions(contactId: string, workspaceId: string, limite: number, executeur: Executeur): Promise<ItemInteraction[]> {
  const lignes = await executeur
    .select({
      interaction: interactionsTable,
      visiteBienId: visitesTable.bienId,
      bien: { titre: biensTable.titre, ville: biensTable.ville },
      prospectVendeurId: prospectsVendeursTable.id,
      acquereurId: acquereursTable.id,
      gmailSujet: envoisEmailTable.objet,
      gmailBienId: envoisEmailTable.bienId,
    })
    .from(interactionsTable)
    .leftJoin(visitesTable, eq(interactionsTable.visiteId, visitesTable.id))
    // Le bien du contexte : direct (`bien_id`) ou via la visite.
    .leftJoin(biensTable, eq(biensTable.id, interactionsTable.bienId))
    .leftJoin(prospectsVendeursTable, and(eq(prospectsVendeursTable.projetVendeurId, interactionsTable.projetVendeurId), eq(prospectsVendeursTable.workspaceId, workspaceId)))
    .leftJoin(acquereursTable, and(eq(acquereursTable.projetAcquereurId, interactionsTable.projetAcquereurId), eq(acquereursTable.workspaceId, workspaceId)))
    .leftJoin(
      referencesExternesTable,
      and(
        eq(referencesExternesTable.interactionId, interactionsTable.id),
        eq(referencesExternesTable.fournisseur, FOURNISSEUR_GMAIL),
        eq(referencesExternesTable.workspaceId, workspaceId)
      )
    )
    .leftJoin(envoisEmailTable, and(eq(envoisEmailTable.gmailMessageId, referencesExternesTable.idExterne), eq(envoisEmailTable.workspaceId, workspaceId)))
    .where(eq(interactionsTable.contactId, contactId))
    .orderBy(desc(interactionsTable.survenuLe), desc(interactionsTable.creeLe), asc(interactionsTable.id))
    .limit(limite);

  // Une visite porte son bien : résolu en une seconde requête bornée (jamais un getById par item).
  const bienIdsVisites = [...new Set(lignes.map((l) => l.visiteBienId).filter((id): id is string => id !== null))];
  const biensVisites = new Map<string, { titre: string; ville: string }>();
  if (bienIdsVisites.length > 0) {
    for (const b of await executeur.select({ id: biensTable.id, titre: biensTable.titre, ville: biensTable.ville }).from(biensTable).where(inArray(biensTable.id, bienIdsVisites))) {
      biensVisites.set(b.id, { titre: b.titre, ville: b.ville });
    }
  }

  const vus = new Set<string>();
  const items: ItemInteraction[] = [];
  for (const l of lignes) {
    const i = l.interaction;
    if (vus.has(i.id)) continue;
    vus.add(i.id);
    let contexte: ContexteTimelineContact | undefined;
    if (i.visiteId) {
      const bien = l.visiteBienId ? biensVisites.get(l.visiteBienId) ?? null : null;
      contexte = { libelle: bien ? `Visite — ${libelleBien(bien)}` : "Visite", href: `/visites/${i.visiteId}` };
    } else if (i.bienId) {
      contexte = { libelle: libelleBien(l.bien) ?? "Bien", href: `/biens/${i.bienId}` };
    } else if (i.projetVendeurId && l.prospectVendeurId) {
      contexte = { libelle: "Projet vendeur", href: `/prospects-vendeurs/${l.prospectVendeurId}` };
    } else if (i.projetAcquereurId && l.acquereurId) {
      contexte = { libelle: "Projet acquéreur", href: `/clients/${l.acquereurId}` };
    } else if (l.gmailSujet !== null && l.gmailBienId) {
      // L'interaction Gmail n'a volontairement aucun contexte (ADR-055 §G) ; le bien dont parlait le
      // message reste un simple repère de navigation, jamais un contexte affirmé.
      contexte = { libelle: "Bien concerné", href: `/biens/${l.gmailBienId}` };
    }
    items.push({
      id: i.id,
      source: "interaction",
      type: i.type as TypeInteraction,
      sens: (i.sens as SensInteraction | null) ?? undefined,
      survenuLe: i.survenuLe.toISOString(),
      contenu: i.contenu ?? undefined,
      natureMetier: (i.natureMetier as NatureMetierInteraction | null) ?? undefined,
      sujet: l.gmailSujet ?? undefined,
      contexte,
      gmail: l.gmailSujet !== null ? { sujetNormalise: normaliserSujet(l.gmailSujet) } : undefined,
    });
  }
  return items;
}

async function lireNotesLegacy(contactId: string, workspaceId: string, limite: number, executeur: Executeur): Promise<ItemNoteLegacy[]> {
  const lignes = await executeur
    .select({ note: notesProspectVendeurTable, prospectId: prospectsVendeursTable.id })
    .from(notesProspectVendeurTable)
    .innerJoin(prospectsVendeursTable, eq(notesProspectVendeurTable.prospectVendeurId, prospectsVendeursTable.id))
    .where(and(eq(prospectsVendeursTable.contactId, contactId), eq(prospectsVendeursTable.workspaceId, workspaceId)))
    .orderBy(desc(notesProspectVendeurTable.creeLe), asc(notesProspectVendeurTable.id))
    .limit(limite);
  return lignes.map(({ note, prospectId }) => {
    const type = TYPE_LEGACY_VERS_INTERACTION[note.type as TypeNoteProspectVendeur] ?? "note";
    const legacyGmailSujet =
      note.type === "email" && note.contenu.startsWith(PREFIXE_NOTE_LEGACY_GMAIL)
        ? note.contenu.slice(PREFIXE_NOTE_LEGACY_GMAIL.length)
        : undefined;
    return {
      id: note.id,
      source: "note_legacy",
      type,
      // Le journal legacy ne connaît pas le sens : on n'en invente pas.
      sens: type === "note" ? "interne" : undefined,
      survenuLe: note.creeLe.toISOString(),
      contenu: note.contenu,
      contexte: { libelle: "Journal prospect vendeur", href: `/prospects-vendeurs/${prospectId}` },
      legacyGmailSujet,
    };
  });
}

// RAPPROCHEMENT Gmail ↔ note legacy — CONSERVATEUR. Une note legacy n'est retirée que si TOUTES
// les preuves disponibles concordent : (1) note de type `email` au format exact du journal Gmail,
// (2) interaction `email`/`sortant` du même Contact reliée à un VRAI envoi Gmail (références
// externes + `envois_email`), (3) objet identique après normalisation, (4) horodatages compatibles
// (garde, pas clé), (5) une interaction ne « consomme » qu'une seule note. Deux vrais emails proches
// avec des objets différents restent deux items ; deux envois distincts au même objet restent deux
// interactions, chacune ne pouvant absorber qu'une note. Au moindre doute : les deux s'affichent.
function retirerNotesLegacyDoublonsGmail(interactions: ItemInteraction[], notes: ItemNoteLegacy[]): ItemNoteLegacy[] {
  const disponibles = interactions.filter((i) => i.gmail && i.type === "email" && i.sens === "sortant");
  const consommees = new Set<string>();
  return notes.filter((note) => {
    if (note.legacyGmailSujet === undefined) return true;
    const sujet = normaliserSujet(note.legacyGmailSujet);
    const dateNote = new Date(note.survenuLe).getTime();
    const correspondance = disponibles.find(
      (i) =>
        !consommees.has(i.id) &&
        i.gmail!.sujetNormalise === sujet &&
        Math.abs(new Date(i.survenuLe).getTime() - dateNote) <= FENETRE_RAPPROCHEMENT_GMAIL_MS
    );
    if (!correspondance) return true;
    consommees.add(correspondance.id);
    return false;
  });
}

function comparerItems(a: ItemTimelineContact, b: ItemTimelineContact): number {
  if (a.survenuLe !== b.survenuLe) return a.survenuLe < b.survenuLe ? 1 : -1;
  if (a.source !== b.source) return a.source === "interaction" ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export async function listerTimelineContact(
  contactId: string,
  workspaceId: string,
  limite: number = LIMITE_TIMELINE_PAR_DEFAUT,
  executeur: Executeur = getDb()
): Promise<ItemTimelineContact[]> {
  const borne = Math.min(Math.max(1, Math.floor(limite)), LIMITE_TIMELINE_MAX);
  if (!(await contactDuWorkspace(contactId, workspaceId, executeur))) return [];
  const [interactions, notes] = await Promise.all([
    lireInteractions(contactId, workspaceId, borne, executeur),
    lireNotesLegacy(contactId, workspaceId, borne, executeur),
  ]);
  const notesConservees = retirerNotesLegacyDoublonsGmail(interactions, notes);
  const items: ItemTimelineContact[] = [
    ...interactions.map(({ gmail: _gmail, ...item }) => item),
    ...notesConservees.map(({ legacyGmailSujet: _legacy, ...item }) => item),
  ];
  return items.sort(comparerItems).slice(0, borne);
}

// ───────────────────────────── CONTEXTES D'UN ÉCHANGE MANUEL ─────────────────────────────

// Les contextes qu'un échange saisi depuis la fiche Contact peut légitimement porter — uniquement
// ceux qui SONT déjà reliés à cette personne dans ce workspace, par une clé réelle : ses projets
// (parties_projet), les biens dont elle est partie au mandat ou vendeur d'origine. Même prédicat
// pour proposer les options ET pour valider une soumission (voir `contexteAppartientAuContact`).
export type ContexteEchange =
  | { code: `projetVendeur:${string}`; kind: "projetVendeur"; id: string; libelle: string }
  | { code: `projetAcquereur:${string}`; kind: "projetAcquereur"; id: string; libelle: string }
  | { code: `bien:${string}`; kind: "bien"; id: string; libelle: string };

export async function listerContextesEchangeContact(contactId: string, workspaceId: string, executeur: Executeur = getDb()): Promise<ContexteEchange[]> {
  if (!(await contactDuWorkspace(contactId, workspaceId, executeur))) return [];
  const [projets, biensMandat, biensProspect] = await Promise.all([
    executeur
      .select({
        projetVendeurId: partiesProjetTable.projetVendeurId,
        projetAcquereurId: partiesProjetTable.projetAcquereurId,
        vendeurArchive: projetsVendeurTable.archiveLe,
        acquereurArchive: projetsAcquereurTable.archiveLe,
        localisation: prospectsVendeursTable.ville,
        budgetMax: projetsAcquereurTable.budgetMax,
      })
      .from(partiesProjetTable)
      .leftJoin(projetsVendeurTable, and(eq(partiesProjetTable.projetVendeurId, projetsVendeurTable.id), eq(projetsVendeurTable.workspaceId, workspaceId)))
      .leftJoin(projetsAcquereurTable, and(eq(partiesProjetTable.projetAcquereurId, projetsAcquereurTable.id), eq(projetsAcquereurTable.workspaceId, workspaceId)))
      .leftJoin(prospectsVendeursTable, and(eq(prospectsVendeursTable.projetVendeurId, projetsVendeurTable.id), eq(prospectsVendeursTable.workspaceId, workspaceId)))
      .where(eq(partiesProjetTable.contactId, contactId))
      .orderBy(asc(partiesProjetTable.creeLe)),
    executeur
      .select({ id: biensTable.id, titre: biensTable.titre, ville: biensTable.ville })
      .from(partiesMandatTable)
      .innerJoin(mandatsTable, eq(partiesMandatTable.mandatId, mandatsTable.id))
      .innerJoin(biensTable, and(eq(mandatsTable.bienId, biensTable.id), eq(biensTable.workspaceId, workspaceId)))
      .where(and(eq(partiesMandatTable.contactId, contactId), isNull(biensTable.archiveLe))),
    executeur
      .select({ id: biensTable.id, titre: biensTable.titre, ville: biensTable.ville })
      .from(prospectsVendeursTable)
      .innerJoin(biensTable, and(eq(prospectsVendeursTable.bienId, biensTable.id), eq(biensTable.workspaceId, workspaceId)))
      .where(and(eq(prospectsVendeursTable.contactId, contactId), eq(prospectsVendeursTable.workspaceId, workspaceId), isNull(biensTable.archiveLe))),
  ]);

  const contextes: ContexteEchange[] = [];
  for (const p of projets) {
    if (p.projetVendeurId && p.vendeurArchive === null) {
      contextes.push({ code: `projetVendeur:${p.projetVendeurId}`, kind: "projetVendeur", id: p.projetVendeurId, libelle: `Projet vendeur${p.localisation ? ` — ${p.localisation}` : ""}` });
    } else if (p.projetAcquereurId && p.acquereurArchive === null) {
      contextes.push({ code: `projetAcquereur:${p.projetAcquereurId}`, kind: "projetAcquereur", id: p.projetAcquereurId, libelle: `Projet acquéreur${p.budgetMax ? ` — jusqu'à ${p.budgetMax.toLocaleString("fr-FR")} €` : ""}` });
    }
  }
  const biensVus = new Set<string>();
  for (const b of [...biensMandat, ...biensProspect]) {
    if (biensVus.has(b.id)) continue;
    biensVus.add(b.id);
    contextes.push({ code: `bien:${b.id}`, kind: "bien", id: b.id, libelle: `Bien — ${b.titre} (${b.ville})` });
  }
  return contextes;
}

export function parseCodeContexteEchange(code: string): { kind: ContexteEchange["kind"]; id: string } | undefined {
  const m = /^(projetVendeur|projetAcquereur|bien):([0-9a-f-]{36})$/i.exec(code.trim());
  if (!m || !UUID_REGEX.test(m[2])) return undefined;
  return { kind: m[1] as ContexteEchange["kind"], id: m[2] };
}
