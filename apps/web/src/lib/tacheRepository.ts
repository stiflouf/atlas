import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { taches as tachesTable } from "@/db/schema";
import { verrouillerContactActif } from "@/lib/contactActif";
import { tachesMetier as tachesDemo } from "@/data/taches";
import type { CodeRegleAutomatisation } from "@/types/automatisation";
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
    visiteCanoniqueId: ligne.visiteCanoniqueId ?? undefined,
    contactId: ligne.contactId ?? undefined,
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

// WORKSPACE_SCOPING_V2B2 (ADR-054) — LA lecture d'ensemble des tâches pour une surface
// UTILISATEUR (l'écran Aujourd'hui et ses compteurs). `taches` est une table racine : le périmètre
// est une colonne. Aucun repli de démonstration : un workspace sans tâche en a zéro.
export async function listerTachesDuWorkspace(workspaceId: string): Promise<Tache[]> {
  try {
    const lignes = await getDb().select().from(tachesTable).where(eq(tachesTable.workspaceId, workspaceId));
    return lignes.map(ligneVersTache);
  } catch (erreur) {
    console.error("[taches] lecture Postgres indisponible :", erreur);
    return [];
  }
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

// WORKSPACE_SCOPING_V2C2 — les tâches d'UN bien, dans le périmètre de session. `getTachesPourBien`
// ci-dessus lisait la table entière avant de filtrer en mémoire : le résultat était juste (une
// tâche ne porte qu'un bien), mais le `SELECT` ne l'était pas, et une surface utilisateur n'a
// aucune raison de faire traverser un catalogue trans-workspace à son processus. Même patron que
// `getTachesPourProspectVendeur` : requête directe, aucun repli mock — un bien mocké n'a pas de
// tâche persistée, et sa fiche n'est de toute façon plus atteignable depuis un workspace.
export async function listerTachesDuBienDuWorkspace(bienId: string, workspaceId: string): Promise<Tache[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(tachesTable)
      .where(and(eq(tachesTable.bienId, bienId), eq(tachesTable.workspaceId, workspaceId)));
    return lignes.map(ligneVersTache);
  } catch (erreur) {
    console.error("[taches] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// WORKSPACE_SCOPING_V2D1 — pendant exact du lecteur par bien ci-dessus, pour l'acquéreur. Même
// raison : `getTachesPourAcquereur` lit la table entière avant de filtrer en mémoire, ce qu'une
// surface utilisateur n'a aucune raison de faire. Le lecteur global reste pour ses appelants
// legacy (fiche Visite, action de prochaine étape), qui ne relèvent pas de ce lot.
export async function listerTachesDeLAcquereurDuWorkspace(acquereurId: string, workspaceId: string): Promise<Tache[]> {
  if (!UUID_REGEX.test(acquereurId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(tachesTable)
      .where(and(eq(tachesTable.acquereurId, acquereurId), eq(tachesTable.workspaceId, workspaceId)));
    return lignes.map(ligneVersTache);
  } catch (erreur) {
    console.error("[taches] lecture Postgres indisponible :", erreur);
    return [];
  }
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

// WORKSPACE_SCOPING_V2B1 — enrichissement de la liste /prospects-vendeurs : UNE requête pour tous
// les prospects affichés, scopée par le périmètre, au lieu d'une requête par ligne. Avant ce lot,
// la page appelait `getTachesPourProspectVendeur` dans une boucle, sans périmètre : les libellés
// de tâches d'un autre workspace s'affichaient sur ses lignes.
export async function listerTachesParProspectVendeurDuWorkspace(
  prospectVendeurIds: string[],
  workspaceId: string
): Promise<Map<string, Tache[]>> {
  const ids = prospectVendeurIds.filter((id) => UUID_REGEX.test(id));
  const parProspect = new Map<string, Tache[]>();
  if (ids.length === 0) return parProspect;
  try {
    const lignes = await getDb()
      .select()
      .from(tachesTable)
      .where(and(inArray(tachesTable.prospectVendeurId, ids), eq(tachesTable.workspaceId, workspaceId)));
    for (const ligne of lignes) {
      const tache = ligneVersTache(ligne);
      if (!tache.prospectVendeurId) continue;
      const deja = parProspect.get(tache.prospectVendeurId);
      if (deja) deja.push(tache);
      else parProspect.set(tache.prospectVendeurId, [tache]);
    }
  } catch (erreur) {
    console.error("[taches] lecture Postgres indisponible :", erreur);
  }
  return parProspect;
}

// WORKSPACE_SCOPING_V1 — `taches` est une table RACINE : le périmètre est une colonne, le filtre
// tient dans le `WHERE`. À utiliser dès que l'identifiant vient du client (FormData « Terminer »,
// « Annuler »). Hors périmètre = introuvable.
export async function getTacheDuWorkspace(
  id: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Tache | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  try {
    const [ligne] = await executeur
      .select()
      .from(tachesTable)
      .where(and(eq(tachesTable.id, id), eq(tachesTable.workspaceId, workspaceId)))
      .limit(1);
    return ligne ? ligneVersTache(ligne) : undefined;
  } catch (erreur) {
    console.error("[taches] lecture Postgres indisponible :", erreur);
    return undefined;
  }
}

// INTERNE / NON SCOPÉ — préférer `getTacheDuWorkspace` pour tout id venant du client.
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
  | "id"
  | "creeLe"
  | "termineeLe"
  | "annuleeLe"
  | "bienId"
  | "acquereurId"
  | "prospectVendeurId"
  | "visiteId"
  | "offreId"
  | "compromisId"
  | "remunerationId"
  | "visiteCanoniqueId"
  | "contactId"
> & { cible?: CibleTache };

// Insertion pure : la validation métier (titre non vide, au plus une cible, archivage, etc.) est
// de la responsabilité de l'appelant (Server Action), pas de ce repository. `executeur` optionnel
// (même principe que bienRepository.creerBien, ADR-019) : permet au moteur d'automatisations
// (ADR-032) de créer la tâche dans la même transaction que la pose de reussieLe sur l'exécution.
// ADR-054 — `workspaceId` est un paramètre OBLIGATOIRE, jamais une valeur que ce repository
// choisirait : il vient du contexte authentifié (`exigerWorkspaceCourant()`) ou du contexte
// d'exécution machine (`resoudreWorkspaceExecutionMachine()`). Aucun repli, aucun `?? "default"` —
// la migration 0033 a retiré le DEFAULT SQL précisément pour qu'un oubli échoue immédiatement au
// lieu d'être silencieusement rangé dans le workspace historique.
export async function creerTache(
  input: NouvelleTache,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Tache> {
  const [ligne] = await executeur
    .insert(tachesTable)
    .values({
      workspaceId,
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
      visiteCanoniqueId: input.cible?.type === "visiteCanonique" ? input.cible.id : null,
      contactId: input.cible?.type === "contact" ? input.cible.id : null,
    })
    .returning();
  return ligneVersTache(ligne);
}

// TASK_CONTACT_TARGET_V1 (ADR-064) — créer une tâche CIBLANT UN CONTACT, avec sa garde, dans UNE
// transaction.
//
// `creerTache` ci-dessus reste une insertion pure et le restera : ce qui est différent ici, c'est
// qu'un contact possède un état — ACTIF ou ABSORBÉ (ADR-059) — et qu'une tâche est une donnée
// vivante. Rattacher une intention future à une personne dont l'historique continue ailleurs
// (ADR-059 §10) produirait une tâche qui prépare un email vers une identité périmée.
//
// La garde est `verrouillerContactActif`, la primitive partagée par tous les writers qui reçoivent
// un `contact_id` — jamais une relecture maison : elle lit la ligne SOUS VERROU dans NOTRE
// transaction, ce qui sérialise cette création avec le moteur de fusion. Une lecture nue suivie d'un
// INSERT laisserait la course ouverte (la fusion pourrait se commettre entre les deux).
//
// Elle ne suit JAMAIS la chaîne de fusion : un conseiller qui choisit B et découvre B absorbé est
// refusé, pas silencieusement redirigé vers A. C'est la résolution à la LECTURE
// (`resoudreContactActif`, employée par le contexte de communication) qui mène au survivant.
//
// Hors périmètre, le contact est INTROUVABLE — indistinguable d'un id inexistant : aucune fuite.
export type ResultatCreationTacheContact =
  | { statut: "creee"; tache: Tache }
  | { statut: "contact_introuvable" }
  | { statut: "contact_fusionne" };

export async function creerTacheCiblantContact(
  input: Omit<NouvelleTache, "cible">,
  contactId: string,
  workspaceId: string
): Promise<ResultatCreationTacheContact> {
  return getDb().transaction(async (tx) => {
    const etat = await verrouillerContactActif(contactId, tx, workspaceId);
    if (etat.statut === "introuvable") return { statut: "contact_introuvable" } as const;
    if (etat.statut === "fusionne") return { statut: "contact_fusionne" } as const;
    const tache = await creerTache({ ...input, cible: { type: "contact", id: contactId } }, workspaceId, tx);
    return { statut: "creee", tache } as const;
  });
}

// Écritures atomiques dédiées, gel concurrent (même patron que marquerCompromisRealise/
// marquerRemunerationEncaissee, ADR-016/021) : termineeLe et annuleeLe ne sont jamais posés si
// l'autre l'est déjà — la clause WHERE fait échouer l'UPDATE (0 ligne, retour undefined) plutôt que
// d'écraser silencieusement une transition déjà actée.
//
// SELLER_FEEDBACK_INTERACTION_V1 — `executeur` optionnel (défaut `getDb()`, comportement inchangé
// pour tous les appelants existants) : `enregistrerRetourVendeurVisite` doit pouvoir clôturer la
// tâche DANS la même transaction que la création de l'Interaction (brief §8 — éviter une Interaction
// créée sans tâche clôturée, ou l'inverse).
//
// WORKSPACE_SCOPING_V1 (ADR-054) — `taches` est une table racine : le périmètre rejoint les autres
// conditions du `WHERE`. Une tâche d'un autre workspace se comporte exactement comme une tâche déjà
// close : 0 ligne, `undefined`, aucune transition écrite.
export async function terminerTache(
  id: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Tache | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(tachesTable)
    .set({ termineeLe: new Date() })
    .where(
      and(
        eq(tachesTable.id, id),
        eq(tachesTable.workspaceId, workspaceId),
        isNull(tachesTable.termineeLe),
        isNull(tachesTable.annuleeLe)
      )
    )
    .returning();
  return ligne ? ligneVersTache(ligne) : undefined;
}

export async function annulerTache(id: string, workspaceId: string): Promise<Tache | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(tachesTable)
    .set({ annuleeLe: new Date() })
    .where(
      and(
        eq(tachesTable.id, id),
        eq(tachesTable.workspaceId, workspaceId),
        isNull(tachesTable.termineeLe),
        isNull(tachesTable.annuleeLe)
      )
    )
    .returning();
  return ligne ? ligneVersTache(ligne) : undefined;
}

// AUTOMATION_ENGINE_GENERALIZATION_V1 — obsolescence en LOT des tâches automatiques d'une règle
// temporelle : ferme (même sémantique terminale que `annulerTache`, jamais un DELETE — brief §40)
// toute tâche encore ouverte de cette règle dont la cible n'est PLUS dans `idsCiblesValides` (le jeu
// de candidats recalculé par le scan EN COURS). Grâce au caractère monotone des seuils temporels
// (une date ne redevient jamais "pas encore franchie"), sortir du jeu de candidats signifie
// TOUJOURS que la cause a disparu (mandat renouvelé/résilié, offre décidée, compromis apparu...) —
// jamais une fausse obsolescence.
//
// Filtre `origine = 'automatique' AND origine_code = regleCode` : ne touche JAMAIS une tâche
// manuelle, ni une tâche d'une autre règle. Filtre `annulee_le IS NULL AND terminee_le IS NULL` :
// ne touche jamais une tâche déjà close — qu'elle l'ait été par ce même mécanisme lors d'un scan
// précédent OU par un geste humain (`terminerTacheAction`/`annulerTacheAction`) ; c'est cette garde,
// et elle seule, qui fait qu'une tâche fermée manuellement n'est jamais rouverte par un scan
// ultérieur (politique A, brief §41) — aucune colonne ni logique dédiée n'est nécessaire.
//
// Une seule requête UPDATE, jamais une par tâche (brief §38).
//
// WORKSPACE_SCOPING_V2B5 — `workspaceId` OBLIGATOIRE, et présent dans le `WHERE` SQL. Le jeu de
// candidats est celui d'UN workspace (le scan est désormais une passe par workspace) ; sans ce
// filtre, « toute tâche de cette règle qui n'est pas dans les candidats » englobait les tâches
// automatiques des AUTRES workspaces, que le scan de A aurait donc annulées en bloc. C'est la
// fuite la plus sévère du lot : elle ne révèle pas une donnée, elle en détruit une.
const COLONNES_CIBLE_OBSOLESCENCE = {
  bienId: tachesTable.bienId,
  offreId: tachesTable.offreId,
  visiteCanoniqueId: tachesTable.visiteCanoniqueId,
} as const;

export async function cloturerTachesAutomatiquesObsoletes(
  regleCode: CodeRegleAutomatisation,
  colonneCible: keyof typeof COLONNES_CIBLE_OBSOLESCENCE,
  idsCiblesValides: string[],
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<number> {
  const colonne = COLONNES_CIBLE_OBSOLESCENCE[colonneCible];
  const idsValides = idsCiblesValides.filter((id) => UUID_REGEX.test(id));
  const lignes = await executeur
    .update(tachesTable)
    .set({ annuleeLe: new Date() })
    .where(
      and(
        eq(tachesTable.workspaceId, workspaceId),
        eq(tachesTable.origine, "automatique"),
        eq(tachesTable.origineCode, regleCode),
        isNull(tachesTable.termineeLe),
        isNull(tachesTable.annuleeLe),
        idsValides.length > 0 ? notInArray(colonne, idsValides) : undefined
      )
    )
    .returning({ id: tachesTable.id });
  return lignes.length;
}

// AUTOMATION_ENGINE_GENERALIZATION_V1 — variante par IDENTIFIANTS EXPLICITES, pour une règle dont
// l'identité d'occurrence (ex. mandatId) diffère de la colonne cible de la tâche (bienId, brief §11
// — aucune colonne `mandat_id` sur `taches`) : `cloturerTachesAutomatiquesObsoletes` "NOT IN
// candidats" ne peut alors PAS détecter l'obsolescence (le bien reste un candidat valide à travers
// un renouvellement, seule l'identité du mandat change) — l'appelant doit calculer lui-même,
// via une jointure execution -> événement, quelles tâches précises sont concernées (voir
// scanners/mandatExpireBientot.ts). Même garde `annulee_le/terminee_le IS NULL` : ne rouvre jamais
// une tâche déjà close, humainement ou automatiquement.
//
// WORKSPACE_SCOPING_V2B5 — `workspaceId` OBLIGATOIRE ici AUSSI, alors même que les identifiants
// sont déjà produits par le scan de ce workspace. Ce n'est pas une double ceinture inutile : la
// liste d'ids traverse une frontière de module (le scanner la calcule, ce repository l'applique),
// et la garde doit vivre là où l'écriture a lieu. Le coût est nul, la preuve devient locale.
export async function cloturerTachesParIds(
  ids: string[],
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<number> {
  const idsValides = ids.filter((id) => UUID_REGEX.test(id));
  if (idsValides.length === 0) return 0;
  const lignes = await executeur
    .update(tachesTable)
    .set({ annuleeLe: new Date() })
    .where(
      and(
        eq(tachesTable.workspaceId, workspaceId),
        inArray(tachesTable.id, idsValides),
        isNull(tachesTable.termineeLe),
        isNull(tachesTable.annuleeLe)
      )
    )
    .returning({ id: tachesTable.id });
  return lignes.length;
}
