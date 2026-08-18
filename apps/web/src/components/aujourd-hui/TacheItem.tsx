import Link from "next/link";
import { terminerTacheAction } from "@/actions/terminerTache";
import { LABEL_REGLE_AUTOMATISATION } from "@/lib/automatisations/catalogueRegles";
import { estEnRetard } from "@/lib/tachePriority";
import { LABEL_ECHEANCE_ABSENTE, deriverCibleTache, deriverRouteFicheCible, type Tache } from "@/types/tache";
import type { CodeRegleAutomatisation } from "@/types/automatisation";
import Badge from "@/components/ui/Badge";

// "Sans échéance" (ADR-028) — jamais "En attente" : une tâche ouverte sans échéance n'est pas une
// tâche "en attente" au sens métier (réservé à une future notion d'attente client/notaire/document,
// voir types/tache.ts). Simple constat factuel sur la présence ou non d'une échéance.
export default function TacheItem({
  tache,
  redirectTo = "/",
}: {
  tache: Tache;
  redirectTo?: string;
}) {
  const routeFiche = deriverRouteFicheCible(tache);
  const cible = deriverCibleTache(tache);

  return (
    <div className="flex items-start gap-3 py-2.5">
      <form action={terminerTacheAction} className="mt-0.5 shrink-0">
        <input type="hidden" name="id" value={tache.id} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <button
          type="submit"
          aria-label="Marquer comme terminée"
          className="w-4 h-4 rounded border border-border-md hover:border-accent hover:bg-accent-light transition-colors"
        />
      </form>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] text-text-1">{tache.titre}</p>
        {tache.contexte && (
          <p className="text-[13px] text-text-3 mt-0.5">{tache.contexte}</p>
        )}
        <p className="text-[11px] text-text-3 mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span>
            {tache.echeance ? (
              <>
                Échéance :{" "}
                {new Date(tache.echeance).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                })}
              </>
            ) : (
              LABEL_ECHEANCE_ABSENTE
            )}
          </span>
          {/* estEnRetard() (src/lib/tachePriority.ts) reste l'unique définition du retard — jamais
              une seconde règle recalculée ici : ce badge ne fait qu'afficher un fait déjà déterminé
              par le tri (ADR-039), une tâche sans échéance n'est structurellement jamais en retard. */}
          {estEnRetard(tache) && <Badge variant="danger">En retard</Badge>}
        </p>
        {tache.origine === "automatique" && (
          <p className="text-[11px] text-text-3 mt-0.5">
            Créée automatiquement — Règle :{" "}
            {tache.origineCode && LABEL_REGLE_AUTOMATISATION[tache.origineCode as CodeRegleAutomatisation]
              ? LABEL_REGLE_AUTOMATISATION[tache.origineCode as CodeRegleAutomatisation]
              : "inconnue"}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1">
          {/* Voir la fiche (ADR-039) : navigation directe vers la cible structurée de la tâche —
              jamais une seconde cible reconstruite (ex. le bien d'un "nouveau match", qui ne cible
              structurellement que l'acquéreur, ADR-028/037). Absent si la cible n'a aucune fiche
              navigable (deriverRouteFicheCible), jamais un lien factice. */}
          {routeFiche && (
            <Link
              href={routeFiche}
              className="text-[11px] font-medium text-accent hover:text-accent-hover transition-colors inline-block"
            >
              Voir la fiche
            </Link>
          )}
          {cible && (
            <Link
              href={`/communications/nouveau?tacheId=${tache.id}`}
              className="text-[11px] font-medium text-accent hover:text-accent-hover transition-colors inline-block"
            >
              Préparer un email
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
