import NavItems from "./NavItems";
import BrandMark from "./BrandMark";

// Structure inchangée (marque / navigation / conseiller) — seul le langage visuel change : fond
// navy profond sur toute la hauteur (direction artistique premium), navigation claire dessus.
export default function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col w-[220px] shrink-0 h-full bg-navy">
      <div className="px-5 py-5 border-b border-white/10">
        <BrandMark surNavy />
      </div>

      <div className="flex-1 px-3 py-4">
        <NavItems variant="sidebar" />
      </div>

      {/* Zone visuelle de marque — décorative, générative (aucun asset distant). Masquée sous une
          hauteur d'écran réduite (laptop compact) pour ne jamais pousser le bloc conseiller hors
          champ. */}
      <div className="hidden md:block [@media(max-height:720px)]:!hidden mx-3 mb-3 rounded-lg overflow-hidden relative h-24">
        <svg viewBox="0 0 200 60" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="sbv-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#102a54" />
              <stop offset="100%" stopColor="#071a3a" />
            </linearGradient>
          </defs>
          <rect width="200" height="60" fill="url(#sbv-bg)" />
          <g fill="#c59a5b" fillOpacity="0.18">
            <rect x="-10" y="30" width="30" height="30" />
            <rect x="18" y="14" width="22" height="46" />
            <rect x="150" y="24" width="24" height="36" />
            <rect x="176" y="10" width="24" height="50" />
          </g>
          <g fill="#c59a5b" fillOpacity="0.3">
            <rect x="42" y="4" width="26" height="56" />
          </g>
        </svg>
      </div>

      {/* Conseiller — carte minimale (avatar/initiale, jamais une photo inventée). */}
      <div className="px-3 py-4 border-t border-white/10">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
          <span className="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-full bg-champagne text-[13px] font-semibold text-navy">
            SG
          </span>
          <p className="text-[13px] text-white/90 truncate">Steven Gausset</p>
        </div>
      </div>
    </aside>
  );
}
