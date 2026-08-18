// Primitive Card (direction artistique premium) — 3 variantes seulement, sur les tokens
// surface/border existants. `default` remplace l'ancien style (bordure + ombre fixes) partout où
// il était déjà utilisé, sans changement de comportement.
type Variant = "default" | "elevated" | "interactive";

const VARIANTS: Record<Variant, string> = {
  default: "bg-surface border border-border shadow-[0_1px_2px_rgba(18,32,56,0.04)]",
  elevated: "bg-surface border border-border shadow-[0_2px_8px_rgba(18,32,56,0.06)]",
  interactive:
    "bg-surface border border-border shadow-[0_1px_2px_rgba(18,32,56,0.04)] transition-shadow duration-150 hover:shadow-[0_2px_8px_rgba(18,32,56,0.08)] hover:border-border-md",
};

export default function Card({
  children,
  className = "",
  variant = "default",
}: {
  children: React.ReactNode;
  className?: string;
  variant?: Variant;
}) {
  return <div className={`rounded-xl ${VARIANTS[variant]} ${className}`}>{children}</div>;
}
