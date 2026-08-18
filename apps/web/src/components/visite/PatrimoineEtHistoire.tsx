import SectionTitle from "@/components/ui/SectionTitle";
import { ChevronDown } from "lucide-react";
import type { MonumentProche } from "@/types/patrimoine";
import type { ElementARaconter } from "@/types/araconter";

type Props = {
  monuments: MonumentProche[];
  recupereLe?: string;
  elementsARaconter: ElementARaconter[];
};

// Regroupe Patrimoine à proximité et À raconter si pertinent sous un seul repli UX — les deux
// sources restent des sous-parties distinctes (même source Mérimée, angles différents : liste
// factuelle vs extraits datés), pas fusionnées sémantiquement.
export default function PatrimoineEtHistoire({ monuments, recupereLe, elementsARaconter }: Props) {
  if (monuments.length === 0 && elementsARaconter.length === 0) return null;

  return (
    <section className="mb-8">
      <details className="group">
        <summary className="cursor-pointer list-none flex items-center gap-1.5 mb-3 [&::-webkit-details-marker]:hidden">
          <SectionTitle>Patrimoine & histoire</SectionTitle>
          <ChevronDown size={14} className="text-text-3 transition-transform group-open:rotate-180" />
        </summary>

        <div className="mt-1">
          {monuments.length > 0 && (
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
                Patrimoine à proximité
              </p>
              <div className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-border mb-2">
                {monuments.map((m) => (
                  <div key={m.reference} className="py-3">
                    <p className="text-[14px] font-medium text-text-1 leading-snug">{m.nom}</p>
                    <p className="text-[12px] text-text-2 mt-0.5">
                      {m.type && `${m.type.charAt(0).toUpperCase()}${m.type.slice(1)}`}
                      {m.type && " · "}
                      {m.distanceMetres} m
                    </p>
                    {m.extraitHistorique && (
                      <p className="text-[13px] text-text-2 leading-snug mt-1">{m.extraitHistorique}</p>
                    )}
                  </div>
                ))}
              </div>
              {recupereLe && (
                <p className="text-[11px] text-text-3">
                  Source : Ministère de la Culture — Base Mérimée · récupéré le{" "}
                  {new Date(recupereLe).toLocaleString("fr-FR")}
                </p>
              )}
            </div>
          )}

          {elementsARaconter.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
                À raconter si pertinent
              </p>
              <div className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-border mb-2">
                {elementsARaconter.map((e) => (
                  <div key={e.reference} className="py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-1">
                      🏛 Histoire · {e.distanceMetres} m
                    </p>
                    <p className="text-[14px] text-text-1 leading-snug">{e.texte}</p>
                    <p className="text-[11px] text-text-3 mt-1">
                      Source : {e.source} — {e.reference}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
