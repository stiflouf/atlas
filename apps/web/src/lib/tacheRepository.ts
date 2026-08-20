import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { taches as tachesTable } from "@/db/schema";
import { tachesMetier as tachesDemo } from "@/data/taches";
import type { CibleTache, OrigineTache, PrioriteTache, Tache, TypeTache } from "@/types/tache";

type LigneTache = typeof tachesTable.$inferSelect;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bugfix pilote : le repli mock ci-dessous ne doit jamais atteindre la production (des id non-UUID
// comme "tache-001" y sont inutilisables comme FK réelle — voir la contamination Postgres
// SQLSTATE 22P02 constatée). Hors production (dev/tests), comportement historique inchangé.
function estProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// NULL Postgres -> undefined métier, jamais interprété comme false/"aucun" — même principe que
// bienRepository.ts.
function ligneVersTache(ligne: LigneTache): Tache {
  return {
    id: ligne.id,
    titre: ligne.titre,
    contexte: ligne.contexte ?? undefined,
    type: ligne.type as TypeTache,
    priorite: ligne.priorite as PrioriteTache,
    echeance: ligne.echeance ?? undefined,
    origine: ligne.origine as OrigineTache,
    origineCode: ligne.origineCode ?? undefined,
    bienId: ligne.bienId ?? undefined,
    acquereurId: ligne.acquereurId ?? undefined,
    prospectVendeurId: ligne.prospectVendeurId ?? undefined,
    visiteId: ligne.visiteId ?? undefined,
    offreId: ligne.offreId ?? undefined,
    compromisId: ligne.compromisId ?? undefined,
    remunerationId: ligne.remunerationId ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    termineeLe: ligne.termineeLe?.toISOString(),
    annuleeLe: ligne.annuleeLe?.toISOString(),
  };
}

// Tâches réelles si au moins une existe, sinon les tâches de démonstration — jamais un mélange,
// même principe que listerBiens()/listerClients(). Repli mock désactivé en production (voir
// estProduction ci-dessus) : une DB vide y rend un tableau vide, un vrai état vide, jamais fictif.
export async function listerTaches(): Promise<Tache[]> {
  try {
    const lignes = await getDb().select().from(tachesTable);
    if (lignes.length > 0) return lignes.map(ligneVersTache);
  } catch (erreur) {
    console.error("[taches] lecture Postgres indisponible :", erreur);
    if (estProduction()) throw erreur;
    return tachesDemo;
  }
  if (estProduction()) return [];
  return tachesDemo;
}

// bien/acquéreur peuvent encore être mockés (id non-UUID) tant que la bascule démo->réel n'est pas
// complète pour ces catalogues — filtrage sur listerTaches() (avec repli mock) plutôt qu'une
// requête directe, même principe que l'ancien getActionsPourBien/getActionsPourAcquereur.
export async function getTachesPourBien(bienId: string): Promise<Tache[]> {
  const toutes = await listerTaches();
  return toutes.filter((t) => t.bienId === bienId);
}

export async function getTachesPourAcquereur(acquereurId: string): Promise<Tache[]> {
  const toutes = await listerTaches();
  return toutes.filter((t) => t.acquereurId === acquereurId);
}

// Un prospect vendeur n'a jamais de catalogue mocké (ADR-027) : requête directe, même patron que
// listerNotesProspectVendeur, pas de repli sur listerTaches().
export async function getTachesPourProspectVendeur(prospectVendeurId: string): Promise<Tache[]> {
  if (!UUID_REGEX.test(prospectVendeurId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(tachesTable)
      .where(eq(tachesTable.prospectVendeurId, prospectVendeurId));
    return lignes.map(ligneVersTache);
  } catch (erreur) {
    console.error("[taches] lecture Postgres indisponible :", erreur);
    return [];
  }
}

export async function getTacheById(id: string): Promise<Tache | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  try {
    const [ligne] = await getDb().select().from(tachesTable).where(eq(tachesTable.id, id));
    return ligne ? ligneVersTache(ligne) : undefined;
  } catch (erreur) {
    console.error("[taches] lecture Postgres indisponible :", erreur);
    return undefined;
  }
}

// { type, id } générique en entrée (CibleTache, ADR-028) traduit ici vers la seule colonne dédiée
// concernée — jamais stocké sous cette forme générique, uniquement une commodité d'appel pour les
// Server Actions qui manipulent une cible choisie dynamiquement (ex. /taches/nouveau).
export type NouvelleTache = Omit<
  Tache,
  "id" | "creeLe" | "termineeLe" | "annuleeLe" | "bienId" | "acquereurId" | "prospectVendeurId" | "visiteId" | "offreId" | "compromisId" | "remunerationId"
> & { cible?: CibleTache };

// Insertion pure : la validation métier (titre non vide, au plus une cible, archivage, etc.) est
// de la responsabilité de l'appelant (Server Action), pas de ce repository. `executeur` optionnel
// (même principe que bienRepository.creerBien, ADR-019) : permet au moteur d'automatisations
// (ADR-032) de créer la tâche dans la même transaction que la pose de reussieLe sur l'exécution.
export async function creerTache(input: NouvelleTache, executeur: Executeur = getDb()): Promise<Tache> {
  const [ligne] = await executeur
    .insert(tachesTable)
    .values({
      titre: input.titre,
      contexte: input.contexte ?? null,
      type: input.type,
      priorite: input.priorite,
      echeance: input.echeance ?? null,
      origine: input.origine,
      origineCode: input.origineCode ?? null,
      bienId: input.cible?.type === "bien" ? input.cible.id : null,
      acquereurId: input.cible?.type === "acquereur" ? input.cible.id : null,
      prospectVendeurId: input.cible?.type === "prospectVendeur" ? input.cible.id : null,
      visiteId: input.cible?.type === "visite" ? input.cible.id : null,
      offreId: input.cible?.type === "offre" ? input.cible.id : null,
      compromisId: input.cible?.type === "compromis" ? input.cible.id : null,
      remunerationId: input.cible?.type === "remuneration" ? input.cible.id : null,
    })
    .returning();
  return ligneVersTache(ligne);
}

// Écritures atomiques dédiées, gel concurrent (même patron que marquerCompromisRealise/
// marquerRemunerationEncaissee, ADR-016/021) : termineeLe et annuleeLe ne sont jamais posés si
// l'autre l'est déjà — la clause WHERE fait échouer l'UPDATE (0 ligne, retour undefined) plutôt que
// d'écraser silencieusement une transition déjà actée.
export async function terminerTache(id: string): Promise<Tache | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(tachesTable)
    .set({ termineeLe: new Date() })
    .where(and(eq(tachesTable.id, id), isNull(tachesTable.termineeLe), isNull(tachesTable.annuleeLe)))
    .returning();
  return ligne ? ligneVersTache(ligne) : undefined;
}

export async function annulerTache(id: string): Promise<Tache | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(tachesTable)
    .set({ annuleeLe: new Date() })
    .where(and(eq(tachesTable.id, id), isNull(tachesTable.termineeLe), isNull(tachesTable.annuleeLe)))
    .returning();
  return ligne ? ligneVersTache(ligne) : undefined;
}
