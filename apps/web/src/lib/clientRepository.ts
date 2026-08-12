import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { acquereurs as acquereursTable } from "@/db/schema";
import { clients as clientsDemo, getClientById as getClientDemoById } from "@/data/clients";
import type { ProfilAcquereur, StadeProjet } from "@/types/client";

type LigneAcquereur = typeof acquereursTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    console.error("[acquereurs] lecture Postgres indisponible, repli sur les mocks :", erreur);
  }
  return clientsDemo;
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
    console.error("[acquereurs] lecture Postgres indisponible, repli sur les mocks :", erreur);
    return getClientDemoById(id);
  }
  return getClientDemoById(id);
}

export type NouvelAcquereur = Omit<ProfilAcquereur, "id">;

// Insertion pure : la validation métier (budgetMin <= budgetMax, etc.) est de la responsabilité
// de l'appelant (Server Action), pas de ce repository.
export async function creerAcquereur(input: NouvelAcquereur): Promise<ProfilAcquereur> {
  const [ligne] = await getDb()
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
export async function modifierAcquereur(id: string, input: NouvelAcquereur): Promise<ProfilAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
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
export async function archiverAcquereur(id: string): Promise<ProfilAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(acquereursTable)
    .set({ archiveLe: new Date() })
    .where(eq(acquereursTable.id, id))
    .returning();
  return ligne ? ligneVersAcquereur(ligne) : undefined;
}

export async function desarchiverAcquereur(id: string): Promise<ProfilAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(acquereursTable)
    .set({ archiveLe: null })
    .where(eq(acquereursTable.id, id))
    .returning();
  return ligne ? ligneVersAcquereur(ligne) : undefined;
}
