import Link from "next/link";
import Badge from "@/components/ui/Badge";
import { LABEL_CHARGE_HONORAIRES, LABEL_STATUT_MANDAT, type Bien } from "@/types/bien";
import type { ProspectVendeur } from "@/types/prospectVendeur";

const VARIANT_STATUT_MANDAT: Record<Bien["statutMandat"], "success" | "warning" | "danger"> = {
  actif: "success",
  suspendu: "warning",
  expire: "danger",
};

// Bloc "Vendeur & mandat" (design validé Claude Design, artifact 7615625f) — nouveau composant
// présentationnel pur, aucune nouvelle donnée : bien.statutMandat/chargeHonoraires/nomCopropriete
// existent déjà sur le Bien (types/bien.ts) mais n'étaient affichés nulle part sur la Fiche avant
// ce chantier (statutMandat en particulier). prospectVendeurOrigine est déjà résolu côté serveur
// (getProspectVendeurParBien) — jamais recalculé ici. Aucun champ vendeur non confirmé (téléphone/
// email) n'est affiché : uniquement le nom + lien vers sa fiche, pour ne rien présumer de la forme
// exacte de ProspectVendeur au-delà de ce que ce composant a vérifié.
export default function BienVendeurMandat({
  bien,
  prospectVendeurOrigine,
}: {
  bien: Bien;
  prospectVendeurOrigine?: ProspectVendeur;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl shadow-[0_1px_2px_rgba(18,32,56,0.04)] p-4 md:p-5">
      <p className="text-[15px] font-semibold text-text-1 mb-3.5">Vendeur &amp; mandat</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-[11px] text-text-3 mb-1">Vendeur</p>
          {prospectVendeurOrigine ? (
            <>
              <p className="text-[13px] font-medium text-text-1 mb-1">
                {prospectVendeurOrigine.prenom ? `${prospectVendeurOrigine.prenom} ` : ""}
                {prospectVendeurOrigine.nom}
              </p>
              <Link href={`/prospects-vendeurs/${prospectVendeurOrigine.id}`} className="text-[12px] text-accent hover:text-accent-hover">
                Voir la fiche vendeur →
              </Link>
            </>
          ) : (
            <p className="text-[13px] text-text-3">Non renseigné</p>
          )}
        </div>
        <div>
          <p className="text-[11px] text-text-3 mb-1">Statut du mandat</p>
          <Badge variant={VARIANT_STATUT_MANDAT[bien.statutMandat]}>{LABEL_STATUT_MANDAT[bien.statutMandat]}</Badge>
        </div>
        <div>
          <p className="text-[11px] text-text-3 mb-1">Honoraires à la charge</p>
          <p className="text-[13px] font-medium text-text-1">
            {bien.chargeHonoraires ? LABEL_CHARGE_HONORAIRES[bien.chargeHonoraires] : "Non renseigné"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-text-3 mb-1">Copropriété</p>
          <p className="text-[13px] font-medium text-text-1">{bien.nomCopropriete ?? "Non renseigné"}</p>
        </div>
      </div>
    </div>
  );
}
