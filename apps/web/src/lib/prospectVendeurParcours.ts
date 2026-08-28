import { deriverStatutProspectVendeur, type ProspectVendeur, type StatutProspectVendeur } from "@/types/prospectVendeur";
import { LABEL_MOTIF_PERTE_PROSPECT_VENDEUR } from "@/types/motifPerteProspectVendeur";
import type { NoteProspectVendeur } from "@/types/noteProspectVendeur";

// Ordre FIXE du rail de progression — celui réellement implémenté par
// deriverStatutProspectVendeur (ADR-027), jamais un ordre d'affichage réinventé : `estimation`
// vient APRÈS `rendez_vous` parce que la cascade teste estimationProposeeLe avant
// rdvEstimationRealiseLe. Modifier cet ordre ici sans toucher la cascade désynchroniserait le rail
// du stade affiché.
export type CleJalon = "prospect" | "qualification" | "rendez_vous" | "estimation" | "mandat_propose" | "mandat_signe";

export type EtatJalon = "passe" | "actuel" | "futur";

export type JalonParcours = {
  cle: CleJalon;
  libelle: string;
  etat: EtatJalon;
  // Date réellement enregistrée, jamais fabriquée. Absente = le rail affiche un tiret.
  date?: string;
  // true quand `date` porte une date PRÉVUE et non un franchissement (rdvEstimationPrevuLe) :
  // le jalon reste non franchi, la date n'est affichée que comme repère.
  previsionnel: boolean;
};

// « RDV estimation » et non « RDV réalisé » : ce segment peut porter une date prévue avant sa
// réalisation, un libellé au passé y serait faux. Le statut métier `rendez_vous` et le champ
// rdvEstimationRealiseLe restent inchangés — c'est un libellé d'interface uniquement.
const LIBELLE_JALON: Record<CleJalon, string> = {
  prospect: "Prospect",
  qualification: "Qualifié",
  rendez_vous: "RDV estimation",
  estimation: "Estimation",
  mandat_propose: "Mandat proposé",
  mandat_signe: "Mandat signé",
};

const ORDRE_JALONS: CleJalon[] = [
  "prospect",
  "qualification",
  "rendez_vous",
  "estimation",
  "mandat_propose",
  "mandat_signe",
];

// Date de FRANCHISSEMENT du jalon (undefined = jamais franchi). `rendez_vous` n'est franchi que
// par rdvEstimationRealiseLe — une date seulement prévue ne franchit rien (ADR-027).
function dateFranchissement(prospect: ProspectVendeur, cle: CleJalon): string | undefined {
  switch (cle) {
    case "prospect":
      return prospect.creeLe;
    case "qualification":
      return prospect.qualifieLe;
    case "rendez_vous":
      return prospect.rdvEstimationRealiseLe;
    case "estimation":
      return prospect.estimationProposeeLe;
    case "mandat_propose":
      return prospect.mandatProposeLe;
    case "mandat_signe":
      return prospect.mandatSigneLe;
  }
}

// Aucune séquence n'étant imposée à la saisie (ADR-027), l'état de chaque segment se lit
// indépendamment : franchi ou non, plus le stade courant. Jamais une progression déduite par
// position dans le tableau — un prospect peut avoir une estimation chiffrée sans rendez-vous
// marqué réalisé, et le rail doit le représenter fidèlement plutôt que de le corriger.
export function deriverParcoursProspectVendeur(prospect: ProspectVendeur): JalonParcours[] {
  const statut: StatutProspectVendeur = deriverStatutProspectVendeur(prospect);

  return ORDRE_JALONS.map((cle) => {
    const franchi = dateFranchissement(prospect, cle);
    const previsionnel = cle === "rendez_vous" && !franchi && Boolean(prospect.rdvEstimationPrevuLe);

    return {
      cle,
      libelle: LIBELLE_JALON[cle],
      // `perdu` n'est aucun de ces six jalons : aucun segment n'est alors "actuel", le rail montre
      // seulement le chemin réellement parcouru avant la perte.
      etat: cle === statut ? "actuel" : franchi ? "passe" : "futur",
      date: franchi ?? (previsionnel ? prospect.rdvEstimationPrevuLe : undefined),
      previsionnel,
    };
  });
}

// ---------------------------------------------------------------------------
// Journal « Parcours et échanges »
// ---------------------------------------------------------------------------

// Deux natures de faits volontairement mélangées dans un seul fil, avec une différence assumée :
// les NOTES sont append-only (elles ne bougent jamais), les JALONS sont dérivés des dates
// actuellement enregistrées — corriger une date déplace l'entrée et l'ancienne valeur n'est pas
// conservée. Ce n'est donc PAS un journal d'audit, exactement la même limite que
// deriverHistoriqueBien (ADR-014) déjà assumée sur la Fiche Bien. Aucune table d'événements n'est
// créée ici.
export type EntreeJournal =
  | { genre: "jalon"; cle: string; titre: string; date: string; detail?: string }
  | { genre: "note"; id: string; note: NoteProspectVendeur; date: string };

function formatMontantEstimation(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(centimes / 100);
}

export function deriverJournalProspectVendeur(
  prospect: ProspectVendeur,
  notes: NoteProspectVendeur[]
): EntreeJournal[] {
  const entrees: EntreeJournal[] = [];

  const ajouterJalon = (cle: string, titre: string, date: string | undefined, detail?: string) => {
    if (date) entrees.push({ genre: "jalon", cle, titre, date, detail });
  };

  ajouterJalon("creation", "Opportunité créée", prospect.creeLe);
  ajouterJalon("qualification", "Prospect qualifié", prospect.qualifieLe);
  // Une planification est un fait réel enregistré, distinct de sa réalisation : les deux entrées
  // coexistent quand les deux dates existent.
  ajouterJalon("rdv_planifie", "Rendez-vous d'estimation planifié", prospect.rdvEstimationPrevuLe);
  ajouterJalon("rdv_realise", "Rendez-vous d'estimation réalisé", prospect.rdvEstimationRealiseLe);
  ajouterJalon(
    "estimation",
    "Estimation enregistrée",
    prospect.estimationProposeeLe,
    prospect.estimationProposeeCentimes !== undefined
      ? formatMontantEstimation(prospect.estimationProposeeCentimes)
      : undefined
  );
  ajouterJalon("mandat_propose", "Mandat proposé", prospect.mandatProposeLe);
  ajouterJalon("mandat_signe", "Mandat signé — bien créé", prospect.mandatSigneLe);
  ajouterJalon(
    "perte",
    "Opportunité perdue",
    prospect.datePerte,
    prospect.motifPerte ? LABEL_MOTIF_PERTE_PROSPECT_VENDEUR[prospect.motifPerte] : undefined
  );

  for (const note of notes) {
    entrees.push({ genre: "note", id: note.id, note, date: note.creeLe });
  }

  // Plus récent d'abord. À date égale (une date SQL `date` et un timestamptz du même jour peuvent
  // se croiser), l'ordre d'insertion ci-dessus fait foi — jamais un tri instable qui ferait
  // sauter les entrées d'un rendu à l'autre.
  return entrees.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

// ---------------------------------------------------------------------------
// Ancienneté relationnelle
// ---------------------------------------------------------------------------

// Même ancre que le moteur d'inactivité (calculOccurrencesInactivite.ts, ADR-033) :
// dernierContactLe s'il existe, sinon creeLe — un prospect jamais contacté n'est pas hors
// périmètre, son silence se compte depuis sa création. Jamais un score, jamais un seuil de
// priorité : un simple nombre de jours entre deux dates réelles.
export function joursDepuisDernierEchange(prospect: ProspectVendeur, maintenant: Date = new Date()): number {
  const ancre = prospect.dernierContactLe ?? prospect.creeLe;
  return Math.floor((maintenant.getTime() - new Date(ancre).getTime()) / (1000 * 60 * 60 * 24));
}
