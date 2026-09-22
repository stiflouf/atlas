"use client";

import { useFormStatus } from "react-dom";
import Button, { type ButtonSize, type ButtonVariant } from "@/components/ui/Button";

// FORM_FEEDBACK_V1 — bouton de soumission à pending : `useFormStatus` (état du `<form>` parent le
// plus proche) désactive le bouton et affiche un libellé d'attente pendant la Server Action — une
// seconde soumission accidentelle ne part jamais. `className` accepte les classes des boutons ad hoc
// existants pour ne pas changer l'apparence des formulaires déjà stylés.
export default function BoutonSoumettre({
  children,
  libelleAttente = "Enregistrement…",
  variant = "primary",
  size = "md",
  className = "",
  classeBrute,
  disabled = false,
}: {
  children: React.ReactNode;
  libelleAttente?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  // Classes complètes d'un bouton existant (remplace le style `Button`) — pour rebrancher un
  // formulaire sans en changer l'aspect.
  classeBrute?: string;
  // Blocage métier côté client (ex. doublon à confirmer) — cumulé au pending, jamais à sa place.
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const inactif = pending || disabled;
  if (classeBrute) {
    return (
      <button type="submit" disabled={inactif} aria-busy={pending || undefined} className={`${classeBrute} disabled:opacity-50 disabled:cursor-not-allowed`}>
        {pending ? libelleAttente : children}
      </button>
    );
  }
  return (
    <Button type="submit" variant={variant} size={size} loading={pending} disabled={inactif} className={className}>
      {pending ? libelleAttente : children}
    </Button>
  );
}
