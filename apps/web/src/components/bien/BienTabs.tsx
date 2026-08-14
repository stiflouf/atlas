"use client";

import { useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import type { Bien } from "@/types/bien";
import type { DossierBien } from "@/data/dossier";
import {
  LABEL_STATUT_COMPATIBILITE,
  LABEL_STATUT_CRITERE,
  type ResultatCompatibilite,
} from "@/lib/compatibilite/types";
import { LABEL_ECHEANCE_ABSENTE, deriverCibleTache, deriverStatutTache, type Tache } from "@/types/tache";
import type { NoteBien } from "@/types/noteBien";
import type { ProfilAcquereur } from "@/types/client";
import { LABEL_INTERET, type CompteRenduVisite } from "@/types/compteRenduVisite";
import {
  FAMILLE_PAR_TYPE_DOCUMENT,
  LABEL_CATEGORIE_DOCUMENT,
  LABEL_ETAT_VERIFICATION_DOCUMENT,
  LABEL_FAMILLE_DOCUMENT,
  LABEL_TYPE_DOCUMENT,
  TYPES_DOCUMENT,
  type CategorieDocument,
  type DocumentBien,
  type EtatVerificationDocument,
  type FamilleDocument,
  type TypeDocument,
} from "@/types/documentBien";
import { LABEL_STATUT_OFFRE, type Offre } from "@/types/offre";
import { LABEL_STATUT_COMPROMIS, type Compromis } from "@/types/compromis";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import { MOTIFS_PERTE, LABEL_MOTIF_PERTE } from "@/types/motifPerte";
import {
  LABEL_ETAT_REMUNERATION,
  deriverEtatRemuneration,
  formatMontantCentimes,
  type Remuneration,
} from "@/types/remuneration";
import { LABEL_ETAT_CONTROLE_EXIGENCE, type ChecklistDossier } from "@/lib/documents/checklistDossier";
import type { CodeRegleAutomatisation } from "@/types/automatisation";
import { rendezVousDuJour } from "@/data/agenda";
import { terminerTacheAction } from "@/actions/terminerTache";
import { annulerTacheAction } from "@/actions/annulerTache";
import { ajouterNoteBienAction } from "@/actions/ajouterNoteBien";
import { ajouterDocumentBienAction, corrigerClassementDocumentBienAction } from "@/actions/ajouterDocumentBien";
import { ajouterOffreAction, changerStatutOffreAction } from "@/actions/offre";
import { lierVisiteAOffreAction, delierVisiteAction } from "@/actions/offreVisite";
import { ajouterCompromisAction, changerStatutCompromisAction } from "@/actions/compromis";
import {
  ajouterRemunerationAction,
  marquerRemunerationEncaisseeAction,
  modifierRemunerationAction,
} from "@/actions/remuneration";
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

const FAMILLES_DOCUMENT: FamilleDocument[] = [
  "parties",
  "bien",
  "diagnostics",
  "copropriete",
  "transaction",
  "financement",
  "notaire",
  "autre",
];

const ETATS_VERIFICATION_DOCUMENT: EtatVerificationDocument[] = ["non_verifie", "confirme", "a_verifier", "rejete"];

const COULEUR_ETAT_CONTROLE: Record<string, string> = {
  present: "text-[#16a34a]",
  manquant: "text-[#dc2626]",
  a_verifier: "text-[#d97706]",
  perime: "text-[#dc2626]",
  incoherent: "text-[#dc2626]",
  non_applicable: "text-[#94a3b8]",
};

function formatTaille(octets: number): string {
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatPrix(montant: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    montant
  );
}

type Tab =
  | "contexte"
  | "historique"
  | "notes"
  | "visites"
  | "documents"
  | "offres"
  | "compromis"
  | "taches"
  | "compatibilite";

const VARIANT_PAR_STATUT_COMPATIBILITE = {
  compatible: "success",
  incompatible: "danger",
  a_verifier: "default",
} as const;

const VARIANT_PAR_STATUT_CRITERE = {
  compatible: "success",
  incompatible: "danger",
  a_verifier: "default",
  non_concerne: "muted",
} as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function BienTabs({
  bien,
  dossier,
  taches,
  notes,
  comptesRendus,
  documents,
  offres,
  compromis,
  remunerations = [],
  liens = [],
  acquereursActifs = [],
  acquereursParId = new Map(),
  compromisActuel,
  prospectVendeurOrigine,
  checklist,
  labelRegleAutomatisation,
  compatibilites = [],
}: {
  bien: Bien;
  dossier?: DossierBien;
  taches: Tache[];
  notes: NoteBien[];
  comptesRendus: CompteRenduVisite[];
  documents: DocumentBien[];
  offres: Offre[];
  compromis: Compromis[];
  remunerations?: Remuneration[];
  liens?: { lienId: string; offreId: string; visite: CompteRenduVisite }[];
  acquereursActifs?: ProfilAcquereur[];
  acquereursParId?: Map<string, ProfilAcquereur | undefined>;
  compromisActuel?: Compromis;
  prospectVendeurOrigine?: ProspectVendeur;
  checklist?: ChecklistDossier;
  labelRegleAutomatisation: Record<CodeRegleAutomatisation, string>;
  // ADR-034 : résultats déjà calculés côté serveur (evaluerCompatibiliteBien) — BienTabs ne fait
  // jamais lui-même appel au moteur, il affiche uniquement.
  compatibilites?: ResultatCompatibilite[];
}) {
  const [active, setActive] = useState<Tab>("contexte");
  const [acquereurOffreSelectionne, setAcquereurOffreSelectionne] = useState("");

  const liensParOffre = new Map<string, { lienId: string; visite: CompteRenduVisite }[]>();
  for (const lien of liens) {
    const liste = liensParOffre.get(lien.offreId) ?? [];
    liste.push({ lienId: lien.lienId, visite: lien.visite });
    liensParOffre.set(lien.offreId, liste);
  }

  const remunerationParCompromis = new Map<string, Remuneration>();
  for (const r of remunerations) {
    remunerationParCompromis.set(r.compromisId, r);
  }

  // Même population que celle sur laquelle evaluerCompatibiliteBien() a itéré côté serveur
  // (listerClients()) — reconstruit ici uniquement pour résoudre le nom affiché, jamais pour
  // recalculer la compatibilité elle-même.
  const acquereursCompatibiliteParId = new Map(acquereursActifs.map((a) => [a.id, a]));
  // Compatible en premier (candidats les plus actionnables), incompatible en dernier — jamais un
  // score, uniquement un ordre d'affichage sur le statut discret.
  const ORDRE_STATUT_COMPATIBILITE = { compatible: 0, a_verifier: 1, incompatible: 2 } as const;
  const compatibilitesTriees = [...compatibilites].sort(
    (a, b) => ORDRE_STATUT_COMPATIBILITE[a.statutGlobal] - ORDRE_STATUT_COMPATIBILITE[b.statutGlobal]
  );

  // Contexte, Tâches, Notes, Visites et Documents reposent tous sur des données réelles (bien,
  // tacheRepository, noteBienRepository, compteRenduVisiteRepository, documentBienRepository),
  // toujours disponibles — Notes, Visites et Documents restent affichés même vides, c'est
  // justement là que le conseiller ajoute sa première entrée. Historique, lui, est dérivé de
  // faits réels (bien.creeLe, tache.creeLe/termineeLe, comptes rendus de visite) quand aucun
  // dossier mock n'existe.
  const evenementsHistorique: EvenementHistorique[] = dossier
    ? dossier.historique
    : deriverHistoriqueBien(bien, taches, comptesRendus, offres, compromis, remunerations);

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
    { id: "taches", label: "Tâches" },
    { id: "compatibilite", label: "Acquéreurs compatibles" },
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
          {checklist && (
            <div className="bg-[#fafafa] rounded-lg border border-[#f1f5f9] p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                  Dossier documentaire
                </p>
                {!checklist.honorairesRenseignes && (
                  <span className="text-[11px] font-medium text-[#dc2626]">
                    Charge des honoraires non renseignée
                  </span>
                )}
              </div>
              {FAMILLES_DOCUMENT.map((famille) => {
                const exigencesFamille = checklist.exigences.filter(
                  (e) => e.famille === famille && e.etat !== "non_applicable"
                );
                if (exigencesFamille.length === 0) return null;
                return (
                  <div key={famille}>
                    <p className="text-[12px] font-medium text-[#64748b] mb-1">{LABEL_FAMILLE_DOCUMENT[famille]}</p>
                    <div className="flex flex-col gap-0.5">
                      {exigencesFamille.map((e) => (
                        <div key={e.code} className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="text-[#0f172a]">{e.label}</span>
                          <span className="flex items-center gap-2 shrink-0">
                            {(e.etat === "manquant" || e.etat === "a_verifier" || e.etat === "perime") && (
                              <Link
                                href={`/communications/nouveau?bienId=${bien.id}&exigenceCode=${e.code}`}
                                className="text-[11px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
                              >
                                Préparer un email
                              </Link>
                            )}
                            <span className={`font-medium ${COULEUR_ETAT_CONTROLE[e.etat]}`}>
                              {LABEL_ETAT_CONTROLE_EXIGENCE[e.etat]}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-[13px] pt-2 border-t border-[#e2e8f0]">
                <span className="text-[#0f172a]">PV d&apos;assemblée générale</span>
                <span className="text-[#64748b]">
                  {checklist.pvAg.presents.length} / {checklist.pvAg.attendus} derniers
                </span>
              </div>
              <Link
                href={`/biens/${bien.id}/pack-notaire`}
                className="self-start text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
              >
                Préparer le pack notaire →
              </Link>
            </div>
          )}

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
              <div className="grid grid-cols-2 gap-2">
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
                <select
                  name="typeDocument"
                  defaultValue=""
                  className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                >
                  <option value="">Type — non classé</option>
                  {FAMILLES_DOCUMENT.map((famille) => (
                    <optgroup key={famille} label={LABEL_FAMILLE_DOCUMENT[famille]}>
                      {TYPES_DOCUMENT.filter((t) => FAMILLE_PAR_TYPE_DOCUMENT[t] === famille).map((type) => (
                        <option key={type} value={type}>
                          {LABEL_TYPE_DOCUMENT[type]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <input
                type="text"
                name="typeDocumentDetail"
                placeholder="Précision si type « Autre » (optionnel)"
                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-[#94a3b8]">
                  Date du document
                  <input
                    type="date"
                    name="dateDocument"
                    className="w-full mt-1 border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                  />
                </label>
                <label className="text-[11px] text-[#94a3b8]">
                  Fin de validité (diagnostics)
                  <input
                    type="date"
                    name="dateFinValidite"
                    className="w-full mt-1 border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                  />
                </label>
              </div>
              {(compromisActuel || acquereursActifs.length > 0 || prospectVendeurOrigine) && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <p className="text-[11px] font-medium text-[#64748b]">Rattachement (optionnel)</p>
                  {compromisActuel && (
                    <label className="inline-flex items-center gap-2 text-[13px] text-[#0f172a]">
                      <input type="checkbox" name="compromisId" value={compromisActuel.id} />
                      Rattacher au compromis en cours
                    </label>
                  )}
                  {acquereursActifs.length > 0 && (
                    <select
                      name="acquereurId"
                      defaultValue=""
                      className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                    >
                      <option value="">Acquéreur — aucun</option>
                      {acquereursActifs.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.prenom} {a.nom}
                        </option>
                      ))}
                    </select>
                  )}
                  {prospectVendeurOrigine && (
                    <label className="inline-flex items-center gap-2 text-[13px] text-[#0f172a]">
                      <input type="checkbox" name="prospectVendeurId" value={prospectVendeurOrigine.id} />
                      Rattacher au vendeur d&apos;origine ({prospectVendeurOrigine.nom})
                    </label>
                  )}
                </div>
              )}
              <input
                type="text"
                name="coproprieteDeclaree"
                placeholder="Copropriété déclarée par le document (optionnel)"
                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              />
              <input
                type="text"
                name="adresseDeclaree"
                placeholder="Adresse déclarée par le document (optionnel)"
                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              />
              <input
                type="text"
                name="provenance"
                placeholder="Provenance (optionnel — agent, vendeur, notaire...)"
                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              />
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
                <div key={doc.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-[#0f172a] truncate">{doc.nom}</p>
                      <p className="text-[11px] text-[#94a3b8]">
                        {doc.typeDocument ? LABEL_TYPE_DOCUMENT[doc.typeDocument] : LABEL_CATEGORIE_DOCUMENT[doc.categorie]}
                        {" · "}
                        {formatTaille(doc.tailleOctets)} · {formatDate(doc.creeLe)}
                        {doc.etatVerification !== "non_verifie" &&
                          ` · ${LABEL_ETAT_VERIFICATION_DOCUMENT[doc.etatVerification]}`}
                      </p>
                    </div>
                    <a href={`/api/documents/${doc.id}`} className="text-[13px] text-[#4338ca] font-medium shrink-0">
                      Télécharger
                    </a>
                  </div>

                  <details className="text-[12px]">
                    <summary className="text-[#94a3b8] cursor-pointer select-none">Corriger le classement</summary>
                    <form
                      action={corrigerClassementDocumentBienAction}
                      className="flex flex-col gap-2 mt-2 pt-2 border-t border-[#f1f5f9]"
                    >
                      <input type="hidden" name="id" value={doc.id} />
                      <input
                        type="text"
                        name="bienId"
                        required
                        defaultValue={doc.bienId}
                        placeholder="Identifiant du bien"
                        className="w-full border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                      />
                      <input
                        type="text"
                        name="nom"
                        required
                        defaultValue={doc.nom}
                        className="w-full border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          name="categorie"
                          defaultValue={doc.categorie}
                          className="w-full border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                        >
                          {CATEGORIES_DOCUMENT.map((categorie) => (
                            <option key={categorie} value={categorie}>
                              {LABEL_CATEGORIE_DOCUMENT[categorie]}
                            </option>
                          ))}
                        </select>
                        <select
                          name="typeDocument"
                          defaultValue={doc.typeDocument ?? ""}
                          className="w-full border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                        >
                          <option value="">Type — non classé</option>
                          {FAMILLES_DOCUMENT.map((famille) => (
                            <optgroup key={famille} label={LABEL_FAMILLE_DOCUMENT[famille]}>
                              {TYPES_DOCUMENT.filter((t) => FAMILLE_PAR_TYPE_DOCUMENT[t] === famille).map((type) => (
                                <option key={type} value={type}>
                                  {LABEL_TYPE_DOCUMENT[type]}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          name="dateDocument"
                          defaultValue={doc.dateDocument ?? ""}
                          className="w-full border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                        />
                        <input
                          type="date"
                          name="dateFinValidite"
                          defaultValue={doc.dateFinValidite ?? ""}
                          className="w-full border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                        />
                      </div>
                      {compromisActuel && (
                        <label className="inline-flex items-center gap-2 text-[13px] text-[#0f172a]">
                          <input
                            type="checkbox"
                            name="compromisId"
                            value={compromisActuel.id}
                            defaultChecked={doc.compromisId === compromisActuel.id}
                          />
                          Rattacher au compromis en cours
                        </label>
                      )}
                      {acquereursActifs.length > 0 && (
                        <select
                          name="acquereurId"
                          defaultValue={doc.acquereurId ?? ""}
                          className="w-full border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                        >
                          <option value="">Acquéreur — aucun</option>
                          {acquereursActifs.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.prenom} {a.nom}
                            </option>
                          ))}
                        </select>
                      )}
                      {prospectVendeurOrigine && (
                        <label className="inline-flex items-center gap-2 text-[13px] text-[#0f172a]">
                          <input
                            type="checkbox"
                            name="prospectVendeurId"
                            value={prospectVendeurOrigine.id}
                            defaultChecked={doc.prospectVendeurId === prospectVendeurOrigine.id}
                          />
                          Rattacher au vendeur d&apos;origine ({prospectVendeurOrigine.nom})
                        </label>
                      )}
                      <input
                        type="text"
                        name="coproprieteDeclaree"
                        defaultValue={doc.coproprieteDeclaree ?? ""}
                        placeholder="Copropriété déclarée par le document"
                        className="w-full border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                      />
                      <input
                        type="text"
                        name="adresseDeclaree"
                        defaultValue={doc.adresseDeclaree ?? ""}
                        placeholder="Adresse déclarée par le document"
                        className="w-full border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                      />
                      <select
                        name="etatVerification"
                        defaultValue={doc.etatVerification}
                        className="w-full border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                      >
                        {ETATS_VERIFICATION_DOCUMENT.map((etat) => (
                          <option key={etat} value={etat}>
                            {LABEL_ETAT_VERIFICATION_DOCUMENT[etat]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="self-start text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
                      >
                        Enregistrer la correction
                      </button>
                    </form>
                  </details>
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
                onChange={(e) => setAcquereurOffreSelectionne(e.target.value)}
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
              {acquereurOffreSelectionne && (
                <div>
                  <p className="text-[11px] font-medium text-[#64748b] mb-1">
                    Visites à lier à cette offre (optionnel)
                  </p>
                  {/* Filtrage indicatif côté client (acquéreur sélectionné) — ne remplace jamais
                      la validation serveur (bien/acquéreur/date), qui revérifie tout (ADR-019). */}
                  {comptesRendus.filter((cr) => cr.acquereurId === acquereurOffreSelectionne).length === 0 ? (
                    <p className="text-[12px] text-[#94a3b8]">Aucune visite enregistrée avec cet acquéreur.</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {comptesRendus
                        .filter((cr) => cr.acquereurId === acquereurOffreSelectionne)
                        .map((cr) => (
                          <label key={cr.id} className="inline-flex items-center gap-2 text-[13px] text-[#0f172a]">
                            <input type="checkbox" name="compteRenduVisiteIds" value={cr.id} />
                            {formatDate(cr.dateVisite)} — {LABEL_INTERET[cr.interet]}
                          </label>
                        ))}
                    </div>
                  )}
                </div>
              )}
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
                    {offre.dateDecision && (
                      <p className="text-[13px] text-[#94a3b8] mt-1">
                        Décidée le {formatDate(offre.dateDecision)}
                        {offre.motifPerte && ` — ${LABEL_MOTIF_PERTE[offre.motifPerte]}`}
                      </p>
                    )}
                    {offre.statut === "en_cours" && !bien.archiveLe && (
                      <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-[#f1f5f9]">
                        {(["acceptee", "refusee", "retiree"] as const).map((statut) => (
                          <form
                            key={statut}
                            action={changerStatutOffreAction}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <input type="hidden" name="offreId" value={offre.id} />
                            <input type="hidden" name="statut" value={statut} />
                            <input
                              type="date"
                              name="dateDecision"
                              required
                              defaultValue={new Date().toISOString().slice(0, 10)}
                              className="border border-[#e2e8f0] rounded-lg px-2 py-1 text-[12px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                            />
                            {statut !== "acceptee" && (
                              <select
                                name="motifPerte"
                                required
                                defaultValue=""
                                className="border border-[#e2e8f0] rounded-lg px-2 py-1 text-[12px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                              >
                                <option value="" disabled>
                                  Motif
                                </option>
                                {MOTIFS_PERTE.map((motif) => (
                                  <option key={motif} value={motif}>
                                    {LABEL_MOTIF_PERTE[motif]}
                                  </option>
                                ))}
                              </select>
                            )}
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

                    {/* Rattachement rétroactif de visites (ADR-019) — pas seulement à la création
                        de l'offre : correspondance bien/acquéreur/date toujours revalidée côté
                        serveur, jamais d'inférence, aucune garde d'archivage (documentation d'un
                        rapprochement entre faits existants, pas un nouveau fait commercial). */}
                    {(() => {
                      const liensDeLOffre = liensParOffre.get(offre.id) ?? [];
                      const idsDejaLies = new Set(liensDeLOffre.map(({ visite }) => visite.id));
                      const visitesDisponibles = comptesRendus.filter(
                        (cr) =>
                          cr.acquereurId === offre.acquereurId &&
                          cr.dateVisite <= offre.dateOffre &&
                          !idsDejaLies.has(cr.id)
                      );
                      return (
                        <div className="mt-3 pt-3 border-t border-[#f1f5f9]">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-1.5">
                            Visites liées
                          </p>
                          {liensDeLOffre.length === 0 ? (
                            <p className="text-[12px] text-[#94a3b8] mb-2">Aucune visite liée pour l'instant.</p>
                          ) : (
                            <div className="flex flex-col gap-1 mb-2">
                              {liensDeLOffre.map(({ lienId, visite }) => (
                                <div key={lienId} className="flex items-center justify-between gap-2 text-[13px]">
                                  <span className="text-[#64748b]">
                                    {formatDate(visite.dateVisite)} — {LABEL_INTERET[visite.interet]}
                                  </span>
                                  <form action={delierVisiteAction}>
                                    <input type="hidden" name="lienId" value={lienId} />
                                    <button
                                      type="submit"
                                      className="text-[11px] font-medium text-[#64748b] hover:text-[#dc2626] transition-colors"
                                    >
                                      Retirer le lien
                                    </button>
                                  </form>
                                </div>
                              ))}
                            </div>
                          )}
                          {visitesDisponibles.length > 0 && (
                            <form action={lierVisiteAOffreAction} className="flex items-center gap-2">
                              <input type="hidden" name="offreId" value={offre.id} />
                              <select
                                name="compteRenduVisiteId"
                                required
                                defaultValue=""
                                className="flex-1 border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[12px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                              >
                                <option value="" disabled>
                                  Lier une visite existante
                                </option>
                                {visitesDisponibles.map((cr) => (
                                  <option key={cr.id} value={cr.id}>
                                    {formatDate(cr.dateVisite)} — {LABEL_INTERET[cr.interet]}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors shrink-0"
                              >
                                Lier
                              </button>
                            </form>
                          )}
                        </div>
                      );
                    })()}
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
                    {c.dateActeReelle && (
                      <p className="text-[13px] text-[#16a34a] mt-1">Acte signé le {formatDate(c.dateActeReelle)}</p>
                    )}
                    {c.dateAnnulation && (
                      <p className="text-[13px] text-[#94a3b8] mt-1">
                        Annulé le {formatDate(c.dateAnnulation)}
                        {c.motifAnnulation && ` — ${LABEL_MOTIF_PERTE[c.motifAnnulation]}`}
                      </p>
                    )}
                    {c.statut === "en_cours" && !bien.archiveLe && (
                      <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t border-[#f1f5f9]">
                        <form action={changerStatutCompromisAction} className="flex items-end gap-2">
                          <input type="hidden" name="compromisId" value={c.id} />
                          <input type="hidden" name="statut" value="realise" />
                          <label className="text-[11px] text-[#94a3b8]">
                            Date réelle de l'acte
                            <input
                              type="date"
                              name="dateActeReelle"
                              required
                              defaultValue={c.dateActe ?? ""}
                              className="block mt-1 border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                            />
                          </label>
                          <button
                            type="submit"
                            className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors pb-1.5"
                          >
                            Marquer réalisé
                          </button>
                        </form>
                        <form action={changerStatutCompromisAction} className="flex items-end gap-2">
                          <input type="hidden" name="compromisId" value={c.id} />
                          <input type="hidden" name="statut" value="annule" />
                          <label className="text-[11px] text-[#94a3b8]">
                            Date d'annulation
                            <input
                              type="date"
                              name="dateAnnulation"
                              required
                              defaultValue={new Date().toISOString().slice(0, 10)}
                              className="block mt-1 border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                            />
                          </label>
                          <select
                            name="motifAnnulation"
                            required
                            defaultValue=""
                            className="border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                          >
                            <option value="" disabled>
                              Motif
                            </option>
                            {MOTIFS_PERTE.map((motif) => (
                              <option key={motif} value={motif}>
                                {LABEL_MOTIF_PERTE[motif]}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors pb-1.5"
                          >
                            Annuler
                          </button>
                        </form>
                      </div>
                    )}
                    {(() => {
                      if (c.statut === "annule") return null;
                      const remuneration = remunerationParCompromis.get(c.id);
                      const acquereurCompromis = acquereursParId.get(c.acquereurId);
                      // Archivage commercial ≠ clôture du suivi financier historique (ADR-021) :
                      // seul un compromis en_cours est bloqué par l'archivage du bien/acquéreur ;
                      // un compromis realise reste corrigible/encaissable après archivage.
                      const eligibleMalgreArchivage =
                        c.statut === "realise" || (!bien.archiveLe && !acquereurCompromis?.archiveLe);
                      const etatRemuneration = remuneration
                        ? deriverEtatRemuneration(remuneration, c.statut)
                        : undefined;
                      const encaissementDisponible = c.statut === "realise" && !!c.dateActeReelle;

                      if (!remuneration) {
                        return eligibleMalgreArchivage ? (
                          <form
                            action={ajouterRemunerationAction}
                            className="flex flex-col gap-2 mt-3 pt-3 border-t border-[#f1f5f9]"
                          >
                            <input type="hidden" name="compromisId" value={c.id} />
                            <p className="text-[12px] font-medium text-[#64748b]">Rémunération</p>
                            <input
                              type="text"
                              inputMode="decimal"
                              name="montantRemunerationConseiller"
                              required
                              placeholder="Rémunération conseiller (€)"
                              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                            />
                            <input
                              type="text"
                              inputMode="decimal"
                              name="montantHonorairesTotal"
                              placeholder="Honoraires totaux (€, optionnel)"
                              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                            />
                            <label className="text-[11px] text-[#94a3b8]">
                              Date d'encaissement prévue (optionnelle)
                              <input
                                type="date"
                                name="dateEncaissementPrevue"
                                className="w-full mt-1 border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                              />
                            </label>
                            <button
                              type="submit"
                              className="self-start text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
                            >
                              Ajouter la rémunération
                            </button>
                          </form>
                        ) : null;
                      }

                      return (
                        <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-[#f1f5f9]">
                          <div className="flex items-center gap-2">
                            <p className="text-[12px] font-medium text-[#64748b]">Rémunération</p>
                            <span className="text-[11px] font-medium text-[#4338ca]">
                              {etatRemuneration ? LABEL_ETAT_REMUNERATION[etatRemuneration] : "Liée à un compromis annulé"}
                            </span>
                          </div>
                          <p className="text-[14px] font-medium text-[#0f172a]">
                            {formatMontantCentimes(remuneration.montantRemunerationConseillerCentimes)}
                            {remuneration.montantHonorairesTotalCentimes != null &&
                              ` (honoraires totaux ${formatMontantCentimes(remuneration.montantHonorairesTotalCentimes)})`}
                          </p>
                          {remuneration.dateEncaissementPrevue && !remuneration.dateEncaissementReelle && (
                            <p className="text-[13px] text-[#94a3b8]">
                              Encaissement prévu le {formatDate(remuneration.dateEncaissementPrevue)}
                            </p>
                          )}
                          {remuneration.dateEncaissementReelle && (
                            <p className="text-[13px] text-[#16a34a]">
                              Encaissée le {formatDate(remuneration.dateEncaissementReelle)}
                            </p>
                          )}
                          {!remuneration.dateEncaissementReelle && eligibleMalgreArchivage && (
                            <form action={modifierRemunerationAction} className="flex flex-col gap-2">
                              <input type="hidden" name="compromisId" value={c.id} />
                              <input
                                type="text"
                                inputMode="decimal"
                                name="montantRemunerationConseiller"
                                required
                                defaultValue={(remuneration.montantRemunerationConseillerCentimes / 100).toFixed(2)}
                                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                              />
                              <input
                                type="text"
                                inputMode="decimal"
                                name="montantHonorairesTotal"
                                defaultValue={
                                  remuneration.montantHonorairesTotalCentimes != null
                                    ? (remuneration.montantHonorairesTotalCentimes / 100).toFixed(2)
                                    : ""
                                }
                                placeholder="Honoraires totaux (€, optionnel)"
                                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                              />
                              <input
                                type="date"
                                name="dateEncaissementPrevue"
                                defaultValue={remuneration.dateEncaissementPrevue ?? ""}
                                className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                              />
                              <button
                                type="submit"
                                className="self-start text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
                              >
                                Corriger la rémunération
                              </button>
                            </form>
                          )}
                          {!remuneration.dateEncaissementReelle && encaissementDisponible && (
                            <form action={marquerRemunerationEncaisseeAction} className="flex items-end gap-2">
                              <input type="hidden" name="compromisId" value={c.id} />
                              <label className="text-[11px] text-[#94a3b8]">
                                Date d'encaissement réelle
                                <input
                                  type="date"
                                  name="dateEncaissementReelle"
                                  required
                                  className="block mt-1 border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
                                />
                              </label>
                              <button
                                type="submit"
                                className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors pb-1.5"
                              >
                                Marquer encaissée
                              </button>
                            </form>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {active === "taches" && (
        <div className="flex flex-col divide-y divide-[#f1f5f9] bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4">
          {taches.length === 0 ? (
            <p className="text-[14px] text-[#94a3b8] py-3">Aucune tâche en cours sur ce dossier.</p>
          ) : (
            taches.map((tache) => {
              const statut = deriverStatutTache(tache);
              return (
                <div key={tache.id} className="flex items-start gap-3 py-3">
                  {statut !== "a_faire" ? (
                    <div className="w-4 h-4 mt-0.5 rounded border shrink-0 bg-[#f1f5f9] border-[#e2e8f0]" />
                  ) : (
                    <form action={terminerTacheAction} className="mt-0.5 shrink-0">
                      <input type="hidden" name="id" value={tache.id} />
                      <input type="hidden" name="redirectTo" value={`/biens/${bien.id}`} />
                      <button
                        type="submit"
                        aria-label="Marquer comme terminée"
                        className="w-4 h-4 rounded border border-[#e2e8f0] hover:border-[#4338ca] hover:bg-[#eef2ff] transition-colors"
                      />
                    </form>
                  )}
                  <div className="flex-1">
                    <p className="text-[14px] text-[#0f172a]">{tache.titre}</p>
                    {tache.contexte && <p className="text-[13px] text-[#94a3b8] mt-0.5">{tache.contexte}</p>}
                    <p className="text-[11px] text-[#94a3b8] mt-0.5">
                      {statut === "annulee"
                        ? "Annulée"
                        : tache.echeance
                          ? `Échéance : ${formatDate(tache.echeance)}`
                          : LABEL_ECHEANCE_ABSENTE}
                    </p>
                    {tache.origine === "automatique" && (
                      <p className="text-[11px] text-[#94a3b8] mt-0.5">
                        Créée automatiquement — Règle :{" "}
                        {tache.origineCode && labelRegleAutomatisation[tache.origineCode as CodeRegleAutomatisation]
                          ? labelRegleAutomatisation[tache.origineCode as CodeRegleAutomatisation]
                          : "inconnue"}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      {deriverCibleTache(tache) && (
                        <Link
                          href={`/communications/nouveau?tacheId=${tache.id}`}
                          className="text-[11px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
                        >
                          Préparer un email
                        </Link>
                      )}
                      {statut === "a_faire" && (
                        <form action={annulerTacheAction}>
                          <input type="hidden" name="id" value={tache.id} />
                          <input type="hidden" name="redirectTo" value={`/biens/${bien.id}`} />
                          <button type="submit" className="text-[11px] text-[#94a3b8] hover:text-[#dc2626] transition-colors">
                            Annuler
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ADR-034 — moteur canonique et déterministe, déjà calculé côté serveur. Jamais de score,
          jamais "a_verifier" présenté comme une incompatibilité : chaque critère non_concerne est
          simplement absent du détail plutôt que listé comme neutre. */}
      {active === "compatibilite" && (
        <div className="flex flex-col gap-2">
          {compatibilitesTriees.length === 0 ? (
            <p className="text-[14px] text-[#94a3b8]">Aucun acquéreur à comparer pour l'instant.</p>
          ) : (
            compatibilitesTriees.map((resultat) => {
              const acquereur = acquereursCompatibiliteParId.get(resultat.acquereurId);
              const criteresPertinents = resultat.criteres.filter((c) => c.statut !== "non_concerne");
              return (
                <details key={resultat.acquereurId} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                  <summary className="cursor-pointer flex items-center justify-between gap-3 list-none">
                    <span className="text-[14px] font-medium text-[#0f172a]">
                      {acquereur ? `${acquereur.prenom} ${acquereur.nom}` : "Acquéreur indisponible"}
                    </span>
                    <Badge variant={VARIANT_PAR_STATUT_COMPATIBILITE[resultat.statutGlobal]}>
                      {LABEL_STATUT_COMPATIBILITE[resultat.statutGlobal]}
                    </Badge>
                  </summary>
                  <div className="mt-3 pt-3 border-t border-[#f1f5f9] flex flex-col gap-2">
                    {criteresPertinents.length === 0 ? (
                      <p className="text-[13px] text-[#94a3b8]">
                        Aucune exigence structurée déclarée par cet acquéreur pour ce bien.
                      </p>
                    ) : (
                      criteresPertinents.map((critere) => (
                        <div key={critere.critere} className="flex items-start gap-2">
                          <Badge variant={VARIANT_PAR_STATUT_CRITERE[critere.statut]}>
                            {LABEL_STATUT_CRITERE[critere.statut]}
                          </Badge>
                          <p className="text-[13px] text-[#64748b] leading-snug">{critere.explication}</p>
                        </div>
                      ))
                    )}
                  </div>
                </details>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
