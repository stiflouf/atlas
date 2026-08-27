import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import IconTile from "@/components/ui/IconTile";
import type { Bien } from "@/types/bien";
import { LABEL_STATUT_VISITE, type Visite } from "@/types/visite";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Visites de la Fiche Acquéreur Premium — lecture seule sur l'entité Visite réelle (ADR-040),
// jamais un compte rendu (ResultatCompatibilite/CompteRenduVisite non chargés ici, voir garde-fou
// B du chantier) ni un calendrier inventé. "Préparer" n'apparaît que pour une visite encore
// planifiee, vers la route réelle déjà existante /visites/[id]/preparer.
export default function AcquereurVisites({
  visites,
  biensParId,
}: {
  visites: Visite[];
  biensParId: Map<string, Bien | undefined>;
}) {
  if (visites.length === 0) {
    return (
      <section>
        <div className="flex items-center gap-2 mb-2">
          <IconTile icon={CalendarCheck} tone="champagne" size={28} iconSize={14} />
          <p className="text-[15px] font-semibold text-text-1">Visites</p>
        </div>
        <p className="text-[13px] text-text-3">Aucune visite enregistrée pour cet acquéreur.</p>
      </section>
    );
  }

  const aVenir = [...visites].filter((v) => v.statut === "planifiee").sort((a, b) => (a.datePrevue < b.datePrevue ? -1 : 1));
  const passees = [...visites].filter((v) => v.statut !== "planifiee").sort((a, b) => (a.datePrevue < b.datePrevue ? 1 : -1));

  function ligne(visite: Visite) {
    const bien = biensParId.get(visite.bienId);
    return (
      <div key={visite.id} className="flex items-center justify-between gap-3 px-3.5 py-3 border-b border-border last:border-b-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-text-2">{formatDate(visite.datePrevue)}</p>
            <span className="text-[11px] text-text-3">·</span>
            <span className="text-[11px] font-medium text-accent">{LABEL_STATUT_VISITE[visite.statut]}</span>
          </div>
          <p className="text-[13px] text-text-1 truncate">{bien ? bien.titre : "Bien indisponible"}</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {visite.statut === "planifiee" && (
            <Link href={`/visites/${visite.id}/preparer`} className="text-[12px] font-medium text-accent hover:text-accent-hover">
              Préparer →
            </Link>
          )}
          {bien && (
            <Link href={`/biens/${bien.id}`} className="text-[12px] text-accent hover:text-accent-hover">
              Voir le bien →
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <IconTile icon={CalendarCheck} tone="champagne" size={28} iconSize={14} />
        <p className="text-[15px] font-semibold text-text-1">Visites</p>
      </div>
      {aVenir.length > 0 && <div className="border border-border rounded-lg overflow-hidden mb-2.5">{aVenir.map(ligne)}</div>}
      {aVenir.length === 0 && <p className="text-[13px] text-text-3 mb-2.5">Aucune visite à venir.</p>}
      {passees.length > 0 && (
        <details>
          <summary className="text-[12px] text-text-3 hover:text-text-2 cursor-pointer select-none">
            {passees.length} visite{passees.length > 1 ? "s" : ""} passée{passees.length > 1 ? "s" : ""} — afficher
          </summary>
          <div className="mt-2 border border-border rounded-lg overflow-hidden">{passees.map(ligne)}</div>
        </details>
      )}
    </section>
  );
}
