import { inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { evenementsMetier, executionsAutomatisation } from "@/db/schema";

// Destiné aux TESTS uniquement (même précédent que le raccourci de workspace de test) : depuis ADR-061, les
// événements `offre_*` référencent `offres` par une FK NO ACTION (journal append-only) — une
// fixture qui supprime ses offres doit d'abord retirer leurs événements et exécutions. Jamais
// appelé par le produit : rien n'y supprime un événement.
export async function supprimerEvenementsDeTestPourOffres(offreIds: string[]): Promise<void> {
  if (offreIds.length === 0) return;
  const evenements = await getDb()
    .select({ id: evenementsMetier.id })
    .from(evenementsMetier)
    .where(inArray(evenementsMetier.offreId, offreIds));
  const ids = evenements.map((e) => e.id);
  if (ids.length === 0) return;
  await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, ids));
  await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, ids));
}
