import type { ComponentType } from "react";
import IconTile from "./IconTile";

// Petite tuile icône + valeur + libellé (chantier fidélité visuelle) — réutilisée pour les
// indicateurs du Cockpit (comptages déjà calculés côté page, aucune requête ici) et les
// métadonnées de la Fiche Bien (surface/pièces/étage...). Purement présentationnel : ne calcule
// jamais rien, se contente d'afficher ce qu'on lui passe.
export default function StatTile({
  icon,
  valeur,
  libelle,
  className = "",
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  valeur: string | number;
  libelle: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 bg-surface border border-border rounded-lg px-3 py-2.5 ${className}`}
    >
      <IconTile icon={icon} tone="champagne" size={32} iconSize={15} />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-text-1 leading-tight">{valeur}</p>
        <p className="text-[11px] text-text-3 truncate">{libelle}</p>
      </div>
    </div>
  );
}
