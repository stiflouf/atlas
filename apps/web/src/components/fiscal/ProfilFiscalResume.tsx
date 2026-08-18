import type { ProfilFiscal } from "@/types/profilFiscal";
import {
  LABEL_AFFILIATION_RETRAITE,
  LABEL_PERIODICITE_URSSAF,
  LABEL_REGIME_FISCAL,
  LABEL_REGIME_TVA,
} from "@/types/profilFiscal";

function Ligne({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex justify-between text-[13px] py-1.5 border-b border-border last:border-b-0">
      <span className="text-text-2">{label}</span>
      <span className="text-text-1 font-medium">{valeur}</span>
    </div>
  );
}

function libelleTriEtat(valeur: boolean | undefined, siOui: string, siNon: string): string {
  if (valeur === true) return siOui;
  if (valeur === false) return siNon;
  return "Je ne sais pas";
}

// Lecture seule — reflète l'instantané applicable aujourd'hui (chargerProfilFiscalActuel), jamais
// l'historique complet (pas d'écran d'audit en V1).
export default function ProfilFiscalResume({ profil }: { profil: ProfilFiscal }) {
  return (
    <div className="bg-surface border border-border-md rounded-lg px-4 py-3">
      <p className="text-[12px] text-text-3 mb-2">Situation applicable depuis le {profil.dateDebutValidite}</p>
      <Ligne label="Régime fiscal" valeur={LABEL_REGIME_FISCAL[profil.regimeFiscal]} />
      <Ligne label="Régime TVA" valeur={LABEL_REGIME_TVA[profil.regimeTva]} />
      <Ligne label="Périodicité Urssaf" valeur={LABEL_PERIODICITE_URSSAF[profil.periodiciteUrssaf]} />
      <Ligne label="Affiliation retraite" valeur={LABEL_AFFILIATION_RETRAITE[profil.affiliationRetraite]} />
      <Ligne
        label="Versement libératoire"
        valeur={libelleTriEtat(profil.optionVersementLiberatoire, "Actif", "Non actif")}
      />
      <Ligne label="ACRE" valeur={libelleTriEtat(profil.acreActif, "Bénéficiaire", "Non bénéficiaire")} />
    </div>
  );
}
