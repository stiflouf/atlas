import type { ComponentType } from "react";
import IconTile from "./IconTile";

// Petite tuile icône + valeur + libellé (chantier fidélité visuelle) — réutilisée pour les
// indicateurs du Cockpit (comptages déjà calculés côté page, aucune requête ici) et les
// métadonnées de la Fiche Bien (surface/pièces/étage...). Purement présentationnel : ne calcule
// jamais rien, se contente d'afficher ce qu'on lui passe.
//
// `taille="kpi"` affirme davantage la tuile — icône plus grande, chiffre plus imposant, libellé
// plus discret — réservé aux repères chiffrés du Cockpit ; les tuiles métadonnées de la Fiche Bien
// et du Pack Notaire gardent le défaut "compact" inchangé pour ne pas grossir des tuiles denses
// dans une grille à 5 colonnes.
//
// `taille="lead"` (passe polish finale) : même tuile, sur fond navy. Quatre KPI de poids identique
// ne hiérarchisaient rien — l'œil devait lire les quatre pour trouver celui qui appelle une
// action. La variante lead désigne ce chiffre-là. Purement visuelle : aucun calcul, aucun seuil,
// c'est l'appelant qui décide lequel de ses comptages mérite le fond navy.
type Taille = "compact" | "kpi" | "lead";

const TAILLE_ICONE: Record<Taille, number> = { compact: 32, kpi: 40, lead: 40 };
const TAILLE_ICONE_GLYPHE: Record<Taille, number> = { compact: 15, kpi: 18, lead: 18 };
const TAILLE_VALEUR: Record<Taille, string> = {
  compact: "text-[15px] font-semibold",
  kpi: "text-[22px] font-semibold",
  lead: "text-[22px] font-semibold",
};
const TAILLE_PADDING: Record<Taille, string> = { compact: "px-3 py-2.5", kpi: "px-4 py-3.5", lead: "px-4 py-3.5" };

const TAILLE_SURFACE: Record<Taille, string> = {
  compact: "bg-surface border-border",
  kpi: "bg-surface border-border",
  lead: "bg-navy border-navy",
};
const TAILLE_VALEUR_COULEUR: Record<Taille, string> = {
  compact: "text-text-1",
  kpi: "text-text-1",
  lead: "text-surface",
};
const TAILLE_LIBELLE_COULEUR: Record<Taille, string> = {
  compact: "text-text-3",
  kpi: "text-text-3",
  lead: "text-champagne",
};
const TAILLE_TON_ICONE: Record<Taille, "champagne" | "navy" | "muted" | "sur-navy"> = {
  compact: "champagne",
  kpi: "champagne",
  lead: "sur-navy",
};

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
      className={`flex items-center gap-3 border rounded-lg ${TAILLE_SURFACE[taille]} ${TAILLE_PADDING[taille]} ${className}`}
    >
      <IconTile
        icon={icon}
        tone={TAILLE_TON_ICONE[taille]}
        size={TAILLE_ICONE[taille]}
        iconSize={TAILLE_ICONE_GLYPHE[taille]}
      />
      <div className="min-w-0">
        <p className={`${TAILLE_VALEUR[taille]} ${TAILLE_VALEUR_COULEUR[taille]} leading-tight`}>{valeur}</p>
        <p className={`text-[11px] ${TAILLE_LIBELLE_COULEUR[taille]} truncate mt-0.5`}>{libelle}</p>
      </div>
    </div>
  );
}
