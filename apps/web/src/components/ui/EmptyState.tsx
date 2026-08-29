import type { ComponentType } from "react";
import ButtonLink from "./ButtonLink";
import IconTile from "./IconTile";

// État vide premium (chantier fidélité visuelle) — remplace un simple <p> texte quand une liste
// n'a rien à montrer. Purement présentationnel, jamais de donnée fabriquée : le message et le CTA
// (optionnel) restent fournis par l'appelant, qui seul connaît la sémantique de sa liste.
export default function EmptyState({
  icon,
  titre,
  message,
  cta,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  titre: string;
  message: string;
  cta?: { href: string; libelle: string };
}) {
  return (
    <div className="flex flex-col items-center text-center gap-3 bg-surface border border-border rounded-xl px-6 py-12">
      <IconTile icon={icon} tone="champagne" size={44} iconSize={20} />
      <div>
        <p className="text-[15px] font-medium text-text-1">{titre}</p>
        <p className="text-[13px] text-text-muted mt-1 max-w-sm">{message}</p>
      </div>
      {cta && (
        <ButtonLink href={cta.href} variant="primary" size="md" className="mt-1">
          {cta.libelle}
        </ButtonLink>
      )}
    </div>
  );
}
