import { PRODUCT_NAME } from "@/lib/branding";
import type { ProvenanceRegleProjection } from "@/types/projectionFiscale";

const LABEL_STATUT_VERIFICATION: Record<string, string> = {
  verifie_direct: "vérifié directement",
  recoupement: "recoupé sur plusieurs sources",
  a_confirmer: "à confirmer",
};

// "Comment ce chiffre est calculé ?" pour une année projetée (ADR-025) : distingue explicitement une
// règle officiellement publiée d'une reconduction hypothétique de la dernière règle connue — jamais
// masqué, toujours visible dans l'UI (correction n° 3).
export default function ExplicationCalculProjection({ provenance }: { provenance: ProvenanceRegleProjection[] }) {
  if (provenance.length === 0) return null;
  return (
    <details className="mt-1.5 text-[12px] text-text-2">
      <summary className="cursor-pointer select-none text-accent">Comment ce chiffre est calculé ?</summary>
      <div className="mt-2 flex flex-col gap-1.5 pl-3 border-l-2 border-border-md">
        {provenance.map((p, index) => {
          if (p.origine === "indisponible") {
            return (
              <p key={`indisponible-${p.code}-${index}`}>
                Règle {p.code} : indisponible, aucune valeur n&apos;a jamais été renseignée dans {PRODUCT_NAME}.
              </p>
            );
          }
          if (p.origine === "hypothese_reconduction") {
            return (
              <p key={`hypothese-${p.regleReconduite.code}-${index}`}>
                <span className="font-medium text-warning">Hypothèse de reconduction</span> — dernière règle
                officiellement connue depuis {p.anneeDerniereRegleOfficielle} ({p.regleReconduite.sourceLibelle}),
                reconduite sans garantie pour cette année.{" "}
                <a href={p.regleReconduite.sourceUrl} target="_blank" rel="noreferrer" className="underline text-accent">
                  Source de la dernière règle connue
                </a>
              </p>
            );
          }
          return (
            <p key={`officielle-${p.regle.code}-${index}`}>
              Règle officielle — {p.regle.sourceLibelle} ({LABEL_STATUT_VERIFICATION[p.regle.statutVerification]}),
              applicable depuis le {p.regle.dateDebutValidite}
              {p.regle.dateFinValidite ? ` jusqu'au ${p.regle.dateFinValidite}` : ""}.{" "}
              <a href={p.regle.sourceUrl} target="_blank" rel="noreferrer" className="underline text-accent">
                Source officielle
              </a>
            </p>
          );
        })}
      </div>
    </details>
  );
}
