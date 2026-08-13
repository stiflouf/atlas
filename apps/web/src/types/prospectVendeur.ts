import type { TypeBien } from "@/types/bien";
import type { OrigineLead } from "@/types/origineLead";
import type { MotifPerteProspectVendeur } from "@/types/motifPerteProspectVendeur";

// ADR-027. Une OPPORTUNITÉ commerciale de prise de mandat sur un bien potentiel, avec UN contact
// vendeur principal — jamais une personne physique générique découplée de l'opportunité. Limites
// V1 assumées, documentées explicitement (ne pas les traiter comme résolues) :
// - un seul contact principal par opportunité ;
// - une seule opportunité par bien potentiel (bienId unique côté schéma, voir db/schema.ts) ;
// - plusieurs propriétaires sur un même bien, ou un même propriétaire avec plusieurs biens,
//   nécessiteront une séparation contact <-> opportunité vendeur dans une passe ultérieure — pas
//   construite ici.
export type StatutProspectVendeur =
  | "prospect"
  | "qualification"
  | "rendez_vous"
  | "estimation"
  | "mandat_propose"
  | "mandat_signe"
  | "perdu";

export type ProspectVendeur = {
  id: string;
  nom: string;
  // Un lead peut n'être connu que par son nom, ou correspondre plus tard à une SCI/indivision/
  // succession — pas de modèle personne physique/personne morale construit ici (voir limites V1).
  prenom?: string;
  email?: string;
  telephone?: string;
  origineLead?: OrigineLead;
  origineLeadDetail?: string;
  // Adresse PRÉCISE uniquement — jamais un secteur approximatif dans ce champ (voir
  // secteurBienPotentiel ci-dessous, et signerMandatProspectVendeur pour la règle de conversion).
  adresseBienPotentiel?: string;
  // Description approximative libre ("quartier centre-ville") quand aucune adresse précise n'est
  // encore connue — jamais utilisée pour préremplir biens.adresse.
  secteurBienPotentiel?: string;
  ville?: string;
  codePostal?: string;
  typeBien?: TypeBien;
  qualifieLe?: string;
  estimationProposeeCentimes?: number;
  estimationProposeeLe?: string;
  // Planifié — ne fait jamais avancer le statut (voir deriverStatutProspectVendeur).
  rdvEstimationPrevuLe?: string;
  // Effectivement tenu — fait avancer le statut vers "rendez_vous".
  rdvEstimationRealiseLe?: string;
  mandatProposeLe?: string;
  mandatSigneLe?: string;
  // Vraie FK vers un bien réel, posée atomiquement avec mandatSigneLe (ADR-010) — jamais présente
  // avant la conversion.
  bienId?: string;
  motifPerte?: MotifPerteProspectVendeur;
  datePerte?: string;
  // Mis à jour uniquement par une vraie interaction (note de type != 'note_interne', ou rendez-
  // vous marqué réalisé) — jamais par un simple jalon de pipeline. Indispensable pour de futures
  // règles déterministes de relance (ADR-029+) qui mesureraient un vrai silence vendeur — les
  // tâches liées à ce prospect (table `taches`, prospectVendeurId, ADR-028) peuvent optionnellement
  // journaliser une telle interaction à leur clôture, jamais automatiquement.
  dernierContactLe?: string;
  // Gestion administrative de la fiche (doublon, erreur de saisie) — distincte de motifPerte/
  // datePerte (résultat commercial). Voir ADR-012.
  archiveLe?: string;
  creeLe: string;
  modifieLe: string;
};

// Champs saisissables à la création — tous les jalons, l'issue commerciale, la conversion et
// l'archivage sont posés ensuite par leur propre Server Action, jamais à la création. Depuis
// ADR-028, la prochaine action se crée comme une tâche (table `taches`, prospectVendeurId) plutôt
// qu'un champ de ce formulaire.
export type NouveauProspectVendeur = Pick<
  ProspectVendeur,
  | "nom"
  | "prenom"
  | "email"
  | "telephone"
  | "origineLead"
  | "origineLeadDetail"
  | "adresseBienPotentiel"
  | "secteurBienPotentiel"
  | "ville"
  | "codePostal"
  | "typeBien"
>;

// Dérivé, jamais stocké (même principe que deriverStatutCommercial, ADR-014) : le jalon le plus
// avancé déjà RÉELLEMENT atteint l'emporte. Ordre d'affichage : prospect -> qualification ->
// rendez_vous -> estimation -> mandat_propose -> mandat_signe, perdu prioritaire depuis n'importe
// quel état. rdvEstimationPrevuLe seul ne fait jamais avancer le statut (rendez-vous planifié !=
// réalisé). estimationProposeeLe est vérifié AVANT rdvEstimationRealiseLe dans la cascade : une
// estimation déjà chiffrée représente un stade plus avancé qu'un rendez-vous seulement marqué
// réalisé — mais aucun ordre strict n'est imposé à la SAISIE (une estimation peut être chiffrée
// avant même qu'un rendez-vous soit marqué réalisé), cette cascade ne fixe que la représentation
// du stade le plus avancé.
export function deriverStatutProspectVendeur(prospect: ProspectVendeur): StatutProspectVendeur {
  if (prospect.datePerte) return "perdu";
  if (prospect.mandatSigneLe) return "mandat_signe";
  if (prospect.mandatProposeLe) return "mandat_propose";
  if (prospect.estimationProposeeLe) return "estimation";
  if (prospect.rdvEstimationRealiseLe) return "rendez_vous";
  if (prospect.qualifieLe) return "qualification";
  return "prospect";
}

export const LABEL_STATUT_PROSPECT_VENDEUR: Record<StatutProspectVendeur, string> = {
  prospect: "Prospect",
  qualification: "Qualification",
  rendez_vous: "Rendez-vous",
  estimation: "Estimation",
  mandat_propose: "Mandat proposé",
  mandat_signe: "Mandat signé",
  perdu: "Perdu",
};
