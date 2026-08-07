import type { ActionPrevue } from "@/types/agenda";

export default function ActionItem({ action }: { action: ActionPrevue }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="w-4 h-4 mt-0.5 rounded border border-[#e2e8f0] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] text-[#0f172a]">{action.label}</p>
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
