import type { ButtonHTMLAttributes } from "react";

// Composant minimal (passe design RC2, chantier E) — encapsule les 3 niveaux de poids visuel déjà
// nécessaires ailleurs dans le produit (CTA principal / action secondaire / action destructive),
// sur les tokens de couleur existants. Compatible tel quel avec un `<form action={...}>` (Server
// Action) via `type="submit"` — aucune logique, aucun état, un wrapper de style uniquement.
type Variant = "primary" | "secondary" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover disabled:hover:bg-accent",
  secondary: "border border-border-md text-text-1 hover:border-accent hover:text-accent bg-transparent",
  danger: "border border-border-md text-danger hover:border-danger hover:bg-danger-light bg-transparent",
};

const SIZES: Record<Size, string> = {
  sm: "text-[12px] px-2.5 py-1.5 rounded-md",
  md: "text-[13px] px-3.5 py-2 rounded-lg",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export default function Button({ variant = "secondary", size = "md", className = "", type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={`font-medium transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  );
}
