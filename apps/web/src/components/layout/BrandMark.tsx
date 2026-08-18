import { PRODUCT_NAME } from "@/lib/branding";

// Monogramme temporaire, volontairement sobre et remplaçable — le logo final n'est pas figé
// (vérification marque en cours). Isolé ici : un futur remplacement (SVG, nouveau nom) ne touche
// que ce fichier, jamais Sidebar/BottomNav/connexion.
type Props = { taille?: "sm" | "md"; surNavy?: boolean; className?: string };

export default function BrandMark({ taille = "md", surNavy = false, className = "" }: Props) {
  const tailleMonogramme = taille === "sm" ? "w-6 h-6 text-[12px]" : "w-8 h-8 text-[14px]";
  const tailleTexte = taille === "sm" ? "text-[13px]" : "text-[15px]";

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span
        className={`inline-flex items-center justify-center shrink-0 rounded-md bg-champagne font-semibold text-navy ${tailleMonogramme}`}
      >
        {PRODUCT_NAME.charAt(0)}
      </span>
      <span className={`font-semibold tracking-tight ${tailleTexte} ${surNavy ? "text-white" : "text-text-1"}`}>
        {PRODUCT_NAME}
      </span>
    </div>
  );
}
