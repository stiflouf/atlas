import Link from "next/link";
import { Building2 } from "lucide-react";
import Badge from "@/components/ui/Badge";
import IconTile from "@/components/ui/IconTile";
import PhotoPrincipale from "@/components/bien/PhotoPrincipale";
import type { BienAvecPhotoPrincipale } from "@/lib/bienRepository";
import {
  LABEL_STATUT_COMPATIBILITE,
  LABEL_STATUT_CRITERE,
  type ResultatCompatibilite,
} from "@/lib/compatibilite/types";

const VARIANT_PAR_STATUT_COMPATIBILITE = {
  compatible: "success",
  incompatible: "danger",
  a_verifier: "default",
} as const;

const VARIANT_PAR_STATUT_CRITERE = {
  compatible: "success",
  incompatible: "danger",
  a_verifier: "default",
  non_concerne: "muted",
} as const;

const ORDRE_STATUT_COMPATIBILITE = { compatible: 0, a_verifier: 1, incompatible: 2 } as const;

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function extraitExplication(resultat: ResultatCompatibilite): string | undefined {
  return resultat.criteres.find((c) => c.statut !== "non_concerne")?.explication;
}

// Cœur de la Fiche Acquéreur Premium — même moteur canonique que BienAcquereursCompatibles.tsx
// (evaluerCompatibiliteAcquereur, ADR-034), direction inversée : un Bien par résultat plutôt qu'un
// acquéreur. Jamais de score/pourcentage, jamais un "a_verifier" présenté comme une
// incompatibilité. Vraie photo principale ADR-052 si présente, sinon PropertyVisual (délégué à
// PhotoPrincipale, jamais une seconde logique photo). Compatibles/à vérifier visibles directement
// ("actionnables" — lecture priorisée, design validé section 8) ; incompatibles repliés sous un
// <details> natif, jamais masqués définitivement.
export default function AcquereurBiensCompatibles({
  compatibilites,
  biensActifs,
}: {
  compatibilites: ResultatCompatibilite[];
  biensActifs: BienAvecPhotoPrincipale[];
}) {
  const biensParId = new Map(biensActifs.map((b) => [b.id, b]));
  const tries = [...compatibilites].sort(
    (a, b) => ORDRE_STATUT_COMPATIBILITE[a.statutGlobal] - ORDRE_STATUT_COMPATIBILITE[b.statutGlobal]
  );
  const visibles = tries.filter((r) => r.statutGlobal !== "incompatible");
  const masques = tries.filter((r) => r.statutGlobal === "incompatible");
  const nbCompatibles = tries.filter((r) => r.statutGlobal === "compatible").length;
  const nbAVerifier = tries.filter((r) => r.statutGlobal === "a_verifier").length;

  function carte(resultat: ResultatCompatibilite) {
    const bien = biensParId.get(resultat.bienId);
    const explication = extraitExplication(resultat);
    const criteresPertinents = resultat.criteres.filter((c) => c.statut !== "non_concerne");

    return (
      <div key={resultat.bienId} className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="flex gap-3 p-3">
          {bien ? (
            <PhotoPrincipale type={bien.type} photoPrincipaleId={bien.photoPrincipaleId} format="thumb" className="w-20 h-20 shrink-0" />
          ) : (
            <div className="w-20 h-20 rounded-xl bg-surface-muted shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-text-1 truncate">{bien ? bien.titre : "Bien indisponible"}</p>
                {bien && (
                  <p className="text-[12px] text-text-3 truncate">
                    {bien.adresse}, {bien.codePostal} {bien.ville}
                  </p>
                )}
              </div>
              <Badge variant={VARIANT_PAR_STATUT_COMPATIBILITE[resultat.statutGlobal]}>
                {LABEL_STATUT_COMPATIBILITE[resultat.statutGlobal]}
              </Badge>
            </div>
            {bien && (
              <p className="text-[13px] font-semibold text-text-1 mt-1">
                {formatPrix(bien.prix)}
                <span className="text-[12px] font-normal text-text-3">
                  {" "}
                  · {bien.surface} m² · {bien.pieces} pièces
                </span>
              </p>
            )}
            {explication && <p className="text-[12px] text-text-3 mt-1 leading-snug">{explication}</p>}
          </div>
        </div>

        {criteresPertinents.length > 0 && (
          <details className="border-t border-border px-3 py-2">
            <summary className="text-[12px] text-accent cursor-pointer select-none">Voir le détail des critères</summary>
            <div className="mt-2 flex flex-col gap-1.5">
              {criteresPertinents.map((critere) => (
                <div key={critere.critere} className="flex items-start gap-2">
                  <Badge variant={VARIANT_PAR_STATUT_CRITERE[critere.statut]}>{LABEL_STATUT_CRITERE[critere.statut]}</Badge>
                  <p className="text-[12px] text-text-2 leading-snug">{critere.explication}</p>
                </div>
              ))}
            </div>
          </details>
        )}

        {bien && (
          <div className="border-t border-border px-3 py-2">
            <Link href={`/biens/${bien.id}`} className="text-[12px] font-medium text-accent hover:text-accent-hover">
              Voir la fiche →
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <IconTile icon={Building2} tone="champagne" size={28} iconSize={14} />
          <p className="text-[15px] font-semibold text-text-1">Biens compatibles</p>
        </div>
        <div className="flex items-center gap-1.5">
          {nbCompatibles > 0 && <Badge variant="success">{nbCompatibles} compatible{nbCompatibles > 1 ? "s" : ""}</Badge>}
          {nbAVerifier > 0 && <Badge variant="warning">{nbAVerifier} à vérifier</Badge>}
        </div>
      </div>

      {tries.length === 0 ? (
        <p className="text-[13px] text-text-3">Aucun bien actif à comparer pour le moment.</p>
      ) : visibles.length === 0 ? (
        <p className="text-[13px] text-text-3">
          Aucun bien compatible ou à vérifier pour l&#39;instant — {masques.length} bien
          {masques.length > 1 ? "s" : ""} incompatible{masques.length > 1 ? "s" : ""}.
        </p>
      ) : (
        <div className="flex flex-col gap-3">{visibles.map(carte)}</div>
      )}

      {masques.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-text-3 hover:text-text-2 select-none">
            {masques.length} bien{masques.length > 1 ? "s" : ""} non compatible{masques.length > 1 ? "s" : ""} masqué
            {masques.length > 1 ? "s" : ""} — afficher
          </summary>
          <div className="mt-2 flex flex-col gap-3">{masques.map(carte)}</div>
        </details>
      )}
    </section>
  );
}
