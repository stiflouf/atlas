import type { ProfilFiscal } from "@/types/profilFiscal";
import {
  LABEL_AFFILIATION_RETRAITE,
  LABEL_PERIODICITE_URSSAF,
  LABEL_REGIME_FISCAL,
  LABEL_REGIME_TVA,
} from "@/types/profilFiscal";

function Ligne({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex justify-between text-[13px] py-1.5 border-b border-[#f1f5f9] last:border-b-0">
      <span className="text-[#64748b]">{label}</span>
      <span className="text-[#0f172a] font-medium">{valeur}</span>
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
    <div className="bg-white border border-[#e2e8f0] rounded-lg px-4 py-3">
      <p className="text-[12px] text-[#94a3b8] mb-2">Situation applicable depuis le {profil.dateDebutValidite}</p>
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
