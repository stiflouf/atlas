// ADR-059 — contrats du JOURNAL de fusion (`contact_fusions`). Ce que ces types fixent : la forme
// des colonnes `jsonb`, pour qu'un journal écrit aujourd'hui se relise dans trois ans. Aucun
// écrivain n'existe encore ; le moteur de fusion (lot à part) devra produire exactement ceci.

// L'identité d'un Contact telle qu'elle était à un instant : les quatre champs canoniques, rien
// d'autre. `undefined` = absence, jamais "" (même règle que `Contact`).
export type IdentiteContactSnapshot = {
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
};

export const CHAMPS_IDENTITE_CONTACT = ["nom", "prenom", "email", "telephone"] as const;
export type ChampIdentiteContact = (typeof CHAMPS_IDENTITE_CONTACT)[number];

// Ce qu'un humain a décidé pour chaque champ : la valeur du survivant, celle de l'absorbé, ou
// aucun choix à faire (valeurs identiques, ou une seule non absente — `absence_comblee`).
export type ChoixFusionChamp = "survivant" | "absorbe" | "identique" | "absence_comblee";
export type ChoixFusionParChamp = Record<ChampIdentiteContact, ChoixFusionChamp>;

// Les ids déplacés vers le survivant, table par table — ce qui rend une restauration manuelle
// possible. `partiesProjetSupprimees` : les participations de l'absorbé retirées parce que le
// survivant participait déjà au même projet (seule suppression physique prévue par le moteur).
export type IdsDeplacesFusionContact = {
  interactions: string[];
  partiesProjet: string[];
  partiesProjetSupprimees: string[];
  acquereurs: string[];
  prospectsVendeurs: string[];
  referencesExternes: string[];
};

export type ContactFusion = {
  id: string;
  contactSurvivantId: string;
  contactAbsorbeId: string;
  fusionneLe: string;
  fusionneParSub?: string;
  fusionneParEmail?: string;
  identiteAvantSurvivant: IdentiteContactSnapshot;
  identiteAvantAbsorbe: IdentiteContactSnapshot;
  identiteFinale: IdentiteContactSnapshot;
  choixParChamp: ChoixFusionParChamp;
  idsDeplaces: IdsDeplacesFusionContact;
  // Libellés stables des avertissements que l'humain a explicitement acquittés (par exemple deux
  // références du même fournisseur).
  avertissementsAcquittes: string[];
};
