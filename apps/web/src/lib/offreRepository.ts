import { and, desc, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { offres as offresTable } from "@/db/schema";
import type { Offre, StatutOffre } from "@/types/offre";
import type { OffreVisite } from "@/types/offreVisite";
import type { MotifPerte } from "@/types/motifPerte";
import { lierVisiteAOffre } from "@/lib/offreVisiteRepository";
import { marquerOffreEnCours } from "@/lib/bienRepository";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneOffre = typeof offresTable.$inferSelect;

function ligneVersOffre(ligne: LigneOffre): Offre {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    acquereurId: ligne.acquereurId,
    montant: ligne.montant,
    dateOffre: ligne.dateOffre,
    statut: ligne.statut as StatutOffre,
    dateValidite: ligne.dateValidite ?? undefined,
    dateDecision: ligne.dateDecision ?? undefined,
    motifPerte: (ligne.motifPerte as MotifPerte | null) ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Pas de repli mock : une offre n'existe que pour un bien/acquéreur réels (FK uuid), il n'y a pas
// de dataset de démonstration équivalent à fabriquer. Un id non-UUID (bien/acquéreur mocké) ne
// peut correspondre à aucune ligne réelle : liste vide plutôt qu'une erreur de cast Postgres.
export async function listerOffresPourBien(bienId: string): Promise<Offre[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(offresTable)
      .where(eq(offresTable.bienId, bienId))
      .orderBy(desc(offresTable.dateOffre));
    return lignes.map(ligneVersOffre);
  } catch (erreur) {
    console.error("[offres] lecture Postgres indisponible :", erreur);
    return [];
  }
}

export async function listerOffresPourAcquereur(acquereurId: string): Promise<Offre[]> {
  if (!UUID_REGEX.test(acquereurId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(offresTable)
      .where(eq(offresTable.acquereurId, acquereurId))
      .orderBy(desc(offresTable.dateOffre));
    return lignes.map(ligneVersOffre);
  } catch (erreur) {
    console.error("[offres] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// Détection de doublon accidentel (ADR-044 §17-21) : offres 'en_cours' pour EXACTEMENT cette paire
// bien/acquéreur — jamais un blocage définitif (le modèle autorise plusieurs offres 'en_cours'
// pour la même paire après confirmation explicite du conseiller, une nouvelle proposition restant
// toujours une nouvelle ligne, jamais une modification de l'ancienne). Utilisée à la fois pour
// l'avertissement affiché côté client et pour la revalidation côté serveur dans
// ajouterOffreAction — jamais une confiance aveugle dans le résultat client.
export async function listerOffresEnCoursPourPaire(bienId: string, acquereurId: string): Promise<Offre[]> {
  if (!UUID_REGEX.test(bienId) || !UUID_REGEX.test(acquereurId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(offresTable)
      .where(and(eq(offresTable.bienId, bienId), eq(offresTable.acquereurId, acquereurId), eq(offresTable.statut, "en_cours")))
      .orderBy(desc(offresTable.dateOffre));
    return lignes.map(ligneVersOffre);
  } catch (erreur) {
    console.error("[offres] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// Résolution directe, jamais filtrée par archivage — nécessaire pour que changerStatutOffreAction
// retrouve le bien/acquéreur d'une offre avant de vérifier leur statut d'archivage.
export async function getOffreById(id: string): Promise<Offre | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  try {
    const [ligne] = await getDb().select().from(offresTable).where(eq(offresTable.id, id));
    return ligne ? ligneVersOffre(ligne) : undefined;
  } catch (erreur) {
    console.error("[offres] lecture Postgres indisponible :", erreur);
    return undefined;
  }
}

// Validation (montant > 0, bien/acquéreur non archivés) déjà faite par l'appelant (server
// action) — insertion pure ici, même principe que les autres repositories.
export type NouvelleOffre = Omit<Offre, "id" | "statut" | "creeLe">;

// `executeur` optionnel : permet d'appeler cette fonction à l'intérieur d'une transaction ouverte
// ailleurs (voir enregistrerOffreAvecLiensEtJalon ci-dessous, ADR-019).
export async function enregistrerOffre(input: NouvelleOffre, executeur: Executeur = getDb()): Promise<Offre> {
  const [ligne] = await executeur
    .insert(offresTable)
    .values({
      bienId: input.bienId,
      acquereurId: input.acquereurId,
      montant: input.montant,
      dateOffre: input.dateOffre,
      dateValidite: input.dateValidite ?? null,
    })
    .returning();
  return ligneVersOffre(ligne);
}

// Geste conseiller complet (ADR-015/ADR-019) : créer l'offre, lier les visites explicitement
// désignées, poser le jalon offreEnCoursLe — les trois dans une seule transaction, pour ne
// jamais laisser une offre "orpheline" de ses visites annoncées ou du jalon associé si l'une des
// trois écritures échoue. Compose des fonctions d'autres repositories (bienRepository,
// offreVisiteRepository) en leur passant le même `tx` — première composition inter-repositories
// du projet, volontaire ici plutôt que de dupliquer leur logique d'écriture ou de faire porter la
// transaction par la Server Action (ADR-007 : seuls les repositories parlent à Postgres).
// Validation (existence/correspondance bien-acquéreur/date des comptes rendus) déjà faite par
// l'appelant — écriture pure ici, même principe que les autres repositories.
export async function enregistrerOffreAvecLiensEtJalon(
  input: NouvelleOffre,
  compteRenduVisiteIds: string[]
): Promise<{ offre: Offre; liens: OffreVisite[] }> {
  return getDb().transaction(async (tx) => {
    const offre = await enregistrerOffre(input, tx);
    const liens: OffreVisite[] = [];
    for (const compteRenduVisiteId of compteRenduVisiteIds) {
      liens.push(await lierVisiteAOffre(offre.id, compteRenduVisiteId, tx));
    }
    await marquerOffreEnCours(offre.bienId, tx);
    return { offre, liens };
  });
}

// Type discriminé (ADR-020) plutôt que des paramètres optionnels plats : rend l'état "motifPerte
// renseigné pour une offre acceptee" irreprésentable à la compilation, pas seulement vérifié à
// l'exécution — dateDecision obligatoire pour les trois transitions finales, motifPerte
// obligatoire uniquement pour refusee/retiree, absent pour acceptee.
export type TransitionFinaleOffre =
  | { statut: "acceptee"; dateDecision: string }
  | { statut: "refusee" | "retiree"; dateDecision: string; motifPerte: MotifPerte };

// UPDATE atomique (statut + dateDecision + motifPerte ensemble, même principe que
// marquerCompromisRealise) — aucune garde métier interne (bien/acquéreur archivés, offre déjà
// dans un statut final) : même séparation que le reste du fichier, la garde vit dans la Server
// Action.
export async function changerStatutOffre(id: string, transition: TransitionFinaleOffre): Promise<Offre | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(offresTable)
    .set({
      statut: transition.statut,
      dateDecision: transition.dateDecision,
      motifPerte: transition.statut === "acceptee" ? null : transition.motifPerte,
    })
    .where(eq(offresTable.id, id))
    .returning();
  return ligne ? ligneVersOffre(ligne) : undefined;
}
