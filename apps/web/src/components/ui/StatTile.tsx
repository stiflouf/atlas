import type { ComponentType } from "react";
import IconTile from "./IconTile";

// Petite tuile icône + valeur + libellé (chantier fidélité visuelle) — réutilisée pour les
// indicateurs du Cockpit (comptages déjà calculés côté page, aucune requête ici) et les
// métadonnées de la Fiche Bien (surface/pièces/étage...). Purement présentationnel : ne calcule
// jamais rien, se contente d'afficher ce qu'on lui passe.
//
// `taille="kpi"` (dernière passe visuelle) affirme davantage la tuile — icône plus grande,
// chiffre plus imposant, libellé plus discret — réservé aux 4 repères chiffrés du Cockpit ;
// les tuiles métadonnées de la Fiche Bien et du Pack Notaire gardent le défaut "compact"
// inchangé pour ne pas grossir des tuiles denses dans une grille à 5 colonnes.
type Taille = "compact" | "kpi";

const TAILLE_ICONE: Record<Taille, number> = { compact: 32, kpi: 40 };
const TAILLE_ICONE_GLYPHE: Record<Taille, number> = { compact: 15, kpi: 18 };
const TAILLE_VALEUR: Record<Taille, string> = {
  compact: "text-[15px] font-semibold",
  kpi: "text-[22px] font-semibold",
};
const TAILLE_PADDING: Record<Taille, string> = { compact: "px-3 py-2.5", kpi: "px-4 py-3.5" };

export default function StatTile({
  icon,
  valeur,
  libelle,
  taille = "compact",
  className = "",
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  valeur: string | number;
  libelle: string;
  taille?: Taille;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 bg-surface border border-border rounded-lg ${TAILLE_PADDING[taille]} ${className}`}
    >
      <IconTile icon={icon} tone="champagne" size={TAILLE_ICONE[taille]} iconSize={TAILLE_ICONE_GLYPHE[taille]} />
      <div className="min-w-0">
        <p className={`${TAILLE_VALEUR[taille]} text-text-1 leading-tight`}>{valeur}</p>
        <p className="text-[11px] text-text-3 truncate mt-0.5">{libelle}</p>
      </div>
    </div>
  );
}
