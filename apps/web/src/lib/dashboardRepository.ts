import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  biens as biensTable,
  compromis as compromisTable,
  comptesRendusVisite,
  offres as offresTable,
  offreVisites as offreVisitesTable,
} from "@/db/schema";
import type { MotifPerte } from "@/types/motifPerte";

// Agrégation entièrement côté SQL (COUNT/SUM/AVG/GROUP BY par Postgres) — ADR-018. La page ne
// charge jamais les lignes métier pour recalculer en mémoire.
//
// Convention de retour : 0 est une vraie valeur (compteurs/sommes) ; `undefined` signifie
// "aucune donnée pour calculer ce taux/cette moyenne/ce délai" (dénominateur vide), jamais
// confondu avec un 0 mesuré — même principe que ADR-009 (NULL ≠ false) appliqué à l'absence
// de donnée.
//
// Règle d'archivage (ADR-018) : les métriques historiques/réalisées (Résultats, Activité,
// Délais/pertes) incluent les biens/acquéreurs archivés — une vente reste une vente après
// archivage du bien. Les métriques de Pipeline excluent les biens archivés (jointure sur
// biens.archive_le IS NULL) ; l'archivage acquéreur n'est volontairement pas pris en compte ici.

export type MontantParMois = { mois: string; montant: number };

export type DashboardResultats = {
  nombreVentes: number;
  volumeVendu: number;
  tauxCompromisVente: number | undefined;
  realiseParMois: MontantParMois[];
};

export type DashboardPipeline = {
  compromisEnCours: number;
  volumeSousCompromis: number;
  pipelinePrevisionnelParMois: MontantParMois[];
  offresEnCours: number;
  volumeOffresEnCours: number;
};

export type DashboardActivite = {
  visitesEnregistrees: number;
  offresEnregistrees: number;
  compromisEnregistres: number;
  // Calculée uniquement sur les ventes disposant d'au moins un compte rendu de visite
  // correspondant (même bienId + acquereurId, dateVisite < dateSignature). Une vente sans
  // compte rendu n'est jamais comptée comme "0 visite" — absence de donnée, pas zéro — elle est
  // exclue du dénominateur. undefined si aucune vente réalisée ne dispose d'un compte rendu.
  moyenneVisitesAvantVente: number | undefined;
  // Calculé uniquement à partir des visites explicitement associées à une offre (ADR-019, table
  // offre_visites) — jamais par rapprochement de date. undefined si aucune visite n'est
  // enregistrée. Ne rattrape jamais l'historique antérieur à la mise en place du lien : les
  // visites jamais liées manuellement restent hors du numérateur, sans exception.
  tauxVisiteOffre: number | undefined;
};

export type DashboardDelais = {
  delaiMoyenOffreCompromisJours: number | undefined;
  delaiMoyenCompromisActeJours: number | undefined;
  // Moyenne de (offre.dateOffre - visite.dateVisite) sur chaque paire explicitement liée
  // (ADR-019) — une visite liée à plusieurs offres, ou une offre liée à plusieurs visites,
  // contribue une valeur par paire. undefined si aucune paire liée n'existe.
  delaiMoyenVisiteOffreJours: number | undefined;
};

export type PerteParMotif = { motif: MotifPerte; nombre: number; volume: number };

// Convention ADR-020, symétrique à ADR-018/019 : les pertes historiques créées avant
// dateDecision/motifPerte/dateAnnulation/motifAnnulation comptent dans les totaux par étape
// (offresRefusees/offresRetirees/compromisAnnules — ne dépendent que de `statut`), mais sont
// silencieusement absentes des répartitions par motif et des séries mensuelles (qui filtrent sur
// la colonne correspondante non nulle) — jamais reclassées vers "autre", jamais approximées
// depuis dateOffre/dateSignature. Même règle d'archivage qu'ADR-018 (Résultats/Activité/
// Délais/pertes) : aucune requête ci-dessous ne filtre sur biens.archive_le.
export type DashboardPertes = {
  offresRefusees: number;
  offresRetirees: number;
  // sum(montant) où statut in (refusee, retiree) — jamais un "CA perdu" (montant proposé, jamais
  // accepté).
  volumeOffresPerdues: number;
  compromisAnnules: number;
  // sum(prixConvenu) où statut = annule — jamais un "CA perdu" (volume de transaction interrompu).
  volumeCompromisAnnules: number;
  pertesOffresParMotif: PerteParMotif[];
  pertesCompromisParMotif: PerteParMotif[];
  pertesOffresParMois: MontantParMois[];
  pertesCompromisParMois: MontantParMois[];
};

export async function chargerResultats(): Promise<DashboardResultats> {
  const [{ nombreVentes, volumeVendu }] = await getDb()
    .select({
      nombreVentes: sql<number>`count(*)::int`,
      volumeVendu: sql<number>`coalesce(sum(${compromisTable.prixConvenu}), 0)::int`,
    })
    .from(compromisTable)
    .where(and(eq(compromisTable.statut, "realise"), isNotNull(compromisTable.dateActeReelle)));

  const [{ realises, resolus }] = await getDb()
    .select({
      realises: sql<number>`count(*) filter (where ${compromisTable.statut} = 'realise' and ${compromisTable.dateActeReelle} is not null)::int`,
      resolus: sql<number>`count(*) filter (where ${compromisTable.statut} in ('realise','annule'))::int`,
    })
    .from(compromisTable);

  const realiseParMois = await getDb()
    .select({
      mois: sql<string>`to_char(date_trunc('month', ${compromisTable.dateActeReelle}), 'YYYY-MM')`,
      montant: sql<number>`sum(${compromisTable.prixConvenu})::int`,
    })
    .from(compromisTable)
    .where(and(eq(compromisTable.statut, "realise"), isNotNull(compromisTable.dateActeReelle)))
    .groupBy(sql`date_trunc('month', ${compromisTable.dateActeReelle})`)
    .orderBy(sql`date_trunc('month', ${compromisTable.dateActeReelle})`);

  return {
    nombreVentes,
    volumeVendu,
    tauxCompromisVente: resolus > 0 ? realises / resolus : undefined,
    realiseParMois,
  };
}

export async function chargerPipeline(): Promise<DashboardPipeline> {
  const [{ compromisEnCours, volumeSousCompromis }] = await getDb()
    .select({
      compromisEnCours: sql<number>`count(*)::int`,
      volumeSousCompromis: sql<number>`coalesce(sum(${compromisTable.prixConvenu}), 0)::int`,
    })
    .from(compromisTable)
    .innerJoin(biensTable, eq(compromisTable.bienId, biensTable.id))
    .where(and(eq(compromisTable.statut, "en_cours"), isNull(biensTable.archiveLe)));

  const pipelinePrevisionnelParMois = await getDb()
    .select({
      mois: sql<string>`to_char(date_trunc('month', ${compromisTable.dateActe}), 'YYYY-MM')`,
      montant: sql<number>`sum(${compromisTable.prixConvenu})::int`,
    })
    .from(compromisTable)
    .innerJoin(biensTable, eq(compromisTable.bienId, biensTable.id))
    .where(
      and(
        eq(compromisTable.statut, "en_cours"),
        isNotNull(compromisTable.dateActe),
        isNull(biensTable.archiveLe)
      )
    )
    .groupBy(sql`date_trunc('month', ${compromisTable.dateActe})`)
    .orderBy(sql`date_trunc('month', ${compromisTable.dateActe})`);

  const [{ offresEnCours, volumeOffresEnCours }] = await getDb()
    .select({
      offresEnCours: sql<number>`count(*)::int`,
      volumeOffresEnCours: sql<number>`coalesce(sum(${offresTable.montant}), 0)::int`,
    })
    .from(offresTable)
    .innerJoin(biensTable, eq(offresTable.bienId, biensTable.id))
    .where(and(eq(offresTable.statut, "en_cours"), isNull(biensTable.archiveLe)));

  return {
    compromisEnCours,
    volumeSousCompromis,
    pipelinePrevisionnelParMois,
    offresEnCours,
    volumeOffresEnCours,
  };
}

export async function chargerActivite(): Promise<DashboardActivite> {
  const [{ visitesEnregistrees }] = await getDb()
    .select({ visitesEnregistrees: sql<number>`count(*)::int` })
    .from(comptesRendusVisite);
  const [{ offresEnregistrees }] = await getDb()
    .select({ offresEnregistrees: sql<number>`count(*)::int` })
    .from(offresTable);
  const [{ compromisEnregistres }] = await getDb()
    .select({ compromisEnregistres: sql<number>`count(*)::int` })
    .from(compromisTable);

  // Sous-requête corrélée (nombre de comptes rendus par vente) non exprimable proprement via le
  // query builder — SQL brut paramétré, seule fonction du fichier écrite ainsi. Le filtre
  // "where visite_count > 0" exclut les ventes sans compte rendu du dénominateur (jamais
  // comptées comme 0 visite) — voir ADR-018.
  const resultat = await getDb().execute<{ moyenne: string | null }>(sql`
    select avg(visite_count)::float as moyenne from (
      select (
        select count(*) from comptes_rendus_visite v
        where v.bien_id = c.bien_id and v.acquereur_id = c.acquereur_id and v.date_visite < c.date_signature
      ) as visite_count
      from compromis c
      where c.statut = 'realise' and c.date_acte_reelle is not null
    ) sous_requete
    where visite_count > 0
  `);
  const moyenneBrute = resultat[0]?.moyenne;
  const moyenneVisitesAvantVente = moyenneBrute === null || moyenneBrute === undefined ? undefined : Number(moyenneBrute);

  // Numérateur : comptes rendus distincts référencés par au moins une ligne offre_visites
  // (ADR-019) — un lien explicite, jamais une proximité de date. Dénominateur : tous les comptes
  // rendus enregistrés (visitesEnregistrees ci-dessus).
  const [{ visitesAvecOffre }] = await getDb()
    .select({
      visitesAvecOffre: sql<number>`count(distinct ${offreVisitesTable.compteRenduVisiteId})::int`,
    })
    .from(offreVisitesTable);
  const tauxVisiteOffre = visitesEnregistrees > 0 ? visitesAvecOffre / visitesEnregistrees : undefined;

  return { visitesEnregistrees, offresEnregistrees, compromisEnregistres, moyenneVisitesAvantVente, tauxVisiteOffre };
}

export async function chargerDelais(): Promise<DashboardDelais> {
  const offreCompromisResultat = await getDb()
    .select({ moyenne: sql<string | null>`avg(${compromisTable.dateSignature} - ${offresTable.dateOffre})` })
    .from(compromisTable)
    .innerJoin(offresTable, eq(compromisTable.offreId, offresTable.id));
  const delaiMoyenOffreCompromisJours =
    offreCompromisResultat[0]?.moyenne == null ? undefined : Number(offreCompromisResultat[0].moyenne);

  const compromisActeResultat = await getDb()
    .select({ moyenne: sql<string | null>`avg(${compromisTable.dateActeReelle} - ${compromisTable.dateSignature})` })
    .from(compromisTable)
    .where(and(eq(compromisTable.statut, "realise"), isNotNull(compromisTable.dateActeReelle)));
  const delaiMoyenCompromisActeJours =
    compromisActeResultat[0]?.moyenne == null ? undefined : Number(compromisActeResultat[0].moyenne);

  // Une ligne par paire (visite, offre) explicitement liée (ADR-019) — une même visite ou une
  // même offre peut contribuer plusieurs fois si elle est liée à plusieurs offres/visites.
  const visiteOffreResultat = await getDb()
    .select({ moyenne: sql<string | null>`avg(${offresTable.dateOffre} - ${comptesRendusVisite.dateVisite})` })
    .from(offreVisitesTable)
    .innerJoin(offresTable, eq(offreVisitesTable.offreId, offresTable.id))
    .innerJoin(comptesRendusVisite, eq(offreVisitesTable.compteRenduVisiteId, comptesRendusVisite.id));
  const delaiMoyenVisiteOffreJours =
    visiteOffreResultat[0]?.moyenne == null ? undefined : Number(visiteOffreResultat[0].moyenne);

  return { delaiMoyenOffreCompromisJours, delaiMoyenCompromisActeJours, delaiMoyenVisiteOffreJours };
}

export async function chargerPertes(): Promise<DashboardPertes> {
  const [{ offresRefusees, offresRetirees, volumeOffresPerdues }] = await getDb()
    .select({
      offresRefusees: sql<number>`count(*) filter (where ${offresTable.statut} = 'refusee')::int`,
      offresRetirees: sql<number>`count(*) filter (where ${offresTable.statut} = 'retiree')::int`,
      volumeOffresPerdues: sql<number>`coalesce(sum(${offresTable.montant}) filter (where ${offresTable.statut} in ('refusee','retiree')), 0)::int`,
    })
    .from(offresTable);

  const [{ compromisAnnules, volumeCompromisAnnules }] = await getDb()
    .select({
      compromisAnnules: sql<number>`count(*)::int`,
      volumeCompromisAnnules: sql<number>`coalesce(sum(${compromisTable.prixConvenu}), 0)::int`,
    })
    .from(compromisTable)
    .where(eq(compromisTable.statut, "annule"));

  // motif_perte/motif_annulation non nul uniquement (ADR-020) — une perte historique sans motif
  // compte dans offresRefusees/offresRetirees/compromisAnnules ci-dessus, jamais ici : ne jamais
  // reclassifier un motif inconnu vers "autre".
  const pertesOffresParMotifBrut = await getDb()
    .select({
      motif: offresTable.motifPerte,
      nombre: sql<number>`count(*)::int`,
      volume: sql<number>`coalesce(sum(${offresTable.montant}), 0)::int`,
    })
    .from(offresTable)
    .where(and(inArray(offresTable.statut, ["refusee", "retiree"]), isNotNull(offresTable.motifPerte)))
    .groupBy(offresTable.motifPerte);
  const pertesOffresParMotif: PerteParMotif[] = pertesOffresParMotifBrut.map((ligne) => ({
    motif: ligne.motif as MotifPerte,
    nombre: ligne.nombre,
    volume: ligne.volume,
  }));

  const pertesCompromisParMotifBrut = await getDb()
    .select({
      motif: compromisTable.motifAnnulation,
      nombre: sql<number>`count(*)::int`,
      volume: sql<number>`coalesce(sum(${compromisTable.prixConvenu}), 0)::int`,
    })
    .from(compromisTable)
    .where(and(eq(compromisTable.statut, "annule"), isNotNull(compromisTable.motifAnnulation)))
    .groupBy(compromisTable.motifAnnulation);
  const pertesCompromisParMotif: PerteParMotif[] = pertesCompromisParMotifBrut.map((ligne) => ({
    motif: ligne.motif as MotifPerte,
    nombre: ligne.nombre,
    volume: ligne.volume,
  }));

  // date_decision/date_annulation non nulle uniquement — jamais approximé depuis dateOffre/
  // dateSignature (la date de création, pas de la perte).
  const pertesOffresParMois = await getDb()
    .select({
      mois: sql<string>`to_char(date_trunc('month', ${offresTable.dateDecision}), 'YYYY-MM')`,
      montant: sql<number>`sum(${offresTable.montant})::int`,
    })
    .from(offresTable)
    .where(and(inArray(offresTable.statut, ["refusee", "retiree"]), isNotNull(offresTable.dateDecision)))
    .groupBy(sql`date_trunc('month', ${offresTable.dateDecision})`)
    .orderBy(sql`date_trunc('month', ${offresTable.dateDecision})`);

  const pertesCompromisParMois = await getDb()
    .select({
      mois: sql<string>`to_char(date_trunc('month', ${compromisTable.dateAnnulation}), 'YYYY-MM')`,
      montant: sql<number>`sum(${compromisTable.prixConvenu})::int`,
    })
    .from(compromisTable)
    .where(and(eq(compromisTable.statut, "annule"), isNotNull(compromisTable.dateAnnulation)))
    .groupBy(sql`date_trunc('month', ${compromisTable.dateAnnulation})`)
    .orderBy(sql`date_trunc('month', ${compromisTable.dateAnnulation})`);

  return {
    offresRefusees,
    offresRetirees,
    volumeOffresPerdues,
    compromisAnnules,
    volumeCompromisAnnules,
    pertesOffresParMotif,
    pertesCompromisParMotif,
    pertesOffresParMois,
    pertesCompromisParMois,
  };
}
