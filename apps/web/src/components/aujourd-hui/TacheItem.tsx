import Link from "next/link";
import { terminerTacheAction } from "@/actions/terminerTache";
import { LABEL_REGLE_AUTOMATISATION } from "@/lib/automatisations/catalogueRegles";
import { LABEL_ECHEANCE_ABSENTE, deriverCibleTache, type Tache } from "@/types/tache";
import type { CodeRegleAutomatisation } from "@/types/automatisation";

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
  return (
    <div className="flex items-start gap-3 py-2.5">
      <form action={terminerTacheAction} className="mt-0.5 shrink-0">
        <input type="hidden" name="id" value={tache.id} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <button
          type="submit"
          aria-label="Marquer comme terminée"
          className="w-4 h-4 rounded border border-[#e2e8f0] hover:border-[#4338ca] hover:bg-[#eef2ff] transition-colors"
        />
      </form>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] text-[#0f172a]">{tache.titre}</p>
        {tache.contexte && (
          <p className="text-[13px] text-[#94a3b8] mt-0.5">{tache.contexte}</p>
        )}
        <p className="text-[11px] text-[#94a3b8] mt-0.5">
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
        </p>
        {tache.origine === "automatique" && (
          <p className="text-[11px] text-[#94a3b8] mt-0.5">
            Créée automatiquement — Règle :{" "}
            {tache.origineCode && LABEL_REGLE_AUTOMATISATION[tache.origineCode as CodeRegleAutomatisation]
              ? LABEL_REGLE_AUTOMATISATION[tache.origineCode as CodeRegleAutomatisation]
              : "inconnue"}
          </p>
        )}
        {deriverCibleTache(tache) && (
          <Link
            href={`/communications/nouveau?tacheId=${tache.id}`}
            className="text-[11px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors mt-1 inline-block"
          >
            Préparer un email
          </Link>
        )}
      </div>
    </div>
  );
}
