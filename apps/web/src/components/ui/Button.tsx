import type { ButtonHTMLAttributes } from "react";
import { LoaderCircle } from "lucide-react";

// Composant minimal (passe design RC2, chantier E) — encapsule les 3 niveaux de poids visuel déjà
// nécessaires ailleurs dans le produit (CTA principal / action secondaire / action destructive),
// sur les tokens de couleur existants. Compatible tel quel avec un `<form action={...}>` (Server
// Action) via `type="submit"` — aucune logique, aucun état, un wrapper de style uniquement.
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-action-primary text-text-inverse hover:bg-action-primary-hover disabled:hover:bg-action-primary",
  secondary: "border border-border-default text-text-primary hover:border-action-primary bg-transparent",
  ghost: "text-text-secondary hover:text-action-primary hover:bg-surface-subtle bg-transparent",
  destructive:
    "border border-border-default text-status-danger hover:border-status-danger hover:bg-status-danger-subtle bg-transparent",
  // Alias de compatibilité déprécié de `destructive` (nom canonique DESIGN-SYSTEM-V1.md § 10). À
  // supprimer une fois une recherche exhaustive confirmant qu'aucun consommateur ne l'utilise plus.
  danger:
    "border border-border-default text-status-danger hover:border-status-danger hover:bg-status-danger-subtle bg-transparent",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "text-[12px] px-2.5 py-1.5 rounded-md",
  md: "text-[13px] px-3.5 py-2 rounded-lg",
};

const TAILLE_SPINNER: Record<ButtonSize, number> = { sm: 14, md: 16 };

// Classes partagées avec `ButtonLink` — un seul système visuel pour le bouton natif et le lien
// stylé en bouton, jamais deux implémentations divergentes.
export function classesBouton({
  variant = "secondary",
  size = "md",
  className = "",
  avecFlex = false,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  avecFlex?: boolean;
}): string {
  return `font-medium transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${avecFlex ? "inline-flex items-center justify-center gap-1.5" : ""} ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export default function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  loading = false,
  disabled,
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classesBouton({ variant, size, className, avecFlex: loading })}
    >
      {loading && <LoaderCircle aria-hidden size={TAILLE_SPINNER[size]} className="animate-spin" />}
      {children}
    </button>
  );
}
