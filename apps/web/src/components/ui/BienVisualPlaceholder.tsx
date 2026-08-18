// Placeholder visuel premium pour un Bien sans photo (chantier fidélité visuelle Domiora) —
// jamais une icône isolée dans un carré : une composition générative (SVG inline, aucun asset
// distant/téléchargé) pensée comme une photo éditoriale de nuit — une façade unique dominante avec
// des fenêtres allumées, jamais une silhouette abstraite façon histogramme/dataviz. Décoratif et
// générique par construction, ne représente jamais un Bien précis — ne doit jamais être confondu
// avec une vraie photo (voir consigne produit).
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

// Fenêtres allumées déterministes (aucun Math.random — même rendu serveur/client, aucune
// hydration mismatch) : positions fixes et volontairement éparses sur la façade, pensées pour
// évoquer quelques pièces habitées au blue hour. Seules les fenêtres allumées sont dessinées —
// aucun pavage régulier en arrière-plan, pour ne jamais retomber sur un effet damier/histogramme.
const FENETRES_ALLUMEES = [
  { x: 34, y: 28 }, { x: 34, y: 52 },
  { x: 58, y: 40 }, { x: 58, y: 64 },
  { x: 82, y: 28 }, { x: 82, y: 76 },
  { x: 106, y: 52 },
  { x: 130, y: 28 }, { x: 130, y: 64 },
];

export default function BienVisualPlaceholder({
  ratio = "panoramic",
  arrondi = true,
  className = "",
}: {
  ratio?: Ratio;
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
        <defs>
          <linearGradient id="bvp-ciel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#050f28" />
            <stop offset="55%" stopColor="#0d244a" />
            <stop offset="100%" stopColor="#16345f" />
          </linearGradient>
          <linearGradient id="bvp-facade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d244a" />
            <stop offset="100%" stopColor="#071a3a" />
          </linearGradient>
          <linearGradient id="bvp-sol" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#071a3a" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#071a3a" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect width="200" height="100" fill="url(#bvp-ciel)" />

        {/* Silhouettes secondaires, très estompées — profondeur, jamais le sujet principal. */}
        <g fill="#0d244a">
          <rect x="-10" y="58" width="26" height="42" />
          <rect x="172" y="50" width="20" height="50" />
          <rect x="188" y="62" width="22" height="38" />
        </g>

        {/* Façade principale — le vrai sujet de la composition. */}
        <rect x="24" y="18" width="118" height="82" fill="url(#bvp-facade)" />
        {/* Toit plat + léger acrotère, lecture "architecture contemporaine". */}
        <rect x="20" y="14" width="126" height="5" fill="#071a3a" />

        {/* Quelques fenêtres allumées, éparses — jamais une grille complète. */}
        <g fill="#f2e6d0" fillOpacity="0.8">
          {FENETRES_ALLUMEES.map(({ x, y }) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="5" height="7" rx="0.5" />
          ))}
        </g>

        {/* Entrée / rez-de-chaussée — un accent champagne franc, seul point de lumière "chaud" au
            sol pour ancrer la composition. */}
        <rect x="70" y="86" width="20" height="14" fill="#c59a5b" fillOpacity="0.55" />

        {/* Végétation discrète — quelques masses arrondies au pied de la façade. */}
        <g fill="#3a6b4f" fillOpacity="0.4">
          <circle cx="16" cy="94" r="8" />
          <circle cx="150" cy="93" r="7" />
          <circle cx="160" cy="96" r="5" />
        </g>

        {/* Sol + reflet léger sous la façade. */}
        <rect x="0" y="96" width="200" height="4" fill="url(#bvp-sol)" />
        <line x1="0" y1="100" x2="200" y2="100" stroke="#c59a5b" strokeOpacity="0.3" strokeWidth="1" />
      </svg>
    </div>
  );
}
