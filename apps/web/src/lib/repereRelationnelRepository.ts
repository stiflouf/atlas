import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { reperesRelationnelsAcquereur as reperesTable } from "@/db/schema";
import type {
  CategorieRepereRelationnel,
  ProvenanceRepereRelationnel,
  RepereRelationnel,
} from "@/types/repereRelationnel";

type LigneRepere = typeof reperesTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ligneVersRepere(ligne: LigneRepere): RepereRelationnel {
  return {
    id: ligne.id,
    acquereurId: ligne.acquereurId,
    categorie: ligne.categorie as CategorieRepereRelationnel,
    libelle: ligne.libelle,
    provenance: ligne.provenance as ProvenanceRepereRelationnel,
    utilisableCommunication: ligne.utilisableCommunication,
    archiveLe: ligne.archiveLe?.toISOString(),
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe?.toISOString(),
  };
}

// Ordre déterministe posé ICI, jamais laissé au hasard d'un `SELECT` sans `ORDER BY` : ancienneté
// puis `id` en tie-break (deux insertions rapprochées peuvent partager `cree_le` — même leçon que
// getDernierRunScanPourRegle). Le REGROUPEMENT par catégorie est une décision d'affichage, faite
// par le composant dans l'ordre canonique de CATEGORIES_REPERE_RELATIONNEL — jamais un tri
// alphabétique de codes techniques, qui placerait « Autre repère » en tête.
const ORDRE_DETERMINISTE = [asc(reperesTable.creeLe), asc(reperesTable.id)];

// Repères ACTIFS uniquement : un repère archivé n'alimente jamais la mémoire active (patron
// listerAcquereurs/listerAcquereursArchives). Aucun repli mock : un repère n'existe que pour un
// acquéreur réel (FK uuid), même principe que listerSecteursPourAcquereur.
export async function listerReperesRelationnelsAcquereur(acquereurId: string): Promise<RepereRelationnel[]> {
  if (!UUID_REGEX.test(acquereurId)) return [];
  const lignes = await getDb()
    .select()
    .from(reperesTable)
    .where(and(eq(reperesTable.acquereurId, acquereurId), isNull(reperesTable.archiveLe)))
    .orderBy(...ORDRE_DETERMINISTE);
  return lignes.map(ligneVersRepere);
}

export async function listerReperesRelationnelsArchivesAcquereur(
  acquereurId: string
): Promise<RepereRelationnel[]> {
  if (!UUID_REGEX.test(acquereurId)) return [];
  const lignes = await getDb()
    .select()
    .from(reperesTable)
    .where(and(eq(reperesTable.acquereurId, acquereurId), isNotNull(reperesTable.archiveLe)))
    .orderBy(...ORDRE_DETERMINISTE);
  return lignes.map(ligneVersRepere);
}

// Insertion pure : catégorie, provenance et libellé doivent déjà avoir été validés par l'appelant
// (Server Action). `utilisableCommunication` est un paramètre EXPLICITE sans valeur par défaut ici
// — c'est la colonne qui porte le refus par défaut, jamais un `?? false` dispersé dans le code.
export async function creerRepereRelationnelAcquereur(
  input: {
    acquereurId: string;
    categorie: CategorieRepereRelationnel;
    libelle: string;
    provenance: ProvenanceRepereRelationnel;
    utilisableCommunication: boolean;
  },
  executeur: Executeur = getDb()
): Promise<RepereRelationnel> {
  const [ligne] = await executeur.insert(reperesTable).values(input).returning();
  return ligneVersRepere(ligne);
}

// Correction de la valeur courante (patron ADR-029/ADR-021) : `modifieLe` est posé ici, `creeLe`
// n'est jamais retouché, aucun historique de versions n'est écrit. Scopée à l'acquéreur
// propriétaire (acquereurId dans le WHERE, pas seulement l'id de ligne) : un formulaire manipulé
// sur une fiche ne peut jamais corriger le repère d'un autre acquéreur. Retourne `undefined` si
// aucune ligne ne correspond plutôt que de supposer une modification effective.
export async function modifierRepereRelationnelAcquereur(
  id: string,
  acquereurId: string,
  champs: {
    categorie: CategorieRepereRelationnel;
    libelle: string;
    provenance: ProvenanceRepereRelationnel;
    utilisableCommunication: boolean;
  },
  executeur: Executeur = getDb()
): Promise<RepereRelationnel | undefined> {
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(acquereurId)) return undefined;
  const [ligne] = await executeur
    .update(reperesTable)
    .set({ ...champs, modifieLe: new Date() })
    .where(and(eq(reperesTable.id, id), eq(reperesTable.acquereurId, acquereurId)))
    .returning();
  return ligne ? ligneVersRepere(ligne) : undefined;
}

// Archivage réversible (patron ADR-012) — jamais un DELETE. `modifieLe` reste volontairement
// intact : archiver n'est pas corriger le contenu du repère, et `modifieLe` doit continuer à
// répondre « quand ce texte a-t-il été changé pour la dernière fois ? ».
export async function archiverRepereRelationnelAcquereur(
  id: string,
  acquereurId: string,
  executeur: Executeur = getDb()
): Promise<RepereRelationnel | undefined> {
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(acquereurId)) return undefined;
  const [ligne] = await executeur
    .update(reperesTable)
    .set({ archiveLe: new Date() })
    .where(and(eq(reperesTable.id, id), eq(reperesTable.acquereurId, acquereurId)))
    .returning();
  return ligne ? ligneVersRepere(ligne) : undefined;
}

export async function restaurerRepereRelationnelAcquereur(
  id: string,
  acquereurId: string,
  executeur: Executeur = getDb()
): Promise<RepereRelationnel | undefined> {
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(acquereurId)) return undefined;
  const [ligne] = await executeur
    .update(reperesTable)
    .set({ archiveLe: null })
    .where(and(eq(reperesTable.id, id), eq(reperesTable.acquereurId, acquereurId)))
    .returning();
  return ligne ? ligneVersRepere(ligne) : undefined;
}
