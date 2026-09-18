import { Home } from "lucide-react";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import { LABEL_CHARGE_HONORAIRES, LABEL_TYPE_BIEN, type Bien } from "@/types/bien";
import type { StatutMandatEffectif } from "@/lib/presentationMandatBien";

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

// État terminal du cockpit : le mandat est signé, le pipeline est clos, la fiche devient une trace
// du parcours et un pont vers le bien. Remplace la bande navy « Prochaine étape » — aucune
// transition n'est plus possible (chargerProspectPourJalon les refuse déjà côté serveur).
//
// ADR-060 §1 (lot MANDATE_CANONICAL_UI_V1) — le statut du mandat est le statut EFFECTIF tranché par
// le même read model que la fiche Bien (`statutMandatEffectif`) : jamais une seconde logique
// canonique/legacy ici. Le détail du mandat (type, terme, parties) se lit sur la fiche du bien.
export default function ProspectVendeurBienCree({ bien, mandatEffectif }: { bien: Bien; mandatEffectif: StatutMandatEffectif }) {
  return (
    <div className="bg-surface border border-success rounded-xl shadow-[0_2px_8px_rgba(18,32,56,0.06)] p-5 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="flex items-start gap-4 min-w-0">
          <span className="w-11 h-11 rounded-[10px] bg-success-light text-success flex items-center justify-center shrink-0">
            <Home size={19} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-success mb-1">
              Bien en commercialisation
            </p>
            <p className="text-[17px] md:text-[18px] font-semibold text-text-1 leading-snug">{bien.titre}</p>
            <p className="text-[13px] text-text-2 mt-0.5">
              {bien.adresse} · {bien.codePostal} {bien.ville}
            </p>
            <div className="flex flex-wrap gap-2 mt-2.5">
              <Badge variant="muted">Réf. {bien.reference}</Badge>
              <Badge>{LABEL_TYPE_BIEN[bien.type]}</Badge>
              <Badge variant={mandatEffectif.variante}>
                {mandatEffectif.actif ? "Mandat actif" : mandatEffectif.libelle}
              </Badge>
              <Badge variant="muted">{formatPrix(bien.prix)}</Badge>
              {bien.chargeHonoraires && (
                <Badge variant="muted">
                  Honoraires à la charge : {LABEL_CHARGE_HONORAIRES[bien.chargeHonoraires].toLowerCase()}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0">
          <ButtonLink href={`/biens/${bien.id}`} variant="primary" size="md">
            Ouvrir la fiche du bien
          </ButtonLink>
        </div>
      </div>

      <p className="text-[12px] text-text-3 mt-4 pt-4 border-t border-border">
        Visites, documents et suivi commercial se poursuivent sur la fiche du bien.
      </p>
    </div>
  );
}
