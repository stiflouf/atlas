import Link from "next/link";
import Badge from "@/components/ui/Badge";
import type { VisiteDuJour } from "@/lib/visiteRepository";
import { nomComplet } from "@/lib/identite/nomPersonne";

// VISIT_NATIVE_ENTRY_V1 — une Visite DOMIORA du jour dans la timeline d'Aujourd'hui. Même gabarit
// visuel qu'AgendaCard (colonne heure, rail, badge, titre), mais SANS requête : tout vient du reader
// set-based `visitesDuJour` (bien et acquéreur déjà joints), jamais un getById par carte. Pas
// d'heure : la Visite est un jour civil (ADR-040/041), affichée comme un événement de la journée.
// Le lien va à la fiche canonique /visites/{id}, jamais à /preparer.
export default function VisiteJourCard({ visite, dernier = false }: { visite: VisiteDuJour; dernier?: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="w-14 shrink-0 text-right pt-0.5">
        <span className="text-[12px] font-medium text-text-secondary leading-tight">Journée</span>
      </div>

      <div className="flex flex-col items-center shrink-0">
        <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 bg-champagne" />
        {!dernier && <span className="w-px flex-1 bg-border-subtle mt-1" />}
      </div>

      <div className="flex-1 min-w-0 pb-6">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="accent">Visite</Badge>
          <span className="text-[11px] text-text-muted">DOMIORA</span>
        </div>
        <p className="text-[14px] font-medium text-text-primary leading-snug">{visite.bien.titre}</p>
        <p className="text-[13px] text-text-secondary mt-0.5 truncate">
          {visite.bien.adresse}, {visite.bien.codePostal} {visite.bien.ville}
        </p>
        <p className="text-[13px] text-text-muted mt-0.5">{nomComplet(visite.acquereur)}</p>
        <Link
          href={`/visites/${visite.id}`}
          className="inline-block mt-1.5 text-[13px] font-medium text-action-primary hover:text-action-primary-hover transition-colors"
        >
          Ouvrir la visite&nbsp;→
        </Link>
      </div>
    </div>
  );
}
