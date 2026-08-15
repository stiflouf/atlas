import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb, type Executeur } from "@/db/client";
import { configurationsAutomatisation, evenementsMetier, executionsAutomatisation } from "@/db/schema";
import { reglesPourTypeEvenement } from "./catalogueRegles";
import type { EvenementMetier, TypeEvenementMetier } from "@/types/automatisation";

type LigneEvenementMetier = typeof evenementsMetier.$inferSelect;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ligneVersEvenementMetier(ligne: LigneEvenementMetier): EvenementMetier {
  return {
    id: ligne.id,
    typeEvenement: ligne.typeEvenement as TypeEvenementMetier,
    compteRenduVisiteId: ligne.compteRenduVisiteId ?? undefined,
    prospectVendeurId: ligne.prospectVendeurId ?? undefined,
    compromisId: ligne.compromisId ?? undefined,
    ancreCycle: ligne.ancreCycle ? ligne.ancreCycle.toISOString() : undefined,
    bienId: ligne.bienId ?? undefined,
    acquereurId: ligne.acquereurId ?? undefined,
    cycleCompatibilite: ligne.cycleCompatibilite ?? undefined,
    survenuLe: ligne.survenuLe.toISOString(),
  };
}

// Discriminée par cible plutôt qu'un objet générique {type, id} : chaque type d'événement V1 a une
// seule cible possible, connue statiquement — évite une erreur de câblage (mauvaise colonne pour
// un type donné) qu'un couple générique ne détecterait qu'à l'exécution.
//
// 'inactivite_prospect_vendeur' (ADR-033) exige `ancreCycle` : c'est elle, pas prospectVendeurId
// seul, qui identifie l'occurrence (voir cibleIndex ci-dessous et l'index dédié, db/schema.ts).
export type NouvelEvenementMetier =
  | { typeEvenement: "visite_realisee"; compteRenduVisiteId: string }
  | { typeEvenement: "rdv_estimation_realise" | "mandat_signe"; prospectVendeurId: string }
  | { typeEvenement: "compromis_signe"; compromisId: string }
  | { typeEvenement: "inactivite_prospect_vendeur"; prospectVendeurId: string; ancreCycle: Date }
  | {
      typeEvenement: "compatibilite_bien_acquereur_devenue_compatible";
      bienId: string;
      acquereurId: string;
      cycleCompatibilite: number;
    };

export type ResultatEmissionEvenement = {
  // undefined si l'événement existait déjà (index unique partiel, double submit) — dans ce cas,
  // aucune exécution n'est jamais re-préparée : ce fait a déjà été traité une première fois.
  evenement: EvenementMetier | undefined;
  idsExecutionsATraiter: string[];
};

// Émet un événement métier ET fige l'activation des règles concernées (ADR-032, corrections n°1
// à 3) — DOIT être appelé avec un `executeur` ouvert dans LA MÊME transaction que la mutation
// métier déclenchante : l'événement et le snapshot des exécutions à traiter sont aussi durables
// que la mutation elle-même, jamais un trou entre les deux.
//
// `ON CONFLICT ... DO NOTHING` sur l'index unique partiel concerné (jamais un `throw` propagé) :
// un double submit produisant le même fait ne doit jamais faire échouer la mutation métier qui
// l'accompagne, il doit simplement ne rien dupliquer.
//
// L'activation des règles est lue ICI, au moment de l'événement (`configurations_automatisation`
// tel qu'il est maintenant) — jamais réévaluée plus tard : activer une règle après coup ne traite
// jamais rétroactivement les événements déjà survenus, faute de ligne d'exécution prévue pour eux.
export async function emettreEvenementEtPreparerExecutions(
  input: NouvelEvenementMetier,
  executeur: Executeur = getDb()
): Promise<ResultatEmissionEvenement> {
  const valeurs = {
    typeEvenement: input.typeEvenement,
    compteRenduVisiteId: "compteRenduVisiteId" in input ? input.compteRenduVisiteId : null,
    prospectVendeurId: "prospectVendeurId" in input ? input.prospectVendeurId : null,
    compromisId: "compromisId" in input ? input.compromisId : null,
    ancreCycle: "ancreCycle" in input ? input.ancreCycle : null,
    bienId: "bienId" in input ? input.bienId : null,
    acquereurId: "acquereurId" in input ? input.acquereurId : null,
    cycleCompatibilite: "cycleCompatibilite" in input ? input.cycleCompatibilite : null,
  };

  // Le `where` DOIT correspondre exactement au prédicat de l'index visé (inférence Postgres de
  // l'arbitre ON CONFLICT) — d'où la distinction explicite du type cyclique ici, jamais un simple
  // "IS NOT NULL" générique qui réutiliserait par erreur l'index ponctuel (ADR-033).
  const cibleIndex =
    "compteRenduVisiteId" in input
      ? { colonnes: [evenementsMetier.typeEvenement, evenementsMetier.compteRenduVisiteId], where: sql`${evenementsMetier.compteRenduVisiteId} IS NOT NULL` }
      : "compromisId" in input
        ? { colonnes: [evenementsMetier.typeEvenement, evenementsMetier.compromisId], where: sql`${evenementsMetier.compromisId} IS NOT NULL` }
        : input.typeEvenement === "compatibilite_bien_acquereur_devenue_compatible"
          ? {
              colonnes: [
                evenementsMetier.typeEvenement,
                evenementsMetier.bienId,
                evenementsMetier.acquereurId,
                evenementsMetier.cycleCompatibilite,
              ],
              where: sql`${evenementsMetier.typeEvenement} = 'compatibilite_bien_acquereur_devenue_compatible'`,
            }
          : input.typeEvenement === "inactivite_prospect_vendeur"
            ? {
                colonnes: [evenementsMetier.typeEvenement, evenementsMetier.prospectVendeurId, evenementsMetier.ancreCycle],
                where: sql`${evenementsMetier.typeEvenement} = 'inactivite_prospect_vendeur'`,
              }
            : {
                colonnes: [evenementsMetier.typeEvenement, evenementsMetier.prospectVendeurId],
                where: sql`${evenementsMetier.prospectVendeurId} IS NOT NULL AND ${evenementsMetier.typeEvenement} <> 'inactivite_prospect_vendeur'`,
              };

  const [ligne] = await executeur
    .insert(evenementsMetier)
    .values(valeurs)
    .onConflictDoNothing({
      target: cibleIndex.colonnes,
      where: cibleIndex.where,
    })
    .returning();

  if (!ligne) {
    // Ce fait précis a déjà été enregistré (double submit) — jamais un deuxième événement, jamais
    // une deuxième préparation d'exécutions.
    return { evenement: undefined, idsExecutionsATraiter: [] };
  }

  const evenement = ligneVersEvenementMetier(ligne);
  const reglesCandidates = reglesPourTypeEvenement(evenement.typeEvenement);
  if (reglesCandidates.length === 0) return { evenement, idsExecutionsATraiter: [] };

  const codes = reglesCandidates.map((r) => r.code);
  const configsActives = await executeur
    .select({ regleCode: configurationsAutomatisation.regleCode })
    .from(configurationsAutomatisation)
    .where(and(inArray(configurationsAutomatisation.regleCode, codes), eq(configurationsAutomatisation.active, true)));

  const idsExecutionsATraiter: string[] = [];
  for (const { regleCode } of configsActives) {
    const [execution] = await executeur
      .insert(executionsAutomatisation)
      .values({ regleCode, evenementId: evenement.id })
      .onConflictDoNothing({ target: [executionsAutomatisation.regleCode, executionsAutomatisation.evenementId] })
      .returning();
    if (execution) idsExecutionsATraiter.push(execution.id);
  }

  return { evenement, idsExecutionsATraiter };
}

export async function getEvenementMetierById(id: string): Promise<EvenementMetier | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(evenementsMetier).where(eq(evenementsMetier.id, id)).limit(1);
  return ligne ? ligneVersEvenementMetier(ligne) : undefined;
}
