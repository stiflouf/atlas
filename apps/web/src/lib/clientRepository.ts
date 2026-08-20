import { and, count, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { acquereurs as acquereursTable } from "@/db/schema";
import { clients as clientsDemo, getClientById as getClientDemoById } from "@/data/clients";
import type { ProfilAcquereur, StadeProjet } from "@/types/client";
import type { PageResultat } from "@/types/pagination";

type LigneAcquereur = typeof acquereursTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bugfix pilote : le repli mock ci-dessous ne doit jamais atteindre la production (id non-UUID
// comme "client-001" inutilisable comme FK réelle — voir la contamination Postgres SQLSTATE 22P02
// constatée). Hors production (dev/tests), comportement historique inchangé.
function estProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// NULL Postgres -> undefined métier, jamais interprété comme false — même principe que
// bienRepository.ts.
function ligneVersAcquereur(ligne: LigneAcquereur): ProfilAcquereur {
  return {
    id: ligne.id,
    prenom: ligne.prenom,
    nom: ligne.nom,
    email: ligne.email,
    telephone: ligne.telephone,
    budgetMin: ligne.budgetMin,
    budgetMax: ligne.budgetMax,
    criteres: ligne.criteres,
    stadeProjet: ligne.stadeProjet as StadeProjet,
    notes: ligne.notes,
    datePremiereContact: ligne.datePremiereContact,
    piecesMin: ligne.piecesMin ?? undefined,
    surfaceMin: ligne.surfaceMin ?? undefined,
    accessibiliteRequise: ligne.accessibiliteRequise ?? undefined,
    necessiteParking: ligne.necessiteParking ?? undefined,
    necessiteExterieur: ligne.necessiteExterieur ?? undefined,
    archiveLe: ligne.archiveLe?.toISOString(),
  };
}

// Acquéreurs réels si au moins un existe, sinon les acquéreurs de démonstration — jamais un
// mélange, même principe que listerBiens(). La bascule compte TOUTES les lignes réelles
// (archivées comprises) — seul le résultat retourné exclut les archivés (ADR-012).
export async function listerClients(): Promise<ProfilAcquereur[]> {
  try {
    const lignes = await getDb().select().from(acquereursTable);
    if (lignes.length > 0) return lignes.filter((l) => !l.archiveLe).map(ligneVersAcquereur);
  } catch (erreur) {
    console.error("[acquereurs] lecture Postgres indisponible :", erreur);
    if (estProduction()) throw erreur;
    return clientsDemo;
  }
  if (estProduction()) return [];
  return clientsDemo;
}

// Réservé aux consommateurs qui ont besoin d'entités structurellement persistées (FK-able) — ADR-036
// (synchroniseur de compatibilité) uniquement. Même principe que listerBiensActifsPersistes()
// (bienRepository.ts) : interroge la table réelle directement, AUCUN repli mock. Ne remplace jamais
// listerClients() : le comportement produit existant (UI, matching flou) reste strictement inchangé.
export async function listerClientsActifsPersistes(): Promise<ProfilAcquereur[]> {
  const lignes = await getDb().select().from(acquereursTable);
  return lignes.filter((l) => !l.archiveLe).map(ligneVersAcquereur);
}

// Réservé aux acquéreurs réels archivés — aucun repli mock.
export async function listerClientsArchives(): Promise<ProfilAcquereur[]> {
  try {
    const lignes = await getDb().select().from(acquereursTable);
    return lignes.filter((l) => l.archiveLe).map(ligneVersAcquereur);
  } catch (erreur) {
    console.error("[acquereurs] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// ADR-048 — recherche + pagination serveur, réservée à la page /clients. Ne remplace jamais
// listerClients() : le cockpit, le dashboard et les <select> de contexte continuent d'appeler la
// fonction existante, intégralement, sans pagination (voir docs/adr/048-...). Aucun repli mock ici
// (contrairement à listerClients()) : la recherche/pagination n'a pas de sens sur un jeu de
// démonstration figé, exposé uniquement avant toute création réelle.
//
// Ordre déterministe explicite (ADR-048) : aucun repository de ce projet n'avait d'ORDER BY avant
// cette ADR, l'ordre observé n'était donc jamais une garantie. `creeLe DESC` (le plus récent en
// premier, cohérent avec la lecture habituelle d'une liste), `id DESC` en tie-breaker pour deux
// lignes insérées à la même transaction/même timestamp — jamais un ordre implicite non déterministe
// qui déplacerait silencieusement des lignes d'une page à l'autre.
export async function rechercherAcquereursPage(params: {
  q?: string;
  archives: boolean;
  page: number;
  parPage: number;
}): Promise<PageResultat<ProfilAcquereur>> {
  const texte = params.q?.trim();
  const conditionArchive = params.archives ? isNotNull(acquereursTable.archiveLe) : isNull(acquereursTable.archiveLe);
  const conditionTexte: SQL | undefined = texte
    ? or(ilike(acquereursTable.nom, `%${texte}%`), ilike(acquereursTable.prenom, `%${texte}%`))
    : undefined;
  const conditions = conditionTexte ? and(conditionArchive, conditionTexte) : conditionArchive;

  const page = Math.max(1, Math.floor(params.page) || 1);
  const offset = (page - 1) * params.parPage;

  const [lignes, [{ total }]] = await Promise.all([
    getDb()
      .select()
      .from(acquereursTable)
      .where(conditions)
      .orderBy(desc(acquereursTable.creeLe), desc(acquereursTable.id))
      .limit(params.parPage)
      .offset(offset),
    getDb().select({ total: count() }).from(acquereursTable).where(conditions),
  ]);

  return { lignes: lignes.map(ligneVersAcquereur), total };
}

// Même règle de repli que getBienById() : dataset réel non vide => lookup DB uniquement, même
// pour un id de démo direct.
export async function getClientById(id: string): Promise<ProfilAcquereur | undefined> {
  try {
    if (UUID_REGEX.test(id)) {
      const [ligne] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, id)).limit(1);
      if (ligne) return ligneVersAcquereur(ligne);
    }

    const [{ total }] = await getDb().select({ total: sql<number>`count(*)::int` }).from(acquereursTable);
    if (total > 0) return undefined;
  } catch (erreur) {
    console.error("[acquereurs] lecture Postgres indisponible :", erreur);
    if (estProduction()) throw erreur;
    return getClientDemoById(id);
  }
  if (estProduction()) return undefined;
  return getClientDemoById(id);
}

export type NouvelAcquereur = Omit<ProfilAcquereur, "id">;

// Insertion pure : la validation métier (budgetMin <= budgetMax, etc.) est de la responsabilité
// de l'appelant (Server Action), pas de ce repository.
export async function creerAcquereur(
  input: NouvelAcquereur,
  executeur: Executeur = getDb()
): Promise<ProfilAcquereur> {
  const [ligne] = await executeur
    .insert(acquereursTable)
    .values({
      prenom: input.prenom,
      nom: input.nom,
      email: input.email,
      telephone: input.telephone,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      criteres: input.criteres,
      stadeProjet: input.stadeProjet,
      notes: input.notes,
      datePremiereContact: input.datePremiereContact,
      piecesMin: input.piecesMin ?? null,
      surfaceMin: input.surfaceMin ?? null,
      accessibiliteRequise: input.accessibiliteRequise ?? null,
      necessiteParking: input.necessiteParking ?? null,
      necessiteExterieur: input.necessiteExterieur ?? null,
    })
    .returning();
  return ligneVersAcquereur(ligne);
}

// Update pur, même principe que creerAcquereur. modifieLe posé explicitement (voir
// bienRepository.modifierBien pour le détail). Retourne undefined si id ne correspond à aucune
// ligne réelle plutôt que de supposer une modification effective.
export async function modifierAcquereur(
  id: string,
  input: NouvelAcquereur,
  executeur: Executeur = getDb()
): Promise<ProfilAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(acquereursTable)
    .set({
      prenom: input.prenom,
      nom: input.nom,
      email: input.email,
      telephone: input.telephone,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      criteres: input.criteres,
      stadeProjet: input.stadeProjet,
      notes: input.notes,
      datePremiereContact: input.datePremiereContact,
      piecesMin: input.piecesMin ?? null,
      surfaceMin: input.surfaceMin ?? null,
      accessibiliteRequise: input.accessibiliteRequise ?? null,
      necessiteParking: input.necessiteParking ?? null,
      necessiteExterieur: input.necessiteExterieur ?? null,
      modifieLe: new Date(),
    })
    .where(eq(acquereursTable.id, id))
    .returning();
  return ligne ? ligneVersAcquereur(ligne) : undefined;
}

// Archivage/désarchivage : jamais un DELETE, uniquement archiveLe qui bascule (voir
// bienRepository.archiverBien pour le détail des garanties FK).
export async function archiverAcquereur(
  id: string,
  executeur: Executeur = getDb()
): Promise<ProfilAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(acquereursTable)
    .set({ archiveLe: new Date() })
    .where(eq(acquereursTable.id, id))
    .returning();
  return ligne ? ligneVersAcquereur(ligne) : undefined;
}

export async function desarchiverAcquereur(
  id: string,
  executeur: Executeur = getDb()
): Promise<ProfilAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(acquereursTable)
    .set({ archiveLe: null })
    .where(eq(acquereursTable.id, id))
    .returning();
  return ligne ? ligneVersAcquereur(ligne) : undefined;
}
