import { and, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import {
  offreVisites as offreVisitesTable,
  offres as offresTable,
  comptesRendusVisite as comptesRendusVisiteTable,
} from "@/db/schema";
import type { OffreVisite } from "@/types/offreVisite";
import type { CompteRenduVisite, Interet } from "@/types/compteRenduVisite";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneLien = typeof offreVisitesTable.$inferSelect;
type LigneCompteRendu = typeof comptesRendusVisiteTable.$inferSelect;

function ligneVersLien(ligne: LigneLien): OffreVisite {
  return {
    id: ligne.id,
    offreId: ligne.offreId,
    compteRenduVisiteId: ligne.compteRenduVisiteId,
    creeLe: ligne.creeLe.toISOString(),
  };
}

function ligneVersCompteRendu(ligne: LigneCompteRendu): CompteRenduVisite {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    acquereurId: ligne.acquereurId,
    dateVisite: ligne.dateVisite,
    retour: ligne.retour,
    interet: ligne.interet as Interet,
    prochaineEtape: ligne.prochaineEtape ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Une seule requête (jointure offre_visites -> offres -> comptes_rendus_visite, filtrée sur le
// bien) plutôt qu'une requête par offre — la fiche bien affiche plusieurs offres à la fois,
// jamais de N+1 ici (même principe que les autres repositories "pourBien").
export async function listerLiensPourBien(
  bienId: string
): Promise<{ lienId: string; offreId: string; visite: CompteRenduVisite }[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await getDb()
      .select({ lien: offreVisitesTable, visite: comptesRendusVisiteTable })
      .from(offreVisitesTable)
      .innerJoin(offresTable, eq(offreVisitesTable.offreId, offresTable.id))
      .innerJoin(comptesRendusVisiteTable, eq(offreVisitesTable.compteRenduVisiteId, comptesRendusVisiteTable.id))
      .where(eq(offresTable.bienId, bienId));
    return lignes.map(({ lien, visite }) => ({
      lienId: lien.id,
      offreId: lien.offreId,
      visite: ligneVersCompteRendu(visite),
    }));
  } catch (erreur) {
    console.error("[offre-visites] lecture Postgres indisponible :", erreur);
    return [];
  }
}

export async function getLienOffreVisiteById(id: string): Promise<OffreVisite | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(offreVisitesTable).where(eq(offreVisitesTable.id, id));
  return ligne ? ligneVersLien(ligne) : undefined;
}

// Détection explicite d'un doublon avant insertion, pour un message d'erreur clair côté Server
// Action — la contrainte unique en base reste le dernier filet de sécurité (appel contourné,
// course entre deux requêtes).
export async function getLienOffreVisite(
  offreId: string,
  compteRenduVisiteId: string
): Promise<OffreVisite | undefined> {
  if (!UUID_REGEX.test(offreId) || !UUID_REGEX.test(compteRenduVisiteId)) return undefined;
  const [ligne] = await getDb()
    .select()
    .from(offreVisitesTable)
    .where(and(eq(offreVisitesTable.offreId, offreId), eq(offreVisitesTable.compteRenduVisiteId, compteRenduVisiteId)));
  return ligne ? ligneVersLien(ligne) : undefined;
}

// Validation (existence, correspondance bien/acquéreur, dateVisite <= dateOffre, absence de
// doublon) déjà faite par l'appelant — insertion pure ici, même principe que les autres
// repositories. `executeur` optionnel : permet d'appeler cette fonction à l'intérieur d'une
// transaction ouverte ailleurs (voir offreRepository.enregistrerOffreAvecLiensEtJalon).
export async function lierVisiteAOffre(
  offreId: string,
  compteRenduVisiteId: string,
  executeur: Executeur = getDb()
): Promise<OffreVisite> {
  const [ligne] = await executeur
    .insert(offreVisitesTable)
    .values({ offreId, compteRenduVisiteId })
    .returning();
  return ligneVersLien(ligne);
}

// Supprime uniquement la ligne de liaison — ne modifie jamais l'offre ni le compte rendu qu'elle
// reliait. Suppression physique volontaire (pas de flag "annulé") : contrairement à une visite ou
// une offre, un lien n'est pas un fait métier historique mais une annotation de rapprochement
// faite par Atlas ; la retirer ne réécrit aucune histoire.
export async function retirerLienVisiteOffre(id: string): Promise<void> {
  if (!UUID_REGEX.test(id)) return;
  await getDb().delete(offreVisitesTable).where(eq(offreVisitesTable.id, id));
}
