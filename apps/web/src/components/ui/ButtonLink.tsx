import Link from "next/link";
import type { ComponentProps } from "react";
import { classesBouton, type ButtonSize, type ButtonVariant } from "./Button";

// Pendant de `Button` qui rend un vrai lien Next.js — jamais un <button>. Évite l'imbrication
// <a><button> invalide que produisait `<Link><Button /></Link>` (audit Lot 2). Même système visuel
// que `Button` via `classesBouton`, jamais deux implémentations de style divergentes.
type Props = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export default function ButtonLink({ variant = "secondary", size = "md", className = "", ...rest }: Props) {
  return <Link className={classesBouton({ variant, size, className })} {...rest} />;
}
