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
  bonsVisite,
  visites,
  mandats,
  partiesMandat,
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

  // PILOT_VISIT_SIGNATURE_E2E_V1 — depuis ADR-060, créer un bien avec un mandat actif crée aussi un
  // MANDAT CANONIQUE (`creerBien`). `mandats.bien_id` et `parties_mandat.mandat_id` sont sans
  // cascade : le nettoyage échouait sur `mandats_bien_id_biens_id_fk`. Comme pour les bons signés,
  // on respecte la contrainte en supprimant explicitement, dans l'ordre, plutôt que de l'affaiblir.
  let idsMandats: string[] = [];
  if (bienId) {
    idsMandats = (await db.select({ id: mandats.id }).from(mandats).where(eq(mandats.bienId, bienId))).map((m) => m.id);
    if (idsMandats.length > 0) {
      await db.delete(partiesMandat).where(inArray(partiesMandat.mandatId, idsMandats));
      conditionsBienOuAcquereur.push(inArray(evenementsMetier.mandatId, idsMandats));
    }
  }

  // PILOT_VISIT_SIGNATURE_E2E_V1 — `bon_visite_signe` (ADR-063) est le seul événement métier du
  // parcours qui ne porte NI `bien_id` NI `acquereur_id` : sa seule cible est `bon_visite_id`, et
  // cette colonne référence `bons_visite` en NO ACTION (src/db/schema.ts). La cascade
  // bien → visites → bons_visite est donc BLOQUÉE par cet événement, et le nettoyage échouait sur
  // une violation de FK dès qu'un bon avait été réellement signé.
  //
  // C'est exactement le `DELETE_PATH_MISSING` déjà nommé par ADR-069 : la contrainte est voulue
  // (un fait signé ne disparaît pas par effet de bord), on la respecte donc en supprimant
  // explicitement l'événement, jamais en affaiblissant la FK.
  let idsBonsVisite: string[] = [];
  if (bienId) {
    idsBonsVisite = (
      await db
        .select({ id: bonsVisite.id })
        .from(bonsVisite)
        .innerJoin(visites, eq(bonsVisite.visiteId, visites.id))
        .where(eq(visites.bienId, bienId))
    ).map((b) => b.id);
    if (idsBonsVisite.length > 0) {
      conditionsBienOuAcquereur.push(inArray(evenementsMetier.bonVisiteId, idsBonsVisite));
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

  // Les bons de visite partent AVANT le bien, et ce n'est pas un détail d'ordre : `documents_bien`
  // cascade depuis `biens`, et `bons_visite.document_id` est en SET NULL. Supprimer le bien d'abord
  // déclenche donc un UPDATE qui met `document_id` à NULL sur un bon SIGNÉ — refusé par
  // `bons_visite_coherence_statut_check` (un bon signé doit garder document, hash et date). La
  // suppression échouait exactement là, avec un « new row violates check constraint » sur un DELETE.
  //
  // C'est le `DELETE_PATH_MISSING` nommé par ADR-069, rencontré en vrai : la contrainte protège
  // l'intégrité d'un fait signé, on supprime donc dans l'ordre plutôt que de la contourner.
  // `signatures_bon_visite` cascade bien depuis `bons_visite`.
  if (idsBonsVisite.length > 0) await db.delete(bonsVisite).where(inArray(bonsVisite.id, idsBonsVisite));

  // Les mandats partent APRÈS les événements qui les référencent (`evenements_metier.mandat_id`,
  // NO ACTION) et AVANT le bien, dont ils bloquent la suppression.
  if (idsMandats.length > 0) await db.delete(mandats).where(inArray(mandats.id, idsMandats));

  // compromis/documentsBien/visites/comptesRendusVisite/offres/remuneration/taches cascadent tous
  // réellement sur biens/acquereurs (voir src/db/schema.ts) — un DELETE explicite du bien suffit.
  if (bienId) await db.delete(biens).where(eq(biens.id, bienId));
  if (acquereurId) await db.delete(acquereurs).where(eq(acquereurs.id, acquereurId));
}
