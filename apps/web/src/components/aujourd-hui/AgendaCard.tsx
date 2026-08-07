import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import type { RendezVous, TypeRdv } from "@/types/agenda";

const typeConfig: Record<TypeRdv, { label: string; variant: "accent" | "default" | "muted" | "success" }> = {
  visite: { label: "Visite", variant: "accent" },
  estimation: { label: "Estimation", variant: "default" },
  appel: { label: "Appel", variant: "muted" },
  signature: { label: "Signature", variant: "success" },
  reunion: { label: "Réunion", variant: "muted" },
};

export default function AgendaCard({ rdv }: { rdv: RendezVous }) {
  const { label, variant } = typeConfig[rdv.type];

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[13px] font-medium text-[#64748b] tabular-nums">{rdv.heure}</span>
            <Badge variant={variant}>{label}</Badge>
          </div>
          <p className="text-[14px] font-medium text-[#0f172a] leading-snug">{rdv.titre}</p>
          {rdv.lieu && (
            <p className="text-[13px] text-[#64748b] mt-0.5 truncate">{rdv.lieu}</p>
          )}
          {rdv.client && (
            <p className="text-[13px] text-[#94a3b8] mt-0.5">
              {rdv.client.prenom} {rdv.client.nom}
            </p>
          )}
        </div>

        {rdv.preparationDisponible && (
          <Link
            href={`/visites/${rdv.id}/preparer`}
            className="shrink-0 self-center min-h-[44px] flex items-center text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
          >
            Préparer&nbsp;→
          </Link>
        )}
      </div>
    </Card>
  );
}
