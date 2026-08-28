import Badge from "@/components/ui/Badge";
import type { EntreeJournal } from "@/lib/prospectVendeurParcours";
import {
  TYPES_NOTE_PROSPECT_VENDEUR,
  LABEL_TYPE_NOTE_PROSPECT_VENDEUR,
} from "@/types/noteProspectVendeur";
import { ajouterNoteProspectVendeurAction } from "@/actions/prospectVendeur";

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[13px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";

function formatDateHeure(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateSeule(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Une date SQL `date` (estimationProposeeLe, datePerte) n'a pas d'heure : afficher "00:00" pour
// elle serait une précision inventée. Détection sur la forme de la valeur, jamais sur le champ.
function estDateSeule(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

// Journal « Parcours et échanges » — un seul fil chronologique alimenté par DEUX sources réelles :
// les jalons dérivés des dates enregistrées et les notes append-only. Ce n'est PAS un journal
// d'audit : corriger une date de jalon déplace l'entrée correspondante et l'ancienne valeur n'est
// pas conservée (même limite assumée que deriverHistoriqueBien sur la Fiche Bien). Aucune table
// d'événements n'a été créée pour ce chantier.
export default function ProspectVendeurJournal({
  prospectId,
  entrees,
}: {
  prospectId: string;
  entrees: EntreeJournal[];
}) {
  return (
    <div className="bg-surface border border-border rounded-xl shadow-[0_1px_2px_rgba(18,32,56,0.04)] p-4 md:p-5">
      {/* Journalisation d'un échange DÉJÀ EU — le libellé « Noter un échange » et la mention
          ci-dessous évitent toute confusion avec un envoi : Atlas n'envoie un email que depuis
          /communications/nouveau, à partir d'une tâche (ADR-031/031-bis). Aucun envoi Gmail direct
          vendeur n'est ajouté ici. Réutilise le formulaire de note existant, sans nouvelle
          mutation. */}
      <details className="pb-4 mb-1 border-b border-border">
        <summary className="list-none cursor-pointer select-none inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:text-accent-hover transition-colors">
          + Noter un échange
        </summary>
        <form action={ajouterNoteProspectVendeurAction} className="flex flex-col gap-3 mt-3.5">
          <input type="hidden" name="id" value={prospectId} />
          <div>
            <label className="text-[12px] font-medium text-text-2 mb-1 block">Type d&apos;échange</label>
            <select name="type" defaultValue="appel" className={inputCls}>
              {TYPES_NOTE_PROSPECT_VENDEUR.map((t) => (
                <option key={t} value={t}>
                  {LABEL_TYPE_NOTE_PROSPECT_VENDEUR[t]}
                </option>
              ))}
            </select>
          </div>
          <textarea
            name="contenu"
            required
            rows={3}
            className={inputCls}
            placeholder="Ce qui s'est dit, ce qui a été convenu..."
          />
          <p className="text-[11.5px] text-text-3">
            Journalise un échange déjà eu — n&apos;envoie aucun message. Un échange autre qu&apos;une
            note interne met à jour la date de dernier contact.
          </p>
          <button
            type="submit"
            className="self-start text-[13px] font-medium text-accent bg-surface border border-border-md hover:border-accent transition-colors px-3.5 py-2 rounded-lg"
          >
            Enregistrer l&apos;échange
          </button>
        </form>
      </details>

      {entrees.length === 0 ? (
        <p className="text-[13px] text-text-3 pt-3">Aucun échange ni jalon enregistré pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col">
          {entrees.map((entree, index) => {
            const dernier = index === entrees.length - 1;
            return (
              <div key={entree.genre === "note" ? `note-${entree.id}` : `jalon-${entree.cle}`} className="flex gap-3 py-2.5">
                <div className="flex flex-col items-center w-5 shrink-0">
                  {/* Trois marqueurs distincts : jalon de pipeline, échange avec le vendeur, note
                      interne (qui n'est pas une interaction, ADR-027). */}
                  <span
                    className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
                      entree.genre === "jalon"
                        ? "bg-success"
                        : entree.note.type === "note_interne"
                          ? "bg-surface border border-border-md"
                          : "bg-champagne"
                    }`}
                  />
                  {!dernier && <span className="w-px flex-1 bg-border mt-1.5" />}
                </div>

                <div className="min-w-0 flex flex-col gap-1 pb-1">
                  {entree.genre === "jalon" ? (
                    <>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[13.5px] font-medium text-text-1">{entree.titre}</span>
                        <span className="text-[11.5px] text-text-3 tabular-nums">
                          {estDateSeule(entree.date) ? formatDateSeule(entree.date) : formatDateHeure(entree.date)}
                        </span>
                      </div>
                      {entree.detail && <p className="text-[13px] text-text-2 leading-relaxed">{entree.detail}</p>}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={entree.note.type === "note_interne" ? "muted" : "accent"}>
                          {LABEL_TYPE_NOTE_PROSPECT_VENDEUR[entree.note.type]}
                        </Badge>
                        <span className="text-[11.5px] text-text-3 tabular-nums">{formatDateHeure(entree.date)}</span>
                      </div>
                      <p className="text-[13px] text-text-2 leading-relaxed whitespace-pre-wrap">{entree.note.contenu}</p>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11.5px] text-text-3 mt-3 pt-3 border-t border-border">
        Les échanges sont définitifs une fois enregistrés. Les jalons reflètent les dates
        actuellement saisies — corriger une date déplace l&apos;entrée correspondante.
      </p>
    </div>
  );
}
