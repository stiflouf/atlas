import Link from "next/link";
import { Check } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { estEnRetard } from "@/lib/tachePriority";
import { LABEL_REGLE_AUTOMATISATION } from "@/lib/automatisations/catalogueRegles";
import type { CodeRegleAutomatisation } from "@/types/automatisation";
import { LABEL_ECHEANCE_ABSENTE, LABEL_TYPE_TACHE, type Tache } from "@/types/tache";
import { LABEL_TYPE_NOTE_PROSPECT_VENDEUR, TYPES_NOTE_INTERACTION } from "@/types/noteProspectVendeur";
import { terminerTacheAction } from "@/actions/terminerTache";
import { annulerTacheAction } from "@/actions/annulerTache";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[13px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";

function formatDateCourte(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

// Tâches du cockpit vendeur. Réutilise le polish validé en rc6 : case cliquable pour une tâche
// active, cercle vert plein + coche claire NON interactif pour une tâche terminée (aucune
// transition terminée -> active n'existe).
//
// Ne duplique jamais TacheItem : la fiche vendeur est le seul endroit où terminer une tâche peut
// aussi journaliser une interaction (case opt-in, ADR-028) — TacheItem ne porte pas cette capacité
// et la remplacer par lui la ferait disparaître. Une seule logique de complétion malgré tout : les
// deux chemins soumettent la MÊME terminerTacheAction, l'un sans interaction, l'autre avec.
export default function ProspectVendeurTaches({
  prospectId,
  tachesOuvertes,
  tachesTerminees,
  tacheTerminee,
}: {
  prospectId: string;
  tachesOuvertes: Tache[];
  tachesTerminees: Tache[];
  tacheTerminee?: Tache;
}) {
  const retour = `/prospects-vendeurs/${prospectId}`;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Tâches</p>
        <Link
          href={`/taches/nouveau?prospectVendeurId=${prospectId}`}
          className="text-[12px] font-medium text-accent hover:text-accent-hover transition-colors"
        >
          + Ajouter
        </Link>
      </div>

      {/* Feedback de complétion, même garde que la Fiche Acquéreur : ne confirme que si l'id
          correspond réellement à une tâche désormais terminée pour CE prospect — un query param
          arbitraire ne peut pas fabriquer une fausse confirmation. */}
      {tacheTerminee && (
        <p className="text-[13px] text-success bg-success-light rounded-lg px-3 py-2 mb-2">
          Tâche terminée : « {tacheTerminee.titre} » — déplacée dans les tâches terminées ci-dessous.
        </p>
      )}

      {tachesOuvertes.length === 0 ? (
        <div className="border border-dashed border-border-md rounded-xl px-4 py-4 text-center">
          <p className="text-[13px] text-text-3">Aucune tâche en cours</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl shadow-[0_1px_2px_rgba(18,32,56,0.04)] px-4 divide-y divide-border">
          {tachesOuvertes.map((tache) => (
            <div key={tache.id} className="py-3">
              <div className="flex items-start gap-3">
                <form action={terminerTacheAction} className="mt-0.5 shrink-0">
                  <input type="hidden" name="id" value={tache.id} />
                  <input type="hidden" name="redirectTo" value={`${retour}?tacheTerminee=${tache.id}`} />
                  <button
                    type="submit"
                    aria-label={`Marquer « ${tache.titre} » comme terminée`}
                    className="w-4 h-4 rounded border border-border-md hover:border-accent hover:bg-accent-light transition-colors"
                  />
                </form>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-text-1">{tache.titre}</p>
                  {tache.contexte && <p className="text-[13px] text-text-3 mt-0.5">{tache.contexte}</p>}
                  <p className="text-[11px] text-text-3 mt-1 flex items-center gap-1.5 flex-wrap">
                    <span>{LABEL_TYPE_TACHE[tache.type]}</span>
                    <span>·</span>
                    <span>{tache.echeance ? formatDateCourte(tache.echeance) : LABEL_ECHEANCE_ABSENTE}</span>
                    {estEnRetard(tache) && <Badge variant="danger">En retard</Badge>}
                  </p>
                  {tache.origine === "automatique" && (
                    <p className="text-[11px] text-champagne mt-1">
                      Créée automatiquement — Règle :{" "}
                      {tache.origineCode && LABEL_REGLE_AUTOMATISATION[tache.origineCode as CodeRegleAutomatisation]
                        ? LABEL_REGLE_AUTOMATISATION[tache.origineCode as CodeRegleAutomatisation]
                        : "inconnue"}
                    </p>
                  )}

                  {/* Seul chemin réel vers un email vendeur aujourd'hui : par la tâche
                      (/communications/nouveau?tacheId=). Jamais un bouton d'envoi direct. */}
                  {UUID_REGEX.test(tache.id) && (
                    <Link
                      href={`/communications/nouveau?tacheId=${tache.id}`}
                      className="text-[12px] font-medium text-accent hover:text-accent-hover transition-colors mt-1.5 inline-block"
                    >
                      Préparer un email
                    </Link>
                  )}

                  <details className="mt-2">
                    <summary className="list-none cursor-pointer select-none text-[12px] text-text-3 hover:text-text-2 transition-colors">
                      Terminer en notant l&apos;échange
                    </summary>
                    <form action={terminerTacheAction} className="flex flex-col gap-2.5 mt-2.5">
                      <input type="hidden" name="id" value={tache.id} />
                      <input type="hidden" name="redirectTo" value={`${retour}?tacheTerminee=${tache.id}`} />
                      <input type="hidden" name="enregistrerInteraction" value="on" />
                      <select name="typeInteraction" defaultValue="appel" className={inputCls}>
                        {TYPES_NOTE_INTERACTION.map((t) => (
                          <option key={t} value={t}>
                            {LABEL_TYPE_NOTE_PROSPECT_VENDEUR[t]}
                          </option>
                        ))}
                      </select>
                      <textarea
                        name="contenuInteraction"
                        rows={2}
                        required
                        placeholder="Ce qui s'est dit lors de cet échange..."
                        className={inputCls}
                      />
                      <button
                        type="submit"
                        className="self-start text-[12.5px] font-medium text-accent bg-surface border border-border-md hover:border-accent transition-colors px-3 py-1.5 rounded-lg"
                      >
                        Terminer et journaliser
                      </button>
                    </form>
                    <form action={annulerTacheAction} className="mt-2.5 pt-2.5 border-t border-border">
                      <input type="hidden" name="id" value={tache.id} />
                      <input type="hidden" name="redirectTo" value={retour} />
                      <button type="submit" className="text-[12px] text-text-3 hover:text-danger transition-colors">
                        Annuler la tâche
                      </button>
                    </form>
                  </details>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tachesTerminees.length > 0 && (
        <details className="mt-2" open={Boolean(tacheTerminee)}>
          <summary className="text-[12px] text-text-3 hover:text-text-2 cursor-pointer select-none">
            {tachesTerminees.length} tâche{tachesTerminees.length > 1 ? "s" : ""} terminée
            {tachesTerminees.length > 1 ? "s" : ""} — afficher
          </summary>
          <div className="bg-surface border border-border rounded-xl shadow-[0_1px_2px_rgba(18,32,56,0.04)] flex flex-col divide-y divide-border px-4 mt-2">
            {tachesTerminees.map((tache) => (
              <div key={tache.id} className="flex items-start gap-3 py-3">
                {/* Marqueur non interactif, identique à celui validé en rc6 sur la Fiche
                    Acquéreur : ni bouton ni formulaire, aucune réouverture n'existe. */}
                <span
                  role="img"
                  aria-label="Tâche terminée"
                  title="Tâche terminée"
                  className="w-4 h-4 mt-0.5 rounded-full shrink-0 bg-success text-surface flex items-center justify-center"
                >
                  <Check size={12} strokeWidth={3.5} />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] text-text-1">{tache.titre}</p>
                  {tache.contexte && <p className="text-[13px] text-text-3 mt-0.5">{tache.contexte}</p>}
                  {tache.termineeLe && (
                    <p className="text-[11px] text-text-3 mt-0.5">Terminée le {formatDateCourte(tache.termineeLe)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
