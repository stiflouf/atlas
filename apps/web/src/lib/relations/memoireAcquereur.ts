import { deriverStatutTache, deriverRouteFicheCible, type Tache } from "@/types/tache";
import { trierParPriorite } from "@/lib/tachePriority";
import { LABEL_INTERET, type CompteRenduVisite } from "@/types/compteRenduVisite";
import { deriverEtatEnvoiEmail, type EnvoiEmail } from "@/types/envoiEmail";
import type { ProfilAcquereur, StadeProjet } from "@/types/client";
import type { SecteurRecherche } from "@/types/secteurRecherche";
import type { Visite } from "@/types/visite";
import type { Offre } from "@/types/offre";
import type { Compromis } from "@/types/compromis";
import type { Bien } from "@/types/bien";
import type { Opportunite } from "@/types/opportunite";

// VALUE-03 — read model PUR de la mémoire relationnelle d'un acquéreur. Aucune requête, aucune
// persistance, aucun cache, aucune table : tout est dérivé à la lecture de faits déjà en base,
// exactement comme deriverHistoriqueBien (ADR-014) et deriverJournalProspectVendeur (ADR-027).
//
// Ce module n'est PAS un moteur de décision : il ne réinvente ni le statut de l'acquéreur
// (stadeProjet reste le seul statut réel, ADR-034 côté compatibilité), ni les règles
// d'opportunité (VALUE-01), ni l'orchestration post-visite (VALUE-02). Il remet en lumière, au
// bon endroit, ce que ces sources ont déjà décidé.
//
// `acquereurs.notes` et `acquereurs.criteres` (textes libres) ne sont JAMAIS lus ici : aucun fait
// structuré ne peut en être extrait sans interprétation, et c'est exactement ce que ce lot
// s'interdit. Le retour libre d'un compte rendu (`compteRendu.retour`) est exclu pour la même
// raison — seul `interet`, valeur contrôlée, alimente la mémoire.

export type TypeEvenementMemoire =
  | "premier_contact"
  | "visite_prevue"
  | "visite_realisee"
  | "visite_annulee"
  | "offre_deposee"
  | "offre_decidee"
  | "compromis_signe"
  | "compromis_finalise"
  | "compromis_annule"
  | "email_envoye"
  | "tache_terminee";

export type ProvenanceMemoire = "acquereur" | "visite" | "offre" | "compromis" | "email" | "tache";

export type EvenementMemoire = {
  // Déterministe (`type:idSource`), jamais un UUID généré : deux constructions du même contexte
  // produisent exactement les mêmes ids, donc le même ordre.
  id: string;
  type: TypeEvenementMemoire;
  // Date MÉTIER du fait, jamais une date technique de ligne. Jamais fabriquée : un fait dont la
  // date fiable manque ne produit tout simplement pas d'événement.
  date: string;
  titre: string;
  detail?: string;
  provenance: ProvenanceMemoire;
  // Toujours un écran déjà existant, jamais un lien construit à l'aveugle.
  href?: string;
  // 1 = jalon commercial majeur, 2 = fait relationnel, 3 = contexte. Sert uniquement à choisir
  // DÉTERMINISTEMENT quoi garder quand l'historique dépasse la limite de lecture — jamais un score
  // affiché, jamais une probabilité.
  importance: 1 | 2 | 3;
};

export type FaitARetenir = { cle: string; libelle: string; valeur: string };

export type ActionMemoire = {
  cle: string;
  // `tache` = action réellement persistée ; `opportunite` = situation détectée par VALUE-01 et
  // NON encore couverte par une tâche (la déduplication est faite par le moteur, pas ici).
  source: "tache" | "opportunite";
  titre: string;
  detail?: string;
  href?: string;
};

export type MemoireRelationnelleAcquereur = {
  etatActuel: { libelle: string; precisions: string[] };
  faitsARetenir: FaitARetenir[];
  historique: EvenementMemoire[];
  actions: ActionMemoire[];
};

// Lisible en moins de dix secondes : au-delà, la mémoire redevient le journal que le conseiller
// devait déjà relire. Pas de pagination, pas d'accordéon — la sélection ci-dessous est déterministe.
export const MAXIMUM_EVENEMENTS_MEMOIRE = 8;
export const MAXIMUM_ACTIONS_MEMOIRE = 4;

const LABEL_STADE_PROJET: Record<StadeProjet, string> = {
  decouverte: "Découverte",
  recherche_active: "Recherche active",
  offre: "En attente d'offre",
  compromis: "Compromis",
  acte: "Acte",
};

function formatPrix(montant: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    montant
  );
}

function formatJour(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function libelleBien(bien: Bien | undefined): string {
  return bien ? bien.reference : "bien indisponible";
}

// ---------------------------------------------------------------------------
// Sélection des tâches réellement liées à la relation
// ---------------------------------------------------------------------------

// Une tâche appartient à cette relation si sa cible EST l'acquéreur, ou l'un des objets nés de sa
// relation avec l'agence (visite, offre, compromis). Rapprochement par FK réelle (ADR-028)
// uniquement — jamais par comparaison de libellés. C'est ce qui permet de faire remonter
// « Confirmer la date de l'acte avec l'étude notariale » (tâche portée par le compromis) comme
// prochaine action de l'acquéreur, alors qu'elle ne porte pas son id.
//
// Exportée parce que la page en a besoin AVANT d'appeler la mémoire : c'est cet ensemble d'ids qui
// détermine quels envois d'email sont rattachables à cette relation.
export function selectionnerTachesLieesAcquereur(
  taches: Tache[],
  acquereurId: string,
  visites: Visite[],
  offres: Offre[],
  compromis: Compromis[]
): Tache[] {
  const idsVisites = new Set(visites.map((v) => v.id));
  const idsOffres = new Set(offres.map((o) => o.id));
  const idsCompromis = new Set(compromis.map((c) => c.id));

  return taches.filter(
    (t) =>
      t.acquereurId === acquereurId ||
      (t.visiteId !== undefined && idsVisites.has(t.visiteId)) ||
      (t.offreId !== undefined && idsOffres.has(t.offreId)) ||
      (t.compromisId !== undefined && idsCompromis.has(t.compromisId))
  );
}

// ---------------------------------------------------------------------------
// État actuel
// ---------------------------------------------------------------------------

// `stadeProjet` reste le seul statut canonique de l'acquéreur — aucune machine à états parallèle
// n'est créée ici. Les précisions ne font qu'ajouter LE fait qui décrit le présent, choisi par une
// cascade du plus avancé au moins avancé : afficher à la fois « Offre acceptée » et « Compromis en
// cours » raconterait le passé, pas l'état courant.
function deriverEtatActuel(entrees: {
  acquereur: ProfilAcquereur;
  visites: Visite[];
  offres: Offre[];
  compromis: Compromis[];
  aujourdHui: string;
}): { libelle: string; precisions: string[] } {
  const { acquereur, visites, offres, compromis, aujourdHui } = entrees;
  const precisions: string[] = [];

  if (acquereur.archiveLe) precisions.push("Fiche archivée");

  const compromisRealise = compromis.find((c) => c.statut === "realise" && c.dateActeReelle);
  const compromisEnCours = compromis.find((c) => c.statut === "en_cours");
  const offreAcceptee = offres.find((o) => o.statut === "acceptee");
  const offreEnCours = offres.find((o) => o.statut === "en_cours");

  if (compromisRealise) {
    precisions.push(`Acte signé le ${formatJour(compromisRealise.dateActeReelle!)}`);
  } else if (compromisEnCours) {
    precisions.push(
      compromisEnCours.dateActe
        ? `Compromis signé, acte prévu le ${formatJour(compromisEnCours.dateActe)}`
        : "Compromis signé"
    );
  } else if (offreAcceptee) {
    precisions.push(`Offre acceptée — ${formatPrix(offreAcceptee.montant)}`);
  } else if (offreEnCours) {
    precisions.push(`Offre en cours — ${formatPrix(offreEnCours.montant)}`);
  }

  // Une visite encore planifiée est un fait du présent quelle que soit l'avancée commerciale :
  // elle se cumule donc avec la précision ci-dessus plutôt que de la remplacer. Comparaison sur le
  // jour civil : une visite prévue aujourd'hui est encore à venir.
  const prochaineVisite = visites
    .filter((v) => v.statut === "planifiee" && v.datePrevue >= aujourdHui)
    .sort((a, b) => (a.datePrevue < b.datePrevue ? -1 : 1))[0];
  if (prochaineVisite) precisions.push(`Visite prévue le ${formatJour(prochaineVisite.datePrevue)}`);

  return { libelle: LABEL_STADE_PROJET[acquereur.stadeProjet], precisions };
}

// ---------------------------------------------------------------------------
// Faits à retenir
// ---------------------------------------------------------------------------

// Uniquement des champs STRUCTURÉS du modèle, dans l'ordre où un conseiller les rappelle avant
// d'appeler. `budgetMax` et non budgetMin : c'est le seul des deux que le moteur de compatibilité
// lit réellement (criteres.ts). Une contrainte n'est retenue que lorsqu'elle vaut explicitement
// `true` — `false` (« non requis ») et `undefined` (inconnu, ADR-009) ne discriminent rien et
// transformeraient cette liste en recopie de formulaire.
function deriverFaitsARetenir(acquereur: ProfilAcquereur, secteurs: SecteurRecherche[]): FaitARetenir[] {
  const faits: FaitARetenir[] = [{ cle: "budget", libelle: "Budget maximum", valeur: formatPrix(acquereur.budgetMax) }];

  if (secteurs.length > 0) {
    faits.push({
      cle: "secteurs",
      libelle: secteurs.length > 1 ? "Secteurs recherchés" : "Secteur recherché",
      valeur: secteurs.map((s) => s.nomCommune).join(", "),
    });
  }
  if (acquereur.piecesMin !== undefined) {
    faits.push({ cle: "pieces", libelle: "Pièces minimum", valeur: String(acquereur.piecesMin) });
  }
  if (acquereur.surfaceMin !== undefined) {
    faits.push({ cle: "surface", libelle: "Surface minimum", valeur: `${acquereur.surfaceMin} m²` });
  }
  if (acquereur.necessiteExterieur === true) {
    faits.push({ cle: "exterieur", libelle: "Extérieur", valeur: "Indispensable" });
  }
  if (acquereur.necessiteParking === true) {
    faits.push({ cle: "parking", libelle: "Stationnement", valeur: "Indispensable" });
  }
  if (acquereur.accessibiliteRequise === true) {
    faits.push({ cle: "accessibilite", libelle: "Accessibilité", valeur: "Indispensable" });
  }

  return faits;
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

function deriverHistoriqueComplet(entrees: {
  acquereur: ProfilAcquereur;
  visites: Visite[];
  comptesRendus: CompteRenduVisite[];
  offres: Offre[];
  compromis: Compromis[];
  tachesLiees: Tache[];
  envois: EnvoiEmail[];
  biensParId: ReadonlyMap<string, Bien | undefined>;
}): EvenementMemoire[] {
  const { acquereur, visites, comptesRendus, offres, compromis, tachesLiees, envois, biensParId } = entrees;
  const evenements: EvenementMemoire[] = [];

  evenements.push({
    id: `premier_contact:${acquereur.id}`,
    type: "premier_contact",
    date: acquereur.datePremiereContact,
    titre: "Premier contact",
    provenance: "acquereur",
    importance: 3,
  });

  // Rattachement compte rendu -> visite par visiteId (ADR-040) ; à défaut — comptes rendus
  // antérieurs à cette ADR — par la coïncidence exacte bien + acquéreur + date, jamais par simple
  // proximité. Même règle que regleSuiviVisite (VALUE-01) : une seule définition du rapprochement
  // dans le produit, pas deux qui divergeraient.
  const compteRenduDeLaVisite = (visite: Visite) =>
    comptesRendus.find(
      (cr) =>
        cr.visiteId === visite.id ||
        (cr.visiteId === undefined &&
          cr.bienId === visite.bienId &&
          cr.acquereurId === visite.acquereurId &&
          cr.dateVisite === visite.datePrevue)
    );

  const comptesRendusRattaches = new Set<string>();

  for (const visite of visites) {
    const bien = biensParId.get(visite.bienId);
    const href = `/visites/${visite.id}`;

    if (visite.statut === "annulee") {
      evenements.push({
        id: `visite_annulee:${visite.id}`,
        type: "visite_annulee",
        // `visites` ne porte aucune date d'annulation : la seule date réelle disponible reste la
        // date qui était prévue. Jamais `creeLe` présenté comme une date d'annulation.
        date: visite.datePrevue,
        titre: `Visite annulée — ${libelleBien(bien)}`,
        provenance: "visite",
        href,
        importance: 3,
      });
      continue;
    }

    if (visite.statut === "planifiee") {
      evenements.push({
        id: `visite_prevue:${visite.id}`,
        type: "visite_prevue",
        date: visite.datePrevue,
        titre: `Visite prévue — ${libelleBien(bien)}`,
        provenance: "visite",
        href,
        importance: 2,
      });
      continue;
    }

    // `visites` ne porte AUCUNE date de réalisation distincte (ADR-040) : le statut `realisee`
    // autorise à dire que la visite a eu lieu, à la date prévue — jamais une heure, jamais
    // `creeLe` maquillé en date de réalisation.
    const compteRendu = compteRenduDeLaVisite(visite);
    if (compteRendu) comptesRendusRattaches.add(compteRendu.id);
    evenements.push({
      id: `visite_realisee:${visite.id}`,
      type: "visite_realisee",
      date: visite.datePrevue,
      titre: `Visite réalisée — ${libelleBien(bien)}`,
      // Seule la valeur contrôlée `interet` enrichit l'événement. Le retour libre du compte rendu
      // n'apparaît jamais ici.
      detail: compteRendu ? `Intérêt : ${LABEL_INTERET[compteRendu.interet]}` : undefined,
      provenance: "visite",
      href,
      importance: 1,
    });
  }

  // Comptes rendus sans visite Atlas rattachable (antérieurs à ADR-040) : le fait « une visite a
  // eu lieu » reste réel et daté, il n'est simplement rattaché à aucune fiche visite.
  for (const compteRendu of comptesRendus) {
    if (comptesRendusRattaches.has(compteRendu.id)) continue;
    if (visites.some((v) => v.id === compteRendu.visiteId)) continue;
    evenements.push({
      id: `visite_realisee:cr:${compteRendu.id}`,
      type: "visite_realisee",
      date: compteRendu.dateVisite,
      titre: `Visite réalisée — ${libelleBien(biensParId.get(compteRendu.bienId))}`,
      detail: `Intérêt : ${LABEL_INTERET[compteRendu.interet]}`,
      provenance: "visite",
      importance: 1,
    });
  }

  for (const offre of offres) {
    const bien = biensParId.get(offre.bienId);
    evenements.push({
      id: `offre_deposee:${offre.id}`,
      type: "offre_deposee",
      date: offre.dateOffre,
      titre: `Offre déposée — ${formatPrix(offre.montant)}`,
      detail: libelleBien(bien),
      provenance: "offre",
      href: `/biens/${offre.bienId}`,
      importance: 1,
    });

    // ADR-020 : seule `dateDecision` date une transition finale, et elle n'existe pas sur les
    // lignes antérieures à cette ADR (aucun backfill). Sans elle, aucun événement — le statut reste
    // consultable dans la section Offres, jamais daté ici à une date inventée.
    if (offre.statut !== "en_cours" && offre.dateDecision) {
      const LIBELLE_DECISION = { acceptee: "Offre acceptée", refusee: "Offre refusée", retiree: "Offre retirée" };
      evenements.push({
        id: `offre_decidee:${offre.id}`,
        type: "offre_decidee",
        date: offre.dateDecision,
        titre: `${LIBELLE_DECISION[offre.statut]} — ${formatPrix(offre.montant)}`,
        detail: libelleBien(bien),
        provenance: "offre",
        href: `/biens/${offre.bienId}`,
        importance: 1,
      });
    }
  }

  for (const c of compromis) {
    const bien = biensParId.get(c.bienId);
    evenements.push({
      id: `compromis_signe:${c.id}`,
      type: "compromis_signe",
      date: c.dateSignature,
      titre: `Compromis signé — ${formatPrix(c.prixConvenu)}`,
      detail: libelleBien(bien),
      provenance: "compromis",
      href: `/biens/${c.bienId}`,
      importance: 1,
    });
    // `dateActeReelle` (constatée) et non `dateActe` (prévue) — les deux ne sont jamais confondues
    // (ADR-017).
    if (c.statut === "realise" && c.dateActeReelle) {
      evenements.push({
        id: `compromis_finalise:${c.id}`,
        type: "compromis_finalise",
        date: c.dateActeReelle,
        titre: "Acte signé",
        detail: libelleBien(bien),
        provenance: "compromis",
        href: `/biens/${c.bienId}`,
        importance: 1,
      });
    }
    if (c.statut === "annule" && c.dateAnnulation) {
      evenements.push({
        id: `compromis_annule:${c.id}`,
        type: "compromis_annule",
        date: c.dateAnnulation,
        titre: "Compromis annulé",
        detail: libelleBien(bien),
        provenance: "compromis",
        href: `/biens/${c.bienId}`,
        importance: 1,
      });
    }
  }

  // Seul un envoi dont l'état canonique est « envoyé » produit un événement (ADR-031-bis) : un
  // échec, un envoi resté incertain (rupture réseau APRÈS l'appel Gmail — jamais assimilable à un
  // succès) ou une tentative en cours n'ont jamais quitté l'agence du point de vue du conseiller.
  // Un brouillon, lui, n'existe nulle part en base : il ne peut structurellement pas arriver ici.
  for (const envoi of envois) {
    if (deriverEtatEnvoiEmail(envoi) !== "envoye" || !envoi.reussiLe) continue;
    evenements.push({
      id: `email_envoye:${envoi.id}`,
      type: "email_envoye",
      date: envoi.reussiLe,
      titre: "Email envoyé",
      // L'objet seul, jamais le corps du message — qui n'est de toute façon jamais persisté.
      detail: envoi.objet,
      provenance: "email",
      importance: 2,
    });
  }

  // Uniquement les tâches TERMINÉES : une tâche encore ouverte est déjà présentée dans « À faire
  // maintenant », l'afficher aussi comme un fait passé produirait le doublon « tâche créée » /
  // « tâche terminée » que ce lot doit éviter.
  for (const tache of tachesLiees) {
    if (deriverStatutTache(tache) !== "terminee" || !tache.termineeLe) continue;
    evenements.push({
      id: `tache_terminee:${tache.id}`,
      type: "tache_terminee",
      date: tache.termineeLe,
      titre: `Tâche terminée : ${tache.titre}`,
      provenance: "tache",
      importance: 3,
    });
  }

  return evenements;
}

// Ordre de lecture : plus récent d'abord. Les deux départages (importance puis id) rendent l'ordre
// STABLE à données identiques — une date SQL `date` et un timestamptz du même jour se croisent
// couramment, un tri sans départage ferait sauter les lignes d'un rendu à l'autre.
function comparerParDate(a: EvenementMemoire, b: EvenementMemoire): number {
  const parDate = Date.parse(b.date) - Date.parse(a.date);
  if (parDate !== 0) return parDate;
  if (a.importance !== b.importance) return a.importance - b.importance;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Au-delà de la limite de lecture, ce sont les JALONS COMMERCIAUX qui restent (importance 1),
// jamais les plus récents indistinctement : sur un dossier dense comme un compromis signé, garder
// trois tâches terminées et perdre l'offre acceptée rendrait la mémoire inutile.
function limiterHistorique(evenements: EvenementMemoire[], maximum: number): EvenementMemoire[] {
  if (evenements.length <= maximum) return [...evenements].sort(comparerParDate);
  const retenus = [...evenements]
    .sort((a, b) => (a.importance !== b.importance ? a.importance - b.importance : comparerParDate(a, b)))
    .slice(0, maximum);
  return retenus.sort(comparerParDate);
}

// ---------------------------------------------------------------------------
// À faire maintenant
// ---------------------------------------------------------------------------

// Priorité de source, jamais trois représentations de la même action :
// 1. la tâche réellement persistée, ordonnée par le moteur de priorité existant (tachePriority.ts,
//    ADR-039) — aucune règle de tri recopiée ici ;
// 2. l'opportunité VALUE-01, qui n'arrive dans cette liste que si le moteur ne l'a PAS déjà
//    absorbée contre une tâche active (deduplication.ts) — la déduplication reste faite là-bas,
//    jamais rejouée ici.
// VALUE-02 n'apparaît pas : sa recommandation vit sur la fiche visite, et la tâche qu'elle produit
// (promotion explicite d'une prochaine étape) remonte déjà par le point 1.
function deriverActions(entrees: {
  acquereur: ProfilAcquereur;
  tachesLiees: Tache[];
  opportunites: Opportunite[];
  visites: Visite[];
  maintenant: Date;
}): ActionMemoire[] {
  const { acquereur, tachesLiees, opportunites, visites, maintenant } = entrees;

  const actives = tachesLiees.filter((t) => deriverStatutTache(t) === "a_faire");
  const actions: ActionMemoire[] = trierParPriorite(actives, maintenant).map((tache) => {
    const route = deriverRouteFicheCible(tache);
    return {
      cle: `tache:${tache.id}`,
      source: "tache",
      titre: tache.titre,
      detail: tache.contexte,
      // Jamais un lien vers la page où l'on se trouve déjà, jamais un lien construit pour un type
      // de cible sans fiche (visite/offre/compromis n'en ont aucune — voir types/tache.ts).
      href: route && route !== `/clients/${acquereur.id}` ? route : undefined,
    };
  });

  const idsVisites = new Set(visites.map((v) => v.id));
  for (const opportunite of opportunites) {
    const concerne =
      (opportunite.cible.type === "acquereur" && opportunite.cible.id === acquereur.id) ||
      (opportunite.cible.type === "visite" && idsVisites.has(opportunite.cible.id));
    if (!concerne) continue;
    actions.push({
      cle: `opportunite:${opportunite.id}`,
      source: "opportunite",
      titre: opportunite.titre,
      detail: opportunite.raison,
      href: opportunite.action.href,
    });
  }

  return actions.slice(0, MAXIMUM_ACTIONS_MEMOIRE);
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

export function construireMemoireRelationnelleAcquereur(entrees: {
  acquereur: ProfilAcquereur;
  secteurs: SecteurRecherche[];
  visites: Visite[];
  comptesRendus: CompteRenduVisite[];
  offres: Offre[];
  compromis: Compromis[];
  // Déjà restreintes à la relation par selectionnerTachesLieesAcquereur, tous statuts confondus.
  tachesLiees: Tache[];
  // Déjà restreints aux tâches de cette relation par la page — le rattachement acquéreur d'un
  // envoi passe uniquement par envois_email.tacheId -> taches (aucune FK directe n'existe).
  envois: EnvoiEmail[];
  // Sortie du moteur VALUE-01, déjà dédupliquée contre les tâches actives.
  opportunites: Opportunite[];
  biensParId: ReadonlyMap<string, Bien | undefined>;
  maintenant?: Date;
  aujourdHui: string;
}): MemoireRelationnelleAcquereur {
  const maintenant = entrees.maintenant ?? new Date();

  return {
    etatActuel: deriverEtatActuel({
      acquereur: entrees.acquereur,
      visites: entrees.visites,
      offres: entrees.offres,
      compromis: entrees.compromis,
      aujourdHui: entrees.aujourdHui,
    }),
    faitsARetenir: deriverFaitsARetenir(entrees.acquereur, entrees.secteurs),
    historique: limiterHistorique(deriverHistoriqueComplet(entrees), MAXIMUM_EVENEMENTS_MEMOIRE),
    actions: deriverActions({
      acquereur: entrees.acquereur,
      tachesLiees: entrees.tachesLiees,
      opportunites: entrees.opportunites,
      visites: entrees.visites,
      maintenant,
    }),
  };
}
