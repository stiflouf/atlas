import { SearchX } from "lucide-react";
import ButtonLink from "@/components/ui/ButtonLink";
import IconTile from "@/components/ui/IconTile";

// 404 produit (DEMO-01) — rendue par le `notFound()` déjà appelé par une dizaine de pages `[id]`
// (bien/acquéreur/prospect/visite introuvable, ou id de démonstration après la bascule vers des
// données réelles, voir docs/DEMO_VS_REAL.md). Server Component : aucune interactivité, donc pas
// de `"use client"`.
//
// Aucune redirection automatique : une page qui se dérobe sous l'utilisatrice est plus déroutante
// qu'un message clair avec une sortie explicite.
export default function PageIntrouvable() {
  return (
    <div className="px-4 py-12 md:px-8 md:py-16 flex justify-center">
      <div className="w-full max-w-md bg-surface border border-border rounded-xl shadow-surface p-8 flex flex-col items-center text-center gap-4">
        <IconTile icon={SearchX} tone="muted" size={44} iconSize={20} />

        <div>
          <h1 className="text-[20px] font-semibold text-text-1 leading-tight">Page introuvable</h1>
          <p className="text-[13px] text-text-2 mt-2">
            La page demandée n&apos;existe pas ou n&apos;est plus disponible.
          </p>
        </div>

        <ButtonLink href="/" variant="primary" size="md" className="mt-1">
          Retour à l&apos;accueil
        </ButtonLink>
      </div>
    </div>
  );
}
