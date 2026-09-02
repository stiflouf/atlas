import type { FaitsCommunication, TonMessage } from "@/lib/communications/contexteCommunication";

// VALUE-05 — contrat d'entrée de la rédaction assistée. L'IA occupe UNE case de la chaîne métier,
// entre le générateur déterministe et l'édition humaine :
//
//   faits métier -> mémoire relationnelle -> projection communicationnelle (VALUE-04)
//   -> brouillon déterministe -> RÉDACTION ASSISTÉE -> garde-fous -> conseiller -> Gmail
//
// Elle est un RÉDACTEUR, jamais une source de faits. Rien de la base, de la mémoire relationnelle
// ou des textes libres du CRM ne lui parvient : elle ne reçoit que le texte déjà autorisé à sortir
// et la liste exhaustive des faits qui le fondent.

// LISTE BLANCHE, garantie par le TYPE. `Pick` interdit structurellement d'y placer `tacheContexte`
// (note interne, EMAIL-DEMO-02), un montant d'offre, un prix convenu, `interetVisiteValeur` ou tout
// autre champ de FaitsCommunication non listé. C'est exactement la whitelist VALUE-04
// (FaitsPartageablesAcquereur) plus le prénom, déjà présent dans tout brouillon. L'élargir est un
// geste explicite, visible en revue, jamais un effet de bord.
export type FaitsAutorisesRedaction = Pick<
  FaitsCommunication,
  "destinatairePrenom" | "bienAdresse" | "dateVisite" | "interetVisite" | "criteresCompatibles"
>;

// Projection : construite champ par champ depuis les faits complets de l'écran. Jamais un spread
// (`{...faits}`), qui laisserait passer silencieusement tout champ ajouté plus tard à
// FaitsCommunication.
export function projeterFaitsAutorises(faits: FaitsCommunication): FaitsAutorisesRedaction {
  return {
    destinatairePrenom: faits.destinatairePrenom,
    bienAdresse: faits.bienAdresse,
    dateVisite: faits.dateVisite,
    interetVisite: faits.interetVisite,
    criteresCompatibles: faits.criteresCompatibles,
  };
}

export type ContexteRedactionAugmentee = {
  // Identifiant canonique du ton DOMIORA (ADR-031) — aucune seconde taxonomie n'est créée.
  ton: TonMessage;
  objetActuel: string;
  corpsActuel: string;
  faitsAutorises: FaitsAutorisesRedaction;
};

export type ResultatRedaction =
  | { type: "reformule"; objet: string; corps: string }
  // Une seule catégorie d'échec côté métier : provider absent, timeout, erreur HTTP, réponse
  // illisible. `raison` est un libellé technique COURT destiné aux logs — jamais affiché au
  // conseiller, jamais un message d'erreur du fournisseur.
  | { type: "indisponible"; raison: string };

// Le métier ne dépend d'aucun SDK : une interface, un adaptateur, une configuration. Router plus
// tard vers un modèle européen ou auto-hébergé ne doit demander aucune modification de
// Communications.
export interface RedacteurCommunication {
  // Nom court du fournisseur, pour les logs uniquement.
  readonly nom: string;
  reformuler(contexte: ContexteRedactionAugmentee): Promise<ResultatRedaction>;
}
