import { formatMontantCentimes } from "@/types/remuneration";
import { PRODUCT_NAME } from "@/lib/branding";
import type { AssietteAnnuelle } from "@/types/assietteFiscale";
import type { ProvenanceRegle } from "@/types/resultatFiscal";

const LABEL_STATUT_VERIFICATION: Record<ProvenanceRegle["statutVerification"], string> = {
  verifie_direct: "vérifié directement",
  recoupement: "recoupé sur plusieurs sources",
  a_confirmer: "à confirmer",
};

// "Comment ce chiffre est calculé ?" (ADR-024, UX) : assiette utilisée + règle(s) appliquée(s), avec
// leur source officielle et leur statut de vérification — jamais masqué (ADR-023). <details> natif,
// aucun JS client nécessaire.
export default function ExplicationCalcul({
  provenance,
  assiette,
}: {
  provenance: ProvenanceRegle[];
  assiette?: AssietteAnnuelle;
}) {
  if (provenance.length === 0 && !assiette) return null;
  return (
    <details className="mt-1.5 text-[12px] text-text-2">
      <summary className="cursor-pointer select-none text-accent">Comment ce chiffre est calculé ?</summary>
      <div className="mt-2 flex flex-col gap-1.5 pl-3 border-l-2 border-border-md">
        {assiette && (
          <div>
            <p>
              Assiette : {formatMontantCentimes(assiette.montantConnuCentimes)} connus (
              {assiette.couverture === "complete" ? "couverture complète" : "couverture partielle"}).
            </p>
            {assiette.origines.map((o) =>
              o.source === "historique_amorcage" ? (
                <p key={o.source}>
                  Recettes avant {PRODUCT_NAME} jusqu&apos;au {o.jusquAuInclus} : {formatMontantCentimes(o.montantCentimes)}
                </p>
              ) : (
                <p key={o.source}>
                  {o.nombreEncaissements} encaissement{o.nombreEncaissements > 1 ? "s" : ""} {PRODUCT_NAME} du{" "}
                  {o.premierEncaissement} au {o.dernierEncaissement} : {formatMontantCentimes(o.montantCentimes)}
                </p>
              )
            )}
          </div>
        )}
        {provenance.map((p) => (
          <p key={`${p.code}-${p.dateDebutValidite}`}>
            {p.sourceLibelle} ({LABEL_STATUT_VERIFICATION[p.statutVerification]}), applicable depuis le{" "}
            {p.dateDebutValidite}
            {p.dateFinValidite ? ` jusqu'au ${p.dateFinValidite}` : ""}.{" "}
            <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="underline text-accent">
              Source officielle
            </a>
          </p>
        ))}
      </div>
    </details>
  );
}
