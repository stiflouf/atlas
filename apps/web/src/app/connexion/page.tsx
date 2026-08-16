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
    <div className="h-full flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-8 text-center">
        <p className="text-[15px] font-semibold text-[#0f172a] tracking-tight mb-1">Atlas</p>
        <p className="text-[13px] text-[#64748b] mb-6">Le compagnon du conseiller immobilier.</p>

        {messageErreur && (
          <p className="text-[13px] text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] rounded-lg px-3 py-2 mb-4">
            {messageErreur}
          </p>
        )}

        <a
          href="/api/auth/atlas/login"
          className="inline-flex items-center justify-center w-full text-[14px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-4 py-2.5 rounded-lg"
        >
          Se connecter avec Google
        </a>
      </div>
    </div>
  );
}
