import { terminerActionAction } from "@/actions/terminerAction";
import type { ActionMetier } from "@/types/action";

export default function ActionItem({
  action,
  redirectTo = "/",
}: {
  action: ActionMetier;
  redirectTo?: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <form action={terminerActionAction} className="mt-0.5 shrink-0">
        <input type="hidden" name="id" value={action.id} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <button
          type="submit"
          aria-label="Marquer comme terminée"
          className="w-4 h-4 rounded border border-[#e2e8f0] hover:border-[#4338ca] hover:bg-[#eef2ff] transition-colors"
        />
      </form>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] text-[#0f172a]">{action.titre}</p>
        {action.contexte && (
          <p className="text-[13px] text-[#94a3b8] mt-0.5">{action.contexte}</p>
        )}
        {action.echeance && (
          <p className="text-[11px] text-[#94a3b8] mt-0.5">
            Échéance :{" "}
            {new Date(action.echeance).toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "long",
            })}
          </p>
        )}
      </div>
    </div>
  );
}
