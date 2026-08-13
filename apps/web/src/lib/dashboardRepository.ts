import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  biens as biensTable,
  compromis as compromisTable,
  comptesRendusVisite,
  offres as offresTable,
  offreVisites as offreVisitesTable,
  remuneration as remunerationTable,
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
  // query builder — SQL brut paramétré (avec chargerProjectionAnnuelle, ADR-022, l'un des deux
  // seuls endroits du fichier écrits ainsi). Le filtre "where visite_count > 0" exclut les ventes
  // sans compte rendu du dénominateur (jamais comptées comme 0 visite) — voir ADR-018.
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

// Type dédié — MontantParMois existant représente des volumes immobiliers en euros
// (prixConvenu/montant), jamais des centimes de rémunération. Ne pas réutiliser : les deux types
// doivent rester impossibles à confondre au typage.
export type MontantCentimesParMois = { mois: string; montantCentimes: number };

// ADR-021. Trois états mutuellement exclusifs — chaque ligne remuneration ne peut apparaître que
// dans un seul des trois champs de somme (construits sur des filtres WHERE/filter disjoints sur
// (compromis.statut, date_encaissement_reelle IS NULL)).
//
// Règle d'archivage, volontairement asymétrique : remunerationPrevisionnelleCentimes exclut les
// biens archivés (même règle que chargerPipeline — c'est une métrique de pipeline actif, pas
// d'historique) ; les deux métriques "vente finalisée" incluent les biens archivés (comme
// chargerResultats — le suivi financier d'une vente déjà conclue ne s'arrête pas à l'archivage du
// dossier commercial, ADR-021). Ne jamais uniformiser ces trois règles.
//
// Convention undefined vs 0 (inconnu ≠ zéro, ADR-021) : chaque somme utilise `sum(...) filter
// (where ...)` sans coalesce — Postgres renvoie NULL (mappé en undefined ici) quand aucune ligne ne
// correspond au filtre, jamais une somme à 0.
//
// Indicateurs de couverture, jamais un total silencieusement partiel : une somme sur une population
// où seule une fraction des lignes a une rémunération renseignée serait trompeuse. Les compteurs
// sont calculés par un simple count(*) sur la même population filtrée que la somme correspondante —
// jamais déduits de la somme elle-même.
export type DashboardRemuneration = {
  remunerationPrevisionnelleCentimes: number | undefined;
  nombreRemunerationsPrevisionnellesRenseignees: number;
  nombreCompromisEnCoursEligibles: number;
  remunerationVenteFinaliseeNonEncaisseeCentimes: number | undefined;
  remunerationEncaisseeCentimes: number | undefined;
  nombreRemunerationsVentesFinaliseesRenseignees: number;
  nombreVentesFinalisees: number;
  remunerationEncaisseeParMoisCentimes: MontantCentimesParMois[];
};

export async function chargerRemuneration(): Promise<DashboardRemuneration> {
  const [previsionnel] = await getDb()
    .select({
      nombreRenseignees: sql<number>`count(*) filter (where ${remunerationTable.id} is not null)::int`,
      nombreEligibles: sql<number>`count(*)::int`,
      somme: sql<number | null>`sum(${remunerationTable.montantRemunerationConseillerCentimes})::int`,
    })
    .from(compromisTable)
    .innerJoin(biensTable, eq(compromisTable.bienId, biensTable.id))
    .leftJoin(remunerationTable, eq(remunerationTable.compromisId, compromisTable.id))
    .where(and(eq(compromisTable.statut, "en_cours"), isNull(biensTable.archiveLe)));

  const [venteFinalisee] = await getDb()
    .select({
      nombreVentesFinalisees: sql<number>`count(*)::int`,
      nombreRenseignees: sql<number>`count(*) filter (where ${remunerationTable.id} is not null)::int`,
      sommeNonEncaissee: sql<number | null>`sum(${remunerationTable.montantRemunerationConseillerCentimes}) filter (where ${remunerationTable.dateEncaissementReelle} is null)::int`,
      sommeEncaissee: sql<number | null>`sum(${remunerationTable.montantRemunerationConseillerCentimes}) filter (where ${remunerationTable.dateEncaissementReelle} is not null)::int`,
    })
    .from(compromisTable)
    .leftJoin(remunerationTable, eq(remunerationTable.compromisId, compromisTable.id))
    .where(eq(compromisTable.statut, "realise"));

  const remunerationEncaisseeParMoisCentimes = await getDb()
    .select({
      mois: sql<string>`to_char(date_trunc('month', ${remunerationTable.dateEncaissementReelle}), 'YYYY-MM')`,
      montantCentimes: sql<number>`sum(${remunerationTable.montantRemunerationConseillerCentimes})::int`,
    })
    .from(remunerationTable)
    .innerJoin(compromisTable, eq(remunerationTable.compromisId, compromisTable.id))
    .where(and(eq(compromisTable.statut, "realise"), isNotNull(remunerationTable.dateEncaissementReelle)))
    .groupBy(sql`date_trunc('month', ${remunerationTable.dateEncaissementReelle})`)
    .orderBy(sql`date_trunc('month', ${remunerationTable.dateEncaissementReelle})`);

  return {
    remunerationPrevisionnelleCentimes: previsionnel.somme ?? undefined,
    nombreRemunerationsPrevisionnellesRenseignees: previsionnel.nombreRenseignees,
    nombreCompromisEnCoursEligibles: previsionnel.nombreEligibles,
    remunerationVenteFinaliseeNonEncaisseeCentimes: venteFinalisee.sommeNonEncaissee ?? undefined,
    remunerationEncaisseeCentimes: venteFinalisee.sommeEncaissee ?? undefined,
    nombreRemunerationsVentesFinaliseesRenseignees: venteFinalisee.nombreRenseignees,
    nombreVentesFinalisees: venteFinalisee.nombreVentesFinalisees,
    remunerationEncaisseeParMoisCentimes,
  };
}

// ADR-022. Vue "année en cours" de la rémunération, scindée de chargerRemuneration() (même
// logique qu'ADR-020 chargerDelaisPertes -> chargerDelais/chargerPertes) : chargerRemuneration()
// reste le snapshot 3-états stable et déjà testé, cette fonction est dédiée à l'année civile en
// cours (janvier -> décembre) et n'appelle jamais chargerRemuneration() — convention du fichier,
// chaque charger* est indépendante, composée uniquement via Promise.all dans dashboard/page.tsx.
//
// Réutilisation obligatoire, jamais dupliquée ici : nombreCompromisEnCoursEligibles/
// nombreRemunerationsPrevisionnellesRenseignees et nombreVentesFinalisees/
// nombreRemunerationsVentesFinaliseesRenseignees viennent tous de chargerRemuneration() — la page
// compose les deux résultats pour afficher les ratios de couverture à plusieurs niveaux.
export type MontantCentimesParMoisAnnuel = {
  mois: string; // "YYYY-MM", toujours 12 entrées consécutives janvier -> décembre de l'année en cours
  previsionnelCentimes: number; // jamais undefined : un mois zero-rempli est un vrai 0 mesuré
  finaliseNonEncaisseCentimes: number;
  encaisseCentimes: number;
};

export type DashboardProjectionAnnuelle = {
  annee: number;

  // sum(montant) où compromis.statut = 'realise' et date_encaissement_reelle dans l'année en cours.
  // Biens archivés INCLUS (même règle que remunerationEncaisseeCentimes de chargerRemuneration()).
  // Pas de compteur de couverture : dateEncaissementReelle n'est jamais absente pour une ligne
  // encaissée (posée atomiquement par marquerRemunerationEncaissee, ADR-021).
  encaisseDepuisJanvierCentimes: number | undefined;

  // sum(montant) où compromis.statut = 'en_cours', bien NON archivé, date_encaissement_prevue
  // entre aujourd'hui et le 31/12 de l'année en cours. Ne mélange JAMAIS les compromis realise non
  // encaissés (décision explicite, ADR-022).
  previsionnelRestantCentimes: number | undefined;
  // Troisième niveau de couverture uniquement (les deux premiers viennent de chargerRemuneration()) :
  // a une dateEncaissementPrevue renseignée, quelle que soit sa valeur (passée, dans la fenêtre, ou
  // après le 31/12) — mesure la discipline de saisie, jamais la fenêtre elle-même.
  nombreRemunerationsPrevisionnellesAvecDatePrevue: number;

  // sum(montant) où compromis.statut = 'realise', date_encaissement_reelle IS NULL,
  // date_encaissement_prevue IS NOT NULL et < aujourd'hui. Biens archivés INCLUS (ADR-021 :
  // l'archivage ne clôt jamais le suivi financier d'une vente déjà conclue). Libellé UI obligatoire
  // "Encaissement(s) attendu(s) dépassé(s)" — jamais "retard" (ADR-022).
  encaissementsAttendusDepassesCentimes: number | undefined;
  nombreEncaissementsAttendusDepasses: number; // nombre de ventes concernées (un compte, pas une couverture)
  // Troisième niveau de couverture, sur la sous-population (realise, date_encaissement_reelle IS
  // NULL) — ni le numérateur ni le dénominateur n'existent dans chargerRemuneration() (son
  // dénominateur mélange encaissées et non encaissées), recalculés ici en entier.
  nombreFinaliseNonEncaisseAvecDatePrevue: number;
  nombreFinaliseNonEncaisseRenseignees: number;

  // ADR-024 (moteur fiscal année courante) : sum(montant) où compromis.statut = 'realise',
  // date_encaissement_reelle IS NULL, date_encaissement_prevue entre aujourd'hui et le 31/12 de
  // l'année en cours — symétrique de encaissementsAttendusDepassesCentimes (même sous-population,
  // fenêtre inverse : "à venir" plutôt que "dépassée"). Même mapping undefined/0 : aucune date
  // prévue connue dans cette sous-population ⇒ undefined ; des dates connues mais aucune dans la
  // fenêtre ⇒ 0 mesuré.
  finaliseNonEncaisseRestantCentimes: number | undefined;
  nombreFinaliseNonEncaisseRestant: number; // sous-population avec date prévue dans la fenêtre restante

  ventilationMensuelle: MontantCentimesParMoisAnnuel[]; // toujours 12 entrées, zero-remplies
};

export async function chargerProjectionAnnuelle(): Promise<DashboardProjectionAnnuelle> {
  const [{ somme: encaisseDepuisJanvierBrut }] = await getDb()
    .select({
      somme: sql<number | null>`sum(${remunerationTable.montantRemunerationConseillerCentimes})::int`,
    })
    .from(remunerationTable)
    .innerJoin(compromisTable, eq(remunerationTable.compromisId, compromisTable.id))
    .where(
      and(
        eq(compromisTable.statut, "realise"),
        isNotNull(remunerationTable.dateEncaissementReelle),
        sql`date_trunc('year', ${remunerationTable.dateEncaissementReelle}) = date_trunc('year', current_date)`
      )
    );

  const [previsionnel] = await getDb()
    .select({
      nombreAvecDatePrevue: sql<number>`count(*) filter (where ${remunerationTable.dateEncaissementPrevue} is not null)::int`,
      sommeFenetre: sql<number | null>`sum(${remunerationTable.montantRemunerationConseillerCentimes}) filter (where ${remunerationTable.dateEncaissementPrevue} >= current_date and ${remunerationTable.dateEncaissementPrevue} <= date_trunc('year', current_date) + interval '1 year' - interval '1 day')::int`,
    })
    .from(compromisTable)
    .innerJoin(biensTable, eq(compromisTable.bienId, biensTable.id))
    .leftJoin(remunerationTable, eq(remunerationTable.compromisId, compromisTable.id))
    .where(and(eq(compromisTable.statut, "en_cours"), isNull(biensTable.archiveLe)));

  const [depasse] = await getDb()
    .select({
      nombreRenseignees: sql<number>`count(*) filter (where ${remunerationTable.id} is not null)::int`,
      nombreAvecDatePrevue: sql<number>`count(*) filter (where ${remunerationTable.dateEncaissementPrevue} is not null)::int`,
      nombreDepasses: sql<number>`count(*) filter (where ${remunerationTable.dateEncaissementPrevue} is not null and ${remunerationTable.dateEncaissementPrevue} < current_date)::int`,
      sommeDepassee: sql<number | null>`sum(${remunerationTable.montantRemunerationConseillerCentimes}) filter (where ${remunerationTable.dateEncaissementPrevue} is not null and ${remunerationTable.dateEncaissementPrevue} < current_date)::int`,
    })
    .from(compromisTable)
    .leftJoin(remunerationTable, eq(remunerationTable.compromisId, compromisTable.id))
    .where(and(eq(compromisTable.statut, "realise"), isNull(remunerationTable.dateEncaissementReelle)));

  // ADR-024 : même sous-population que `depasse` (realise, non encaissée), fenêtre inverse —
  // date_encaissement_prevue entre aujourd'hui et le 31/12, jamais fusionnée avec `depasse`
  // (mutuellement exclusives : une date prévue ne peut pas être à la fois < aujourd'hui et dans la
  // fenêtre restante).
  const [restant] = await getDb()
    .select({
      nombreAvecDatePrevue: sql<number>`count(*) filter (where ${remunerationTable.dateEncaissementPrevue} is not null)::int`,
      sommeFenetre: sql<number | null>`sum(${remunerationTable.montantRemunerationConseillerCentimes}) filter (where ${remunerationTable.dateEncaissementPrevue} >= current_date and ${remunerationTable.dateEncaissementPrevue} <= date_trunc('year', current_date) + interval '1 year' - interval '1 day')::int`,
    })
    .from(compromisTable)
    .leftJoin(remunerationTable, eq(remunerationTable.compromisId, compromisTable.id))
    .where(and(eq(compromisTable.statut, "realise"), isNull(remunerationTable.dateEncaissementReelle)));

  // Deuxième usage de SQL brut paramétré du fichier (avec chargerActivite) : generate_series
  // fournit une spine de 12 mois (janvier -> décembre de l'année en cours), les trois LEFT JOIN
  // zero-remplissent chaque catégorie via coalesce(...,0) — seul endroit de ce fichier où
  // coalesce(...,0) est correct : un mois sans ligne est une vraie mesure (0), pas une absence de
  // donnée globale (voir chargerRemuneration ci-dessus pour la convention inverse).
  const ventilationBrute = await getDb().execute<{
    annee: number;
    mois: string;
    previsionnel_centimes: number;
    finalise_non_encaisse_centimes: number;
    encaisse_centimes: number;
  }>(sql`
    with mois as (
      select generate_series(
        date_trunc('year', current_date),
        date_trunc('year', current_date) + interval '11 months',
        interval '1 month'
      ) as debut
    ),
    previsionnel_mois as (
      select date_trunc('month', r.date_encaissement_prevue) as debut,
             sum(r.montant_remuneration_conseiller_centimes) as somme
      from remuneration r
      join compromis c on c.id = r.compromis_id
      join biens b on b.id = c.bien_id
      where c.statut = 'en_cours'
        and b.archive_le is null
        and r.date_encaissement_prevue is not null
        and date_trunc('year', r.date_encaissement_prevue) = date_trunc('year', current_date)
      group by 1
    ),
    finalise_mois as (
      select date_trunc('month', r.date_encaissement_prevue) as debut,
             sum(r.montant_remuneration_conseiller_centimes) as somme
      from remuneration r
      join compromis c on c.id = r.compromis_id
      where c.statut = 'realise'
        and r.date_encaissement_reelle is null
        and r.date_encaissement_prevue is not null
        and date_trunc('year', r.date_encaissement_prevue) = date_trunc('year', current_date)
      group by 1
    ),
    encaisse_mois as (
      select date_trunc('month', r.date_encaissement_reelle) as debut,
             sum(r.montant_remuneration_conseiller_centimes) as somme
      from remuneration r
      join compromis c on c.id = r.compromis_id
      where c.statut = 'realise'
        and r.date_encaissement_reelle is not null
        and date_trunc('year', r.date_encaissement_reelle) = date_trunc('year', current_date)
      group by 1
    )
    select
      extract(year from current_date)::int as annee,
      to_char(mois.debut, 'YYYY-MM') as mois,
      coalesce(previsionnel_mois.somme, 0)::int as previsionnel_centimes,
      coalesce(finalise_mois.somme, 0)::int as finalise_non_encaisse_centimes,
      coalesce(encaisse_mois.somme, 0)::int as encaisse_centimes
    from mois
    left join previsionnel_mois on previsionnel_mois.debut = mois.debut
    left join finalise_mois on finalise_mois.debut = mois.debut
    left join encaisse_mois on encaisse_mois.debut = mois.debut
    order by mois.debut
  `);

  const ventilationMensuelle: MontantCentimesParMoisAnnuel[] = ventilationBrute.map((ligne) => ({
    mois: ligne.mois,
    previsionnelCentimes: ligne.previsionnel_centimes,
    finaliseNonEncaisseCentimes: ligne.finalise_non_encaisse_centimes,
    encaisseCentimes: ligne.encaisse_centimes,
  }));

  // Mapping undefined/0/somme : ne jamais se contenter du NULL naturel de SUM ... FILTER, qui
  // confondrait "aucune date connue" (vraiment inconnu) et "des dates connues mais aucune dans la
  // fenêtre" (un vrai zéro mesuré) — voir ADR-022.
  const previsionnelRestantCentimes =
    previsionnel.nombreAvecDatePrevue === 0 ? undefined : (previsionnel.sommeFenetre ?? 0);
  const encaissementsAttendusDepassesCentimes =
    depasse.nombreAvecDatePrevue === 0 ? undefined : (depasse.sommeDepassee ?? 0);
  const finaliseNonEncaisseRestantCentimes =
    restant.nombreAvecDatePrevue === 0 ? undefined : (restant.sommeFenetre ?? 0);

  return {
    annee: ventilationBrute[0]?.annee ?? new Date().getFullYear(),
    encaisseDepuisJanvierCentimes: encaisseDepuisJanvierBrut ?? undefined,
    previsionnelRestantCentimes,
    nombreRemunerationsPrevisionnellesAvecDatePrevue: previsionnel.nombreAvecDatePrevue,
    encaissementsAttendusDepassesCentimes,
    nombreEncaissementsAttendusDepasses: depasse.nombreDepasses,
    nombreFinaliseNonEncaisseAvecDatePrevue: depasse.nombreAvecDatePrevue,
    nombreFinaliseNonEncaisseRenseignees: depasse.nombreRenseignees,
    finaliseNonEncaisseRestantCentimes,
    nombreFinaliseNonEncaisseRestant: restant.nombreAvecDatePrevue,
    ventilationMensuelle,
  };
}
