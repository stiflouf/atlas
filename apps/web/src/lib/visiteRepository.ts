import { and, eq, lte, sql } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { acquereurs as acquereursTable, biens as biensTable, visites as visitesTable } from "@/db/schema";
import type { Visite, StatutVisite } from "@/types/visite";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";

// VISIT_NATIVE_LIFECYCLE_V1 (ADR-063) — la Visite devient WORKSPACE-SAFE : `visites` ne porte pas
// sa propre colonne `workspace_id` (feuille de `biens`, même modèle qu'Offre/Compromis, ADR-054 §7)
// — chaque lecture et chaque écriture remonte à `biens.workspace_id` par jointure ; une visite d'un
// autre workspace est INTROUVABLE, indistinguable d'un id inconnu.
//
// EXCEPTION DÉLIBÉRÉE : `listerVisites()` (VALUE-01, moteur d'opportunités) reste un lecteur GLOBAL
// non scopé — même contrat qu'aujourd'hui, documenté "raisonne sur l'ensemble du portefeuille".
// Ses appelants (`chargerContexteOpportunites`, Aujourd'hui) sont eux-mêmes intégralement non
// scopés par workspace aujourd'hui (limitation pré-existante, hors du domaine Visite, jamais
// auditée par ADR-063) : scoper cette seule fonction sans ses appelants n'apporterait aucune
// garantie réelle, seulement une signature trompeuse. Non comptée parmi les lecteurs/writers
// "de production" que ce lot corrige.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneVisite = typeof visitesTable.$inferSelect;

function ligneVersVisite(ligne: LigneVisite): Visite {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    acquereurId: ligne.acquereurId,
    datePrevue: ligne.datePrevue,
    statut: ligne.statut as StatutVisite,
    rendezVousCalendarId: ligne.rendezVousCalendarId ?? undefined,
    realiseeLe: ligne.realiseeLe ? ligne.realiseeLe.toISOString() : undefined,
    annuleeLe: ligne.annuleeLe ? ligne.annuleeLe.toISOString() : undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// ───────────────────────────── LECTURES (scoped) ─────────────────────────────

export async function getVisiteById(id: string, workspaceId: string, executeur: Executeur = getDb()): Promise<Visite | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select({ visite: visitesTable })
    .from(visitesTable)
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(visitesTable.id, id), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersVisite(ligne.visite) : undefined;
}

export async function getVisiteParRendezVousCalendarId(
  rendezVousCalendarId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Visite | undefined> {
  const [ligne] = await executeur
    .select({ visite: visitesTable })
    .from(visitesTable)
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(visitesTable.rendezVousCalendarId, rendezVousCalendarId), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersVisite(ligne.visite) : undefined;
}

export async function listerVisitesPourBien(bienId: string, workspaceId: string, executeur: Executeur = getDb()): Promise<Visite[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  const lignes = await executeur
    .select({ visite: visitesTable })
    .from(visitesTable)
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(visitesTable.bienId, bienId), eq(biensTable.workspaceId, workspaceId)));
  return lignes.map((l) => ligneVersVisite(l.visite));
}

// Lecture globale (VALUE-01) — voir l'exception documentée en tête de fichier : volontairement NON
// scopée, même contrat qu'avant ce lot.
export async function listerVisites(): Promise<Visite[]> {
  try {
    const lignes = await getDb().select().from(visitesTable);
    return lignes.map(ligneVersVisite);
  } catch (erreur) {
    console.error("[visites] lecture Postgres indisponible :", erreur);
    return [];
  }
}

export async function listerVisitesPourAcquereur(
  acquereurId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Visite[]> {
  if (!UUID_REGEX.test(acquereurId)) return [];
  const lignes = await executeur
    .select({ visite: visitesTable })
    .from(visitesTable)
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(visitesTable.acquereurId, acquereurId), eq(biensTable.workspaceId, workspaceId)));
  return lignes.map((l) => ligneVersVisite(l.visite));
}

// Signal exploité par nouveau_match_bien_acquereur (ADR-037/040) : seule une visite encore
// 'planifiee' rend l'action redondante.
export async function existeVisitePlanifieePourPaire(
  bienId: string,
  acquereurId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<boolean> {
  if (!UUID_REGEX.test(bienId) || !UUID_REGEX.test(acquereurId)) return false;
  const [ligne] = await executeur
    .select({ id: visitesTable.id })
    .from(visitesTable)
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(
      and(
        eq(visitesTable.bienId, bienId),
        eq(visitesTable.acquereurId, acquereurId),
        eq(visitesTable.statut, "planifiee"),
        eq(biensTable.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return !!ligne;
}

// VISIT_AUTOMATION_V1 (ADR-063) — candidates pour `visite_j_1` : toute Visite encore `planifiee`
// dont `datePrevue` tombe EXACTEMENT sur la date cible (déjà un jour civil, aucune heure — ADR-040/
// 041 : comparaison d'égalité, jamais une fenêtre "NOW + 24h", zéro ambiguïté de fuseau horaire).
// Une seule requête, set-based (brief §20/§21) — jamais une par Visite.
export async function visitesPlanifieesPourDate(
  workspaceId: string,
  dateISO: string,
  executeur: Executeur = getDb()
): Promise<Visite[]> {
  const lignes = await executeur
    .select({ visite: visitesTable })
    .from(visitesTable)
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(visitesTable.statut, "planifiee"), eq(visitesTable.datePrevue, dateISO), eq(biensTable.workspaceId, workspaceId)));
  return lignes.map((l) => ligneVersVisite(l.visite));
}

// Candidates pour `visite_sans_compte_rendu` : toute Visite encore `planifiee` dont `datePrevue`
// est déjà passée d'au moins `seuilJours` — `statut = 'planifiee'` suffit à garantir l'absence de
// compte rendu (creerCompteRenduEtRealiserVisite fait toujours transiter vers `realisee` DANS LA
// MÊME transaction que la création du CR, ADR-040/VISIT_NATIVE_LIFECYCLE_V1 : aucun NOT EXISTS
// supplémentaire n'est nécessaire, l'invariant est déjà structurel).
export async function visitesPlanifieesPasseesSeuil(
  workspaceId: string,
  seuilDateISO: string,
  executeur: Executeur = getDb()
): Promise<Visite[]> {
  const lignes = await executeur
    .select({ visite: visitesTable })
    .from(visitesTable)
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(visitesTable.statut, "planifiee"), lte(visitesTable.datePrevue, seuilDateISO), eq(biensTable.workspaceId, workspaceId)));
  return lignes.map((l) => ligneVersVisite(l.visite));
}

// ───────────────────────────── VERROUS ─────────────────────────────

// Même patron que verrouillerBienPourOffres (ADR-061 §3) : racine de sérialisation pour toute
// création de Visite sur ce bien. Pas de verrou nécessaire pour LIRE le mandat courant ou une
// invariant inter-visites — contrairement à l'Offre, plusieurs Visites coexistent librement sur un
// même bien, aucune exclusivité à protéger. Le verrou sert uniquement à figer l'état d'archivage
// lu pendant la création.
type BienVerrouillePourVisites = { statut: "verrouille"; archive: boolean } | { statut: "introuvable" };

async function verrouillerBienPourVisites(bienId: string, workspaceId: string, tx: Executeur): Promise<BienVerrouillePourVisites> {
  if (!UUID_REGEX.test(bienId)) return { statut: "introuvable" };
  const [bien] = await tx
    .select({ id: biensTable.id, archiveLe: biensTable.archiveLe })
    .from(biensTable)
    .where(and(eq(biensTable.id, bienId), eq(biensTable.workspaceId, workspaceId)))
    .for("update");
  if (!bien) return { statut: "introuvable" };
  return { statut: "verrouille", archive: bien.archiveLe !== null };
}

// Même patron que acquereurDuWorkspace (ADR-061 §14) : l'acquéreur legacy doit appartenir au même
// workspace que le bien.
async function acquereurDuWorkspace(
  acquereurId: string,
  workspaceId: string,
  tx: Executeur
): Promise<{ statut: "trouve"; archive: boolean } | { statut: "introuvable" }> {
  if (!UUID_REGEX.test(acquereurId)) return { statut: "introuvable" };
  const [acquereur] = await tx
    .select({ id: acquereursTable.id, archiveLe: acquereursTable.archiveLe })
    .from(acquereursTable)
    .where(and(eq(acquereursTable.id, acquereurId), eq(acquereursTable.workspaceId, workspaceId)))
    .limit(1);
  if (!acquereur) return { statut: "introuvable" };
  return { statut: "trouve", archive: acquereur.archiveLe !== null };
}

// Verrouille la Visite elle-même (scoped par le bien), pour toute transition (réalisation via
// compte rendu, annulation, report). Racine de sérialisation d'UNE visite précise : réaliser vs
// annuler, double compte rendu, double annulation — toutes ces courses sont tranchées par CE
// verrou, jamais par un verrou du bien (aucune invariant inter-visites à protéger ici).
export type VisiteVerrouillee = { statut: "verrouille"; ligne: LigneVisite } | { statut: "introuvable" };

// Exportée pour compteRenduVisiteRepository.ts (writer combiné CR + réalisation, §16 du brief) —
// même patron que compromisRepository.ts import de verrouillerBienPourOffres (ADR-061) : jamais une
// seconde implémentation de la transition 'realisee'.
export async function verrouillerVisite(id: string, workspaceId: string, tx: Executeur): Promise<VisiteVerrouillee> {
  if (!UUID_REGEX.test(id)) return { statut: "introuvable" };
  const [trouve] = await tx
    .select({ visite: visitesTable })
    .from(visitesTable)
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(visitesTable.id, id), eq(biensTable.workspaceId, workspaceId)))
    .for("update", { of: visitesTable });
  if (!trouve) return { statut: "introuvable" };
  return { statut: "verrouille", ligne: trouve.visite };
}

// ───────────────────────────── CRÉATION ─────────────────────────────

export type ResultatCreationVisite =
  | { statut: "creee"; visite: Visite }
  | { statut: "bien_introuvable" }
  | { statut: "bien_archive" }
  | { statut: "acquereur_introuvable" }
  | { statut: "acquereur_archive" };

async function creerVisiteEnBase(
  input: { bienId: string; acquereurId: string; datePrevue: string; rendezVousCalendarId: string | null },
  workspaceId: string,
  executeur: Executeur
): Promise<ResultatCreationVisite> {
  return executeur.transaction(async (tx) => {
    const bien = await verrouillerBienPourVisites(input.bienId, workspaceId, tx);
    if (bien.statut !== "verrouille") return { statut: "bien_introuvable" };
    if (bien.archive) return { statut: "bien_archive" };
    const acquereur = await acquereurDuWorkspace(input.acquereurId, workspaceId, tx);
    if (acquereur.statut !== "trouve") return { statut: "acquereur_introuvable" };
    if (acquereur.archive) return { statut: "acquereur_archive" };

    if (input.rendezVousCalendarId) {
      // Chemin Calendar (ADR-040, idempotence DB) : conflit possible et LÉGITIME (double
      // matérialisation du même rendez-vous) — jamais une erreur, une simple relecture.
      const [ligneInseree] = await tx
        .insert(visitesTable)
        .values({
          bienId: input.bienId,
          acquereurId: input.acquereurId,
          datePrevue: input.datePrevue,
          rendezVousCalendarId: input.rendezVousCalendarId,
        })
        // VISIT_NATIVE_LIFECYCLE_V1 (ADR-063) — l'index visé est désormais PARTIEL (colonne
        // Calendar-optionnelle) : l'arbitre ON CONFLICT de Postgres exige un `where` identique au
        // prédicat de l'index pour l'inférer, sinon "no unique or exclusion constraint matching"
        // (42P10) — jamais un simple `target` seul comme au temps de l'ancienne contrainte pleine.
        .onConflictDoNothing({
          target: visitesTable.rendezVousCalendarId,
          where: sql`${visitesTable.rendezVousCalendarId} IS NOT NULL`,
        })
        .returning();
      if (ligneInseree) return { statut: "creee", visite: ligneVersVisite(ligneInseree) };
      const [existante] = await tx
        .select()
        .from(visitesTable)
        .where(eq(visitesTable.rendezVousCalendarId, input.rendezVousCalendarId))
        .limit(1);
      if (!existante) throw new Error("Échec de matérialisation de la visite : ni insertion ni ligne existante retrouvée.");
      return { statut: "creee", visite: ligneVersVisite(existante) };
    }

    // Chemin natif (ADR-063) : aucun conflit possible, `rendez_vous_calendar_id` reste NULL —
    // l'index unique partiel ne contraint jamais cette ligne.
    const [ligne] = await tx
      .insert(visitesTable)
      .values({
        bienId: input.bienId,
        acquereurId: input.acquereurId,
        datePrevue: input.datePrevue,
        rendezVousCalendarId: null,
      })
      .returning();
    return { statut: "creee", visite: ligneVersVisite(ligne) };
  });
}

export type NouvelleVisiteNative = { bienId: string; acquereurId: string; datePrevue: string };

// VISIT_NATIVE_LIFECYCLE_V1 (ADR-063) — création SANS Calendar : `rendez_vous_calendar_id` reste
// NULL en permanence. Réussit intégralement sans Google Calendar, sans event Calendar.
export async function creerVisite(
  input: NouvelleVisiteNative,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatCreationVisite> {
  return creerVisiteEnBase({ ...input, rendezVousCalendarId: null }, workspaceId, executeur);
}

export type NouvelleVisite = { bienId: string; acquereurId: string; datePrevue: string; rendezVousCalendarId: string };

// Chemin Calendar historique (ADR-040/041) — CONVERGE vers la même primitive de création que
// `creerVisite` (§11 du brief) : mêmes gardes (bien/acquéreur workspace + archivage), jamais deux
// logiques métier divergentes. Comportement historique préservé : idempotence DB inchangée.
export async function materialiserVisite(
  input: NouvelleVisite,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatCreationVisite> {
  return creerVisiteEnBase(input, workspaceId, executeur);
}

// ───────────────────────────── TRANSITIONS ─────────────────────────────

export type ResultatAnnulationVisite =
  | { statut: "annulee"; visite: Visite; idsExecutionsATraiter: string[] }
  | { statut: "introuvable" }
  | { statut: "deja_finalisee" };

// Writer central de transition (§6 du brief) : verrouille la Visite (scoped workspace), vérifie
// l'état actuel, UPDATE conditionnel, événement, dans UNE transaction. `realisee → annulee` interdit
// structurellement par la vérification `statut === 'planifiee'` ci-dessous — aucune résurrection
// possible (matrice complète : seul `planifiee` a une transition sortante vers `annulee`).
export async function annulerVisite(id: string, workspaceId: string, executeur: Executeur = getDb()): Promise<ResultatAnnulationVisite> {
  return executeur.transaction(async (tx) => {
    const verrou = await verrouillerVisite(id, workspaceId, tx);
    if (verrou.statut !== "verrouille") return { statut: "introuvable" };
    if (verrou.ligne.statut !== "planifiee") return { statut: "deja_finalisee" };

    const [ligne] = await tx
      .update(visitesTable)
      .set({ statut: "annulee", annuleeLe: new Date() })
      .where(and(eq(visitesTable.id, id), eq(visitesTable.statut, "planifiee")))
      .returning();
    if (!ligne) return { statut: "deja_finalisee" };

    const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions(
      { typeEvenement: "visite_annulee", visiteId: id },
      workspaceId,
      tx
    );
    // Traité hors transaction par l'appelant (même patron ADR-032/061, ex. offreRepository.ts) —
    // voir actions/visite.ts, qui appelle `traiterExecutionsEnAttente()` après le commit.
    return { statut: "annulee", visite: ligneVersVisite(ligne), idsExecutionsATraiter };
  });
}

export type ResultatReportVisite =
  | { statut: "reportee"; visite: Visite }
  | { statut: "introuvable" }
  | { statut: "deja_finalisee" };

// Report (ADR-040 §11, inchangé) : même visite, même id, jamais annulée+recréée. Restreint aux
// visites encore 'planifiee' — désormais scoped workspace + verrouillée comme toute transition.
export async function modifierDatePrevueVisite(
  id: string,
  nouvelleDatePrevue: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatReportVisite> {
  return executeur.transaction(async (tx) => {
    const verrou = await verrouillerVisite(id, workspaceId, tx);
    if (verrou.statut !== "verrouille") return { statut: "introuvable" };
    if (verrou.ligne.statut !== "planifiee") return { statut: "deja_finalisee" };

    const [ligne] = await tx
      .update(visitesTable)
      .set({ datePrevue: nouvelleDatePrevue })
      .where(and(eq(visitesTable.id, id), eq(visitesTable.statut, "planifiee")))
      .returning();
    if (!ligne) return { statut: "deja_finalisee" };
    return { statut: "reportee", visite: ligneVersVisite(ligne) };
  });
}

// Exportée pour la même raison que `verrouillerVisite` ci-dessus — compteRenduVisiteRepository.ts
// a besoin de reconvertir la ligne verrouillée en `Visite` après avoir posé `statut='realisee'`.
export function ligneVersVisitePublique(ligne: LigneVisite): Visite {
  return ligneVersVisite(ligne);
}
