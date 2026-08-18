import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/branding";

// Monogramme temporaire, volontairement sobre et remplaçable — le logo final n'est pas figé
// (nom "Domiora" encore en sécurisation juridique). Isolé ici : un futur remplacement (SVG,
// nouveau nom) ne touche que ce fichier, jamais Sidebar/BottomNav/connexion. Motif géométrique
// abstrait (3 formes architecturales simples) plutôt qu'une lettre gravée — un renommage futur
// reste un changement local, aucune identité littérale à défaire.
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
        className={`inline-flex items-center justify-center shrink-0 rounded-md bg-navy ${tailleMonogramme}`}
      >
        <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]" aria-hidden="true">
          <polygon points="4,20 12,4 20,20" fill="none" stroke="#c59a5b" strokeWidth="2" strokeLinejoin="round" />
          <line x1="8" y1="20" x2="8" y2="13" stroke="#c59a5b" strokeWidth="1.6" />
          <line x1="12" y1="20" x2="12" y2="10" stroke="#c59a5b" strokeWidth="1.6" />
          <line x1="16" y1="20" x2="16" y2="13" stroke="#c59a5b" strokeWidth="1.6" />
        </svg>
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
