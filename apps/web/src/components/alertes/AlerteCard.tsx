import Link from "next/link";
import { AlertTriangle, Eye, Info } from "lucide-react";
import Card from "@/components/ui/Card";
import IconTile from "@/components/ui/IconTile";
import type { AlerteCopilote, NiveauAlerte } from "@/types/alerte";

// Aucun score n'est jamais affiché (ADR-026) — seul un libellé de niveau, jamais un chiffre de
// priorité.
const LABEL_NIVEAU: Record<NiveauAlerte, string> = {
  action_requise: "À compléter",
  attention: "À surveiller",
  information: "Pour information",
};

const COULEUR_NIVEAU: Record<NiveauAlerte, string> = {
  action_requise: "text-warning bg-warning-light",
  attention: "text-text-primary bg-border-subtle",
  information: "text-text-muted bg-page",
};

const ICONE_NIVEAU: Record<NiveauAlerte, typeof AlertTriangle> = {
  action_requise: AlertTriangle,
  attention: Eye,
  information: Info,
};

const TON_ICONE_NIVEAU: Record<NiveauAlerte, "champagne" | "navy" | "muted"> = {
  action_requise: "champagne",
  attention: "navy",
  information: "muted",
};

// Densité premium (chantier composition) — colonne secondaire étroite, jamais une card pleine
// largeur pour 2-3 lignes.
export default function AlerteCard({ alerte }: { alerte: AlerteCopilote }) {
  return (
    <Card className="p-3">
      <div className="flex items-start gap-2.5">
        <IconTile icon={ICONE_NIVEAU[alerte.niveau]} tone={TON_ICONE_NIVEAU[alerte.niveau]} size={28} iconSize={14} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-[13px] font-medium text-text-primary leading-snug">{alerte.titre}</p>
            <span
              className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${COULEUR_NIVEAU[alerte.niveau]}`}
            >
              {LABEL_NIVEAU[alerte.niveau]}
            </span>
          </div>
          <p className="text-[12px] text-text-secondary leading-snug">{alerte.explication}</p>
          {alerte.action && (
            <Link
              href={alerte.action.href}
              className="inline-block mt-1.5 text-[12px] font-medium text-action-primary hover:text-action-primary-hover transition-colors"
            >
              {alerte.action.libelle} →
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}
