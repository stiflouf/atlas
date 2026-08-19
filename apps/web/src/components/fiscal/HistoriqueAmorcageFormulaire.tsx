"use client";

import { useState } from "react";
import { PRODUCT_NAME } from "@/lib/branding";

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";

// Trois années — l'année en cours et les deux précédentes — car aucune règle actuelle (micro-BNC,
// franchise TVA) ne remonte plus loin (ADR-023, point 2 de l'audit préalable). dateFinCouverture
// n'est demandée que pour l'année en cours : une année révolue est nécessairement couverte en
// totalité (voir schema.ts, historique_amorcage).
export default function HistoriqueAmorcageFormulaire({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const anneeEnCours = new Date().getFullYear();
  const [annee, setAnnee] = useState(String(anneeEnCours));
  const anneeEstEnCours = Number(annee) === anneeEnCours;

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Année</label>
          <select name="annee" value={annee} onChange={(e) => setAnnee(e.target.value)} className={inputCls}>
            <option value={anneeEnCours}>{anneeEnCours}</option>
            <option value={anneeEnCours - 1}>{anneeEnCours - 1}</option>
            <option value={anneeEnCours - 2}>{anneeEnCours - 2}</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Montant encaissé (€)</label>
          <input name="montantEncaisse" required placeholder="0,00" className={inputCls} />
        </div>
      </div>

      {anneeEstEnCours && (
        <div>
          <label className={labelCls}>Jusqu&apos;à quelle date avez-vous ce total ?</label>
          <input name="dateFinCouverture" type="date" required className={inputCls} />
          <p className="text-[12px] text-text-3 mt-1">
            Les encaissements suivis par {PRODUCT_NAME} après cette date s&apos;ajouteront automatiquement, sans
            jamais être comptés deux fois.
          </p>
        </div>
      )}

      <button
        type="submit"
        className="self-start text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-4 py-2 rounded-lg"
      >
        Enregistrer
      </button>
    </form>
  );
}
