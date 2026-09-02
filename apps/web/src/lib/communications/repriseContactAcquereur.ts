import { LABEL_INTERET, type CompteRenduVisite } from "@/types/compteRenduVisite";
import { trierParPriorite } from "@/lib/tachePriority";
import { construireIdOpportunite } from "@/lib/opportunites/id";
import type { FaitsCommunication, IntentionCommunication } from "./contexteCommunication";
import type { ProfilAcquereur } from "@/types/client";
import type { Bien } from "@/types/bien";
import type { Visite } from "@/types/visite";
import type { Offre } from "@/types/offre";
import type { Compromis } from "@/types/compromis";
import type { Tache } from "@/types/tache";
import type { Opportunite } from "@/types/opportunite";
import type { ResultatCompatibilite } from "@/lib/compatibilite/types";

// VALUE-04 — PROJECTION COMMUNICATIONNELLE. Mémoire relationnelle (VALUE-03) et contexte
// communicationnel sont deux choses distinctes : la première est une vision interne fiable, la
// seconde un sous-ensemble EXPLICITEMENT autorisé à sortir vers le client. Ce module produit la
// seconde, jamais en dérivant « tout ce que la mémoire contient moins quelques champs », mais en
// construisant depuis zéro une liste blanche.
//
// Quatre responsabilités restent séparées (jamais fusionnées) : mémoire relationnelle -> projection
// communicationnelle sûre -> générateur déterministe (genererBrouillonEmail) -> transport Gmail
// après validation humaine. Ce module n'occupe que la deuxième case : il ne formule aucun texte,
// n'envoie rien, ne décide d'aucune règle commerciale nouvelle.
//
// Aucune règle de décision n'est réinventée ici : « faut-il proposer ce bien ? » reste tranché par
// VALUE-01 (une opportunité doit exister), « ce bien est-il compatible ? » par le moteur canonique
// ADR-034, « quelle suite après visite ? » par les faits structurés d'ADR-040/041. Ce module ne
// fait que choisir, parmi des situations déjà décidées ailleurs, celle qui justifie d'écrire
// maintenant — et quels faits peuvent entrer dans le message.

// LISTE BLANCHE, garantie par le TYPE et non par une discipline de relecture : `Pick` interdit
// structurellement d'y placer `tacheContexte` (note interne, EMAIL-DEMO-02), un montant d'offre,
// un prix convenu ou tout autre champ de FaitsCommunication non listé ici. Ajouter un fait
// partageable devient un geste explicite, jamais un effet de bord.
export type FaitsPartageablesAcquereur = Pick<
  FaitsCommunication,
  "bienAdresse" | "dateVisite" | "interetVisite" | "criteresCompatibles"
>;

export type MotifReprise = "post_visite" | "bien_a_presenter" | "suivi_transaction";

export type RepriseContactAcquereur = {
  motif: MotifReprise;
  // « Pourquoi maintenant ? », affiché au conseiller AVANT l'ouverture du brouillon. Interne :
  // n'entre jamais dans le message.
  raison: string;
  libelle: string;
  // Toujours un écran existant. Deux formes seulement : la reprise d'une tâche déjà ouverte
  // (chemin le plus fiable, ADR-031) ou l'entrée acquéreur dédiée.
  href: string;
  // Renseigné quand la reprise passe par une tâche déjà ouverte : l'appelant l'attache à cette
  // ligne d'action plutôt que d'afficher une seconde représentation de la même chose.
  tacheId?: string;
  // Renseignée quand la reprise absorbe une opportunité VALUE-01 : l'appelant la retire de ses
  // actions pour n'en afficher qu'une seule.
  opportuniteId?: string;
  bienId?: string;
  // Présents UNIQUEMENT quand la reprise ne passe pas par une tâche : c'est alors cette projection
  // qui alimente le générateur. Via une tâche, le contexte existant (ADR-031) fait foi et rien
  // n'est reconstruit ici.
  intention?: IntentionCommunication;
  faitsPartageables?: FaitsPartageablesAcquereur;
};

// Formulations CLIENT des critères de compatibilité, indexées sur l'identifiant STABLE du critère
// (ADR-034) et jamais sur son `label`, qui est un libellé d'interface interne (« Budget maximum »,
// « Nombre de pièces minimum ») dont la formulation peut évoluer et qui sonnerait faux dans un
// message. Liste blanche fail-closed : un critère inconnu est simplement ignoré, jamais rendu tel
// quel. `explication` n'est jamais lue — elle porte des valeurs chiffrées du bien et de la
// recherche, sans utilité dans un message au client.
const FORMULATION_CLIENT_CRITERE: Record<string, string> = {
  secteur_geographique: "le secteur que vous recherchez",
  budget_max: "votre budget",
  pieces_min: "le nombre de pièces",
  surface_min: "la surface",
  parking: "le stationnement",
  exterieur: "l'extérieur",
  accessibilite: "l'accessibilité",
};

// Deux ou trois éléments réellement discriminants, jamais douze : un message qui récite la
// totalité des critères ne se lit pas et ressemble à une sortie de moteur.
const MAXIMUM_CRITERES_PARTAGES = 3;

function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Même rattachement compte rendu -> visite que VALUE-01 et VALUE-03 : par visiteId (ADR-040), à
// défaut par la coïncidence exacte bien + acquéreur + date. Jamais par proximité de date.
function compteRenduDeLaVisite(visite: Visite, comptesRendus: CompteRenduVisite[]): CompteRenduVisite | undefined {
  return comptesRendus.find(
    (cr) =>
      cr.visiteId === visite.id ||
      (cr.visiteId === undefined &&
        cr.bienId === visite.bienId &&
        cr.acquereurId === visite.acquereurId &&
        cr.dateVisite === visite.datePrevue)
  );
}

export type EntreesRepriseContact = {
  acquereur: ProfilAcquereur;
  visites: Visite[];
  comptesRendus: CompteRenduVisite[];
  offres: Offre[];
  compromis: Compromis[];
  // Verdicts du moteur canonique (ADR-034) pour cet acquéreur — jamais recalculés ici.
  compatibilites: ResultatCompatibilite[];
  // Sortie de VALUE-01, DÉJÀ dédupliquée contre les tâches actives : sa seule présence porte les
  // décisions « acquéreur en recherche active » et « aucune tâche ne couvre déjà l'action ».
  opportunites: Opportunite[];
  // Tâches ACTIVES rattachées à la relation (acquéreur, visites, offres, compromis).
  tachesActives: Tache[];
  biens: Bien[];
  maintenant?: Date;
};

// Une tâche n'est un point d'entrée de communication que si son id est un UUID : la résolution de
// contexte (getTacheById) l'exige, une tâche de démonstration produirait un lien vers un 404.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tachePorteuse(taches: Tache[], acquereurId: string, visiteId: string | undefined, maintenant: Date) {
  const candidates = taches.filter(
    (t) => UUID_REGEX.test(t.id) && (t.acquereurId === acquereurId || (visiteId !== undefined && t.visiteId === visiteId))
  );
  // Ordre du moteur de priorité existant (ADR-039) — aucune règle de tri recopiée.
  return trierParPriorite(candidates, maintenant)[0];
}

// CAS 1 — suite d'une visite réellement réalisée. `interet` est la SEULE donnée du compte rendu
// utilisée : ni `retour` (texte libre du conseiller), ni `prochaineEtape` (rédigée pour le
// conseiller, jamais pour le client) n'entrent dans la projection.
//
// `pas_interesse` ne produit jamais de reprise : relancer sur le même bien une personne qui a
// explicitement décliné est exactement ce que le produit s'interdit. `inconnu` non plus : aucune
// orientation commerciale ne peut en être tirée sans l'inventer.
function repriseApresVisite(entrees: EntreesRepriseContact, maintenant: Date): RepriseContactAcquereur | undefined {
  const { acquereur, visites, comptesRendus, offres, compromis, opportunites, tachesActives, biens } = entrees;
  // Dossier déjà engagé (offre ou compromis) : la relation ne se joue plus sur le retour de visite.
  if (offres.length > 0 || compromis.length > 0) return undefined;

  const biensParId = new Map(biens.map((b) => [b.id, b]));
  const realisees = visites
    .filter((v) => v.statut === "realisee")
    .sort((a, b) => (a.datePrevue < b.datePrevue ? 1 : a.datePrevue > b.datePrevue ? -1 : a.id < b.id ? -1 : 1));

  for (const visite of realisees) {
    const compteRendu = compteRenduDeLaVisite(visite, comptesRendus);
    if (!compteRendu) continue;
    if (compteRendu.interet !== "interesse" && compteRendu.interet !== "a_reflechir") continue;
    const bien = biensParId.get(visite.bienId);
    // Aucun fait de lieu partageable : plutôt aucune reprise qu'un message sans objet identifiable.
    // Les appelants passent la liste des biens ACTIFS (listerBiens exclut les archivés, ADR-012) —
    // une visite portant sur un bien depuis archivé ne produit donc aucune reprise, ce qui est le
    // comportement voulu : un bien sorti des flux actifs n'a pas à motiver un message au client.
    if (!bien) continue;

    const tache = tachePorteuse(tachesActives, acquereur.id, visite.id, maintenant);
    const idOpportunite = construireIdOpportunite("suivi_visite", { type: "visite", id: visite.id }, "prochaine_etape_absente");

    return {
      motif: "post_visite",
      // Restitution des faits structurés (date réelle, valeur contrôlée de l'intérêt) — jamais une
      // règle recalculée, jamais une interprétation du retour libre.
      raison: `Visite réalisée le ${formatDateFr(compteRendu.dateVisite)} · intérêt : ${LABEL_INTERET[compteRendu.interet]}`,
      libelle: compteRendu.interet === "a_reflechir" ? "Préparer une relance douce" : "Préparer la relance",
      href: tache
        ? `/communications/nouveau?tacheId=${tache.id}`
        : `/communications/nouveau?acquereurId=${acquereur.id}`,
      tacheId: tache?.id,
      opportuniteId: opportunites.find((o) => o.id === idOpportunite)?.id,
      bienId: bien.id,
      intention: tache ? undefined : "suivi_visite",
      faitsPartageables: tache
        ? undefined
        : {
            bienAdresse: bien.adresse,
            dateVisite: formatDateFr(compteRendu.dateVisite),
            interetVisite: LABEL_INTERET[compteRendu.interet],
          },
    };
  }

  return undefined;
}

// CAS 2 — bien compatible jamais exploité. La DÉCISION appartient entièrement à VALUE-01 : la
// reprise n'existe que si l'opportunité correspondante est réellement présente dans la sortie du
// moteur (id déterministe reconstruit avec le constructeur officiel, jamais un id découpé à la
// main). C'est cette présence qui porte « acquéreur en recherche active » et « aucune tâche ne
// couvre déjà l'action » — deux décisions jamais rejouées ici.
//
// Le verdict `compatible` est en revanche RE-VÉRIFIÉ sur le résultat canonique avant toute
// projection : un rapprochement « à vérifier » (une information manque sur le bien, ADR-034) ne
// doit jamais produire un message présentant le bien comme correspondant à la recherche. La
// vérification interne reste due au conseiller ; le client, lui, n'est pas sollicité tant que le
// critère bloquant n'est pas levé.
function repriseBienAPresenter(entrees: EntreesRepriseContact): RepriseContactAcquereur | undefined {
  const { acquereur, visites, compatibilites, opportunites, biens } = entrees;
  const biensParId = new Map(biens.map((b) => [b.id, b]));
  const pairesVisitees = new Set(visites.map((v) => `${v.bienId}:${v.acquereurId}`));

  const candidats = compatibilites
    .filter(
      (r) =>
        r.acquereurId === acquereur.id &&
        r.statutGlobal === "compatible" &&
        !pairesVisitees.has(`${r.bienId}:${r.acquereurId}`)
    )
    // Ordre stable sur l'identifiant du bien : à données identiques, le même bien est retenu.
    .sort((a, b) => (a.bienId < b.bienId ? -1 : a.bienId > b.bienId ? 1 : 0));

  for (const resultat of candidats) {
    const bien = biensParId.get(resultat.bienId);
    if (!bien) continue;
    const idOpportunite = construireIdOpportunite(
      "match_a_exploiter",
      { type: "acquereur", id: acquereur.id },
      resultat.bienId
    );
    const opportunite = opportunites.find((o) => o.id === idOpportunite);
    if (!opportunite) continue;

    const criteresCompatibles = resultat.criteres
      .filter((c) => c.statut === "compatible")
      .map((c) => FORMULATION_CLIENT_CRITERE[c.critere])
      .filter((formulation): formulation is string => formulation !== undefined)
      .slice(0, MAXIMUM_CRITERES_PARTAGES);

    return {
      motif: "bien_a_presenter",
      // La raison vient du moteur qui a pris la décision, jamais d'un texte reformulé ici.
      raison: opportunite.raison,
      libelle: "Présenter ce bien",
      href: `/communications/nouveau?acquereurId=${acquereur.id}`,
      opportuniteId: opportunite.id,
      bienId: bien.id,
      intention: "suivi_acquereur",
      faitsPartageables: { bienAdresse: bien.adresse, criteresCompatibles },
    };
  }

  return undefined;
}

// CAS 3 — dossier transactionnel avancé. Aucune relance commerciale générique n'est proposée : la
// seule communication légitime est celle que porte DÉJÀ une tâche ouverte (message compromis,
// point notarial). Sans tâche, DOMIORA n'invente pas d'email — il n'a rien de nouveau à dire.
function repriseSuiviTransaction(
  entrees: EntreesRepriseContact,
  maintenant: Date
): RepriseContactAcquereur | undefined {
  const { acquereur, offres, compromis, tachesActives } = entrees;
  const compromisEnCours = compromis.find((c) => c.statut === "en_cours");
  const offreAcceptee = offres.find((o) => o.statut === "acceptee");
  if (!compromisEnCours && !offreAcceptee) return undefined;

  const tache = tachePorteuse(tachesActives, acquereur.id, undefined, maintenant);
  // Une tâche portée par l'offre ou le compromis est tout aussi légitime que celle portée par
  // l'acquéreur : c'est le même dossier.
  const candidate =
    tache ??
    trierParPriorite(
      tachesActives.filter(
        (t) =>
          UUID_REGEX.test(t.id) &&
          ((t.compromisId !== undefined && compromis.some((c) => c.id === t.compromisId)) ||
            (t.offreId !== undefined && offres.some((o) => o.id === t.offreId)))
      ),
      maintenant
    )[0];
  if (!candidate) return undefined;

  return {
    motif: "suivi_transaction",
    raison: compromisEnCours
      ? "Compromis en cours · une tâche de suivi est ouverte"
      : "Offre acceptée · une tâche de suivi est ouverte",
    libelle: "Préparer le message",
    href: `/communications/nouveau?tacheId=${candidate.id}`,
    tacheId: candidate.id,
  };
}

// Au plus UNE reprise, dans cet ordre : un dossier engagé prime sur une conversation de visite,
// qui prime sur une proposition de bien. Jamais deux propositions concurrentes pour la même
// relation.
export function construireRepriseContactAcquereur(
  entrees: EntreesRepriseContact
): RepriseContactAcquereur | undefined {
  // Une fiche archivée est sortie des flux actifs (ADR-012) : elle reste consultable, jamais
  // sollicitée.
  if (entrees.acquereur.archiveLe) return undefined;
  const maintenant = entrees.maintenant ?? new Date();

  return (
    repriseSuiviTransaction(entrees, maintenant) ??
    repriseApresVisite(entrees, maintenant) ??
    repriseBienAPresenter(entrees)
  );
}
