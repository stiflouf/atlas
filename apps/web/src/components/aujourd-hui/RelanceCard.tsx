import Card from "@/components/ui/Card";
import type { Relance, TypeAction } from "@/types/agenda";

const actionLabel: Record<TypeAction, string> = {
  appel: "Appeler →",
  message: "Écrire →",
  email: "Envoyer un mail →",
};

export default function RelanceCard({ relance }: { relance: Relance }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {relance.priorite === "haute" && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#dc2626] shrink-0" />
            )}
            <p className="text-[14px] font-medium text-[#0f172a]">
              {relance.client.prenom} {relance.client.nom}
            </p>
          </div>
          <p className="text-[13px] text-[#64748b]">{relance.motif}</p>
          <p className="text-[13px] text-[#94a3b8] mt-1">{relance.actionSuggeree}</p>
        </div>
        <button className="shrink-0 self-center min-h-[44px] flex items-center text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors whitespace-nowrap">
          {actionLabel[relance.actionType]}
        </button>
      </div>
    </Card>
  );
}
