"use client";

import { useState } from "react";
import type { ProfilFiscal } from "@/types/profilFiscal";

const inputCls =
  "w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]";
const labelCls = "text-[12px] font-medium text-[#64748b] mb-1 block";
const helpCls = "text-[12px] text-[#94a3b8] mt-1";

// Même principe que bienFormulaire.parseTriEtat côté lecture : un select à 3 états.
function triEtat(valeur: boolean | undefined): "" | "oui" | "non" {
  if (valeur === true) return "oui";
  if (valeur === false) return "non";
  return "";
}

// Formulaire toujours utilisé pour créer un NOUVEL instantané (jamais une édition) — profilActuel,
// quand fourni, ne sert qu'à préremplir les valeurs par défaut d'une correction (ADR-023).
// regimeComptable/optionDebits/dates ACRE sont masqués tant qu'ils ne sont pas pertinents (point
// 1) : la visibilité suit exactement les invariants validés côté Server Action
// (profilFiscalFormulaire.ts) pour qu'un champ jamais affiché ne puisse jamais être rejeté.
export default function ProfilFiscalFormulaire({
  profilActuel,
  action,
}: {
  profilActuel?: ProfilFiscal;
  action: (formData: FormData) => Promise<void>;
}) {
  const [regimeFiscal, setRegimeFiscal] = useState(profilActuel?.regimeFiscal ?? "");
  const [regimeTva, setRegimeTva] = useState(profilActuel?.regimeTva ?? "");
  const [acreActif, setAcreActif] = useState<"" | "oui" | "non">(triEtat(profilActuel?.acreActif));

  const afficheRegimeComptable = regimeFiscal === "declaration_controlee";
  const afficheOptionDebits = regimeTva === "redevable_reel_simplifie" || regimeTva === "redevable_reel_normal";
  const afficheDatesAcre = acreActif === "oui";

  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className={labelCls}>Date de début de validité de cet instantané *</label>
        <input
          name="dateDebutValidite"
          type="date"
          required
          defaultValue={new Date().toISOString().slice(0, 10)}
          className={inputCls}
        />
        <p className={helpCls}>
          Pour une correction rétroactive (situation découverte après coup), indiquez la date réelle
          du changement, même dans le passé.
        </p>
      </div>

      <div>
        <label className={labelCls}>Date de début d&apos;activité *</label>
        <input
          name="dateDebutActivite"
          type="date"
          required
          defaultValue={profilActuel?.dateDebutActivite ?? ""}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Régime fiscal *</label>
        <select
          name="regimeFiscal"
          required
          value={regimeFiscal}
          onChange={(e) => setRegimeFiscal(e.target.value)}
          className={inputCls}
        >
          <option value="" disabled>
            Choisir...
          </option>
          <option value="micro_bnc">Micro-BNC</option>
          <option value="declaration_controlee">Déclaration contrôlée</option>
          <option value="inconnu">Je ne sais pas</option>
        </select>
        {regimeFiscal === "inconnu" && (
          <p className={helpCls}>
            Vérifiable sur votre message de confirmation d&apos;immatriculation Urssaf/INPI, ou sur
            votre avis de situation SIRENE.
          </p>
        )}
      </div>

      {afficheRegimeComptable && (
        <div>
          <label className={labelCls}>Régime comptable</label>
          <select name="regimeComptable" defaultValue={profilActuel?.regimeComptable ?? ""} className={inputCls}>
            <option value="">Je ne sais pas</option>
            <option value="caisse">Comptabilité de caisse (recettes encaissées)</option>
            <option value="engagement">Comptabilité d&apos;engagement (créances acquises)</option>
          </select>
        </div>
      )}

      <div>
        <label className={labelCls}>Régime TVA *</label>
        <select
          name="regimeTva"
          required
          value={regimeTva}
          onChange={(e) => setRegimeTva(e.target.value)}
          className={inputCls}
        >
          <option value="" disabled>
            Choisir...
          </option>
          <option value="franchise">Franchise en base (pas de TVA facturée)</option>
          <option value="redevable_reel_simplifie">Redevable — régime réel simplifié</option>
          <option value="redevable_reel_normal">Redevable — régime réel normal</option>
          <option value="inconnu">Je ne sais pas</option>
        </select>
        {regimeTva === "inconnu" && (
          <p className={helpCls}>
            Vérifiable sur votre dernière déclaration — probablement franchise si vous n&apos;avez
            jamais facturé de TVA.
          </p>
        )}
      </div>

      {afficheOptionDebits && (
        <div>
          <label className={labelCls}>Option pour les débits</label>
          <select name="optionDebits" defaultValue={triEtat(profilActuel?.optionDebits)} className={inputCls}>
            <option value="">Je ne sais pas</option>
            <option value="oui">Oui</option>
            <option value="non">Non</option>
          </select>
        </div>
      )}

      <div>
        <label className={labelCls}>Périodicité de déclaration Urssaf *</label>
        <select
          name="periodiciteUrssaf"
          required
          defaultValue={profilActuel?.periodiciteUrssaf ?? ""}
          className={inputCls}
        >
          <option value="" disabled>
            Choisir...
          </option>
          <option value="mensuelle">Mensuelle</option>
          <option value="trimestrielle">Trimestrielle</option>
          <option value="inconnu">Je ne sais pas</option>
        </select>
        <p className={helpCls}>Vérifiable sur autoentrepreneur.urssaf.fr, rubrique &laquo; Mon compte &raquo;.</p>
      </div>

      <div>
        <label className={labelCls}>ACRE</label>
        <select
          name="acreActif"
          value={acreActif}
          onChange={(e) => setAcreActif(e.target.value as "" | "oui" | "non")}
          className={inputCls}
        >
          <option value="">Je ne sais pas</option>
          <option value="oui">Bénéficiaire</option>
          <option value="non">Non bénéficiaire</option>
        </select>
      </div>

      {afficheDatesAcre && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Début ACRE</label>
            <input name="acreDateDebut" type="date" defaultValue={profilActuel?.acreDateDebut ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Fin ACRE</label>
            <input name="acreDateFin" type="date" defaultValue={profilActuel?.acreDateFin ?? ""} className={inputCls} />
          </div>
        </div>
      )}

      <div>
        <label className={labelCls}>Versement libératoire</label>
        <select
          name="optionVersementLiberatoire"
          defaultValue={triEtat(profilActuel?.optionVersementLiberatoire)}
          className={inputCls}
        >
          <option value="">Je ne sais pas</option>
          <option value="oui">Actif</option>
          <option value="non">Non actif</option>
        </select>
      </div>

      <div>
        <label className={labelCls}>Affiliation retraite *</label>
        <select
          name="affiliationRetraite"
          required
          defaultValue={profilActuel?.affiliationRetraite ?? ""}
          className={inputCls}
        >
          <option value="" disabled>
            Choisir...
          </option>
          <option value="ssi_regime_general">Sécurité sociale des indépendants (régime général)</option>
          <option value="cipav">Cipav</option>
          <option value="inconnu">Je ne sais pas</option>
        </select>
      </div>

      <button
        type="submit"
        className="self-start mt-2 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-4 py-2.5 rounded-lg"
      >
        {profilActuel ? "Enregistrer ce changement" : "Enregistrer ma situation fiscale"}
      </button>
    </form>
  );
}
