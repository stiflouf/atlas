// Placeholder visuel premium pour un Bien sans photo (chantier fidélité visuelle Domiora) —
// jamais une icône isolée dans un carré : une composition générative (SVG inline, aucun asset
// distant/téléchargé) pensée comme un visuel éditorial d'architecture au blue hour — masses
// bâties étagées, fenêtres allumées éparses, bassin/reflet en pied de façade, végétation
// estompée. Décoratif et générique par construction, ne représente jamais un Bien précis — ne
// doit jamais être confondu avec une vraie photo (voir consigne produit).
//
// Structure prête pour une vraie photo future : le composant occupe déjà la place et le ratio
// attendus, un futur `src` remplacerait simplement le SVG sans toucher au layout des pages
// consommatrices (biens/page.tsx, biens/[id]/page.tsx).
//
// Deux variantes de composition (indépendantes du ratio du conteneur, contrôlé séparément par
// `ratio`) : `hero` détaille l'atmosphère (profondeur, reflet, glow) pour la grande zone de la
// fiche Bien ; `thumbnail` simplifie et durcit le contraste pour rester lisible en petit (grille
// Liste Biens, ligne mobile). Préfixes d'id distincts (bvp-h-/bvp-t-) : les deux compositions ne
// se chevauchent jamais actuellement sur une même page, mais des id dupliqués entre variantes
// casseraient silencieusement l'une des deux si ça changeait.
type Ratio = "panoramic" | "thumb" | "square";
type Variante = "hero" | "thumbnail";

const RATIO_CLASS: Record<Ratio, string> = {
  panoramic: "aspect-[2/1]",
  thumb: "aspect-square",
  square: "aspect-square",
};

// Fenêtres allumées déterministes (aucun Math.random — même rendu serveur/client, aucune
// hydration mismatch) : positions fixes et volontairement éparses, pensées pour évoquer
// quelques pièces habitées au blue hour. Seules les fenêtres allumées sont dessinées — aucun
// pavage régulier, pour ne jamais retomber sur un effet damier/histogramme.
const FENETRES_HERO_ETAGE = [
  { x: 54, y: 30 }, { x: 86, y: 30 }, { x: 118, y: 30 },
];
const FENETRES_HERO_BASE = [
  { x: 36, y: 56 }, { x: 36, y: 76 },
  { x: 62, y: 66 },
  { x: 96, y: 56 }, { x: 96, y: 80 },
  { x: 132, y: 66 }, { x: 132, y: 84 },
  { x: 156, y: 58 },
];
const FENETRES_THUMBNAIL = [
  { x: 40, y: 42 }, { x: 40, y: 66 },
  { x: 70, y: 54 },
  { x: 104, y: 42 }, { x: 104, y: 70 },
  { x: 134, y: 54 },
];

function CompositionHero() {
  return (
    <>
      <defs>
        <linearGradient id="bvp-h-ciel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#030a1c" />
          <stop offset="48%" stopColor="#0d234a" />
          <stop offset="100%" stopColor="#264a72" />
        </linearGradient>
        <radialGradient id="bvp-h-horizon" cx="50%" cy="100%" r="75%">
          <stop offset="0%" stopColor="#c59a5b" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#c59a5b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bvp-h-facade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#16345f" />
          <stop offset="100%" stopColor="#071a3a" />
        </linearGradient>
        <linearGradient id="bvp-h-facade-haute" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1c3f6e" />
          <stop offset="100%" stopColor="#0d244a" />
        </linearGradient>
        <linearGradient id="bvp-h-sol" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#071a3a" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#071a3a" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="bvp-h-vignette" cx="50%" cy="42%" r="75%">
          <stop offset="55%" stopColor="#030a1c" stopOpacity="0" />
          <stop offset="100%" stopColor="#030a1c" stopOpacity="0.32" />
        </radialGradient>
        {/* Glow doux derrière les fenêtres/reflets — technique "duplicata flou + trait net" pour
            une lecture chaude/atmosphérique plutôt qu'un aplat plat façon icône. */}
        <filter id="bvp-h-flou" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>

      <rect width="200" height="100" fill="url(#bvp-h-ciel)" />
      <rect width="200" height="100" fill="url(#bvp-h-horizon)" />

      {/* Silhouettes secondaires, floutées et très estompées — profondeur atmosphérique, jamais
          le sujet principal. */}
      <g fill="#132c52" fillOpacity="0.45" filter="url(#bvp-h-flou)">
        <rect x="-12" y="52" width="30" height="48" />
        <rect x="176" y="42" width="22" height="58" />
        <rect x="192" y="56" width="20" height="44" />
      </g>

      {/* Masse principale étagée — volume bas + cantilever en retrait, lecture "architecture
          contemporaine à degrés" plutôt qu'un unique rectangle plat. */}
      <rect x="26" y="44" width="148" height="54" fill="url(#bvp-h-facade)" />
      <rect x="46" y="24" width="96" height="24" fill="url(#bvp-h-facade-haute)" />
      <rect x="150" y="14" width="10" height="58" fill="#0a2044" />
      <line x1="44" y1="48.5" x2="144" y2="48.5" stroke="#c59a5b" strokeOpacity="0.4" strokeWidth="0.6" />
      <rect x="20" y="40" width="128" height="4" fill="#071a3a" />

      {/* Fenêtres allumées — glow flouté puis trait net superposé. */}
      <g filter="url(#bvp-h-flou)">
        {[...FENETRES_HERO_ETAGE, ...FENETRES_HERO_BASE].map(({ x, y }) => (
          <rect key={`glow-${x}-${y}`} x={x - 1} y={y - 1} width="7" height="9" fill="#f2e6d0" fillOpacity="0.5" />
        ))}
      </g>
      <g fill="#f7ecd8" fillOpacity="0.9">
        {FENETRES_HERO_ETAGE.map(({ x, y }) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="5" height="7" rx="0.5" />
        ))}
        {FENETRES_HERO_BASE.map(({ x, y }) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="5" height="7" rx="0.5" />
        ))}
        {/* Un pan vitré plus large au rez-de-chaussée — variété d'échelle, jamais uniquement de
            petites fenêtres carrées identiques. */}
        <rect x="70" y="82" width="16" height="8" rx="0.5" fillOpacity="0.7" />
      </g>

      {/* Entrée — accent champagne franc, seul point de lumière "chaud" au sol. */}
      <rect x="112" y="86" width="14" height="12" fill="#c59a5b" fillOpacity="0.55" />

      {/* Végétation — masses estompées superposées (plusieurs ellipses à opacités différentes),
          jamais un simple cercle plat. */}
      <g filter="url(#bvp-h-flou)">
        <ellipse cx="14" cy="88" rx="16" ry="11" fill="#2c4f3c" fillOpacity="0.4" />
        <ellipse cx="24" cy="92" rx="10" ry="7" fill="#2c4f3c" fillOpacity="0.35" />
        <ellipse cx="182" cy="86" rx="14" ry="10" fill="#2c4f3c" fillOpacity="0.38" />
      </g>

      {/* Bassin / reflet en pied de façade — reflets flous des fenêtres allumées, signature
          "photo immobilière au blue hour" plutôt qu'un simple aplat de sol. */}
      <rect x="0" y="90" width="200" height="10" fill="url(#bvp-h-sol)" />
      <g filter="url(#bvp-h-flou)" opacity="0.3">
        {[36, 62, 96, 132].map((x) => (
          <rect key={`reflet-${x}`} x={x} y="92" width="5" height="7" fill="#f2e6d0" />
        ))}
      </g>
      <line x1="0" y1="90" x2="200" y2="90" stroke="#c59a5b" strokeOpacity="0.28" strokeWidth="0.6" />

      <rect width="200" height="100" fill="url(#bvp-h-vignette)" />
    </>
  );
}

function CompositionThumbnail() {
  return (
    <>
      <defs>
        <linearGradient id="bvp-t-ciel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#030a1c" />
          <stop offset="60%" stopColor="#0d244a" />
          <stop offset="100%" stopColor="#1c3f6e" />
        </linearGradient>
        <linearGradient id="bvp-t-facade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#16345f" />
          <stop offset="100%" stopColor="#071a3a" />
        </linearGradient>
        <radialGradient id="bvp-t-vignette" cx="50%" cy="40%" r="72%">
          <stop offset="45%" stopColor="#030a1c" stopOpacity="0" />
          <stop offset="100%" stopColor="#030a1c" stopOpacity="0.4" />
        </radialGradient>
      </defs>

      <rect width="200" height="100" fill="url(#bvp-t-ciel)" />

      {/* Un seul volume dominant avec un simple décroché — contraste net plutôt qu'un flou
          atmosphérique, pour rester lisible à petite taille (grille/liste). */}
      <rect x="20" y="34" width="160" height="64" fill="url(#bvp-t-facade)" />
      <rect x="20" y="24" width="70" height="14" fill="#0d244a" />
      <line x1="20" y1="38" x2="180" y2="38" stroke="#c59a5b" strokeOpacity="0.45" strokeWidth="0.8" />

      <g fill="#f7ecd8" fillOpacity="0.95">
        {FENETRES_THUMBNAIL.map(({ x, y }) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="7" height="9" rx="0.5" />
        ))}
      </g>

      {/* Entrée — accent champagne franc. */}
      <rect x="94" y="84" width="18" height="14" fill="#c59a5b" fillOpacity="0.6" />

      <g fill="#2c4f3c" fillOpacity="0.4">
        <ellipse cx="12" cy="92" rx="14" ry="9" />
        <ellipse cx="188" cy="90" rx="12" ry="8" />
      </g>

      <rect x="0" y="96" width="200" height="4" fill="#071a3a" fillOpacity="0.6" />
      <line x1="0" y1="98" x2="200" y2="98" stroke="#c59a5b" strokeOpacity="0.3" strokeWidth="0.8" />

      <rect width="200" height="100" fill="url(#bvp-t-vignette)" />
    </>
  );
}

export default function BienVisualPlaceholder({
  ratio = "panoramic",
  variante = "thumbnail",
  arrondi = true,
  className = "",
}: {
  ratio?: Ratio;
  variante?: Variante;
  // false pour un usage "média plein-bord" en haut d'une Card qui gère déjà son propre
  // rounded-xl + overflow-hidden (ex. grille Liste Biens desktop) — évite un double-arrondi qui
  // laisserait un liseré visible entre le média et le contenu texte sous lui.
  arrondi?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden ${arrondi ? "rounded-xl" : ""} ${RATIO_CLASS[ratio]} ${className}`}
      role="img"
      aria-label="Aucune photo — visuel de marque"
    >
      <svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
        {variante === "hero" ? <CompositionHero /> : <CompositionThumbnail />}
      </svg>
    </div>
  );
}
