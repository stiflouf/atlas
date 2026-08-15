import { desc, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { comptesRendusVisite as comptesRendusVisiteTable } from "@/db/schema";
import type { CompteRenduVisite, Interet } from "@/types/compteRenduVisite";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneCompteRendu = typeof comptesRendusVisiteTable.$inferSelect;

function ligneVersCompteRendu(ligne: LigneCompteRendu): CompteRenduVisite {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    acquereurId: ligne.acquereurId,
    visiteId: ligne.visiteId ?? undefined,
    dateVisite: ligne.dateVisite,
    retour: ligne.retour,
    interet: ligne.interet as Interet,
    prochaineEtape: ligne.prochaineEtape ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Pas de repli mock : un compte rendu n'existe que pour un bien réel (FK uuid), il n'y a pas de
// dataset de démonstration équivalent à fabriquer. Un id non-UUID (bien mocké) ne peut
// correspondre à aucune ligne réelle : liste vide plutôt qu'une erreur de cast Postgres.
export async function listerComptesRendusPourBien(bienId: string): Promise<CompteRenduVisite[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(comptesRendusVisiteTable)
      .where(eq(comptesRendusVisiteTable.bienId, bienId))
      .orderBy(desc(comptesRendusVisiteTable.dateVisite));
    return lignes.map(ligneVersCompteRendu);
  } catch (erreur) {
    console.error("[comptes-rendus-visite] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// Résolution directe, jamais filtrée par archivage — nécessaire pour valider un lien offre <->
// visite (ADR-019) même si le bien/acquéreur a depuis été archivé.
export async function getCompteRenduVisiteById(id: string): Promise<CompteRenduVisite | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.id, id));
  return ligne ? ligneVersCompteRendu(ligne) : undefined;
}

// Lecture pour la fiche Visite (ADR-041) : un compte rendu créé sur une visite planifiee la
// référence via visite_id (ADR-040) — au plus un compte rendu par visite dans tous les chemins
// d'écriture actuels (une visite ne transite vers 'realisee' qu'une seule fois, gardée). `undefined`
// si aucun compte rendu n'a encore été créé (visite planifiee/annulee) ou si visiteId n'est pas un
// vrai UUID.
export async function getCompteRenduVisiteParVisiteId(visiteId: string): Promise<CompteRenduVisite | undefined> {
  if (!UUID_REGEX.test(visiteId)) return undefined;
  const [ligne] = await getDb().select().from(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.visiteId, visiteId));
  return ligne ? ligneVersCompteRendu(ligne) : undefined;
}

// Validation (retour non vide après trim, interet dans le vocabulaire contrôlé) déjà faite par
// l'appelant (server action) — insertion pure ici, même principe que les autres repositories.
export type NouveauCompteRendu = Omit<CompteRenduVisite, "id" | "creeLe">;

// `executeur` optionnel (ADR-032) : permet d'émettre l'événement métier `visite_realisee` dans la
// même transaction que cet enregistrement.
export async function enregistrerCompteRenduVisite(
  input: NouveauCompteRendu,
  executeur: Executeur = getDb()
): Promise<CompteRenduVisite> {
  const [ligne] = await executeur
    .insert(comptesRendusVisiteTable)
    .values({
      bienId: input.bienId,
      acquereurId: input.acquereurId,
      visiteId: input.visiteId ?? null,
      dateVisite: input.dateVisite,
      retour: input.retour,
      interet: input.interet,
      prochaineEtape: input.prochaineEtape ?? null,
    })
    .returning();
  return ligneVersCompteRendu(ligne);
}
