import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { acquereurs as acquereursTable, biens as biensTable, compromis as compromisTable, offres as offresTable } from "@/db/schema";
import type { Compromis, StatutCompromis } from "@/types/compromis";
import type { MotifPerte, MotifPerteHumain } from "@/types/motifPerte";
import { marquerCompromisSigne } from "@/lib/bienRepository";
import { verrouillerBienPourOffres } from "@/lib/offreRepository";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";

// ADR-016/017/047, et ADR-061 §13 (lot OFFER_LIFECYCLE_FOUNDATION_V1) — accès au Compromis. Le
// modèle n'est PAS refondu : ce lot le rend workspace-safe (feuille de `biens`, ADR-054 §7 : toute
// lecture remonte à `biens.workspace_id`), met la création et les transitions sous le MÊME ordre de
// verrous que l'Offre (bien scoped → offre → compromis), et émet `compromis_realise` /
// `compromis_annule` dans la transaction de la transition. Les contraintes ADR-047
// (`UNIQUE(offre_id)`, un seul `en_cours` par bien) restent le dernier filet.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneCompromis = typeof compromisTable.$inferSelect;

function ligneVersCompromis(ligne: LigneCompromis): Compromis {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    acquereurId: ligne.acquereurId,
    offreId: ligne.offreId ?? undefined,
    prixConvenu: ligne.prixConvenu,
    dateSignature: ligne.dateSignature,
    dateActe: ligne.dateActe ?? undefined,
    dateActeReelle: ligne.dateActeReelle ?? undefined,
    dateAnnulation: ligne.dateAnnulation ?? undefined,
    motifAnnulation: (ligne.motifAnnulation as MotifPerte | null) ?? undefined,
    statut: ligne.statut as StatutCompromis,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// ───────────────────────────── LECTURES (scoped) ─────────────────────────────

// Un id non-UUID (bien/acquéreur mocké) ne peut correspondre à aucune ligne : liste vide.
export async function listerCompromisPourBien(bienId: string, workspaceId: string, executeur: Executeur = getDb()): Promise<Compromis[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  const lignes = await executeur
    .select({ compromis: compromisTable })
    .from(compromisTable)
    .innerJoin(biensTable, eq(compromisTable.bienId, biensTable.id))
    .where(and(eq(compromisTable.bienId, bienId), eq(biensTable.workspaceId, workspaceId)))
    .orderBy(desc(compromisTable.dateSignature));
  return lignes.map((l) => ligneVersCompromis(l.compromis));
}

// Variante EN LOT pour les listes (ADR-061 §11) : une requête pour N biens.
export async function listerCompromisParBiens(bienIds: string[], workspaceId: string, executeur: Executeur = getDb()): Promise<Map<string, Compromis[]>> {
  const ids = bienIds.filter((id) => UUID_REGEX.test(id));
  const parBien = new Map<string, Compromis[]>(bienIds.map((id) => [id, []]));
  if (ids.length === 0) return parBien;
  const lignes = await executeur
    .select({ compromis: compromisTable })
    .from(compromisTable)
    .innerJoin(biensTable, eq(compromisTable.bienId, biensTable.id))
    .where(and(inArray(compromisTable.bienId, ids), eq(biensTable.workspaceId, workspaceId)))
    .orderBy(desc(compromisTable.dateSignature));
  for (const { compromis } of lignes) parBien.get(compromis.bienId)?.push(ligneVersCompromis(compromis));
  return parBien;
}

export async function listerCompromisPourAcquereur(acquereurId: string, workspaceId: string, executeur: Executeur = getDb()): Promise<Compromis[]> {
  if (!UUID_REGEX.test(acquereurId)) return [];
  const lignes = await executeur
    .select({ compromis: compromisTable })
    .from(compromisTable)
    .innerJoin(biensTable, eq(compromisTable.bienId, biensTable.id))
    .where(and(eq(compromisTable.acquereurId, acquereurId), eq(biensTable.workspaceId, workspaceId)))
    .orderBy(desc(compromisTable.dateSignature));
  return lignes.map((l) => ligneVersCompromis(l.compromis));
}

// Résolution directe, jamais filtrée par archivage — mais toujours par workspace.
export async function getCompromisById(id: string, workspaceId: string, executeur: Executeur = getDb()): Promise<Compromis | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select({ compromis: compromisTable })
    .from(compromisTable)
    .innerJoin(biensTable, eq(compromisTable.bienId, biensTable.id))
    .where(and(eq(compromisTable.id, id), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersCompromis(ligne.compromis) : undefined;
}

// Provenance Offre → Compromis (ADR-045/047) : `UNIQUE(offre_id)` garantit au plus une ligne ;
// lecture fail-closed conservée (une incohérence antérieure à la contrainte ne doit jamais être
// masquée).
export async function getCompromisParOffreId(offreId: string, workspaceId: string, executeur: Executeur = getDb()): Promise<Compromis | undefined> {
  if (!UUID_REGEX.test(offreId)) return undefined;
  const lignes = await executeur
    .select({ compromis: compromisTable })
    .from(compromisTable)
    .innerJoin(biensTable, eq(compromisTable.bienId, biensTable.id))
    .where(and(eq(compromisTable.offreId, offreId), eq(biensTable.workspaceId, workspaceId)));
  if (lignes.length === 0) return undefined;
  if (lignes.length > 1) {
    throw new Error(`Incohérence de données : ${lignes.length} compromis référencent l'offre ${offreId} (attendu au plus un).`);
  }
  return ligneVersCompromis(lignes[0].compromis);
}

// ───────────────────────────── CRÉATION ─────────────────────────────

export type NouveauCompromis = Omit<Compromis, "id" | "statut" | "creeLe" | "dateActeReelle" | "dateAnnulation" | "motifAnnulation">;

// PRIMITIVE BASSE d'insertion : aucune garde, aucun verrou, aucun événement, aucun jalon. Réservée
// à la composition de `creerCompromis` (le writer) et aux fixtures de test (lignes « telles
// qu'importées ») ; jamais un chemin produit (garde structurelle).
export async function enregistrerCompromis(input: NouveauCompromis, executeur: Executeur = getDb()): Promise<Compromis> {
  const [ligne] = await executeur
    .insert(compromisTable)
    .values({
      bienId: input.bienId,
      acquereurId: input.acquereurId,
      offreId: input.offreId ?? null,
      prixConvenu: input.prixConvenu,
      dateSignature: input.dateSignature,
      dateActe: input.dateActe ?? null,
    })
    .returning();
  return ligneVersCompromis(ligne);
}

export type ResultatCreationCompromis =
  | { statut: "cree"; compromis: Compromis; idsExecutionsATraiter: string[] }
  | { statut: "bien_introuvable" }
  | { statut: "acquereur_introuvable" }
  | { statut: "bien_archive" }
  | { statut: "acquereur_archive" }
  | { statut: "compromis_en_cours_existant" }
  | { statut: "offre_introuvable" }
  | { statut: "offre_autre_bien" }
  | { statut: "offre_incoherente" }
  | { statut: "offre_non_acceptee"; statutOffre: string }
  | { statut: "offre_deja_utilisee" };

// ADR-061 §13 — création SOUS VERROU DU BIEN (scoped, même racine que l'Offre) : les gardes
// « un seul en_cours par bien », « offre acceptée, même bien, même acquéreur, non déjà utilisée »
// sont relues sous verrou ; les contraintes ADR-047 restent le dernier filet, traduites en résultat
// typé. Le compromis direct sans offre (ADR-045) reste supporté. `biens.compromis_signe_le` est
// toujours posé ici (ADR-032, inchangé par ce lot) ; `compromis_signe` émis dans la transaction.
export async function creerCompromis(input: NouveauCompromis, workspaceId: string, executeur: Executeur = getDb()): Promise<ResultatCreationCompromis> {
  return executeur.transaction(async (tx) => {
    const bien = await verrouillerBienPourOffres(input.bienId, workspaceId, tx);
    if (bien.statut !== "verrouille") return { statut: "bien_introuvable" };
    const [acquereur] = await tx
      .select({ archiveLe: acquereursTable.archiveLe })
      .from(acquereursTable)
      .where(and(eq(acquereursTable.id, input.acquereurId), eq(acquereursTable.workspaceId, workspaceId)))
      .limit(1);
    if (!acquereur) return { statut: "acquereur_introuvable" };
    if (bien.archive) return { statut: "bien_archive" };
    if (acquereur.archiveLe) return { statut: "acquereur_archive" };

    const existants = await listerCompromisPourBien(input.bienId, workspaceId, tx);
    if (existants.some((c) => c.statut === "en_cours")) return { statut: "compromis_en_cours_existant" };

    if (input.offreId) {
      if (!UUID_REGEX.test(input.offreId)) return { statut: "offre_introuvable" };
      const [offre] = await tx.select().from(offresTable).where(eq(offresTable.id, input.offreId)).for("update");
      if (!offre) return { statut: "offre_introuvable" };
      if (offre.bienId !== input.bienId) return { statut: "offre_autre_bien" };
      if (offre.acquereurId !== input.acquereurId) return { statut: "offre_incoherente" };
      if (offre.statut !== "acceptee") return { statut: "offre_non_acceptee", statutOffre: offre.statut };
      if (await getCompromisParOffreId(input.offreId, workspaceId, tx)) return { statut: "offre_deja_utilisee" };
    }

    let compromis: Compromis;
    try {
      compromis = await enregistrerCompromis(input, tx);
    } catch (erreur) {
      const cause = erreur instanceof Error ? erreur.cause : undefined;
      if (cause && typeof cause === "object" && "constraint_name" in cause) {
        if (cause.constraint_name === "compromis_offre_id_unique") return { statut: "offre_deja_utilisee" };
        if (cause.constraint_name === "compromis_bien_id_en_cours_unique") return { statut: "compromis_en_cours_existant" };
      }
      throw erreur;
    }
    await marquerCompromisSigne(input.bienId, workspaceId, tx);
    const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions(
      { typeEvenement: "compromis_signe", compromisId: compromis.id },
      workspaceId,
      tx
    );
    return { statut: "cree", compromis, idsExecutionsATraiter };
  });
}

// ───────────────────────────── TRANSITIONS ─────────────────────────────

export type TransitionCompromis =
  | { statut: "realise"; dateActeReelle: string }
  | { statut: "annule"; dateAnnulation: string; motifAnnulation: MotifPerteHumain };

export type ResultatDecisionCompromis =
  | { statut: "decide"; compromis: Compromis; idsExecutionsATraiter: string[] }
  | { statut: "introuvable" }
  | { statut: "deja_finalise"; statutActuel: StatutCompromis }
  | { statut: "bien_archive" }
  | { statut: "acquereur_archive" };

// ADR-061 §13 — `realise` / `annule` depuis `en_cours` uniquement : verrou du bien (scoped) puis du
// compromis, `UPDATE … WHERE statut = 'en_cours'`, événement dans la transaction. L'annulation ne
// touche JAMAIS l'offre d'origine (ni réouverture, ni caducité) ni `biens.compromis_signe_le`.
export async function deciderCompromis(
  compromisId: string,
  transition: TransitionCompromis,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatDecisionCompromis> {
  if (!UUID_REGEX.test(compromisId)) return { statut: "introuvable" };
  return executeur.transaction(async (tx) => {
    const cible = await getCompromisById(compromisId, workspaceId, tx);
    if (!cible) return { statut: "introuvable" };
    const bien = await verrouillerBienPourOffres(cible.bienId, workspaceId, tx);
    if (bien.statut !== "verrouille") return { statut: "introuvable" };
    const [ligne] = await tx.select().from(compromisTable).where(eq(compromisTable.id, compromisId)).for("update");
    if (!ligne) return { statut: "introuvable" };
    const statutActuel = ligne.statut as StatutCompromis;
    if (statutActuel !== "en_cours") return { statut: "deja_finalise", statutActuel };
    if (bien.archive) return { statut: "bien_archive" };
    const [acquereur] = await tx
      .select({ archiveLe: acquereursTable.archiveLe })
      .from(acquereursTable)
      .where(eq(acquereursTable.id, ligne.acquereurId))
      .limit(1);
    if (acquereur?.archiveLe) return { statut: "acquereur_archive" };

    const modifie =
      transition.statut === "realise"
        ? await marquerCompromisRealise(compromisId, transition.dateActeReelle, tx)
        : await marquerCompromisAnnule(compromisId, transition.dateAnnulation, transition.motifAnnulation, tx);
    if (!modifie) return { statut: "deja_finalise", statutActuel };

    const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions(
      { typeEvenement: transition.statut === "realise" ? "compromis_realise" : "compromis_annule", compromisId },
      workspaceId,
      tx
    );
    return { statut: "decide", compromis: modifie, idsExecutionsATraiter };
  });
}

// PRIMITIVES BASSES de transition — UPDATE conditionnel `WHERE statut = 'en_cours'` (statut + date
// + motif posés ensemble, ADR-017/020), `undefined` si aucune ligne (déjà finalisé). Aucune garde
// métier, aucun verrou, aucun événement : réservées à `deciderCompromis` et aux fixtures de test —
// jamais un chemin produit (garde structurelle).
export async function marquerCompromisRealise(id: string, dateActeReelle: string, executeur: Executeur = getDb()): Promise<Compromis | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(compromisTable)
    .set({ statut: "realise", dateActeReelle })
    .where(and(eq(compromisTable.id, id), eq(compromisTable.statut, "en_cours")))
    .returning();
  return ligne ? ligneVersCompromis(ligne) : undefined;
}

export async function marquerCompromisAnnule(
  id: string,
  dateAnnulation: string,
  motifAnnulation: MotifPerte,
  executeur: Executeur = getDb()
): Promise<Compromis | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(compromisTable)
    .set({ statut: "annule", dateAnnulation, motifAnnulation })
    .where(and(eq(compromisTable.id, id), eq(compromisTable.statut, "en_cours")))
    .returning();
  return ligne ? ligneVersCompromis(ligne) : undefined;
}

// Modification de la date d'acte PRÉVUE (ADR-046) — jamais dateActeReelle ; uniquement `en_cours`,
// sous verrou, scoped. `undefined` efface explicitement la date.
export type ResultatModificationDateActe = { statut: "modifie"; compromis: Compromis } | { statut: "introuvable" } | { statut: "deja_finalise"; statutActuel: StatutCompromis } | { statut: "bien_archive" } | { statut: "acquereur_archive" };

export async function modifierDateActeCompromis(
  compromisId: string,
  dateActe: string | undefined,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatModificationDateActe> {
  if (!UUID_REGEX.test(compromisId)) return { statut: "introuvable" };
  return executeur.transaction(async (tx) => {
    const cible = await getCompromisById(compromisId, workspaceId, tx);
    if (!cible) return { statut: "introuvable" };
    const bien = await verrouillerBienPourOffres(cible.bienId, workspaceId, tx);
    if (bien.statut !== "verrouille") return { statut: "introuvable" };
    const [ligne] = await tx.select().from(compromisTable).where(eq(compromisTable.id, compromisId)).for("update");
    if (!ligne) return { statut: "introuvable" };
    if (ligne.statut !== "en_cours") return { statut: "deja_finalise", statutActuel: ligne.statut as StatutCompromis };
    if (bien.archive) return { statut: "bien_archive" };
    const [acquereur] = await tx
      .select({ archiveLe: acquereursTable.archiveLe })
      .from(acquereursTable)
      .where(eq(acquereursTable.id, ligne.acquereurId))
      .limit(1);
    if (acquereur?.archiveLe) return { statut: "acquereur_archive" };
    const [modifie] = await tx
      .update(compromisTable)
      .set({ dateActe: dateActe ?? null })
      .where(and(eq(compromisTable.id, compromisId), eq(compromisTable.statut, "en_cours")))
      .returning();
    if (!modifie) return { statut: "deja_finalise", statutActuel: ligne.statut as StatutCompromis };
    return { statut: "modifie", compromis: ligneVersCompromis(modifie) };
  });
}
