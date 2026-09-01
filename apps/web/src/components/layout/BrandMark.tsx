import Image from "next/image";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/branding";

// Logo maître « 5. FLAMME DISCRÈTE » (brand/FONDATIONS.md § 1) — affiché depuis l'asset approuvé,
// jamais reconstruit : aucun SVG retracé, aucune recoloration, aucun filtre, aucune opacité. Le
// fichier porte son propre fond navy (PNG sans couche alpha) et le D vient bord à bord ; il occupe
// donc tout le carré, le `bg-navy` du conteneur ne servant que de fond de sécurité.
//
// RÉFÉRENCE RASTER, PAS LE MASTER : ce PNG 1024×1024 est issu de la vignette finale validée. Le
// vectoriel d'origine reste manquant, les tokens or restent donc en attente (PENDING_MASTER_LOGO_
// ASSET, brand/DESIGN-SYSTEM-V1.md § 13) — aucune valeur dorée ne doit être extraite de ce fichier.
//
// Isolé ici : un futur remplacement par le vectoriel ne touche que ce composant, jamais
// Sidebar/BottomNav/connexion.
type Props = { taille?: "sm" | "md" | "lg"; surNavy?: boolean; avecBaseline?: boolean; className?: string };

const TAILLE_MONOGRAMME: Record<NonNullable<Props["taille"]>, string> = {
  sm: "w-6 h-6",
  md: "w-8 h-8",
  lg: "w-10 h-10",
};
const TAILLE_TEXTE: Record<NonNullable<Props["taille"]>, string> = {
  sm: "text-[13px]",
  md: "text-[15px]",
  lg: "text-[18px]",
};

export default function BrandMark({ taille = "md", surNavy = false, avecBaseline = false, className = "" }: Props) {
  const tailleMonogramme = TAILLE_MONOGRAMME[taille];
  const tailleTexte = TAILLE_TEXTE[taille];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span
        className={`relative inline-flex shrink-0 overflow-hidden rounded-md bg-navy ${tailleMonogramme}`}
      >
        {/* object-contain : l'asset est carré comme son conteneur, le ratio est donc conservé à
            l'identique — jamais de recadrage ni d'étirement. alt vide : le mot-symbole DOMIORA
            juste à côté porte déjà le nom, l'annoncer deux fois n'apporterait rien. */}
        <Image
          src="/brand/domiora-mark-flamme-discrete.png"
          alt=""
          fill
          sizes="40px"
          className="object-contain"
        />
      </span>
      <span className="flex flex-col min-w-0">
        <span
          className={`font-semibold tracking-tight leading-tight ${tailleTexte} ${surNavy ? "text-white" : "text-text-1"}`}
        >
          {PRODUCT_NAME}
        </span>
        {/* Baseline très discrète (sidebar uniquement) — jamais dans BottomNav/contextes exigus. */}
        {avecBaseline && (
          <span className={`text-[10px] tracking-wide truncate ${surNavy ? "text-white/45" : "text-text-3"}`}>
            {PRODUCT_TAGLINE}
          </span>
        )}
      </span>
    </div>
  );
}
