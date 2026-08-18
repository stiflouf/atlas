import Link from "next/link";
import Card from "@/components/ui/Card";
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
  attention: "text-text-1 bg-border",
  information: "text-text-3 bg-page",
};

export default function AlerteCard({ alerte }: { alerte: AlerteCopilote }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <p className="text-[14px] font-medium text-text-1 leading-snug">{alerte.titre}</p>
        <span
          className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${COULEUR_NIVEAU[alerte.niveau]}`}
        >
          {LABEL_NIVEAU[alerte.niveau]}
        </span>
      </div>
      <p className="text-[13px] text-text-2 leading-snug">{alerte.explication}</p>
      {alerte.action && (
        <Link
          href={alerte.action.href}
          className="inline-block mt-2 text-[13px] font-medium text-accent hover:text-accent-hover transition-colors"
        >
          {alerte.action.libelle} →
        </Link>
      )}
    </Card>
  );
}
