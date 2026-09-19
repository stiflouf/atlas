import { and, asc, desc, eq, inArray, lte, ne, notExists, sql } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { acquereurs as acquereursTable, biens as biensTable, compromis as compromisTable, offres as offresTable } from "@/db/schema";
import { transitionOffreAutorisee, type Offre, type StatutOffre } from "@/types/offre";
import type { OffreVisite } from "@/types/offreVisite";
import { MOTIF_PERTE_SYSTEME, type MotifPerte, type MotifPerteHumain } from "@/types/motifPerte";
import { lierVisiteAOffre } from "@/lib/offreVisiteRepository";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";

// ADR-061 (lot OFFER_LIFECYCLE_FOUNDATION_V1) — accès à l'Offre canonique. `offres` est la SOURCE
// DE VÉRITÉ du cycle de vie : toute transition passe par `deciderOffre`, sous verrou du BIEN
// (racine de sérialisation, §3), et rend un résultat typé — jamais un UPDATE isolé, jamais une
// erreur SQL brute. Le domaine Offre n'écrit plus `biens.offre_en_cours_le` (§12).
//
// WORKSPACE (ADR-054 §7) : `offres` est une feuille de `biens`. Chaque lecture et chaque écriture
// remonte à `biens.workspace_id` par jointure ; un bien, une offre ou un acquéreur d'un autre
// workspace est INTROUVABLE, indistinguable d'un id inconnu.
//
// ORDRE DE VERROUS (§15), le même pour la création, la décision et le compromis : bien (scoped,
// FOR UPDATE) → offre cible (FOR UPDATE) → offres concurrentes par id croissant.

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

// Ordre de lecture DÉTERMINISTE (§7) : les offres les plus récentes d'abord ; à date égale, la plus
// récemment créée. Un historique importé avec plusieurs `acceptee` reste lisible dans cet ordre —
// jamais réparé.
const ORDRE_OFFRES = [desc(offresTable.dateOffre), desc(offresTable.creeLe), desc(offresTable.id)];

// ───────────────────────────── LECTURES (scoped) ─────────────────────────────

export async function getOffreById(id: string, workspaceId: string, executeur: Executeur = getDb()): Promise<Offre | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select({ offre: offresTable })
    .from(offresTable)
    .innerJoin(biensTable, eq(offresTable.bienId, biensTable.id))
    .where(and(eq(offresTable.id, id), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersOffre(ligne.offre) : undefined;
}

// Un id non-UUID (bien mocké) ne peut correspondre à aucune ligne : liste vide, jamais un cast.
export async function listerOffresPourBien(bienId: string, workspaceId: string, executeur: Executeur = getDb()): Promise<Offre[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  const lignes = await executeur
    .select({ offre: offresTable })
    .from(offresTable)
    .innerJoin(biensTable, eq(offresTable.bienId, biensTable.id))
    .where(and(eq(offresTable.bienId, bienId), eq(biensTable.workspaceId, workspaceId)))
    .orderBy(...ORDRE_OFFRES);
  return lignes.map((l) => ligneVersOffre(l.offre));
}

export async function listerOffresPourAcquereur(acquereurId: string, workspaceId: string, executeur: Executeur = getDb()): Promise<Offre[]> {
  if (!UUID_REGEX.test(acquereurId)) return [];
  const lignes = await executeur
    .select({ offre: offresTable })
    .from(offresTable)
    .innerJoin(biensTable, eq(offresTable.bienId, biensTable.id))
    .where(and(eq(offresTable.acquereurId, acquereurId), eq(biensTable.workspaceId, workspaceId)))
    .orderBy(...ORDRE_OFFRES);
  return lignes.map((l) => ligneVersOffre(l.offre));
}

// Détection de doublon accidentel (ADR-044) : offres 'en_cours' pour EXACTEMENT cette paire —
// jamais un blocage définitif, une nouvelle proposition restant une nouvelle ligne.
export async function listerOffresEnCoursPourPaire(
  bienId: string,
  acquereurId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Offre[]> {
  if (!UUID_REGEX.test(bienId) || !UUID_REGEX.test(acquereurId)) return [];
  const lignes = await executeur
    .select({ offre: offresTable })
    .from(offresTable)
    .innerJoin(biensTable, eq(offresTable.bienId, biensTable.id))
    .where(
      and(
        eq(offresTable.bienId, bienId),
        eq(offresTable.acquereurId, acquereurId),
        eq(offresTable.statut, "en_cours"),
        eq(biensTable.workspaceId, workspaceId)
      )
    )
    .orderBy(...ORDRE_OFFRES);
  return lignes.map((l) => ligneVersOffre(l.offre));
}

// ADR-061 §8 / §11 — PRÉSENCE canonique : EXISTS toute offre du bien, quel que soit son statut.
// C'est elle, et non l'existence d'une offre ouverte, qui décide du mode canonique.
export async function existeOffreCanoniqueDuBien(bienId: string, workspaceId: string, executeur: Executeur = getDb()): Promise<boolean> {
  if (!UUID_REGEX.test(bienId)) return false;
  const [ligne] = await executeur
    .select({ id: offresTable.id })
    .from(offresTable)
    .innerJoin(biensTable, eq(offresTable.bienId, biensTable.id))
    .where(and(eq(offresTable.bienId, bienId), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne !== undefined;
}

// ADR-061 §11 — read model de coexistence. `mode` dépend de l'EXISTENCE d'au moins une offre
// canonique (toutes statuts), jamais d'une offre ouverte : un bien dont toutes les offres sont
// refusées, retirées ou caduques reste `canonique`, sans aucun retour à `biens.offre_en_cours_le`.
// `offreAcceptee` : la première par l'ordre déterministe s'il en existe plusieurs (import
// incohérent, §7) — les autres restent visibles dans `offres`.
export type EtatOffresBien =
  | { mode: "canonique"; offres: Offre[]; offresEnCours: Offre[]; offreAcceptee?: Offre }
  | { mode: "legacy"; offreEnCoursLe?: string }
  | { mode: "aucun" };

function etatDepuisOffres(bien: { offreEnCoursLe?: string }, offres: Offre[]): EtatOffresBien {
  if (offres.length > 0) {
    return {
      mode: "canonique",
      offres,
      offresEnCours: offres.filter((o) => o.statut === "en_cours"),
      offreAcceptee: offres.find((o) => o.statut === "acceptee"),
    };
  }
  if (bien.offreEnCoursLe) return { mode: "legacy", offreEnCoursLe: bien.offreEnCoursLe };
  return { mode: "aucun" };
}

export async function chargerEtatOffresBien(
  bien: { id: string; offreEnCoursLe?: string },
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<EtatOffresBien> {
  return etatDepuisOffres(bien, await listerOffresPourBien(bien.id, workspaceId, executeur));
}

// Variante EN LOT pour les listes (§11) : une requête pour N biens, jamais une par ligne.
export async function chargerEtatsOffresParBien(
  biens: { id: string; offreEnCoursLe?: string }[],
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Map<string, EtatOffresBien>> {
  const ids = biens.map((b) => b.id).filter((id) => UUID_REGEX.test(id));
  const parBien = new Map<string, Offre[]>();
  if (ids.length > 0) {
    const lignes = await executeur
      .select({ offre: offresTable })
      .from(offresTable)
      .innerJoin(biensTable, eq(offresTable.bienId, biensTable.id))
      .where(and(inArray(offresTable.bienId, ids), eq(biensTable.workspaceId, workspaceId)))
      .orderBy(...ORDRE_OFFRES);
    for (const { offre } of lignes) {
      const liste = parBien.get(offre.bienId) ?? [];
      liste.push(ligneVersOffre(offre));
      parBien.set(offre.bienId, liste);
    }
  }
  return new Map(biens.map((b) => [b.id, etatDepuisOffres(b, parBien.get(b.id) ?? [])]));
}

// AUTOMATION_ENGINE_GENERALIZATION_V1 — candidats du scanner `offre_sans_decision` : offres encore
// `en_cours` dont la date métier (`dateOffre`, pas `creeLe`) dépasse le seuil configuré. Comparaison
// de dates directement en SQL (`seuilDateISO` déjà décalé par l'appelant via `ajouterJoursCivils`),
// jamais un calcul par ligne en JS — une requête, indépendante du nombre d'offres du workspace.
export async function offresEnCoursDepasseesSeuil(
  workspaceId: string,
  seuilDateISO: string,
  executeur: Executeur = getDb()
): Promise<Offre[]> {
  const lignes = await executeur
    .select({ offre: offresTable })
    .from(offresTable)
    .innerJoin(biensTable, eq(offresTable.bienId, biensTable.id))
    .where(and(eq(biensTable.workspaceId, workspaceId), eq(offresTable.statut, "en_cours"), lte(offresTable.dateOffre, seuilDateISO)))
    .orderBy(...ORDRE_OFFRES);
  return lignes.map((l) => ligneVersOffre(l.offre));
}

// AUTOMATION_ENGINE_GENERALIZATION_V1 — candidats du scanner `offre_acceptee_sans_compromis` :
// offres `acceptee` depuis au moins le seuil configuré (`dateDecision`, posée une fois à
// l'acceptation, §ADR-061) et sans AUCUN compromis lié — anti-jointure corrélée `notExists`, même
// style que `successeurDe` dans mandatRepository.ts, jamais un `LEFT JOIN ... IS NULL`. Une requête,
// indépendante du nombre d'offres du workspace.
export async function offresAccepteesSansCompromis(
  workspaceId: string,
  seuilDateISO: string,
  executeur: Executeur = getDb()
): Promise<Offre[]> {
  const lignes = await executeur
    .select({ offre: offresTable })
    .from(offresTable)
    .innerJoin(biensTable, eq(offresTable.bienId, biensTable.id))
    .where(
      and(
        eq(biensTable.workspaceId, workspaceId),
        eq(offresTable.statut, "acceptee"),
        lte(offresTable.dateDecision, seuilDateISO),
        notExists(executeur.select({ un: sql`1` }).from(compromisTable).where(eq(compromisTable.offreId, offresTable.id)))
      )
    )
    .orderBy(...ORDRE_OFFRES);
  return lignes.map((l) => ligneVersOffre(l.offre));
}

// AUTOMATION_ENGINE_GENERALIZATION_V1 — résolution EN LOT du bien de plusieurs offres, au seul
// service du cockpit Aujourd'hui (lien "Voir la fiche" d'une tâche ciblant une offre — brief §24 :
// aucune fiche Offre dédiée, la navigation reste `/biens/{bienId}`, où BienTabs héberge l'onglet
// Offres). Jamais utilisée pour une décision métier — une simple projection id -> bienId.
//
// Volontairement NON scopée par workspace : `app/page.tsx` (Aujourd'hui), son unique appelant,
// lit déjà `listerTaches()`/`listerBiens()`/`listerClients()` sans filtre de workspace — limitation
// pré-existante et documentée (KNOWN_LIMITATIONS.md, ADR-054 §"aucune lecture scoped sur Aujourd'hui").
// Scoper cette seule projection isolément n'améliorerait rien (les tâches elles-mêmes restent
// non scopées juste avant) et introduirait une dépendance de session que cette page n'a nulle part
// ailleurs — cohérence avec l'existant, jamais une régression.
export async function bienIdsPourOffres(offreIds: string[], executeur: Executeur = getDb()): Promise<Map<string, string>> {
  const ids = offreIds.filter((id) => UUID_REGEX.test(id));
  if (ids.length === 0) return new Map();
  const lignes = await executeur.select({ id: offresTable.id, bienId: offresTable.bienId }).from(offresTable).where(inArray(offresTable.id, ids));
  return new Map(lignes.map((l) => [l.id, l.bienId]));
}

// ───────────────────────────── VERROUS ─────────────────────────────

// ADR-061 §3 — le BIEN, scoped, FOR UPDATE : racine de sérialisation de toutes les décisions sur
// ses offres et de la création de ses compromis. Exporté pour le writer Compromis (même ordre).
export type BienVerrouillePourOffres = { statut: "verrouille"; archive: boolean } | { statut: "introuvable" };

export async function verrouillerBienPourOffres(bienId: string, workspaceId: string, tx: Executeur): Promise<BienVerrouillePourOffres> {
  if (!UUID_REGEX.test(bienId)) return { statut: "introuvable" };
  const [bien] = await tx
    .select({ id: biensTable.id, archiveLe: biensTable.archiveLe })
    .from(biensTable)
    .where(and(eq(biensTable.id, bienId), eq(biensTable.workspaceId, workspaceId)))
    .for("update");
  if (!bien) return { statut: "introuvable" };
  return { statut: "verrouille", archive: bien.archiveLe !== null };
}

// L'acquéreur legacy doit appartenir au même workspace que le bien (§14) : lu par
// `acquereurs.workspace_id`, sans verrou (aucune écriture ne le concerne).
async function acquereurDuWorkspace(
  acquereurId: string,
  workspaceId: string,
  tx: Executeur
): Promise<{ statut: "trouve"; archive: boolean } | { statut: "introuvable" }> {
  if (!UUID_REGEX.test(acquereurId)) return { statut: "introuvable" };
  const [acquereur] = await tx
    .select({ id: acquereursTable.id, archiveLe: acquereursTable.archiveLe })
    .from(acquereursTable)
    .where(and(eq(acquereursTable.id, acquereurId), eq(acquereursTable.workspaceId, workspaceId)))
    .limit(1);
  if (!acquereur) return { statut: "introuvable" };
  return { statut: "trouve", archive: acquereur.archiveLe !== null };
}

// ───────────────────────────── CRÉATION ─────────────────────────────

export type NouvelleOffre = Omit<Offre, "id" | "statut" | "creeLe" | "dateDecision" | "motifPerte">;

// PRIMITIVE BASSE d'insertion : aucune garde, aucun verrou, aucun événement. Réservée à la
// composition de `creerOffre` (le writer) et aux fixtures de test qui posent une ligne « telle
// qu'importée » ; jamais un chemin produit (garde structurelle).
export async function enregistrerOffre(input: NouvelleOffre, executeur: Executeur = getDb()): Promise<Offre> {
  const [ligne] = await executeur
    .insert(offresTable)
    .values({
      bienId: input.bienId,
      acquereurId: input.acquereurId,
      montant: input.montant,
      dateOffre: input.dateOffre,
      dateValidite: input.dateValidite ?? null,
      statut: "en_cours",
    })
    .returning();
  return ligneVersOffre(ligne);
}

export type ResultatCreationOffre =
  | { statut: "creee"; offre: Offre; liens: OffreVisite[]; idsExecutionsATraiter: string[] }
  | { statut: "bien_introuvable" }
  | { statut: "acquereur_introuvable" }
  | { statut: "bien_archive" }
  | { statut: "acquereur_archive" }
  // Une offre 'en_cours' existe déjà pour cette paire et l'appelant n'a pas confirmé (ADR-044).
  | { statut: "doublon_paire"; offresEnCours: Offre[] };

// ADR-061 §16 — création : bien verrouillé scoped, acquéreur du même workspace, statut `en_cours`
// explicite, liens de visites (validés par l'appelant, ADR-019), événement `offre_recue` dans la
// même transaction. PLUS AUCUNE écriture de `biens.offre_en_cours_le` (§12).
export async function creerOffre(
  input: NouvelleOffre,
  compteRenduVisiteIds: string[],
  workspaceId: string,
  options: { confirmerMalgreExistante?: boolean } = {},
  executeur: Executeur = getDb()
): Promise<ResultatCreationOffre> {
  return executeur.transaction(async (tx) => {
    const bien = await verrouillerBienPourOffres(input.bienId, workspaceId, tx);
    if (bien.statut !== "verrouille") return { statut: "bien_introuvable" };
    const acquereur = await acquereurDuWorkspace(input.acquereurId, workspaceId, tx);
    if (acquereur.statut !== "trouve") return { statut: "acquereur_introuvable" };
    if (bien.archive) return { statut: "bien_archive" };
    if (acquereur.archive) return { statut: "acquereur_archive" };

    if (!options.confirmerMalgreExistante) {
      const offresEnCours = await listerOffresEnCoursPourPaire(input.bienId, input.acquereurId, workspaceId, tx);
      if (offresEnCours.length > 0) return { statut: "doublon_paire", offresEnCours };
    }

    const offre = await enregistrerOffre(input, tx);
    const liens: OffreVisite[] = [];
    for (const compteRenduVisiteId of compteRenduVisiteIds) {
      liens.push(await lierVisiteAOffre(offre.id, compteRenduVisiteId, tx));
    }
    const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions(
      { typeEvenement: "offre_recue", offreId: offre.id },
      workspaceId,
      tx
    );
    return { statut: "creee", offre, liens, idsExecutionsATraiter };
  });
}

// ───────────────────────────── DÉCISION ─────────────────────────────

// Type discriminé (ADR-020, ADR-061 §2) : `acceptee` sans motif ; `refusee`/`retiree` avec un motif
// HUMAIN ; `caduque` avec un motif humain — le motif système `autre_offre_acceptee` n'est jamais
// accepté ici (il est posé par le moteur seul, §5).
export type TransitionOffre =
  | { statut: "acceptee"; dateDecision: string }
  | { statut: "refusee" | "retiree"; dateDecision: string; motifPerte: MotifPerteHumain }
  | { statut: "caduque"; motifPerte: MotifPerteHumain };

export type ResultatDecisionOffre =
  | { statut: "decidee"; offre: Offre; offresRefuseesAutomatiquement: Offre[]; idsExecutionsATraiter: string[] }
  | { statut: "introuvable" }
  | { statut: "deja_finalisee"; statutActuel: StatutOffre }
  | { statut: "transition_interdite"; statutActuel: StatutOffre }
  | { statut: "bien_archive" }
  | { statut: "acquereur_archive" }
  | { statut: "acceptation_active_existante"; offreAccepteeId: string };

const EVENEMENT_PAR_TRANSITION = {
  acceptee: "offre_acceptee",
  refusee: "offre_refusee",
  retiree: "offre_retiree",
  caduque: "offre_caduque",
} as const;

// ADR-061 §3-§6 — LE writer de transition, unique :
//   1. verrou du bien (scoped) ; 2. verrou de l'offre, relecture du statut réel ; 3. invariants
//   (matrice, archivage, acceptation active) ; 4. `UPDATE … WHERE id AND statut = <attendu>`
//   (défense en profondeur même sous verrou : 0 ligne = résultat typé, jamais un succès) ;
//   5. politique A : les autres offres `en_cours` du bien passent `refusee` / `autre_offre_acceptee`,
//   par id croissant ; 6. un événement par ligne modifiée, dans la transaction.
//
// `date_decision` porte la décision INITIALE (acceptation, refus, retrait) : la caducité ne
// l'écrase pas — le fait « acceptée le J » reste lisible sur la ligne, et la date de la caducité
// est celle de l'événement `offre_caduque` (`survenu_le`).
export async function deciderOffre(
  offreId: string,
  transition: TransitionOffre,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatDecisionOffre> {
  if (!UUID_REGEX.test(offreId)) return { statut: "introuvable" };
  return executeur.transaction(async (tx) => {
    // Le bien de l'offre n'est connu qu'après lecture : lecture scoped SANS verrou, puis verrou du
    // bien, puis relecture de l'offre SOUS verrou — l'état qui compte est celui relu à l'étape 2.
    const cible = await getOffreById(offreId, workspaceId, tx);
    if (!cible) return { statut: "introuvable" };
    const bien = await verrouillerBienPourOffres(cible.bienId, workspaceId, tx);
    if (bien.statut !== "verrouille") return { statut: "introuvable" };

    const [ligne] = await tx.select().from(offresTable).where(eq(offresTable.id, offreId)).for("update");
    if (!ligne || ligne.bienId !== cible.bienId) return { statut: "introuvable" };
    const statutActuel = ligne.statut as StatutOffre;
    if (statutActuel === transition.statut) return { statut: "deja_finalisee", statutActuel };
    if (!transitionOffreAutorisee(statutActuel, transition.statut)) {
      return statutActuel === "en_cours" ? { statut: "transition_interdite", statutActuel } : { statut: "deja_finalisee", statutActuel };
    }
    if (bien.archive) return { statut: "bien_archive" };
    const acquereur = await acquereurDuWorkspace(ligne.acquereurId, workspaceId, tx);
    if (acquereur.statut === "trouve" && acquereur.archive) return { statut: "acquereur_archive" };

    // §6 — au plus une offre `acceptee` par bien : une autre acceptation encore active doit d'abord
    // être rendue caduque par un geste humain. Verrou pris sur les concurrentes par id croissant.
    const concurrentes =
      transition.statut === "acceptee"
        ? await tx
            .select()
            .from(offresTable)
            .where(and(eq(offresTable.bienId, cible.bienId), ne(offresTable.id, offreId), inArray(offresTable.statut, ["en_cours", "acceptee"])))
            .orderBy(asc(offresTable.id))
            .for("update")
        : [];
    const dejaAcceptee = concurrentes.find((o) => o.statut === "acceptee");
    if (dejaAcceptee) return { statut: "acceptation_active_existante", offreAccepteeId: dejaAcceptee.id };

    const valeurs =
      transition.statut === "acceptee"
        ? { statut: "acceptee" as const, dateDecision: transition.dateDecision, motifPerte: null }
        : transition.statut === "caduque"
          ? { statut: "caduque" as const, motifPerte: transition.motifPerte }
          : { statut: transition.statut, dateDecision: transition.dateDecision, motifPerte: transition.motifPerte };
    const [modifiee] = await tx
      .update(offresTable)
      .set(valeurs)
      .where(and(eq(offresTable.id, offreId), eq(offresTable.statut, statutActuel)))
      .returning();
    if (!modifiee) return { statut: "deja_finalisee", statutActuel };

    const idsExecutionsATraiter: string[] = [];
    const emission = await emettreEvenementEtPreparerExecutions(
      { typeEvenement: EVENEMENT_PAR_TRANSITION[transition.statut], offreId },
      workspaceId,
      tx
    );
    idsExecutionsATraiter.push(...emission.idsExecutionsATraiter);

    // §4 — politique A : les concurrentes encore ouvertes sont refusées, motif système, même date.
    const offresRefuseesAutomatiquement: Offre[] = [];
    if (transition.statut === "acceptee") {
      for (const concurrente of concurrentes.filter((o) => o.statut === "en_cours")) {
        const [refusee] = await tx
          .update(offresTable)
          .set({ statut: "refusee", dateDecision: transition.dateDecision, motifPerte: MOTIF_PERTE_SYSTEME })
          .where(and(eq(offresTable.id, concurrente.id), eq(offresTable.statut, "en_cours")))
          .returning();
        if (!refusee) continue;
        offresRefuseesAutomatiquement.push(ligneVersOffre(refusee));
        const e = await emettreEvenementEtPreparerExecutions({ typeEvenement: "offre_refusee", offreId: refusee.id }, workspaceId, tx);
        idsExecutionsATraiter.push(...e.idsExecutionsATraiter);
      }
    }

    return { statut: "decidee", offre: ligneVersOffre(modifiee), offresRefuseesAutomatiquement, idsExecutionsATraiter };
  });
}

// Wrappers métier — quatre gestes, un seul moteur de transition.
export function accepterOffre(offreId: string, dateDecision: string, workspaceId: string, executeur?: Executeur) {
  return deciderOffre(offreId, { statut: "acceptee", dateDecision }, workspaceId, executeur);
}

export function refuserOffre(offreId: string, dateDecision: string, motifPerte: MotifPerteHumain, workspaceId: string, executeur?: Executeur) {
  return deciderOffre(offreId, { statut: "refusee", dateDecision, motifPerte }, workspaceId, executeur);
}

export function retirerOffre(offreId: string, dateDecision: string, motifPerte: MotifPerteHumain, workspaceId: string, executeur?: Executeur) {
  return deciderOffre(offreId, { statut: "retiree", dateDecision, motifPerte }, workspaceId, executeur);
}

// ADR-061 §6 — geste HUMAIN explicite, jamais déclenché par l'annulation d'un compromis, une date
// de validité ou une automatisation.
export function rendreOffreCaduque(offreId: string, motifPerte: MotifPerteHumain, workspaceId: string, executeur?: Executeur) {
  return deciderOffre(offreId, { statut: "caduque", motifPerte }, workspaceId, executeur);
}
