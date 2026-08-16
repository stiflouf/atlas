"use client";

import { ajouterCompromisAction } from "@/actions/compromis";
import type { ProfilAcquereur } from "@/types/client";
import type { Offre } from "@/types/offre";

function formatPrix(montant: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(montant);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

type ProprietesCommunes = {
  bienId: string;
};

// Deux modes, même principe qu'OffreFormulaire (ADR-044) : `verrouille: false` (parcours normal
// depuis la fiche Bien — Acquéreur et Offre restent deux sélections indépendantes, comportement
// historique inchangé, un compromis direct sans offre reste pleinement possible) et
// `verrouille: true` (parcours contextuel depuis une Offre acceptée, ADR-045 — Acquéreur ET Offre
// sont des faits déjà structurés de cette Offre, non modifiables dans ce parcours ; le montant de
// l'offre est affiché en simple référence, jamais préempli dans `prixConvenu` — le prix peut
// légitimement avoir évolué entre acceptation et signature).
type Props =
  | (ProprietesCommunes & { verrouille: false; acquereurs: ProfilAcquereur[]; offresAcceptees: Offre[] })
  | (ProprietesCommunes & { verrouille: true; acquereur: ProfilAcquereur; offre: Offre });

export default function CompromisFormulaire(props: Props) {
  const acquereursParId = !props.verrouille ? new Map(props.acquereurs.map((a) => [a.id, a])) : undefined;

  return (
    <form action={ajouterCompromisAction} className="flex flex-col gap-2">
      <input type="hidden" name="bienId" value={props.bienId} />

      {props.verrouille ? (
        <>
          <div>
            <p className="text-[11px] font-medium text-[#64748b] mb-1">Acquéreur</p>
            <p className="text-[14px] font-medium text-[#0f172a] bg-[#fafafa] border border-[#f1f5f9] rounded-lg px-3 py-2">
              {props.acquereur.prenom} {props.acquereur.nom}
            </p>
            <input type="hidden" name="acquereurId" value={props.acquereur.id} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-[#64748b] mb-1">Offre acceptée</p>
            <p className="text-[14px] font-medium text-[#0f172a] bg-[#fafafa] border border-[#f1f5f9] rounded-lg px-3 py-2">
              {formatPrix(props.offre.montant)} — {formatDate(props.offre.dateOffre)}
            </p>
            <input type="hidden" name="offreId" value={props.offre.id} />
          </div>
        </>
      ) : (
        <>
          <select
            name="acquereurId"
            required
            defaultValue=""
            className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
          >
            <option value="" disabled>
              Acquéreur
            </option>
            {props.acquereurs.map((a) => (
              <option key={a.id} value={a.id}>
                {a.prenom} {a.nom}
              </option>
            ))}
          </select>
          <select
            name="offreId"
            defaultValue=""
            className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
          >
            <option value="">Aucune (compromis direct)</option>
            {props.offresAcceptees.map((o) => {
              const acq = acquereursParId?.get(o.acquereurId);
              return (
                <option key={o.id} value={o.id}>
                  {formatPrix(o.montant)} — {acq ? `${acq.prenom} ${acq.nom}` : "Acquéreur indisponible"} —{" "}
                  {formatDate(o.dateOffre)}
                </option>
              );
            })}
          </select>
        </>
      )}

      <input
        type="number"
        name="prixConvenu"
        required
        min={1}
        placeholder="Prix convenu (€)"
        className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
      />
      <label className="text-[11px] text-[#94a3b8]">
        Date de signature
        <input
          type="date"
          name="dateSignature"
          required
          className="w-full mt-1 border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
        />
      </label>
      <label className="text-[11px] text-[#94a3b8]">
        Date d&apos;acte prévue (optionnelle)
        <input
          type="date"
          name="dateActe"
          className="w-full mt-1 border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
        />
      </label>
      <button
        type="submit"
        className="self-start text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
      >
        Ajouter le compromis
      </button>
    </form>
  );
}
