// Placeholder visuel premium pour un Bien sans photo (passe enrichissement visuel) — jamais une
// icône isolée dans un carré : une vraie composition architecturale générative (SVG inline, aucun
// asset distant/téléchargé). Décoratif et générique par construction, ne représente jamais un Bien
// précis — ne doit jamais être confondu avec une vraie photo (voir consigne produit).
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
        {/* Silhouette architecturale — hauteurs/largeurs volontairement irrégulières, jamais un
            bâtiment identifiable. */}
        <g fill="#c59a5b" fillOpacity="0.16">
          <rect x="-10" y="58" width="34" height="42" />
          <rect x="22" y="40" width="24" height="60" />
          <rect x="48" y="64" width="20" height="36" />
          <rect x="70" y="30" width="28" height="70" />
          <rect x="140" y="50" width="26" height="50" />
          <rect x="168" y="36" width="22" height="64" />
        </g>
        <g fill="#c59a5b" fillOpacity="0.28">
          <rect x="98" y="20" width="30" height="80" />
        </g>
        {/* Lignes d'étage discrètes sur le bâtiment principal */}
        <g stroke="#f6f2ea" strokeOpacity="0.14" strokeWidth="0.6">
          <line x1="98" y1="32" x2="128" y2="32" />
          <line x1="98" y1="44" x2="128" y2="44" />
          <line x1="98" y1="56" x2="128" y2="56" />
          <line x1="98" y1="68" x2="128" y2="68" />
          <line x1="98" y1="80" x2="128" y2="80" />
        </g>
        <line x1="0" y1="100" x2="200" y2="100" stroke="#c59a5b" strokeOpacity="0.35" strokeWidth="1" />
      </svg>
    </div>
  );
}
