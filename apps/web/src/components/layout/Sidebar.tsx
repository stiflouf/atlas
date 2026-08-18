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
