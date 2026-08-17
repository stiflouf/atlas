// Nettoyage post-smoke (audit V1 Candidate, §30) — un Bien/Acquéreur créé via le vrai parcours UI
// déclenche des effets réels (émission d'événements métier ADR-032, file de resynchronisation de
// compatibilité ADR-036) qui référencent biens/acquereurs/compromis en NO ACTION (jamais un
// cascade) : ce module centralise l'ordre de purge complet plutôt que de le dupliquer dans chaque
// spec. Respecte les FK plutôt que de les affaiblir pour faciliter le nettoyage (§30, dernière
// ligne).
import { eq, or, inArray, type SQL } from "drizzle-orm";
import { getDb } from "../src/db/client";
import {
  biens,
  acquereurs,
  compromis,
  transmissionsDossierNotaire,
  evenementsMetier,
  executionsAutomatisation,
  compatibilitesBienAcquereurEtat,
  compatibilitesARessynchroniser,
} from "../src/db/schema";

export async function nettoyerDonneesE2E(cibles: { bienId?: string; acquereurId?: string }): Promise<void> {
  const { bienId, acquereurId } = cibles;
  const db = getDb();

  const conditionsBienOuAcquereur: SQL[] = [];
  if (bienId) conditionsBienOuAcquereur.push(eq(evenementsMetier.bienId, bienId));
  if (acquereurId) conditionsBienOuAcquereur.push(eq(evenementsMetier.acquereurId, acquereurId));

  if (bienId) {
    const idsCompromis = (await db.select({ id: compromis.id }).from(compromis).where(eq(compromis.bienId, bienId))).map(
      (c) => c.id
    );
    if (idsCompromis.length > 0) {
      await db.delete(transmissionsDossierNotaire).where(inArray(transmissionsDossierNotaire.compromisId, idsCompromis));
      conditionsBienOuAcquereur.push(inArray(evenementsMetier.compromisId, idsCompromis));
    }
  }

  if (conditionsBienOuAcquereur.length > 0) {
    const idsEvenements = (
      await db.select({ id: evenementsMetier.id }).from(evenementsMetier).where(or(...conditionsBienOuAcquereur))
    ).map((e) => e.id);
    if (idsEvenements.length > 0) {
      await db.delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvenements));
    }
    await db.delete(evenementsMetier).where(or(...conditionsBienOuAcquereur));
  }

  const conditionsCompat: SQL[] = [];
  if (bienId) conditionsCompat.push(eq(compatibilitesBienAcquereurEtat.bienId, bienId));
  if (acquereurId) conditionsCompat.push(eq(compatibilitesBienAcquereurEtat.acquereurId, acquereurId));
  if (conditionsCompat.length > 0) {
    await db.delete(compatibilitesBienAcquereurEtat).where(or(...conditionsCompat));
  }

  const conditionsResync: SQL[] = [];
  if (bienId) conditionsResync.push(eq(compatibilitesARessynchroniser.bienId, bienId));
  if (acquereurId) conditionsResync.push(eq(compatibilitesARessynchroniser.acquereurId, acquereurId));
  if (conditionsResync.length > 0) {
    await db.delete(compatibilitesARessynchroniser).where(or(...conditionsResync));
  }

  // compromis/documentsBien/visites/comptesRendusVisite/offres/remuneration/taches cascadent tous
  // réellement sur biens/acquereurs (voir src/db/schema.ts) — un DELETE explicite du bien suffit.
  if (bienId) await db.delete(biens).where(eq(biens.id, bienId));
  if (acquereurId) await db.delete(acquereurs).where(eq(acquereurs.id, acquereurId));
}
