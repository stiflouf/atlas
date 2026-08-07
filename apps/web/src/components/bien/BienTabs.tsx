"use client";

import { useState } from "react";
import type { Bien } from "@/types/bien";
import { rendezVousDuJour } from "@/data/agenda";

type Tab = "contexte" | "historique" | "notes" | "visites" | "documents" | "actions";

const TABS: { id: Tab; label: string }[] = [
  { id: "contexte", label: "Contexte" },
  { id: "historique", label: "Historique" },
  { id: "notes", label: "Notes" },
  { id: "visites", label: "Visites" },
  { id: "documents", label: "Documents" },
  { id: "actions", label: "Actions" },
];

const mockHistorique = [
  { date: "2026-08-01", auteur: "Steven G.", texte: "Deuxième visite — retour positif des Dubois. Ils souhaitent faire une offre." },
  { date: "2026-07-18", auteur: "Steven G.", texte: "Première visite avec les Dubois. Très intéressés par la luminosité et la proximité du métro." },
  { date: "2026-07-10", auteur: "Steven G.", texte: "Bien mis en ligne sur SeLoger et LeBonCoin." },
  { date: "2026-06-28", auteur: "Steven G.", texte: "Photos réalisées. Bien prêt à être publié." },
  { date: "2026-05-12", auteur: "Steven G.", texte: "Signature du mandat exclusif. Prix convenu : 520 000€." },
];

const mockNotes =
  "Propriétaire motivé à vendre — divorce en cours. Disponible pour les visites en semaine après 17h et le week-end. Ne pas communiquer la raison de la vente aux acquéreurs. Clés disponibles à l'agence.\n\nPoint d'attention : l'immeuble a voté des travaux de ravalement prévu en 2027 (quote-part estimée : 4 200€ pour cet appartement).";

const mockDocuments = [
  { nom: "Mandat exclusif signé", date: "2026-05-12", type: "Mandat" },
  { nom: "Diagnostics énergétiques (DPE)", date: "2026-05-20", type: "Diagnostic" },
  { nom: "Règlement de copropriété", date: "2026-05-20", type: "Copropriété" },
  { nom: "3 derniers PV d'AG", date: "2026-05-20", type: "Copropriété" },
  { nom: "Plans de l'appartement", date: "2026-06-01", type: "Technique" },
  { nom: "Photos professionnelles (24 fichiers)", date: "2026-06-28", type: "Commercial" },
];

const mockActions = [
  { id: "a1", label: "Appeler les Dubois pour confirmer leur intention d'offre", contexte: "Suite à la 2e visite du 1er août" },
  { id: "a2", label: "Mettre à jour l'annonce SeLoger avec les nouvelles photos", contexte: "Photos reçues le 28 juin" },
  { id: "a3", label: "Vérifier la quote-part des travaux de ravalement 2027", contexte: "À mentionner dans la promesse de vente" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function BienTabs({ bien }: { bien: Bien }) {
  const [active, setActive] = useState<Tab>("contexte");

  const visites = rendezVousDuJour.filter((rdv) => rdv.bien?.id === bien.id);

  return (
    <div>
      {/* Onglets */}
      <div className="flex overflow-x-auto gap-0 border-b border-[#f1f5f9] mb-6 scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`shrink-0 px-4 py-3 text-[13px] font-medium border-b-2 transition-colors duration-100 ${
              active === tab.id
                ? "border-[#4338ca] text-[#4338ca]"
                : "border-transparent text-[#94a3b8] hover:text-[#64748b]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      {active === "contexte" && (
        <div>
          <p className="text-[14px] text-[#64748b] leading-relaxed mb-6">{bien.description}</p>
          <ul className="flex flex-col gap-2">
            {bien.caracteristiques.map((c) => (
              <li key={c} className="flex items-start gap-2 text-[14px] text-[#0f172a]">
                <span className="text-[#4338ca] mt-0.5 shrink-0">·</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {active === "historique" && (
        <div className="flex flex-col">
          {mockHistorique.map((evt, i) => (
            <div key={i} className="flex gap-4 pb-6 relative">
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 rounded-full bg-[#4338ca] mt-1.5 shrink-0" />
                {i < mockHistorique.length - 1 && (
                  <div className="w-px flex-1 bg-[#f1f5f9] mt-1" />
                )}
              </div>
              <div className="flex-1 min-w-0 pb-0">
                <p className="text-[11px] text-[#94a3b8] mb-0.5">{formatDate(evt.date)} · {evt.auteur}</p>
                <p className="text-[14px] text-[#0f172a] leading-snug">{evt.texte}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {active === "notes" && (
        <div>
          <div className="bg-[#fafafa] rounded-lg p-4 border border-[#f1f5f9]">
            {mockNotes.split("\n\n").map((paragraph, i) => (
              <p key={i} className={`text-[14px] text-[#64748b] leading-relaxed ${i > 0 ? "mt-4" : ""}`}>
                {paragraph}
              </p>
            ))}
          </div>
          <p className="text-[11px] text-[#94a3b8] mt-3">Notes privées — non communiquées aux acquéreurs.</p>
        </div>
      )}

      {active === "visites" && (
        <div>
          {visites.length === 0 ? (
            <p className="text-[14px] text-[#94a3b8]">Aucune visite à venir dans l'agenda.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {visites.map((rdv) => (
                <div key={rdv.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                  <p className="text-[13px] font-medium text-[#64748b]">{rdv.heure} — Aujourd'hui</p>
                  <p className="text-[14px] font-medium text-[#0f172a] mt-0.5">{rdv.client?.prenom} {rdv.client?.nom}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {active === "documents" && (
        <div className="flex flex-col divide-y divide-[#f1f5f9] bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          {mockDocuments.map((doc) => (
            <div key={doc.nom} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-[#0f172a] truncate">{doc.nom}</p>
                <p className="text-[11px] text-[#94a3b8]">{doc.type} · {formatDate(doc.date)}</p>
              </div>
              <span className="text-[13px] text-[#4338ca] font-medium shrink-0">Voir</span>
            </div>
          ))}
        </div>
      )}

      {active === "actions" && (
        <div className="flex flex-col divide-y divide-[#f1f5f9] bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4">
          {mockActions.map((action) => (
            <div key={action.id} className="flex items-start gap-3 py-3">
              <div className="w-4 h-4 mt-0.5 rounded border border-[#e2e8f0] shrink-0" />
              <div>
                <p className="text-[14px] text-[#0f172a]">{action.label}</p>
                {action.contexte && <p className="text-[13px] text-[#94a3b8] mt-0.5">{action.contexte}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
