import { construireIdAlerte } from "@/lib/alertes/id";
import { raisonsDe } from "@/lib/alertes/raisons";
import { SEUIL_MOIS_MINIMUM_RUN_RATE } from "@/lib/fiscal/runRate";
import { LABEL_REGIME_FISCAL, LABEL_REGIME_TVA } from "@/types/profilFiscal";
import type { ContexteAlertes } from "@/lib/alertes/contexte";
import type { AlerteCopilote } from "@/types/alerte";
import type { RaisonIndisponibilite } from "@/types/resultatFiscal";

type RegleAlerteDonnees = {
  id: string;
  evaluer: (contexte: ContexteAlertes) => AlerteCopilote[];
};

// A1 — cause racine : aucun profil fiscal renseigné. La déduplication (deduplication.ts) supprime
// derrière elle toute alerte fiscale qui ne ferait que reformuler cette même absence — mais elle ne
// se déclenche de toute façon jamais seule ici, `contexte.fiscal` étant systématiquement absent en
// aval (voir contexte.ts).
const regleProfilAbsent: RegleAlerteDonnees = {
  id: "profil_fiscal_absent",
  evaluer: (contexte) => {
    if (contexte.fiscal) return [];
    return [
      {
        id: construireIdAlerte("profil_fiscal_absent", contexte.dossierFiscalId),
        type: "profil_fiscal_absent",
        categorie: "donnees_incompletes",
        niveau: "action_requise",
        titre: "Situation fiscale non renseignée",
        explication:
          "Aucun profil fiscal n'est renseigné : Atlas ne peut calculer ni cotisations, ni seuils, ni projections fiscales tant que cette situation n'est pas connue.",
        donneesDeclencheuses: { dossierFiscalId: contexte.dossierFiscalId },
        provenance: [],
        action: { libelle: "Compléter ma situation fiscale", href: "/fiscal#profil" },
      },
    ];
  },
};

// A2a — donnée réellement inconnue ('inconnu' est une vraie valeur stockée, ADR-023) : l'utilisateur
// peut la compléter, contrairement à A2b ci-dessous.
type ChampInconnuA2a = { champ: "regimeFiscal" | "regimeTva" | "affiliationRetraite"; libelle: string; bloque: string };
const CHAMPS_A2A: ChampInconnuA2a[] = [
  {
    champ: "regimeFiscal",
    libelle: "régime fiscal",
    bloque: "les cotisations sociales, la CFP, le versement libératoire et le suivi du plafond micro-BNC",
  },
  { champ: "regimeTva", libelle: "régime de TVA", bloque: "le suivi du seuil de franchise en base" },
  { champ: "affiliationRetraite", libelle: "affiliation retraite", bloque: "le calcul des cotisations sociales" },
];

const regleProfilInconnu: RegleAlerteDonnees = {
  id: "profil_fiscal_inconnu",
  evaluer: (contexte) => {
    if (!contexte.fiscal) return [];
    const { profil, dossierFiscalId } = contexte.fiscal;
    return CHAMPS_A2A.filter((c) => profil[c.champ] === "inconnu").map((c) => ({
      id: construireIdAlerte("profil_fiscal_inconnu", dossierFiscalId, undefined, c.champ),
      type: "profil_fiscal_inconnu",
      categorie: "donnees_incompletes",
      niveau: "action_requise",
      titre: `${c.libelle[0].toUpperCase()}${c.libelle.slice(1)} non renseigné`,
      explication: `Le ${c.libelle} n'est pas renseigné dans votre situation fiscale — cela bloque ${c.bloque}.`,
      donneesDeclencheuses: { dossierFiscalId, code: c.champ },
      provenance: [],
      action: { libelle: "Compléter ma situation fiscale", href: "/fiscal#profil" },
    }));
  },
};

// A2b — situation réellement connue mais moteur V1 non compatible (ex. déclaration contrôlée,
// régime TVA réel). Ce n'est jamais une erreur de saisie : aucune action ne doit demander de changer
// un régime réel pour satisfaire Atlas.
const regleRegimeNonCouvert: RegleAlerteDonnees = {
  id: "regime_non_couvert",
  evaluer: (contexte) => {
    if (!contexte.fiscal) return [];
    const { profil, dossierFiscalId } = contexte.fiscal;
    const alertes: AlerteCopilote[] = [];
    if (profil.regimeFiscal !== "inconnu" && profil.regimeFiscal !== "micro_bnc") {
      alertes.push({
        id: construireIdAlerte("regime_non_couvert", dossierFiscalId, undefined, "regime_fiscal"),
        type: "regime_non_couvert",
        categorie: "donnees_incompletes",
        niveau: "attention",
        titre: "Régime fiscal non couvert par le moteur de calcul",
        explication: `Votre régime fiscal ("${LABEL_REGIME_FISCAL[profil.regimeFiscal]}") est bien renseigné, mais Atlas ne sait aujourd'hui calculer cotisations, CFP, versement libératoire et suivi du plafond que pour le micro-BNC. Ce n'est pas une anomalie de votre situation, seulement une limite actuelle d'Atlas.`,
        donneesDeclencheuses: { dossierFiscalId, code: "regime_fiscal" },
        provenance: [
          {
            source: "raison_indisponibilite",
            raison: { type: "regime_non_couvert", regimeFiscal: profil.regimeFiscal, date: `${contexte.fiscal.annee}-12-31` },
          },
        ],
      });
    }
    if (profil.regimeTva !== "inconnu" && profil.regimeTva !== "franchise") {
      alertes.push({
        id: construireIdAlerte("regime_non_couvert", dossierFiscalId, undefined, "regime_tva"),
        type: "regime_non_couvert",
        categorie: "donnees_incompletes",
        niveau: "information",
        titre: "Suivi de TVA non couvert par le moteur de calcul",
        explication: `Votre régime de TVA ("${LABEL_REGIME_TVA[profil.regimeTva]}") est bien renseigné, mais Atlas ne suit aujourd'hui que la franchise en base. Ce n'est pas une anomalie de votre situation, seulement une limite actuelle d'Atlas.`,
        donneesDeclencheuses: { dossierFiscalId, code: "regime_tva" },
        provenance: [{ source: "raison_indisponibilite", raison: { type: "regime_tva_non_supporte", regimeTva: profil.regimeTva } }],
      });
    }
    return alertes;
  },
};

// A3 — jamais déclenchée par la simple absence d'une ligne historique_amorcage : uniquement par le
// résultat métier ADR-024 (`couverture === "partielle"`). Cause racine pouvant absorber A7 (voir
// deduplication.ts), jamais D3.
const regleAssietteIncomplete: RegleAlerteDonnees = {
  id: "assiette_incomplete",
  evaluer: (contexte) => {
    if (!contexte.fiscal) return [];
    const { assiette, dossierFiscalId, annee } = contexte.fiscal;
    if (assiette.couverture !== "partielle") return [];
    return [
      {
        id: construireIdAlerte("assiette_incomplete", dossierFiscalId, annee),
        type: "assiette_incomplete",
        categorie: "donnees_incompletes",
        niveau: "action_requise",
        titre: `Couverture ${annee} incomplète`,
        explication:
          "Une partie des encaissements de l'année n'est pas couverte par les données disponibles. Certains calculs fiscaux et projections restent donc incomplets. L'absence d'historique n'est pas anormale en soi : une activité commencée en même temps qu'Atlas peut légitimement n'avoir aucun amorçage à renseigner.",
        donneesDeclencheuses: { dossierFiscalId, annee },
        provenance: [
          { source: "raison_indisponibilite", raison: { type: "assiette_incomplete", periodesInconnues: assiette.periodesInconnues } },
        ],
        action: { libelle: "Renseigner mes recettes des années précédentes", href: "/fiscal#amorcage" },
      },
    ];
  },
};

// A4/A5 — V1 strictement agrégée (ADR-026) : compteurs déjà exposés par chargerRemuneration()/
// chargerProjectionAnnuelle() (ADR-022/024), aucune nouvelle requête, aucun listing dossier par
// dossier.
const regleRemunerationManquante: RegleAlerteDonnees = {
  id: "remuneration_manquante",
  evaluer: (contexte) => {
    const { remuneration, dossierFiscalId } = contexte;
    const manqueCompromisEnCours =
      remuneration.nombreCompromisEnCoursEligibles - remuneration.nombreRemunerationsPrevisionnellesRenseignees;
    const manqueVentesFinalisees =
      remuneration.nombreVentesFinalisees - remuneration.nombreRemunerationsVentesFinaliseesRenseignees;
    const total = manqueCompromisEnCours + manqueVentesFinalisees;
    if (total <= 0) return [];
    const details = [
      manqueCompromisEnCours > 0 ? `${manqueCompromisEnCours} compromis en cours` : undefined,
      manqueVentesFinalisees > 0
        ? `${manqueVentesFinalisees} vente${manqueVentesFinalisees > 1 ? "s" : ""} finalisée${manqueVentesFinalisees > 1 ? "s" : ""}`
        : undefined,
    ].filter((d): d is string => d !== undefined);
    return [
      {
        id: construireIdAlerte("remuneration_manquante", dossierFiscalId),
        type: "remuneration_manquante",
        categorie: "commercial",
        niveau: "attention",
        titre: `${total} dossier${total > 1 ? "s" : ""} sans rémunération renseignée`,
        explication: `${details.join(" et ")} n'${details.length > 1 ? "ont" : "a"} pas de rémunération renseignée. Les projections financières et fiscales ne couvrent donc pas tous les dossiers éligibles.`,
        donneesDeclencheuses: { dossierFiscalId },
        provenance: [
          {
            source: "metrique_dashboard",
            nom: "compromis en cours sans rémunération renseignée",
            valeurCentimes: manqueCompromisEnCours,
          },
          {
            source: "metrique_dashboard",
            nom: "ventes finalisées sans rémunération renseignée",
            valeurCentimes: manqueVentesFinalisees,
          },
        ],
        action: { libelle: "Voir les dossiers concernés", href: "/dashboard#remuneration" },
      },
    ];
  },
};

const regleDateEncaissementManquante: RegleAlerteDonnees = {
  id: "date_encaissement_prevue_manquante",
  evaluer: (contexte) => {
    const { remuneration, projectionAnnuelle, dossierFiscalId } = contexte;
    const manqueCompromis =
      remuneration.nombreRemunerationsPrevisionnellesRenseignees - projectionAnnuelle.nombreRemunerationsPrevisionnellesAvecDatePrevue;
    const manqueFinalise =
      projectionAnnuelle.nombreFinaliseNonEncaisseRenseignees - projectionAnnuelle.nombreFinaliseNonEncaisseAvecDatePrevue;
    const total = manqueCompromis + manqueFinalise;
    if (total <= 0) return [];
    return [
      {
        id: construireIdAlerte("date_encaissement_prevue_manquante", dossierFiscalId),
        type: "date_encaissement_prevue_manquante",
        categorie: "commercial",
        niveau: "attention",
        titre: `${total} rémunération${total > 1 ? "s" : ""} sans date d'encaissement prévue`,
        explication: `${total} rémunération${total > 1 ? "s" : ""} renseignée${total > 1 ? "s" : ""} n'${total > 1 ? "ont" : "a"} pas de date d'encaissement prévue. Elle${total > 1 ? "s ne peuvent" : " ne peut"} donc pas être positionnée${total > 1 ? "s" : ""} dans la projection temporelle.`,
        donneesDeclencheuses: { dossierFiscalId },
        provenance: [
          { source: "metrique_dashboard", nom: "compromis en cours sans date d'encaissement prévue", valeurCentimes: manqueCompromis },
          {
            source: "metrique_dashboard",
            nom: "ventes finalisées non encaissées sans date d'encaissement prévue",
            valeurCentimes: manqueFinalise,
          },
        ],
        action: { libelle: "Voir les dossiers concernés", href: "/dashboard#projection" },
      },
    ];
  },
};

// A6 — un même code (ex. ACRE, `taux_acre_micro_entrepreneur`) peut apparaître dans plusieurs
// résultats (cotisations, VFL...) : dédoublonné par code ici même, avant toute passe de
// déduplication causale. C'est aussi ce qui absorbe nativement l'ancien "C3 ACRE" du plan — une
// seule règle générique, jamais un cas spécial séparé.
const regleRegleLegaleAbsente: RegleAlerteDonnees = {
  id: "regle_legale_absente",
  evaluer: (contexte) => {
    if (!contexte.fiscal) return [];
    const { cotisations, cfp, vfl, microBnc, franchiseTva, eligibiliteRfr, dossierFiscalId } = contexte.fiscal;
    const toutesRaisons: RaisonIndisponibilite[] = [
      ...raisonsDe(cotisations),
      ...raisonsDe(cfp),
      ...raisonsDe(vfl),
      ...raisonsDe(microBnc),
      ...raisonsDe(franchiseTva),
      ...raisonsDe(eligibiliteRfr),
    ];
    const parCode = new Map<string, Extract<RaisonIndisponibilite, { type: "regle_absente" }>>();
    for (const raison of toutesRaisons) {
      if (raison.type === "regle_absente" && !parCode.has(raison.code)) parCode.set(raison.code, raison);
    }
    return [...parCode.values()].map((raison) => ({
      id: construireIdAlerte("regle_legale_absente", dossierFiscalId, undefined, raison.code),
      type: "regle_legale_absente" as const,
      categorie: "donnees_incompletes" as const,
      niveau: "attention" as const,
      titre: "Règle légale non renseignée dans Atlas",
      explication: `Atlas ne dispose pas encore, dans son référentiel légal, de la règle nécessaire à un calcul de votre situation (référence "${raison.code}"). Ce n'est pas une action à faire de votre côté : c'est le référentiel Atlas qui doit être complété.`,
      donneesDeclencheuses: { dossierFiscalId, code: raison.code },
      provenance: [{ source: "raison_indisponibilite" as const, raison }],
    }));
  },
};

// A7 — fenêtre 1 à 5 mois strictement : 0 mois n'est pas une anomalie en soi (peut simplement
// signifier qu'aucun historique_amorcage n'a encore été saisi, cas déjà couvert par A3), 6+ mois
// signifie que le run-rate est déjà fiable.
const regleHistoriqueRunRateInsuffisant: RegleAlerteDonnees = {
  id: "historique_run_rate_insuffisant",
  evaluer: (contexte) => {
    if (!contexte.fiscal) return [];
    const { runRate, dossierFiscalId } = contexte.fiscal;
    if (runRate.fiable) return [];
    if (runRate.moisHistoriqueUtilises < 1 || runRate.moisHistoriqueUtilises >= SEUIL_MOIS_MINIMUM_RUN_RATE) return [];
    return [
      {
        id: construireIdAlerte("historique_run_rate_insuffisant", dossierFiscalId),
        type: "historique_run_rate_insuffisant",
        categorie: "donnees_incompletes",
        niveau: "information",
        titre: "Tendance statistique pas encore disponible",
        explication: `La tendance statistique utilisée pour les projections sera disponible après ${SEUIL_MOIS_MINIMUM_RUN_RATE} mois d'historique mensuel entièrement couvert. Atlas dispose actuellement de ${runRate.moisHistoriqueUtilises} mois. Rien à corriger de votre côté : l'historique est simplement encore jeune.`,
        donneesDeclencheuses: { dossierFiscalId },
        provenance: [],
      },
    ];
  },
};

const regles: RegleAlerteDonnees[] = [
  regleProfilAbsent,
  regleProfilInconnu,
  regleRegimeNonCouvert,
  regleAssietteIncomplete,
  regleRemunerationManquante,
  regleDateEncaissementManquante,
  regleRegleLegaleAbsente,
  regleHistoriqueRunRateInsuffisant,
];

export function produireAlertesDonnees(contexte: ContexteAlertes): AlerteCopilote[] {
  return regles.flatMap((regle) => regle.evaluer(contexte));
}
