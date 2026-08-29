// Primitive Card (direction artistique premium) — 3 variantes seulement, sur les tokens
// surface/border existants. `default` remplace l'ancien style (bordure + ombre fixes) partout où
// il était déjà utilisé, sans changement de comportement.
type Variant = "default" | "elevated" | "interactive";

const VARIANTS: Record<Variant, string> = {
  default: "bg-surface border border-border-subtle shadow-surface",
  elevated: "bg-surface border border-border-subtle shadow-floating",
  interactive:
    "bg-surface border border-border-subtle shadow-surface transition-shadow duration-150 hover:shadow-floating hover:border-border-default",
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
