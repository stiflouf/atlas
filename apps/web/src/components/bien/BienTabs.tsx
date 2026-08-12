"use client";

import { useState } from "react";
import type { Bien } from "@/types/bien";
import type { DossierBien } from "@/data/dossier";
import type { ActionMetier } from "@/types/action";
import type { NoteBien } from "@/types/noteBien";
import type { ProfilAcquereur } from "@/types/client";
import { LABEL_INTERET, type CompteRenduVisite } from "@/types/compteRenduVisite";
import { LABEL_CATEGORIE_DOCUMENT, type CategorieDocument, type DocumentBien } from "@/types/documentBien";
import { LABEL_STATUT_OFFRE, type Offre } from "@/types/offre";
import { LABEL_STATUT_COMPROMIS, type Compromis } from "@/types/compromis";
import { rendezVousDuJour } from "@/data/agenda";
import { terminerActionAction } from "@/actions/terminerAction";
import { ajouterNoteBienAction } from "@/actions/ajouterNoteBien";
import { ajouterDocumentBienAction } from "@/actions/ajouterDocumentBien";
import { ajouterOffreAction, changerStatutOffreAction } from "@/actions/offre";
import { ajouterCompromisAction, changerStatutCompromisAction } from "@/actions/compromis";
import { deriverHistoriqueBien, type EvenementHistorique } from "@/lib/historiqueBien";

const CATEGORIES_DOCUMENT: CategorieDocument[] = [
  "mandat",
  "diagnostic",
  "copropriete",
  "technique",
  "commercial",
  "compromis",
  "autre",
];

function formatTaille(octets: number): string {
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatPrix(montant: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    montant
  );
}

type Tab = "contexte" | "historique" | "notes" | "visites" | "documents" | "offres" | "compromis" | "actions";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function BienTabs({
  bien,
  dossier,
  actions,
  notes,
  comptesRendus,
  documents,
  offres,
  compromis,
  acquereursActifs = [],
  acquereursParId = new Map(),
}: {
  bien: Bien;
  dossier?: DossierBien;
  actions: ActionMetier[];
  notes: NoteBien[];
  comptesRendus: CompteRenduVisite[];
  documents: DocumentBien[];
  offres: Offre[];
  compromis: Compromis[];
  acquereursActifs?: ProfilAcquereur[];
  acquereursParId?: Map<string, ProfilAcquereur | undefined>;
}) {
  const [active, setActive] = useState<Tab>("contexte");

  // Contexte, Actions, Notes, Visites et Documents reposent tous sur des données réelles (bien,
  // actionRepository, noteBienRepository, compteRenduVisiteRepository, documentBienRepository),
  // toujours disponibles — Notes, Visites et Documents restent affichés même vides, c'est
  // justement là que le conseiller ajoute sa première entrée. Historique, lui, est dérivé de
  // faits réels (bien.creeLe, action.creeLe/termineLe, comptes rendus de visite) quand aucun
  // dossier mock n'existe.
  const evenementsHistorique: EvenementHistorique[] = dossier
    ? dossier.historique
    : deriverHistoriqueBien(bien, actions, comptesRendus, offres, compromis);

  const TABS: { id: Tab; label: string }[] = [
    { id: "contexte", label: "Contexte" },
    ...(evenementsHistorique.length > 0 ? ([{ id: "historique", label: "Historique" }] as const) : []),
    { id: "notes", label: "Notes" },
    { id: "visites", label: "Visites" },
    { id: "documents", label: "Documents" },
    // Pas d'équivalent mock (aucun DossierBien.offres/compromis) — visibles pour un bien réel
    // uniquement.
    ...(!dossier ? ([{ id: "offres", label: "Offres" }] as const) : []),
    ...(!dossier ? ([{ id: "compromis", label: "Compromis" }] as const) : []),
    { id: "actions", label: "Actions" },
  ];

  const visitesAVenir = rendezVousDuJour.filter((rdv) => rdv.bien?.id === bien.id);
  const visitesPasseesMock = dossier
    ? [...dossier.visitesEffectuees].sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];
  const comptesRendusTries = [...comptesRendus].sort((a, b) => (a.dateVisite < b.dateVisite ? 1 : -1));
  const offresTriees = [...offres].sort((a, b) => (a.dateOffre < b.dateOffre ? 1 : -1));
  const offresAccepteesDuBien = offres.filter((o) => o.statut === "acceptee");
  const compromisTries = [...compromis].sort((a, b) => (a.dateSignature < b.dateSignature ? 1 : -1));
  const compromisEnCours = compromis.some((c) => c.statut === "en_cours");

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

      {active === "notes" && !dossier && (
        <div className="flex flex-col gap-4">
          {bien.archiveLe ? (
            <p className="text-[13px] text-[#94a3b8] bg-[#fafafa] rounded-lg border border-[#f1f5f9] p-3">
              Ce bien est archivé — impossible d'ajouter une nouvelle note.
            </p>
          ) : (
            <form action={ajouterNoteBienAction} className="flex flex-col gap-2">
              <input type="hidden" name="bienId" value={bien.id} />
              <textarea
                name="contenu"
                rows={3}
                required
                placeholder="Ajouter une note..."
                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              />
              <button
                type="submit"
                className="self-start text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
              >
                Ajouter une note
              </button>
            </form>
          )}

          {notes.length === 0 ? (
            <p className="text-[14px] text-[#94a3b8]">Aucune note pour l'instant.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {notes.map((note) => (
                <div key={note.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                  <p className="text-[11px] text-[#94a3b8] mb-1">{formatDate(note.creeLe)}</p>
                  <p className="text-[14px] text-[#0f172a] leading-relaxed whitespace-pre-wrap">{note.contenu}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-[#94a3b8]">Notes privées — non communiquées aux acquéreurs.</p>
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
            {dossier ? (
              visitesPasseesMock.length === 0 ? (
                <p className="text-[14px] text-[#94a3b8]">Aucune visite effectuée pour l'instant.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {visitesPasseesMock.map((v) => (
                    <div key={v.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                      <p className="text-[13px] font-medium text-[#64748b]">{formatDate(v.date)}</p>
                      <p className="text-[14px] font-medium text-[#0f172a] mt-0.5">{v.client}</p>
                      <p className="text-[13px] text-[#94a3b8] mt-1 leading-snug">{v.retour}</p>
                    </div>
                  ))}
                </div>
              )
            ) : comptesRendusTries.length === 0 ? (
              <p className="text-[14px] text-[#94a3b8]">Aucune visite effectuée enregistrée pour ce bien.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {comptesRendusTries.map((cr) => {
                  const acquereur = acquereursParId.get(cr.acquereurId);
                  return (
                    <div key={cr.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-[13px] font-medium text-[#64748b]">{formatDate(cr.dateVisite)}</p>
                        <span className="text-[11px] text-[#94a3b8]">·</span>
                        <span className="text-[11px] font-medium text-[#4338ca]">{LABEL_INTERET[cr.interet]}</span>
                      </div>
                      <p className="text-[14px] font-medium text-[#0f172a]">
                        {acquereur ? `${acquereur.prenom} ${acquereur.nom}` : "Acquéreur indisponible"}
                      </p>
                      <p className="text-[13px] text-[#94a3b8] mt-1 leading-snug whitespace-pre-wrap">{cr.retour}</p>
                      {cr.prochaineEtape && (
                        <p className="text-[13px] text-[#94a3b8] mt-2 border-t border-[#f1f5f9] pt-2">
                          Prochaine étape : {cr.prochaineEtape}
                        </p>
                      )}
                    </div>
                  );
                })}
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

      {active === "documents" && !dossier && (
        <div className="flex flex-col gap-4">
          {bien.archiveLe ? (
            <p className="text-[13px] text-[#94a3b8] bg-[#fafafa] rounded-lg border border-[#f1f5f9] p-3">
              Ce bien est archivé — impossible d'ajouter un nouveau document.
            </p>
          ) : (
            <form action={ajouterDocumentBienAction} className="flex flex-col gap-2">
              <input type="hidden" name="bienId" value={bien.id} />
              <input
                type="text"
                name="nom"
                required
                placeholder="Nom du document (ex. Diagnostics énergétiques)"
                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              />
              <select
                name="categorie"
                defaultValue="autre"
                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              >
                {CATEGORIES_DOCUMENT.map((categorie) => (
                  <option key={categorie} value={categorie}>
                    {LABEL_CATEGORIE_DOCUMENT[categorie]}
                  </option>
                ))}
              </select>
              <input
                type="file"
                name="fichier"
                required
                accept="application/pdf,image/jpeg,image/png"
                className="w-full text-[13px] text-[#64748b]"
              />
              <p className="text-[11px] text-[#94a3b8]">PDF, JPEG ou PNG — 10 Mo maximum.</p>
              <button
                type="submit"
                className="self-start text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
              >
                Ajouter le document
              </button>
            </form>
          )}

          {documents.length === 0 ? (
            <p className="text-[14px] text-[#94a3b8]">Aucun document pour l'instant.</p>
          ) : (
            <div className="flex flex-col divide-y divide-[#f1f5f9] bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-[#0f172a] truncate">{doc.nom}</p>
                    <p className="text-[11px] text-[#94a3b8]">
                      {LABEL_CATEGORIE_DOCUMENT[doc.categorie]} · {formatTaille(doc.tailleOctets)} ·{" "}
                      {formatDate(doc.creeLe)}
                    </p>
                  </div>
                  <a
                    href={`/api/documents/${doc.id}`}
                    className="text-[13px] text-[#4338ca] font-medium shrink-0"
                  >
                    Télécharger
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {active === "offres" && (
        <div className="flex flex-col gap-4">
          {bien.archiveLe ? (
            <p className="text-[13px] text-[#94a3b8] bg-[#fafafa] rounded-lg border border-[#f1f5f9] p-3">
              Ce bien est archivé — impossible d'ajouter une nouvelle offre.
            </p>
          ) : (
            <form action={ajouterOffreAction} className="flex flex-col gap-2">
              <input type="hidden" name="bienId" value={bien.id} />
              <select
                name="acquereurId"
                required
                defaultValue=""
                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              >
                <option value="" disabled>
                  Acquéreur
                </option>
                {acquereursActifs.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.prenom} {a.nom}
                  </option>
                ))}
              </select>
              <input
                type="number"
                name="montant"
                required
                min={1}
                placeholder="Montant de l'offre (€)"
                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              />
              <label className="text-[11px] text-[#94a3b8]">
                Date de l'offre
                <input
                  type="date"
                  name="dateOffre"
                  required
                  className="w-full mt-1 border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                />
              </label>
              <label className="text-[11px] text-[#94a3b8]">
                Date de validité (optionnelle)
                <input
                  type="date"
                  name="dateValidite"
                  className="w-full mt-1 border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                />
              </label>
              <button
                type="submit"
                className="self-start text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
              >
                Ajouter l'offre
              </button>
            </form>
          )}

          {offresTriees.length === 0 ? (
            <p className="text-[14px] text-[#94a3b8]">Aucune offre pour l'instant.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {offresTriees.map((offre) => {
                const acquereur = acquereursParId.get(offre.acquereurId);
                return (
                  <div key={offre.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-[13px] font-medium text-[#64748b]">{formatDate(offre.dateOffre)}</p>
                      <span className="text-[11px] text-[#94a3b8]">·</span>
                      <span className="text-[11px] font-medium text-[#4338ca]">{LABEL_STATUT_OFFRE[offre.statut]}</span>
                    </div>
                    <p className="text-[14px] font-medium text-[#0f172a]">
                      {formatPrix(offre.montant)} — {acquereur ? `${acquereur.prenom} ${acquereur.nom}` : "Acquéreur indisponible"}
                    </p>
                    {offre.dateValidite && (
                      <p className="text-[13px] text-[#94a3b8] mt-1">Valable jusqu'au {formatDate(offre.dateValidite)}</p>
                    )}
                    {offre.statut === "en_cours" && !bien.archiveLe && (
                      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-[#f1f5f9]">
                        {(["acceptee", "refusee", "retiree"] as const).map((statut) => (
                          <form key={statut} action={changerStatutOffreAction}>
                            <input type="hidden" name="offreId" value={offre.id} />
                            <input type="hidden" name="statut" value={statut} />
                            <button
                              type="submit"
                              className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
                            >
                              {statut === "acceptee" ? "Accepter" : statut === "refusee" ? "Refuser" : "Retirer"}
                            </button>
                          </form>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {active === "compromis" && (
        <div className="flex flex-col gap-4">
          {bien.archiveLe ? (
            <p className="text-[13px] text-[#94a3b8] bg-[#fafafa] rounded-lg border border-[#f1f5f9] p-3">
              Ce bien est archivé — impossible d'ajouter un nouveau compromis.
            </p>
          ) : compromisEnCours ? (
            <p className="text-[13px] text-[#94a3b8] bg-[#fafafa] rounded-lg border border-[#f1f5f9] p-3">
              Un compromis est déjà en cours pour ce bien — résolvez-le avant d'en ajouter un nouveau.
            </p>
          ) : (
            <form action={ajouterCompromisAction} className="flex flex-col gap-2">
              <input type="hidden" name="bienId" value={bien.id} />
              <select
                name="acquereurId"
                required
                defaultValue=""
                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              >
                <option value="" disabled>
                  Acquéreur
                </option>
                {acquereursActifs.map((a) => (
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
                {offresAccepteesDuBien.map((o) => {
                  const acq = acquereursParId.get(o.acquereurId);
                  return (
                    <option key={o.id} value={o.id}>
                      {formatPrix(o.montant)} — {acq ? `${acq.prenom} ${acq.nom}` : "Acquéreur indisponible"} —{" "}
                      {formatDate(o.dateOffre)}
                    </option>
                  );
                })}
              </select>
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
                Date d'acte prévue (optionnelle)
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
          )}

          {compromisTries.length === 0 ? (
            <p className="text-[14px] text-[#94a3b8]">Aucun compromis pour l'instant.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {compromisTries.map((c) => {
                const acquereur = acquereursParId.get(c.acquereurId);
                return (
                  <div key={c.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-[13px] font-medium text-[#64748b]">{formatDate(c.dateSignature)}</p>
                      <span className="text-[11px] text-[#94a3b8]">·</span>
                      <span className="text-[11px] font-medium text-[#4338ca]">{LABEL_STATUT_COMPROMIS[c.statut]}</span>
                    </div>
                    <p className="text-[14px] font-medium text-[#0f172a]">
                      {formatPrix(c.prixConvenu)} — {acquereur ? `${acquereur.prenom} ${acquereur.nom}` : "Acquéreur indisponible"}
                    </p>
                    {c.dateActe && (
                      <p className="text-[13px] text-[#94a3b8] mt-1">Acte prévu le {formatDate(c.dateActe)}</p>
                    )}
                    {c.statut === "en_cours" && !bien.archiveLe && (
                      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-[#f1f5f9]">
                        {(["realise", "annule"] as const).map((statut) => (
                          <form key={statut} action={changerStatutCompromisAction}>
                            <input type="hidden" name="compromisId" value={c.id} />
                            <input type="hidden" name="statut" value={statut} />
                            <button
                              type="submit"
                              className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
                            >
                              {statut === "realise" ? "Marquer réalisé" : "Annuler"}
                            </button>
                          </form>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
