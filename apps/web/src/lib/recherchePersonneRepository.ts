import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { getDb, type Executeur } from "@/db/client";
import {
  acquereurs as acquereursTable,
  contacts as contactsTable,
  prospectsVendeurs as prospectsVendeursTable,
} from "@/db/schema";
import {
  assemblerResultatsContacts,
  expressionRang,
  filtreTexte,
  rechercherContacts,
  type ColonnesIdentite,
  type LigneContactRecherche,
} from "@/lib/rechercheContactRepository";
import type { PageRecherchePersonne, ResultatRecherchePersonne } from "@/types/recherchePersonne";

// ADR-058 décision 5 — LA RECHERCHE MIXTE : Contacts canoniques ET dossiers historiques que personne
// n'a encore rattachés, dans une seule liste ordonnée. Elle ORCHESTRE ; elle ne redéfinit rien.
//
// Ce module ne rapproche JAMAIS un dossier d'un contact. Un Contact « Jean Dupont » et un acquéreur
// historique « Jean Dupont » à la même adresse sont deux résultats, côte à côte, jusqu'à ce qu'un
// humain rattache le second (ADR-055 §H, rattachementContact.ts). Aucun GROUP BY, aucun DISTINCT,
// aucun contact virtuel fabriqué à partir d'un dossier : un résultat legacy est typé legacy.
//
// Les dossiers déjà rattachés (`contact_id IS NOT NULL`) sont EXCLUS des sources historiques : leur
// personne est déjà un Contact, et la faire apparaître deux fois serait un doublon artificiel.
//
// Lecture seule, par construction : ce module n'importe aucun chemin d'écriture.

const PAR_PAGE_DEFAUT = 25;
const PAR_PAGE_MAX = 100;

export type ParametresRecherchePersonne = {
  // ADR-054 — OBLIGATOIRE, jamais optionnel, jamais de repli.
  workspaceId: string;
  q?: string;
  limite?: number;
  decalage?: number;
};

function borner(limite: number | undefined): number {
  if (limite === undefined) return PAR_PAGE_DEFAUT;
  return Math.max(1, Math.min(PAR_PAGE_MAX, Math.floor(limite)));
}

const COLONNES_CONTACT: ColonnesIdentite = {
  nom: contactsTable.nom,
  prenom: contactsTable.prenom,
  email: contactsTable.email,
  telephone: contactsTable.telephone,
};

const COLONNES_ACQUEREUR: ColonnesIdentite = {
  nom: acquereursTable.nom,
  prenom: acquereursTable.prenom,
  email: acquereursTable.email,
  telephone: acquereursTable.telephone,
};

const COLONNES_PROSPECT_VENDEUR: ColonnesIdentite = {
  nom: prospectsVendeursTable.nom,
  prenom: prospectsVendeursTable.prenom,
  email: prospectsVendeursTable.email,
  telephone: prospectsVendeursTable.telephone,
};

// Discriminant et ORDRE DE DÉPARTAGE. Le rang textuel prime toujours (mêmes paliers pour les trois
// sources, calculés par la même fonction) ; à rang et nom égaux seulement, le canonique passe avant
// l'historique — jamais « les Contacts d'abord » quand un dossier correspond mieux.
type TypeSource = "contact" | "legacy_acquereur" | "legacy_vendeur";
const ORDRE_TYPE: Record<TypeSource, number> = { contact: 0, legacy_acquereur: 1, legacy_vendeur: 2 };

export async function rechercherPersonnes(
  params: ParametresRecherchePersonne,
  executeur: Executeur = getDb()
): Promise<PageRecherchePersonne> {
  const texte = params.q?.trim() ?? "";
  const limite = borner(params.limite);
  const decalage = Math.max(0, Math.floor(params.decalage ?? 0));

  // REQUÊTE VIDE → uniquement les Contacts récents. Les dossiers historiques n'apparaissent que
  // lorsqu'un conseiller cherche réellement quelqu'un : sans cela, la page d'accueil du carnet
  // deviendrait l'inventaire de la dette de rattachement.
  if (texte.length === 0) {
    const page = await rechercherContacts({ workspaceId: params.workspaceId, limite, decalage }, executeur);
    return { items: page.items.map((item) => ({ type: "contact" as const, ...item })), hasMore: page.hasMore };
  }

  // UNE SEULE LISTE ORDONNÉE, en SQL : `UNION ALL` des trois sources avec le même rang, puis tri,
  // LIMIT et OFFSET globaux. Trier ou paginer en mémoire après trois LIMIT séparés rendrait la
  // page 2 incohérente avec la page 1. `UNION ALL`, jamais `UNION` : ce dernier dédoublonnerait des
  // lignes identiques, ce que cette recherche s'interdit par principe.
  const sourceContacts = executeur
    .select({
      type: sql<TypeSource>`'contact'`.as("type"),
      ordreType: sql<number>`${ORDRE_TYPE.contact}`.as("ordre_type"),
      id: contactsTable.id,
      nom: contactsTable.nom,
      prenom: contactsTable.prenom,
      email: contactsTable.email,
      telephone: contactsTable.telephone,
      rang: expressionRang(texte, COLONNES_CONTACT).as("rang"),
    })
    .from(contactsTable)
    // ADR-059 — même exclusion que `rechercherContacts` : un contact absorbé n'est plus cherchable.
    .where(
      and(
        eq(contactsTable.workspaceId, params.workspaceId),
        isNull(contactsTable.fusionneDansContactId),
        filtreTexte(texte, COLONNES_CONTACT)
      )
    );

  const sourceAcquereurs = executeur
    .select({
      type: sql<TypeSource>`'legacy_acquereur'`.as("type"),
      ordreType: sql<number>`${ORDRE_TYPE.legacy_acquereur}`.as("ordre_type"),
      id: acquereursTable.id,
      nom: acquereursTable.nom,
      prenom: acquereursTable.prenom,
      email: acquereursTable.email,
      telephone: acquereursTable.telephone,
      rang: expressionRang(texte, COLONNES_ACQUEREUR).as("rang"),
    })
    .from(acquereursTable)
    .where(
      and(
        eq(acquereursTable.workspaceId, params.workspaceId),
        isNull(acquereursTable.contactId),
        filtreTexte(texte, COLONNES_ACQUEREUR)
      )
    );

  const sourceProspectsVendeurs = executeur
    .select({
      type: sql<TypeSource>`'legacy_vendeur'`.as("type"),
      ordreType: sql<number>`${ORDRE_TYPE.legacy_vendeur}`.as("ordre_type"),
      id: prospectsVendeursTable.id,
      nom: prospectsVendeursTable.nom,
      prenom: prospectsVendeursTable.prenom,
      email: prospectsVendeursTable.email,
      telephone: prospectsVendeursTable.telephone,
      rang: expressionRang(texte, COLONNES_PROSPECT_VENDEUR).as("rang"),
    })
    .from(prospectsVendeursTable)
    .where(
      and(
        eq(prospectsVendeursTable.workspaceId, params.workspaceId),
        isNull(prospectsVendeursTable.contactId),
        filtreTexte(texte, COLONNES_PROSPECT_VENDEUR)
      )
    );

  // Une ligne de plus que la page : c'est ce qui dit « il y a une suite », sans COUNT global.
  const lignes = await unionAll(sourceContacts, sourceAcquereurs, sourceProspectsVendeurs)
    .orderBy(asc(sql`"rang"`), asc(sql`"nom"`), asc(sql`"ordre_type"`), asc(sql`"id"`))
    .limit(limite + 1)
    .offset(decalage);

  const hasMore = lignes.length > limite;
  const page = hasMore ? lignes.slice(0, limite) : lignes;

  // Les Contacts de la page reçoivent leur contexte (rôles, projets, dernière interaction) par les
  // agrégats batchés du read model canonique — deux requêtes, quel que soit le nombre de résultats.
  const lignesContacts: LigneContactRecherche[] = page.filter((l) => l.type === "contact");
  const contacts = await assemblerResultatsContacts(lignesContacts, executeur);
  const contactParId = new Map(contacts.map((c) => [c.contactId, c]));

  // L'ordre de la requête est conservé ; chaque ligne devient le résultat de SA nature.
  const items: ResultatRecherchePersonne[] = page.map((ligne) => {
    if (ligne.type === "contact") return { type: "contact", ...contactParId.get(ligne.id)! };
    const identite = {
      nom: ligne.nom,
      prenom: ligne.prenom ?? undefined,
      email: ligne.email ?? undefined,
      telephone: ligne.telephone ?? undefined,
    };
    return ligne.type === "legacy_acquereur"
      ? { type: "legacy_acquereur", acquereurId: ligne.id, ...identite }
      : { type: "legacy_vendeur", prospectVendeurId: ligne.id, ...identite };
  });

  return { items, hasMore };
}
