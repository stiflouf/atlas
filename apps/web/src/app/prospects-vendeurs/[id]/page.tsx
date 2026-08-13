import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, User } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { getProspectVendeurById } from "@/lib/prospectVendeurRepository";
import { listerNotesProspectVendeur } from "@/lib/noteProspectVendeurRepository";
import { deriverStatutProspectVendeur, LABEL_STATUT_PROSPECT_VENDEUR } from "@/types/prospectVendeur";
import { LABEL_ORIGINE_LEAD } from "@/types/origineLead";
import { MOTIFS_PERTE_PROSPECT_VENDEUR, LABEL_MOTIF_PERTE_PROSPECT_VENDEUR } from "@/types/motifPerteProspectVendeur";
import { TYPES_NOTE_PROSPECT_VENDEUR, LABEL_TYPE_NOTE_PROSPECT_VENDEUR } from "@/types/noteProspectVendeur";
import { formatMontantCentimes } from "@/types/remuneration";
import {
  archiverProspectVendeurAction,
  desarchiverProspectVendeurAction,
  qualifierProspectVendeurAction,
  enregistrerEstimationProspectVendeurAction,
  planifierRdvEstimationProspectVendeurAction,
  marquerRdvEstimationRealiseProspectVendeurAction,
  proposerMandatProspectVendeurAction,
  marquerProspectVendeurPerduAction,
  ajouterNoteProspectVendeurAction,
  mettreAJourProchaineActionAction,
} from "@/actions/prospectVendeur";

const inputCls =
  "w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]";
const boutonCls =
  "text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg";
const boutonSecondaireCls =
  "text-[13px] font-medium text-[#4338ca] bg-white border border-[#e2e8f0] hover:border-[#4338ca] transition-colors px-3.5 py-2 rounded-lg";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatDateHeure(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type PageProps = { params: Promise<{ id: string }> };

// Fiche prospect vendeur (ADR-027) : identité, bien potentiel, jalons de pipeline (chacun sa
// propre Server Action, aucune séquence stricte imposée), issue commerciale, prochaine action,
// notes append-only. La conversion en bien vit sur une page dédiée (/signer-mandat) — formulaire
// trop long pour tenir ici sans nuire à la lisibilité du reste de la fiche.
export default async function FicheProspectVendeur({ params }: PageProps) {
  const { id } = await params;
  const prospect = await getProspectVendeurById(id);
  if (!prospect) notFound();

  const notes = await listerNotesProspectVendeur(prospect.id);
  const statut = deriverStatutProspectVendeur(prospect);
  const enCours = statut !== "perdu" && statut !== "mandat_signe";
  const localisation = [prospect.adresseBienPotentiel ?? prospect.secteurBienPotentiel, prospect.ville, prospect.codePostal]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href="/prospects-vendeurs"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Prospects vendeurs
      </Link>

      <div className="mb-8">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-[#eef2ff] flex items-center justify-center shrink-0 mt-0.5">
            <User size={18} className="text-[#4338ca]" strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight">
              {prospect.prenom ? `${prospect.prenom} ` : ""}
              {prospect.nom}
            </h1>
            <p className="text-[14px] text-[#64748b] mt-0.5">
              {[prospect.email, prospect.telephone].filter(Boolean).join(" · ") || "Aucune coordonnée renseignée"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Badge variant="default">{LABEL_STATUT_PROSPECT_VENDEUR[statut]}</Badge>
          {prospect.origineLead && (
            <Badge variant="muted">
              {LABEL_ORIGINE_LEAD[prospect.origineLead]}
              {prospect.origineLeadDetail ? ` — ${prospect.origineLeadDetail}` : ""}
            </Badge>
          )}
          {prospect.archiveLe && <Badge variant="muted">Archivé le {formatDate(prospect.archiveLe)}</Badge>}
        </div>

        <div className="flex flex-wrap gap-3 mt-4">
          <Link href={`/prospects-vendeurs/${prospect.id}/modifier`} className={boutonSecondaireCls}>
            Modifier
          </Link>
          <form action={prospect.archiveLe ? desarchiverProspectVendeurAction : archiverProspectVendeurAction}>
            <input type="hidden" name="id" value={prospect.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#64748b] bg-white border border-[#e2e8f0] hover:border-[#dc2626] hover:text-[#dc2626] transition-colors px-3.5 py-2 rounded-lg"
            >
              {prospect.archiveLe ? "Désarchiver" : "Archiver"}
            </button>
          </form>
        </div>
      </div>

      {/* Bien potentiel */}
      <section className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Bien potentiel</p>
        <div className="bg-white rounded-lg border border-[#f1f5f9] p-4 text-[14px] text-[#0f172a] flex flex-col gap-1">
          <p>{localisation || "Aucune localisation renseignée"}</p>
          {prospect.typeBien && <p className="text-[#64748b]">{prospect.typeBien}</p>}
          {prospect.estimationProposeeCentimes !== undefined && (
            <p className="font-medium">
              Estimation proposée : {formatMontantCentimes(prospect.estimationProposeeCentimes)}
              {prospect.estimationProposeeLe && ` (${formatDate(prospect.estimationProposeeLe)})`}
            </p>
          )}
        </div>
      </section>

      {/* Conversion */}
      {statut === "mandat_signe" && prospect.bienId && (
        <section className="mb-8">
          <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg p-4">
            <p className="text-[14px] text-[#16a34a] font-medium">Mandat signé — bien créé</p>
            <Link href={`/biens/${prospect.bienId}`} className="text-[13px] text-[#4338ca] font-medium hover:text-[#3730a3]">
              Voir la fiche du bien →
            </Link>
          </div>
        </section>
      )}

      {/* Pipeline */}
      {enCours && (
        <section className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Pipeline</p>
          <div className="flex flex-col gap-2">
            {!prospect.qualifieLe && (
              <form action={qualifierProspectVendeurAction}>
                <input type="hidden" name="id" value={prospect.id} />
                <button type="submit" className={boutonSecondaireCls}>
                  Marquer comme qualifié
                </button>
              </form>
            )}
            {prospect.qualifieLe && <p className="text-[13px] text-[#94a3b8]">Qualifié le {formatDate(prospect.qualifieLe)}</p>}

            <details className="bg-white rounded-lg border border-[#f1f5f9] p-3">
              <summary className="text-[13px] font-medium text-[#0f172a] cursor-pointer">
                {prospect.estimationProposeeLe ? "Mettre à jour l'estimation" : "Enregistrer une estimation"}
              </summary>
              <form action={enregistrerEstimationProspectVendeurAction} className="flex flex-col gap-3 mt-3">
                <input type="hidden" name="id" value={prospect.id} />
                <div>
                  <label className="text-[12px] font-medium text-[#64748b] mb-1 block">Montant estimé (€) *</label>
                  <input name="estimationProposeeCentimes" required placeholder="ex. 350000" className={inputCls} />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[#64748b] mb-1 block">Date *</label>
                  <input
                    name="estimationProposeeLe"
                    type="date"
                    required
                    defaultValue={prospect.estimationProposeeLe ?? new Date().toISOString().slice(0, 10)}
                    className={inputCls}
                  />
                </div>
                <button type="submit" className={`self-start ${boutonCls}`}>
                  Enregistrer
                </button>
              </form>
            </details>

            <details className="bg-white rounded-lg border border-[#f1f5f9] p-3">
              <summary className="text-[13px] font-medium text-[#0f172a] cursor-pointer">
                {prospect.rdvEstimationPrevuLe ? "Replanifier le rendez-vous" : "Planifier un rendez-vous d'estimation"}
              </summary>
              <form action={planifierRdvEstimationProspectVendeurAction} className="flex flex-col gap-3 mt-3">
                <input type="hidden" name="id" value={prospect.id} />
                <input name="rdvEstimationPrevuLe" type="datetime-local" required className={inputCls} />
                <button type="submit" className={`self-start ${boutonCls}`}>
                  Planifier
                </button>
              </form>
              {prospect.rdvEstimationPrevuLe && (
                <p className="text-[12px] text-[#94a3b8] mt-2">Prévu le {formatDateHeure(prospect.rdvEstimationPrevuLe)}</p>
              )}
            </details>

            {!prospect.rdvEstimationRealiseLe && (
              <details className="bg-white rounded-lg border border-[#f1f5f9] p-3">
                <summary className="text-[13px] font-medium text-[#0f172a] cursor-pointer">Marquer le rendez-vous comme réalisé</summary>
                <form action={marquerRdvEstimationRealiseProspectVendeurAction} className="flex flex-col gap-3 mt-3">
                  <input type="hidden" name="id" value={prospect.id} />
                  <input
                    name="rdvEstimationRealiseLe"
                    type="datetime-local"
                    required
                    defaultValue={prospect.rdvEstimationPrevuLe?.slice(0, 16)}
                    className={inputCls}
                  />
                  <button type="submit" className={`self-start ${boutonCls}`}>
                    Marquer réalisé
                  </button>
                </form>
              </details>
            )}
            {prospect.rdvEstimationRealiseLe && (
              <p className="text-[13px] text-[#94a3b8]">Rendez-vous réalisé le {formatDateHeure(prospect.rdvEstimationRealiseLe)}</p>
            )}

            {!prospect.mandatProposeLe && (
              <form action={proposerMandatProspectVendeurAction}>
                <input type="hidden" name="id" value={prospect.id} />
                <button type="submit" className={boutonSecondaireCls}>
                  Marquer le mandat comme proposé
                </button>
              </form>
            )}
            {prospect.mandatProposeLe && (
              <p className="text-[13px] text-[#94a3b8]">Mandat proposé le {formatDate(prospect.mandatProposeLe)}</p>
            )}

            <Link href={`/prospects-vendeurs/${prospect.id}/signer-mandat`} className={`self-start ${boutonCls}`}>
              Signer le mandat et créer le bien
            </Link>
          </div>
        </section>
      )}

      {/* Perte */}
      {statut === "perdu" ? (
        <section className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Perte</p>
          <div className="bg-[#fef2f2] border border-[#fecaca] rounded-lg p-4 text-[14px] text-[#0f172a]">
            <p className="font-medium">{prospect.motifPerte && LABEL_MOTIF_PERTE_PROSPECT_VENDEUR[prospect.motifPerte]}</p>
            {prospect.datePerte && <p className="text-[#64748b] text-[13px]">{formatDate(prospect.datePerte)}</p>}
          </div>
        </section>
      ) : (
        enCours && (
          <details className="mb-8 bg-white rounded-lg border border-[#f1f5f9] p-3">
            <summary className="text-[13px] font-medium text-[#dc2626] cursor-pointer">Marquer comme perdu</summary>
            <form action={marquerProspectVendeurPerduAction} className="flex flex-col gap-3 mt-3">
              <input type="hidden" name="id" value={prospect.id} />
              <div>
                <label className="text-[12px] font-medium text-[#64748b] mb-1 block">Motif *</label>
                <select name="motifPerte" required className={inputCls} defaultValue="">
                  <option value="" disabled>
                    Choisir...
                  </option>
                  {MOTIFS_PERTE_PROSPECT_VENDEUR.map((m) => (
                    <option key={m} value={m}>
                      {LABEL_MOTIF_PERTE_PROSPECT_VENDEUR[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-[#64748b] mb-1 block">Date *</label>
                <input name="datePerte" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputCls} />
              </div>
              <button type="submit" className="self-start text-[13px] font-medium text-white bg-[#dc2626] hover:bg-[#b91c1c] transition-colors px-3.5 py-2 rounded-lg">
                Marquer comme perdu
              </button>
            </form>
          </details>
        )
      )}

      {/* Prochaine action */}
      <section className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Prochaine action</p>
        <div className="bg-white rounded-lg border border-[#f1f5f9] p-4">
          {prospect.prochaineAction && (
            <p className="text-[14px] text-[#0f172a] mb-3">
              {prospect.prochaineAction}
              {prospect.prochaineActionLe && ` — ${formatDate(prospect.prochaineActionLe)}`}
            </p>
          )}
          <form action={mettreAJourProchaineActionAction} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={prospect.id} />
            <input
              name="prochaineAction"
              defaultValue={prospect.prochaineAction ?? ""}
              placeholder="ex. Rappeler pour confirmer le RDV"
              className={inputCls}
            />
            <input name="prochaineActionLe" type="date" defaultValue={prospect.prochaineActionLe ?? ""} className={inputCls} />
            <button type="submit" className={`self-start ${boutonSecondaireCls}`}>
              Mettre à jour
            </button>
          </form>
        </div>
      </section>

      {/* Notes */}
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Notes</p>
        <form action={ajouterNoteProspectVendeurAction} className="flex flex-col gap-3 mb-4 bg-white rounded-lg border border-[#f1f5f9] p-4">
          <input type="hidden" name="id" value={prospect.id} />
          <select name="type" defaultValue="note_interne" className={inputCls}>
            {TYPES_NOTE_PROSPECT_VENDEUR.map((t) => (
              <option key={t} value={t}>
                {LABEL_TYPE_NOTE_PROSPECT_VENDEUR[t]}
              </option>
            ))}
          </select>
          <textarea name="contenu" required rows={3} className={inputCls} placeholder="Contenu de la note..." />
          <button type="submit" className={`self-start ${boutonSecondaireCls}`}>
            Ajouter la note
          </button>
        </form>

        {notes.length === 0 ? (
          <p className="text-[14px] text-[#94a3b8]">Aucune note pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {notes.map((note) => (
              <div key={note.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={note.type === "note_interne" ? "muted" : "accent"}>{LABEL_TYPE_NOTE_PROSPECT_VENDEUR[note.type]}</Badge>
                  <span className="text-[12px] text-[#94a3b8]">{formatDateHeure(note.creeLe)}</span>
                </div>
                <p className="text-[14px] text-[#0f172a] whitespace-pre-wrap">{note.contenu}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
