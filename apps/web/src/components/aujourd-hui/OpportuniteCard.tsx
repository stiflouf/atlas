import Link from "next/link";
import { ChevronRight } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import { LABEL_PRIORITE_OPPORTUNITE, type Opportunite, type PrioriteOpportunite } from "@/types/opportunite";

// Même langage visuel que DossierActionCard (rail champagne, deux lignes hiérarchisées, chevron
// d'affordance) — aucune primitive nouvelle, aucun écran nouveau. Le badge dit ce qu'il faut faire
// (« À faire maintenant » / « À suivre » / « À vérifier »), jamais un score ni un pourcentage, et
// jamais « l'IA recommande » : aucune IA n'intervient dans cette page.
const VARIANTE_BADGE: Record<PrioriteOpportunite, "accent" | "default" | "muted"> = {
  haute: "accent",
  moyenne: "default",
  basse: "muted",
};

export default function OpportuniteCard({ opportunite }: { opportunite: Opportunite }) {
  return (
    <Link href={opportunite.action.href} aria-label={`${opportunite.titre} — ${opportunite.action.libelle}`}>
      <Card variant="interactive">
        <div className="flex items-center gap-3.5 p-3.5">
          <span aria-hidden className="h-9 w-[3px] shrink-0 rounded-full bg-champagne" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[14px] font-medium text-text-primary">{opportunite.titre}</p>
              <Badge variant={VARIANTE_BADGE[opportunite.priorite]}>
                {LABEL_PRIORITE_OPPORTUNITE[opportunite.priorite]}
              </Badge>
            </div>
            <p className="mt-0.5 text-[13px] leading-snug text-text-secondary">{opportunite.raison}</p>
          </div>
          <ChevronRight size={16} className="shrink-0 text-text-muted" />
        </div>
      </Card>
    </Link>
  );
}
