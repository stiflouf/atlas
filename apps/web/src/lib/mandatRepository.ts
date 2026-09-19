import { and, asc, desc, eq, exists, notExists, isNull, or, gt, gte, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, type Executeur } from "@/db/client";
import { biens as biensTable, mandats as mandatsTable, projetsVendeur as projetsVendeurTable } from "@/db/schema";
import { deriverStatutMandat, type Mandat, type MandatHistorique, type TypeMandat } from "@/types/mandat";

// ADR-055 §F, ADR-060 — accès au mandat canonique. Le lot lifecycle (ADR-060 §16) rend la table
// VIVANTE : création à l'image des faits saisis, modification, résiliation, mandat courant. Le
// renouvellement humain (verrou double, clôture, écran) reste hors de ce module : seul le primitif
// `creerMandatSuccesseur` existe, sans mutation de l'ancien (§9).
//
// WORKSPACE (ADR-054 §7, ADR-060 §13) : `mandats` n'en porte pas, son périmètre est celui du bien.
// Chaque writer reçoit le workspace de SESSION, relit sa racine sous verrou en le filtrant, et rend
// un objet d'un autre workspace INTROUVABLE — publiquement indistinguable d'un id inconnu.

type LigneMandat = typeof mandatsTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function dateDuJour(): string {
  return new Date().toISOString().slice(0, 10);
}

// NULL Postgres -> undefined métier : un mandat en cours n'a pas une date de résiliation nulle, il
// n'en a pas. `type` NULL (ligne antérieure au lot lifecycle) reste NULL en base et absent ici —
// jamais traduit en `simple`.
function ligneVersMandat(ligne: LigneMandat): Mandat {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    projetVendeurId: ligne.projetVendeurId ?? undefined,
    type: (ligne.type as TypeMandat | null) ?? undefined,
    numero: ligne.numero ?? undefined,
    dateDebut: ligne.dateDebut,
    dateFin: ligne.dateFin ?? undefined,
    exclusiviteJusquAu: ligne.exclusiviteJusquAu ?? undefined,
    resilieLe: ligne.resilieLe ?? undefined,
    motifResiliation: ligne.motifResiliation ?? undefined,
    remplaceMandatId: ligne.remplaceMandatId ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// ADR-060 §12 — un numéro vide n'est pas un numéro.
function normaliserNumero(numero: string | undefined): string | null {
  const propre = numero?.trim() ?? "";
  return propre === "" ? null : propre;
}

function normaliserMotif(motif: string | undefined): string | null {
  const propre = motif?.trim() ?? "";
  return propre === "" ? null : propre;
}

// Les faits contractuels que tout writer humain saisit (ADR-060 §16). `type` est OBLIGATOIRE dans
// le contrat : la nullabilité de la colonne n'existe que pour les lignes antérieures au lot, elle
// n'est pas une option offerte à la saisie.
export type FaitsMandat = {
  type: TypeMandat;
  numero?: string;
  dateFin?: string;
  exclusiviteJusquAu?: string;
};

export type NouveauMandat = FaitsMandat & {
  bienId: string;
  // Optionnel : un mandat signé depuis une opportunité antérieure au modèle canonique n'a pas de
  // projet à référencer. Le mandat reste un fait ; son projet n'a jamais existé en base.
  projetVendeurId?: string;
  dateDebut: string;
  remplaceMandatId?: string;
};

// Cohérence des dates vérifiée AVANT l'écriture, en plus des CHECK SQL qui restent le dernier
// filet : un writer rend un refus typé, jamais une violation de contrainte à interpréter.
function datesIncoherentes(mandat: { dateDebut: string; dateFin?: string; exclusiviteJusquAu?: string }): boolean {
  if (mandat.dateFin !== undefined && mandat.dateFin < mandat.dateDebut) return true;
  if (mandat.exclusiviteJusquAu !== undefined) {
    if (mandat.exclusiviteJusquAu < mandat.dateDebut) return true;
    if (mandat.dateFin !== undefined && mandat.exclusiviteJusquAu > mandat.dateFin) return true;
  }
  return false;
}

// ADR-054 — `mandats` est une FEUILLE de `biens` : son périmètre est celui du bien, jamais un
// paramètre. Aucun `workspaceId` n'est donc reçu ici — le dupliquer permettrait d'en choisir un qui
// contredise le bien.
//
// En revanche, quand un projet est rattaché, les DEUX périmètres doivent coïncider : la base ne peut
// pas le vérifier (aucune des deux colonnes ne porte le workspace), donc ce chemin le fait, et il
// échoue bruyamment. Même garde et même raison que `ajouterPartieProjet`.
//
// Primitive BASSE : elle ne vérifie pas l'invariant « un seul mandat courant » (ADR-060 §11) — c'est
// le rôle des writers qui partent d'un bien EXISTANT (`enregistrerMandatExistant`), sous verrou.
// Les flux qui créent le bien dans la même transaction (signature, création directe) n'ont rien à
// vérifier : le bien n'a encore aucun mandat, et personne d'autre ne le voit.
export async function creerMandat(input: NouveauMandat, executeur: Executeur = getDb()): Promise<Mandat> {
  const [bien] = await executeur
    .select({ workspaceId: biensTable.workspaceId })
    .from(biensTable)
    .where(eq(biensTable.id, input.bienId))
    .limit(1);
  if (!bien) throw new Error(`Bien introuvable : ${input.bienId}`);

  if (input.projetVendeurId !== undefined) {
    const [projet] = await executeur
      .select({ workspaceId: projetsVendeurTable.workspaceId })
      .from(projetsVendeurTable)
      .where(eq(projetsVendeurTable.id, input.projetVendeurId))
      .limit(1);
    if (!projet) throw new Error(`Projet vendeur introuvable : ${input.projetVendeurId}`);
    if (projet.workspaceId !== bien.workspaceId) {
      throw new Error("Un mandat ne peut pas relier un bien et un projet vendeur de workspaces différents");
    }
  }
  if (datesIncoherentes(input)) {
    throw new Error("Dates de mandat incohérentes : terme avant la prise d'effet, ou exclusivité hors période");
  }

  const [ligne] = await executeur
    .insert(mandatsTable)
    .values({
      bienId: input.bienId,
      projetVendeurId: input.projetVendeurId ?? null,
      type: input.type,
      numero: normaliserNumero(input.numero),
      dateDebut: input.dateDebut,
      dateFin: input.dateFin ?? null,
      exclusiviteJusquAu: input.exclusiviteJusquAu ?? null,
      remplaceMandatId: input.remplaceMandatId ?? null,
    })
    .returning();
  return ligneVersMandat(ligne);
}

// CAS 7 d'ADR-055, ADR-060 §9 — un renouvellement CRÉE une ligne. Le mandat remplacé n'est jamais
// modifié : aucun UPDATE ici, aucune date de fin posée d'autorité sur lui — la relation suffit à le
// retirer de la notion de mandat courant. Le geste humain (verrou double, écran) est un lot ultérieur.
//
// Le successeur hérite du bien du mandat remplacé — un renouvellement porte par définition sur le
// même actif. Le laisser choisir au caller permettrait de « renouveler » un mandat sur un autre
// bien, ce qui ne serait pas un renouvellement.
export async function creerMandatSuccesseur(
  mandatRemplaceId: string,
  input: Omit<NouveauMandat, "bienId" | "remplaceMandatId">,
  executeur: Executeur = getDb()
): Promise<Mandat> {
  if (!UUID_REGEX.test(mandatRemplaceId)) throw new Error(`Mandat introuvable : ${mandatRemplaceId}`);
  const [remplace] = await executeur
    .select({ bienId: mandatsTable.bienId })
    .from(mandatsTable)
    .where(eq(mandatsTable.id, mandatRemplaceId))
    .limit(1);
  if (!remplace) throw new Error(`Mandat introuvable : ${mandatRemplaceId}`);

  return creerMandat({ ...input, bienId: remplace.bienId, remplaceMandatId: mandatRemplaceId }, executeur);
}

// LECTURES SCOPED (ADR-054 §7, lot MANDATE_CANONICAL_UI_V1) : dès qu'un écran consomme le mandat
// canonique, chaque lecture remonte au bien et filtre par le workspace de SESSION. Un mandat d'un
// autre workspace est INTROUVABLE — publiquement indistinguable d'un id inconnu — et une liste
// d'un bien ou d'un projet d'un autre workspace est vide, jamais partielle.
export async function getMandatById(id: string, workspaceId: string, executeur: Executeur = getDb()): Promise<Mandat | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select({ mandat: mandatsTable })
    .from(mandatsTable)
    .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
    .where(and(eq(mandatsTable.id, id), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersMandat(ligne.mandat) : undefined;
}

// « Remplacé » = un successeur référence cette ligne (ADR-060 §9-10). Sous-requête corrélée, jamais
// une colonne : un booléen stocké deviendrait faux au premier renouvellement oublié.
const successeurs = alias(mandatsTable, "successeurs");
function successeurDe(executeur: Executeur) {
  return executeur.select({ un: sql`1` }).from(successeurs).where(eq(successeurs.remplaceMandatId, mandatsTable.id));
}

// Ordre chronologique de prise d'effet : l'historique contractuel se lit dans le sens où il s'est
// produit. Les mandats expirés, résiliés ou remplacés ne sont jamais exclus — ce sont eux,
// l'historique. Chaque ligne porte son statut dérivé et l'id de son successeur éventuel, obtenu par
// une jointure — jamais une requête par ligne.
export async function listerMandatsDuBien(
  bienId: string,
  workspaceId: string,
  aujourdhui: string = dateDuJour(),
  executeur: Executeur = getDb()
): Promise<MandatHistorique[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  const lignes = await executeur
    .select({ mandat: mandatsTable, remplaceParId: successeurs.id })
    .from(mandatsTable)
    .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
    .leftJoin(successeurs, eq(successeurs.remplaceMandatId, mandatsTable.id))
    .where(and(eq(mandatsTable.bienId, bienId), eq(biensTable.workspaceId, workspaceId)))
    .orderBy(asc(mandatsTable.dateDebut), asc(mandatsTable.creeLe), asc(mandatsTable.id));
  // Un mandat remplacé deux fois (cas incohérent, lisible) apparaîtrait deux fois : on garde la
  // première ligne par id, le successeur retenu étant déterministe par l'ordre de la jointure.
  const parId = new Map<string, MandatHistorique>();
  for (const { mandat, remplaceParId } of lignes) {
    if (parId.has(mandat.id)) continue;
    const metier = ligneVersMandat(mandat);
    parId.set(mandat.id, { ...metier, statut: deriverStatutMandat(metier, aujourdhui), remplaceParId: remplaceParId ?? undefined });
  }
  return [...parId.values()];
}

// Le périmètre passe par le BIEN de chaque mandat (feuille de `biens`), jamais par le projet : un
// projet et un bien de workspaces différents ne peuvent pas être reliés (`creerMandat`), donc le
// filtre est le même — et il reste celui de l'entité propriétaire.
export async function listerMandatsDuProjetVendeur(
  projetVendeurId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Mandat[]> {
  if (!UUID_REGEX.test(projetVendeurId)) return [];
  const lignes = await executeur
    .select({ mandat: mandatsTable })
    .from(mandatsTable)
    .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
    .where(and(eq(mandatsTable.projetVendeurId, projetVendeurId), eq(biensTable.workspaceId, workspaceId)))
    .orderBy(asc(mandatsTable.dateDebut), asc(mandatsTable.creeLe));
  return lignes.map((l) => ligneVersMandat(l.mandat));
}

// ADR-060 §1 — la PRÉCÉDENCE se décide par entité : dès qu'un mandat canonique existe pour le bien,
// les colonnes legacy `biens.date_mandat` / `statut_mandat` cessent de faire foi. Lu par le writer
// legacy (`modifierBien`) pour ne plus les écrire (§2).
export async function existeMandatCanonique(bienId: string, executeur: Executeur = getDb()): Promise<boolean> {
  if (!UUID_REGEX.test(bienId)) return false;
  const [ligne] = await executeur
    .select({ id: mandatsTable.id })
    .from(mandatsTable)
    .where(eq(mandatsTable.bienId, bienId))
    .limit(1);
  return ligne !== undefined;
}

// Même question, dans le workspace de SESSION (lecture produit, lot MANDATE_CANONICAL_UI_V1) : dit
// à un écran si le bien est en mode canonique (ADR-060 §1) sans charger l'historique. Un bien d'un
// autre workspace n'a aucun mandat canonique visible — comme s'il n'existait pas.
export async function existeMandatCanoniqueDuBien(
  bienId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<boolean> {
  if (!UUID_REGEX.test(bienId)) return false;
  const [ligne] = await executeur
    .select({ id: mandatsTable.id })
    .from(mandatsTable)
    .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
    .where(and(eq(mandatsTable.bienId, bienId), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne !== undefined;
}

// ADR-060 §10 — LE mandat courant d'un bien, en UNE requête : candidats sans successeur dont le
// statut dérivé est `actif` ou `a_venir` (aucun filtre sur la prise d'effet : un mandat signé qui
// prend effet demain est le courant), ordre déterministe, première ligne. Un jeu incohérent (deux
// mandats vivants importés) reste lisible et donne toujours la même réponse ; rien n'est réparé.
//
// Le workspace passe par le bien (ADR-054 §7) : un bien d'un autre workspace n'a pas de mandat
// courant, comme s'il n'existait pas.
export async function mandatCourantDuBien(
  bienId: string,
  workspaceId: string,
  aujourdhui: string = dateDuJour(),
  executeur: Executeur = getDb()
): Promise<Mandat | undefined> {
  if (!UUID_REGEX.test(bienId)) return undefined;
  const [ligne] = await executeur
    .select({ mandat: mandatsTable })
    .from(mandatsTable)
    .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
    .where(
      and(
        eq(mandatsTable.bienId, bienId),
        eq(biensTable.workspaceId, workspaceId),
        notExists(successeurDe(executeur)),
        or(isNull(mandatsTable.resilieLe), gt(mandatsTable.resilieLe, aujourdhui)),
        or(isNull(mandatsTable.dateFin), gte(mandatsTable.dateFin, aujourdhui))
      )
    )
    .orderBy(desc(mandatsTable.dateDebut), desc(mandatsTable.creeLe), desc(mandatsTable.id))
    .limit(1);
  return ligne ? ligneVersMandat(ligne.mandat) : undefined;
}

// AUTOMATION_ENGINE_GENERALIZATION_V1 — variante EN LOT de `mandatCourantDuBien` pour le scanner
// `mandat_expire_bientot` (ADR-060 §"Scalabilité", qui prescrit exactement ce calcul en une passe
// pour une liste de biens plutôt que bien par bien). Même WHERE que `mandatCourantDuBien` (non
// résilié, non remplacé via `successeurDe`), plus la fenêtre `dateFin BETWEEN aujourdhuiISO AND
// finFenetreISO` ; puis réduction en JS au premier par bien selon le MÊME ordre déterministe
// (dateDebut desc, creeLe desc, id desc) — même patron que `listerMandatsDuBien` ci-dessus (garder
// la première ligne par clé, jamais une requête par ligne). Un bien avec plusieurs mandats "courants"
// simultanés (import incohérent) reste lisible, toujours la même réponse déterministe ; rien n'est
// réparé. Une requête, indépendante du nombre de biens du workspace.
export async function mandatsCourantsExpirantBientot(
  workspaceId: string,
  aujourdhuiISO: string,
  finFenetreISO: string,
  executeur: Executeur = getDb()
): Promise<Mandat[]> {
  const lignes = await executeur
    .select({ mandat: mandatsTable })
    .from(mandatsTable)
    .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
    .where(
      and(
        eq(biensTable.workspaceId, workspaceId),
        notExists(successeurDe(executeur)),
        or(isNull(mandatsTable.resilieLe), gt(mandatsTable.resilieLe, aujourdhuiISO)),
        gte(mandatsTable.dateFin, aujourdhuiISO),
        lte(mandatsTable.dateFin, finFenetreISO)
      )
    )
    .orderBy(asc(mandatsTable.bienId), desc(mandatsTable.dateDebut), desc(mandatsTable.creeLe), desc(mandatsTable.id));

  const parBien = new Map<string, Mandat>();
  for (const { mandat } of lignes) {
    if (!parBien.has(mandat.bienId)) parBien.set(mandat.bienId, ligneVersMandat(mandat));
  }
  return [...parBien.values()];
}

// ADR-060 §11 et §13 — verrouille le BIEN (scoped) avant qu'un writer standard ne crée un mandat
// sur un bien existant, et rend le mandat courant éventuel. Même définition du courant partout :
// c'est `mandatCourantDuBien` qui répond, sous le verrou du bien.
export type BienVerrouillePourMandat =
  | { statut: "verrouille"; mandatCourant: Mandat | undefined }
  | { statut: "bien_introuvable" };

export async function verrouillerBienPourMandat(
  bienId: string,
  workspaceId: string,
  tx: Executeur,
  aujourdhui: string = dateDuJour()
): Promise<BienVerrouillePourMandat> {
  if (!UUID_REGEX.test(bienId)) return { statut: "bien_introuvable" };
  const [bien] = await tx
    .select({ id: biensTable.id })
    .from(biensTable)
    .where(and(eq(biensTable.id, bienId), eq(biensTable.workspaceId, workspaceId)))
    .for("update");
  if (!bien) return { statut: "bien_introuvable" };
  return { statut: "verrouille", mandatCourant: await mandatCourantDuBien(bienId, workspaceId, aujourdhui, tx) };
}

// ADR-060 §15 — « Enregistrer le mandat existant » : un bien legacy sans mandat canonique en reçoit
// un, à partir de ce que l'HUMAIN saisit. Jamais un backfill : `dateDebut` est un paramètre, pas
// une copie de `biens.date_mandat`. Refusé dès qu'un mandat canonique existe (§11) — le geste sert à
// amorcer, pas à doubler.
export type ResultatEnregistrementMandat =
  | { statut: "enregistre"; mandat: Mandat }
  | { statut: "bien_introuvable" }
  | { statut: "mandat_canonique_existant" }
  | { statut: "dates_incoherentes" };

export async function enregistrerMandatExistant(
  bienId: string,
  input: FaitsMandat & { dateDebut: string },
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatEnregistrementMandat> {
  if (datesIncoherentes(input)) return { statut: "dates_incoherentes" };
  return executeur.transaction(async (tx) => {
    const verrou = await verrouillerBienPourMandat(bienId, workspaceId, tx);
    if (verrou.statut !== "verrouille") return { statut: "bien_introuvable" };
    if (verrou.mandatCourant !== undefined || (await existeMandatCanonique(bienId, tx))) {
      return { statut: "mandat_canonique_existant" };
    }
    const mandat = await creerMandat({ ...input, bienId }, tx);
    return { statut: "enregistre", mandat };
  });
}

// Relit un mandat SOUS VERROU, dans le workspace de session via son bien (ADR-060 §13). Le verrou
// ne porte que sur `mandats` : le bien n'est pas modifié par ces writers, et verrouiller les deux
// dans un ordre différent du renouvellement futur (bien puis mandat) créerait un interblocage.
// Exporté pour le writer des parties de mandat (ADR-060 §16) : même verrou, même définition du
// périmètre — un second chemin de lecture scoped divergerait un jour.
export type MandatVerrouille =
  | { statut: "verrouille"; ligne: LigneMandat; remplace: boolean }
  | { statut: "introuvable" };

export async function verrouillerMandat(mandatId: string, workspaceId: string, tx: Executeur): Promise<MandatVerrouille> {
  if (!UUID_REGEX.test(mandatId)) return { statut: "introuvable" };
  const [trouve] = await tx
    .select({ mandat: mandatsTable, remplace: sql<boolean>`${exists(successeurDe(tx))}` })
    .from(mandatsTable)
    .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
    .where(and(eq(mandatsTable.id, mandatId), eq(biensTable.workspaceId, workspaceId)))
    .for("update", { of: mandatsTable });
  if (!trouve) return { statut: "introuvable" };
  return { statut: "verrouille", ligne: trouve.mandat, remplace: trouve.remplace };
}

// ADR-060 §16 — modification des faits contractuels d'un mandat VIVANT : type, numéro, terme,
// exclusivité. Jamais la prise d'effet, jamais la résiliation, jamais la relation de remplacement,
// jamais le bien ni le projet. Un mandat résilié ou remplacé est de l'histoire : un writer standard
// ne la réécrit pas.
export type ModificationMandat = {
  type: TypeMandat;
  numero?: string;
  dateFin?: string;
  exclusiviteJusquAu?: string;
};

export type ResultatModificationMandat =
  | { statut: "modifie"; mandat: Mandat }
  | { statut: "introuvable" }
  | { statut: "resilie" }
  | { statut: "remplace" }
  | { statut: "dates_incoherentes" };

export async function modifierMandat(
  mandatId: string,
  input: ModificationMandat,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatModificationMandat> {
  return executeur.transaction(async (tx) => {
    const verrou = await verrouillerMandat(mandatId, workspaceId, tx);
    if (verrou.statut !== "verrouille") return { statut: "introuvable" };
    if (verrou.ligne.resilieLe !== null) return { statut: "resilie" };
    if (verrou.remplace) return { statut: "remplace" };
    if (datesIncoherentes({ dateDebut: verrou.ligne.dateDebut, ...input })) return { statut: "dates_incoherentes" };

    const [ligne] = await tx
      .update(mandatsTable)
      .set({
        type: input.type,
        numero: normaliserNumero(input.numero),
        dateFin: input.dateFin ?? null,
        exclusiviteJusquAu: input.exclusiviteJusquAu ?? null,
      })
      .where(eq(mandatsTable.id, mandatId))
      .returning();
    return { statut: "modifie", mandat: ligneVersMandat(ligne) };
  });
}

// ADR-060 §8 — résiliation : un fait unique (refusée si déjà posée), daté au plus tôt de la prise
// d'effet, qui ne touche à RIEN d'autre — `date_fin` reste le terme prévu. Un mandat remplacé
// n'est plus résiliable par ce chemin : son histoire est close par la relation.
export type ResultatResiliationMandat =
  | { statut: "resilie"; mandat: Mandat }
  | { statut: "introuvable" }
  | { statut: "deja_resilie" }
  | { statut: "remplace" }
  | { statut: "date_incoherente" };

export async function resilierMandat(
  mandatId: string,
  input: { resilieLe: string; motifResiliation?: string },
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatResiliationMandat> {
  return executeur.transaction(async (tx) => {
    const verrou = await verrouillerMandat(mandatId, workspaceId, tx);
    if (verrou.statut !== "verrouille") return { statut: "introuvable" };
    if (verrou.ligne.resilieLe !== null) return { statut: "deja_resilie" };
    if (verrou.remplace) return { statut: "remplace" };
    if (input.resilieLe < verrou.ligne.dateDebut) return { statut: "date_incoherente" };

    const [ligne] = await tx
      .update(mandatsTable)
      .set({ resilieLe: input.resilieLe, motifResiliation: normaliserMotif(input.motifResiliation) })
      .where(eq(mandatsTable.id, mandatId))
      .returning();
    return { statut: "resilie", mandat: ligneVersMandat(ligne) };
  });
}
