// Placeholder visuel premium pour un Bien sans photo (passe convergence Domiora) — jamais une
// icône isolée dans un carré : une vraie composition architecturale générative (SVG inline, aucun
// asset distant/téléchargé). Décoratif et générique par construction, ne représente jamais un Bien
// précis — ne doit jamais être confondu avec une vraie photo (voir consigne produit).
//
// Composition volontairement architecturale (toits, fenêtres, végétation) plutôt qu'une simple
// suite de rectangles de hauteurs variables — trop proche d'un histogramme dans les premières
// versions.
//
// Structure prête pour une vraie photo future : le composant occupe déjà la place et le ratio
// attendus, un futur `src` remplacerait simplement le SVG sans toucher au layout des pages
// consommatrices (biens/page.tsx, biens/[id]/page.tsx).
type Ratio = "panoramic" | "thumb" | "square";

const RATIO_CLASS: Record<Ratio, string> = {
  panoramic: "aspect-[2/1]",
  thumb: "aspect-square",
  square: "aspect-square",
};

export default function BienVisualPlaceholder({
  ratio = "panoramic",
  className = "",
}: {
  ratio?: Ratio;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl ${RATIO_CLASS[ratio]} ${className}`}
      role="img"
      aria-label="Aucune photo — visuel de marque"
    >
      <svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="bvp-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0d244a" />
            <stop offset="100%" stopColor="#071a3a" />
          </linearGradient>
        </defs>
        <rect width="200" height="100" fill="url(#bvp-bg)" />

        {/* Halo discret — chaleur, jamais un effet spectaculaire. */}
        <circle cx="168" cy="18" r="26" fill="#c59a5b" fillOpacity="0.06" />

        {/* Bâtiment secondaire gauche — toit plat, léger acrotère. */}
        <g fill="#c59a5b" fillOpacity="0.14">
          <rect x="-10" y="56" width="36" height="44" />
          <rect x="-10" y="52" width="36" height="4" />
        </g>
        {/* Grille de fenêtres du bâtiment secondaire gauche */}
        <g fill="#f6f2ea" fillOpacity="0.1">
          <rect x="-2" y="64" width="6" height="8" />
          <rect x="10" y="64" width="6" height="8" />
          <rect x="-2" y="80" width="6" height="8" />
          <rect x="10" y="80" width="6" height="8" />
        </g>

        {/* Bâtiment principal — toit à redans (silhouette clairement architecturale, jamais une
            barre). */}
        <g fill="#c59a5b" fillOpacity="0.3">
          <polygon points="58,100 58,46 82,46 82,32 106,32 106,20 122,20 122,100" />
        </g>
        <g stroke="#071a3a" strokeOpacity="0.5" strokeWidth="1">
          <line x1="82" y1="46" x2="82" y2="32" />
          <line x1="106" y1="32" x2="106" y2="20" />
        </g>
        {/* Fenêtres en grille sur le bâtiment principal */}
        <g fill="#f6f2ea" fillOpacity="0.16">
          <rect x="62" y="52" width="6" height="8" />
          <rect x="72" y="52" width="6" height="8" />
          <rect x="62" y="68" width="6" height="8" />
          <rect x="72" y="68" width="6" height="8" />
          <rect x="62" y="84" width="6" height="8" />
          <rect x="72" y="84" width="6" height="8" />
          <rect x="92" y="38" width="6" height="8" />
          <rect x="92" y="54" width="6" height="8" />
          <rect x="92" y="70" width="6" height="8" />
          <rect x="92" y="86" width="6" height="8" />
          <rect x="112" y="26" width="6" height="8" />
          <rect x="112" y="42" width="6" height="8" />
          <rect x="112" y="58" width="6" height="8" />
          <rect x="112" y="74" width="6" height="8" />
        </g>

        {/* Maison à toit à deux pans — signature "architecture", jamais un histogramme. */}
        <g fill="#c59a5b" fillOpacity="0.22">
          <polygon points="140,100 140,66 154,52 168,66 168,100" />
        </g>
        <g fill="#f6f2ea" fillOpacity="0.18">
          <rect x="146" y="78" width="7" height="9" />
          <rect x="157" y="78" width="7" height="9" />
        </g>
        <rect x="150" y="88" width="8" height="12" fill="#071a3a" fillOpacity="0.3" />

        {/* Végétation discrète au sol — quelques masses arrondies, jamais détaillées. */}
        <g fill="#3a6b4f" fillOpacity="0.18">
          <circle cx="132" cy="96" r="7" />
          <circle cx="178" cy="94" r="9" />
          <circle cx="188" cy="97" r="6" />
        </g>

        <line x1="0" y1="100" x2="200" y2="100" stroke="#c59a5b" strokeOpacity="0.35" strokeWidth="1" />
      </svg>
    </div>
  );
}
