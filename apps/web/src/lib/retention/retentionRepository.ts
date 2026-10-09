import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { biens, bonsVisite, runsRetention, visites } from "@/db/schema";
import type { CandidatBonVisiteRetention } from "./eligibilite";
import type { ModeRetention } from "./statutsRetention";

// RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — seul point de ce chantier qui parle à Postgres
// (convention ADR-007). Deux responsabilités, et rien d'autre :
//
//   1. LIRE le strict minimum nécessaire au calcul d'éligibilité ;
//   2. ÉCRIRE le journal de run de rétention — et uniquement lui.
//
// Aucune écriture sur une table métier, aucun DELETE, aucune écriture dans `actions_retention`
// (créée vide par ce lot, voir ADR-066). Un test structurel le vérifie plutôt que de s'en remettre
// à la relecture.

// MINIMISATION, et c'est le point central de cette fonction plutôt qu'un détail de performance :
// le calcul a besoin de l'identifiant, du périmètre, du statut et de la date de signature. Il n'a
// besoin ni du `contenu_snapshot` (qui porte l'adresse du bien, le nom du conseiller et le texte
// signé), ni des `*_snapshot` d'identité du signataire, ni de `hash_document`, ni d'aucune clé de
// stockage. Un `select()` sans projection les aurait tous ramenés en mémoire, pour rien — et un
// moteur de rétention est précisément le dernier endroit où charger des données personnelles dont
// on n'a pas l'usage.
//
// `bons_visite` ne porte pas `workspace_id` : c'est une FEUILLE (ADR-054 §7) et son appartenance se
// dérive par `visites -> biens`. La jointure n'est donc pas un raccourci de requête, c'est la seule
// preuve d'appartenance disponible, et elle doit rester dans le `WHERE` — un filtrage en mémoire
// après lecture aurait chargé les bons des autres workspaces avant de les écarter.
export async function listerCandidatsBonVisitePourRetention(
  workspaceId: string
): Promise<CandidatBonVisiteRetention[]> {
  const lignes = await getDb()
    .select({
      id: bonsVisite.id,
      statut: bonsVisite.statut,
      signeLe: bonsVisite.signeLe,
      workspaceId: biens.workspaceId,
    })
    .from(bonsVisite)
    .innerJoin(visites, eq(bonsVisite.visiteId, visites.id))
    .innerJoin(biens, eq(visites.bienId, biens.id))
    // `signe_le IS NOT NULL` plutôt que `statut = 'signe'` : le filtre porte sur le DÉCLENCHEUR de
    // la politique, pas sur un libellé. Une ligne au statut 'signe' sans date (incohérence que le
    // CHECK SQL interdit) doit rester visible du moteur pour y être BLOQUÉE, et c'est pourquoi le
    // statut n'est pas filtré ici mais évalué par le moteur pur.
    .where(and(eq(biens.workspaceId, workspaceId), isNotNull(bonsVisite.signeLe)));

  return lignes.map((ligne) => ({
    id: ligne.id,
    workspaceId: ligne.workspaceId,
    statut: ligne.statut,
    signeLe: ligne.signeLe ?? undefined,
  }));
}

// Journal à mutation contrôlée, même patron que `demarrerRunScanAutomatisation` (ADR-033) : la ligne
// est posée au début du balayage et complétée à la fin. Un run resté sans `termine_le` (crash en
// cours de route) reste honnêtement visible comme inachevé, plutôt qu'absent.
export async function demarrerRunRetention(workspaceId: string, mode: ModeRetention): Promise<string> {
  const [ligne] = await getDb()
    .insert(runsRetention)
    .values({ workspaceId, mode })
    .returning({ id: runsRetention.id });
  return ligne.id;
}

export async function terminerRunRetention(
  id: string,
  resultat: {
    nombrePolitiques: number;
    nombreEligibles: number;
    nombreBloquees: number;
    erreurTechnique?: string;
  }
): Promise<void> {
  await getDb()
    .update(runsRetention)
    .set({
      termineLe: new Date(),
      nombrePolitiques: resultat.nombrePolitiques,
      nombreEligibles: resultat.nombreEligibles,
      nombreBloquees: resultat.nombreBloquees,
      erreurTechnique: resultat.erreurTechnique ?? null,
    })
    .where(eq(runsRetention.id, id));
}
