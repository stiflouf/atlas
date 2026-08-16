import { desc, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { compromis as compromisTable } from "@/db/schema";
import type { Compromis, StatutCompromis } from "@/types/compromis";
import type { MotifPerte } from "@/types/motifPerte";

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

// Pas de repli mock : un compromis n'existe que pour un bien/acquéreur réels (FK uuid), il n'y a
// pas de dataset de démonstration équivalent à fabriquer. Un id non-UUID (bien/acquéreur mocké)
// ne peut correspondre à aucune ligne réelle : liste vide plutôt qu'une erreur de cast Postgres.
export async function listerCompromisPourBien(bienId: string): Promise<Compromis[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(compromisTable)
      .where(eq(compromisTable.bienId, bienId))
      .orderBy(desc(compromisTable.dateSignature));
    return lignes.map(ligneVersCompromis);
  } catch (erreur) {
    console.error("[compromis] lecture Postgres indisponible :", erreur);
    return [];
  }
}

export async function listerCompromisPourAcquereur(acquereurId: string): Promise<Compromis[]> {
  if (!UUID_REGEX.test(acquereurId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(compromisTable)
      .where(eq(compromisTable.acquereurId, acquereurId))
      .orderBy(desc(compromisTable.dateSignature));
    return lignes.map(ligneVersCompromis);
  } catch (erreur) {
    console.error("[compromis] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// Résolution directe, jamais filtrée par archivage — nécessaire pour que
// changerStatutCompromisAction retrouve le bien/acquéreur avant de vérifier leur archivage.
export async function getCompromisById(id: string): Promise<Compromis | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  try {
    const [ligne] = await getDb().select().from(compromisTable).where(eq(compromisTable.id, id));
    return ligne ? ligneVersCompromis(ligne) : undefined;
  } catch (erreur) {
    console.error("[compromis] lecture Postgres indisponible :", erreur);
    return undefined;
  }
}

// Provenance Offre -> Compromis (ADR-045) : en V1, une Offre acceptée ne peut être l'origine
// structurée d'au plus un Compromis — garde purement applicative, aucun UNIQUE(offre_id) en base
// (décision explicite ADR-045, même choix qu'ADR-043 pour tache_id : la garantie vit dans
// ajouterCompromisAction, pas dans une contrainte SQL). Lecture fail-closed, jamais un `rows[0]`
// silencieux : 0 ligne -> `undefined` (offre disponible) ; exactement 1 -> retournée ; plus d'1 ->
// exception explicite (incohérence historique, ne devrait structurellement jamais arriver tant que
// la garde applicative est respectée, mais ne doit jamais être masquée si elle survient).
export async function getCompromisParOffreId(offreId: string): Promise<Compromis | undefined> {
  if (!UUID_REGEX.test(offreId)) return undefined;
  const lignes = await getDb().select().from(compromisTable).where(eq(compromisTable.offreId, offreId));
  if (lignes.length === 0) return undefined;
  if (lignes.length > 1) {
    throw new Error(`Incohérence de données : ${lignes.length} compromis référencent l'offre ${offreId} (attendu au plus un).`);
  }
  return ligneVersCompromis(lignes[0]);
}

// Validation (bien/acquéreur non archivés, cohérence de l'offre liée, un seul en_cours par bien)
// déjà faite par l'appelant (server action) — insertion pure ici, même principe que les autres
// repositories.
export type NouveauCompromis = Omit<Compromis, "id" | "statut" | "creeLe">;

// `executeur` optionnel (ADR-032) : permet d'émettre l'événement métier `compromis_signe` et de
// poser `biens.compromisSigneLe` dans la même transaction que cet enregistrement — corrige au
// passage l'absence d'atomicité entre les deux écritures dans `ajouterCompromisAction`.
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

// Écriture atomique dédiée à la transition 'annule' (ADR-020, symétrique à
// marquerCompromisRealise) : statut, dateAnnulation et motifAnnulation posés dans le même UPDATE —
// jamais de fenêtre où le compromis serait 'annule' sans date ni motif. dateActeReelle n'est
// jamais touchée ici (réservée à 'realise'). Aucune garde métier interne (transitions autorisées,
// archivage) : même séparation que le reste du fichier.
export async function marquerCompromisAnnule(
  id: string,
  dateAnnulation: string,
  motifAnnulation: MotifPerte
): Promise<Compromis | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(compromisTable)
    .set({ statut: "annule", dateAnnulation, motifAnnulation })
    .where(eq(compromisTable.id, id))
    .returning();
  return ligne ? ligneVersCompromis(ligne) : undefined;
}

// Modification de la date d'acte PRÉVUE (ADR-046) — jamais dateActeReelle (constatée, ADR-017,
// posée uniquement par marquerCompromisRealise). Insertion pure, aucune garde métier interne (le
// statut 'en_cours' est vérifié par la Server Action appelante, même séparation que le reste de ce
// fichier) : cette fonction accepte `undefined` pour effacer explicitement une date devenue
// obsolète (report sans nouvelle date connue) — jamais une estimation inventée pour combler NULL.
export async function modifierDateActeCompromis(id: string, dateActe: string | undefined): Promise<Compromis | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(compromisTable)
    .set({ dateActe: dateActe ?? null })
    .where(eq(compromisTable.id, id))
    .returning();
  return ligne ? ligneVersCompromis(ligne) : undefined;
}

// Écriture atomique dédiée à la transition 'realise' (ADR-017) : statut et dateActeReelle posés
// dans le même UPDATE, jamais deux écritures séparées — aucune fenêtre où le compromis serait
// 'realise' sans dateActeReelle. dateActe (prévue) n'est jamais touchée ici.
export async function marquerCompromisRealise(id: string, dateActeReelle: string): Promise<Compromis | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(compromisTable)
    .set({ statut: "realise", dateActeReelle })
    .where(eq(compromisTable.id, id))
    .returning();
  return ligne ? ligneVersCompromis(ligne) : undefined;
}
