"use client";

import { AlertTriangle } from "lucide-react";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import IconTile from "@/components/ui/IconTile";

// Frontière d'erreur de segment (DEMO-01). Rendue À L'INTÉRIEUR du Root Layout : l'AppShell
// (sidebar/bottom nav) reste en place, l'utilisatrice n'est jamais éjectée hors du produit et
// garde une navigation. `"use client"` est exigé par Next.js pour toute error boundary — elle
// reçoit `reset`, un callback.
//
// Ne rend JAMAIS `error.message`, `error.stack` ni `error.cause` : une erreur serveur peut porter
// un détail technique ou une donnée métier. Même règle que le logging du callback d'identité
// (src/app/api/auth/atlas/callback/route.ts), appliquée ici à l'affichage.
//
// `digest` est l'identifiant opaque produit par Next pour corréler l'incident avec les logs
// serveur : affiché uniquement s'il existe, jamais remplacé par un identifiant fabriqué qui ne
// correspondrait à aucune ligne de log.
export default function ErreurApplication({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="px-4 py-12 md:px-8 md:py-16 flex justify-center">
      <div className="w-full max-w-md bg-surface border border-border rounded-xl shadow-surface p-8 flex flex-col items-center text-center gap-4">
        <IconTile icon={AlertTriangle} tone="muted" size={44} iconSize={20} />

        <div>
          <h1 className="text-[20px] font-semibold text-text-1 leading-tight">Une erreur est survenue</h1>
          <p className="text-[13px] text-text-2 mt-2">
            Cette action n&apos;a pas pu être terminée. Vous pouvez réessayer.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
          <Button variant="primary" size="md" onClick={reset}>
            Réessayer
          </Button>
          <ButtonLink href="/" variant="secondary" size="md">
            Retour à l&apos;accueil
          </ButtonLink>
        </div>

        {error.digest && (
          <p className="text-[12px] text-text-muted mt-1">Référence technique : {error.digest}</p>
        )}
      </div>
    </div>
  );
}
