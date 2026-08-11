"use client";

import { useState } from "react";
import type { Bien } from "@/types/bien";
import type { DossierBien } from "@/data/dossier";
import type { ActionMetier } from "@/types/action";
import { rendezVousDuJour } from "@/data/agenda";
import { terminerActionAction } from "@/actions/terminerAction";
import { deriverHistoriqueBien, type EvenementHistorique } from "@/lib/historiqueBien";

type Tab = "contexte" | "historique" | "notes" | "visites" | "documents" | "actions";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function BienTabs({
  bien,
  dossier,
  actions,
}: {
  bien: Bien;
  dossier?: DossierBien;
  actions: ActionMetier[];
}) {
  const [active, setActive] = useState<Tab>("contexte");

  // Contexte et Actions reposent sur des données réelles (bien, actionRepository), toujours
  // disponibles. Notes/Documents/Visites n'ont pas d'équivalent réel aujourd'hui (aucune table
  // d'audit, de notes, de documents ou de suivi de visites effectuées) : masqués plutôt que de
  // fabriquer un DossierBien artificiel pour un bien réel. Historique, lui, est dérivé de faits
  // réels (bien.creeLe, action.creeLe/termineLe) quand aucun dossier mock n'existe.
  const evenementsHistorique: EvenementHistorique[] = dossier
    ? dossier.historique
    : deriverHistoriqueBien(bien, actions);

  const TABS: { id: Tab; label: string }[] = [
    { id: "contexte", label: "Contexte" },
    ...(evenementsHistorique.length > 0 ? ([{ id: "historique", label: "Historique" }] as const) : []),
    ...(dossier
      ? ([
          { id: "notes", label: "Notes" },
          { id: "visites", label: "Visites" },
          { id: "documents", label: "Documents" },
        ] as const)
      : []),
    { id: "actions", label: "Actions" },
  ];

  const visitesAVenir = rendezVousDuJour.filter((rdv) => rdv.bien?.id === bien.id);
  const visitesPassees = dossier ? [...dossier.visitesEffectuees].sort((a, b) => (a.date < b.date ? 1 : -1)) : [];

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

      {active === "historique" && dossier && (
        <div className="flex flex-col">
          {dossier.historique.map((evt, i) => (
            <div key={i} className="flex gap-4 pb-6 relative">
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 rounded-full bg-[#4338ca] mt-1.5 shrink-0" />
                {i < dossier.historique.length - 1 && (
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

      {active === "historique" && !dossier && (
        <div className="flex flex-col">
          {evenementsHistorique.map((evt, i) => (
            <div key={`${bien.id}-${evt.date}`} className="flex gap-4 pb-6 relative">
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 rounded-full bg-[#4338ca] mt-1.5 shrink-0" />
                {i < evenementsHistorique.length - 1 && (
                  <div className="w-px flex-1 bg-[#f1f5f9] mt-1" />
                )}
              </div>
              <div className="flex-1 min-w-0 pb-0">
                <p className="text-[11px] text-[#94a3b8] mb-0.5">{formatDate(evt.date)}</p>
                <p className="text-[14px] text-[#0f172a] leading-snug">{evt.texte}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {active === "notes" && dossier && (
        <div>
          <div className="bg-[#fafafa] rounded-lg p-4 border border-[#f1f5f9]">
            {dossier.notes.split("\n\n").map((paragraph, i) => (
              <p key={i} className={`text-[14px] text-[#64748b] leading-relaxed ${i > 0 ? "mt-4" : ""}`}>
                {paragraph}
              </p>
            ))}
          </div>
          <p className="text-[11px] text-[#94a3b8] mt-3">Notes privées — non communiquées aux acquéreurs.</p>
        </div>
      )}

      {active === "visites" && (
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">À venir</p>
            {visitesAVenir.length === 0 ? (
              <p className="text-[14px] text-[#94a3b8]">Aucune visite à venir dans l'agenda.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {visitesAVenir.map((rdv) => (
                  <div key={rdv.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                    <p className="text-[13px] font-medium text-[#64748b]">{rdv.heure} — Aujourd'hui</p>
                    <p className="text-[14px] font-medium text-[#0f172a] mt-0.5">{rdv.client?.prenom} {rdv.client?.nom}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Effectuées</p>
            {visitesPassees.length === 0 ? (
              <p className="text-[14px] text-[#94a3b8]">Aucune visite effectuée pour l'instant.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {visitesPassees.map((v) => (
                  <div key={v.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                    <p className="text-[13px] font-medium text-[#64748b]">{formatDate(v.date)}</p>
                    <p className="text-[14px] font-medium text-[#0f172a] mt-0.5">{v.client}</p>
                    <p className="text-[13px] text-[#94a3b8] mt-1 leading-snug">{v.retour}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {active === "documents" && dossier && (
        <div className="flex flex-col divide-y divide-[#f1f5f9] bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          {dossier.documents.map((doc) => (
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
          {actions.length === 0 ? (
            <p className="text-[14px] text-[#94a3b8] py-3">Aucune action en cours sur ce dossier.</p>
          ) : (
            actions.map((action) => (
              <div key={action.id} className="flex items-start gap-3 py-3">
                {action.statut === "termine" ? (
                  <div className="w-4 h-4 mt-0.5 rounded border shrink-0 bg-[#f1f5f9] border-[#e2e8f0]" />
                ) : (
                  <form action={terminerActionAction} className="mt-0.5 shrink-0">
                    <input type="hidden" name="id" value={action.id} />
                    <input type="hidden" name="redirectTo" value={`/biens/${bien.id}`} />
                    <button
                      type="submit"
                      aria-label="Marquer comme terminée"
                      className="w-4 h-4 rounded border border-[#e2e8f0] hover:border-[#4338ca] hover:bg-[#eef2ff] transition-colors"
                    />
                  </form>
                )}
                <div>
                  <p className="text-[14px] text-[#0f172a]">{action.titre}</p>
                  {action.contexte && <p className="text-[13px] text-[#94a3b8] mt-0.5">{action.contexte}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
