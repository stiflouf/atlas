import BrandMark from "@/components/layout/BrandMark";
import { PRODUCT_TAGLINE } from "@/lib/branding";

const MESSAGES_ERREUR: Record<string, string> = {
  compte_non_autorise: "Compte non autorisé.",
  connexion_echouee: "La connexion a échoué — merci de réessayer.",
};

type PageProps = { searchParams: Promise<{ erreur?: string }> };

// Page publique (ADR-047, voir src/proxy.ts) : seul point d'entrée pour obtenir une session Atlas.
// Volontairement minimale — pas de formulaire email/mot de passe, pas d'inscription, aucune
// création de compte : une seule identité est jamais autorisée (ATLAS_ALLOWED_EMAIL).
export default async function ConnexionPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const messageErreur = params.erreur ? MESSAGES_ERREUR[params.erreur] : undefined;

  return (
    <div className="h-full flex items-center justify-center px-4 bg-page">
      <div className="w-full max-w-sm bg-surface border border-border rounded-xl shadow-[0_2px_8px_rgba(18,32,56,0.06)] p-8 text-center">
        <div className="flex justify-center mb-4">
          <BrandMark />
        </div>
        <p className="text-[13px] text-text-2 mb-6">{PRODUCT_TAGLINE}</p>

        {messageErreur && (
          <p className="text-[13px] text-danger bg-danger-light border border-danger/20 rounded-lg px-3 py-2 mb-4">
            {messageErreur}
          </p>
        )}

        <a
          href="/api/auth/atlas/login"
          className="inline-flex items-center justify-center w-full text-[14px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-4 py-2.5 rounded-lg"
        >
          Se connecter avec Google
        </a>
      </div>
    </div>
  );
}
