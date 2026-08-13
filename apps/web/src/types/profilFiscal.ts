// ADR-023. 'inconnu' est une vraie valeur de ces unions, distincte de l'absence de profil —
// jamais interprétée comme un régime par défaut (voir schema.ts, profil_fiscal).
export type RegimeFiscal = "micro_bnc" | "declaration_controlee" | "inconnu";
export type RegimeComptable = "caisse" | "engagement" | "inconnu";
export type RegimeTva = "franchise" | "redevable_reel_simplifie" | "redevable_reel_normal" | "inconnu";
export type PeriodiciteUrssaf = "mensuelle" | "trimestrielle" | "inconnu";
export type AffiliationRetraite = "ssi_regime_general" | "cipav" | "inconnu";

// Instantané complet (voir schema.ts pour la logique de résolution par date). regimeComptable
// n'intervient dans aucun calcul TVA (point 1, corrigé) — il concerne exclusivement la lecture des
// recettes BNC en déclaration contrôlée.
export type ProfilFiscal = {
  id: string;
  dossierFiscalId: string;
  dateDebutValidite: string;
  natureActivite: "agent_commercial_immobilier";
  dateDebutActivite: string;
  regimeFiscal: RegimeFiscal;
  regimeComptable?: RegimeComptable;
  regimeTva: RegimeTva;
  optionDebits?: boolean;
  periodiciteUrssaf: PeriodiciteUrssaf;
  optionVersementLiberatoire?: boolean;
  acreActif?: boolean;
  acreDateDebut?: string;
  acreDateFin?: string;
  affiliationRetraite: AffiliationRetraite;
  creeLe: string;
};

export type NouveauProfilFiscal = Omit<ProfilFiscal, "id" | "creeLe">;

export const LABEL_REGIME_FISCAL: Record<RegimeFiscal, string> = {
  micro_bnc: "Micro-BNC",
  declaration_controlee: "Déclaration contrôlée",
  inconnu: "Je ne sais pas",
};

export const LABEL_REGIME_TVA: Record<RegimeTva, string> = {
  franchise: "Franchise en base (pas de TVA facturée)",
  redevable_reel_simplifie: "Redevable — régime réel simplifié",
  redevable_reel_normal: "Redevable — régime réel normal",
  inconnu: "Je ne sais pas",
};

export const LABEL_PERIODICITE_URSSAF: Record<PeriodiciteUrssaf, string> = {
  mensuelle: "Mensuelle",
  trimestrielle: "Trimestrielle",
  inconnu: "Je ne sais pas",
};

export const LABEL_AFFILIATION_RETRAITE: Record<AffiliationRetraite, string> = {
  ssi_regime_general: "Sécurité sociale des indépendants (régime général)",
  cipav: "Cipav",
  inconnu: "Je ne sais pas",
};
