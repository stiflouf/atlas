"use client";

// Dernier filet (DEMO-01) — ne se déclenche que si le Root Layout lui-même échoue. Next.js exige
// alors que ce composant fournisse `<html>` et `<body>` : il REMPLACE le Root Layout, il n'est pas
// rendu à l'intérieur.
//
// Conséquence directe : rien de ce que porte le Root Layout n'est garanti disponible ici — ni les
// polices next/font, ni les variables de thème de globals.css, ni l'AppShell. Un écran de secours
// qui dépendrait des classes Tailwind/tokens DOMIORA pourrait donc s'afficher sans style au moment
// précis où il doit rester lisible. D'où le choix assumé de styles inline et d'aucun import de
// primitive du Design System : les valeurs ci-dessous sont celles de globals.css (§ 2 de
// brand/DESIGN-SYSTEM-V1.md), recopiées ici volontairement — c'est la seule duplication de tokens
// acceptée du projet, et elle existe pour que cet écran ne dépende de rien.
//
// Même règle de sécurité que src/app/error.tsx : jamais `error.message`/`stack`/`cause`, seulement
// `digest` s'il existe. Le focus visible repose sur l'anneau natif du navigateur (aucun
// `outline: none` n'est posé) plutôt que sur la primitive Button, volontairement non importée ici.

const COULEUR_PAGE = "#f6f2ea";
const COULEUR_SURFACE = "#fffcf7";
const COULEUR_BORDURE = "#e8e0cf";
const COULEUR_TEXTE_PRIMAIRE = "#122038";
const COULEUR_TEXTE_SECONDAIRE = "#5a5d70";
const COULEUR_TEXTE_MUET = "#696b7b";
const COULEUR_ACTION = "#02152b";
const COULEUR_TEXTE_INVERSE = "#fffcf7";

const POLICES = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export default function ErreurGlobale({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, backgroundColor: COULEUR_PAGE, fontFamily: POLICES }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              backgroundColor: COULEUR_SURFACE,
              border: `1px solid ${COULEUR_BORDURE}`,
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              color: COULEUR_TEXTE_PRIMAIRE,
            }}
          >
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>
              Une erreur est survenue
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.6, color: COULEUR_TEXTE_SECONDAIRE }}>
              Cette action n&apos;a pas pu être terminée. Vous pouvez réessayer.
            </p>

            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 20,
                fontSize: 13,
                fontWeight: 500,
                color: COULEUR_TEXTE_INVERSE,
                backgroundColor: COULEUR_ACTION,
                border: "none",
                borderRadius: 8,
                padding: "8px 14px",
                cursor: "pointer",
              }}
            >
              Réessayer
            </button>

            {error.digest && (
              <p style={{ margin: "16px 0 0", fontSize: 12, color: COULEUR_TEXTE_MUET }}>
                Référence technique : {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
