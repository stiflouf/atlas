import NavItems from "./NavItems";
import BrandMark from "./BrandMark";

// Structure inchangée (marque / navigation / conseiller) — seul le langage visuel change : fond
// navy profond sur toute la hauteur (direction artistique premium), navigation claire dessus.
export default function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col w-[220px] shrink-0 h-full bg-navy">
      <div className="px-5 py-6 border-b border-white/10">
        <BrandMark surNavy avecBaseline taille="lg" />
      </div>

      {/* min-h-0 : sans ça un flex item ne peut jamais descendre sous la hauteur de son contenu
          (min-height:auto par défaut), et le contenu de la nav pousserait alors le bloc photo et
          le bloc conseiller hors du viewport sur les hauteurs d'écran réduites au lieu de
          laisser le scroll interne absorber l'excédent. overflow-y-auto : filet de sécurité,
          n'apparaît en pratique jamais aux hauteurs ciblées (voir zone photo ci-dessous). */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
        <NavItems variant="sidebar" />
      </div>

      {/* Zone photographique de marque — tiers inférieur, bord à bord (jamais une card collée),
          fondue dans le navy environnant. Hauteur en `vh` bornée par un clamp, PAS un
          `calc(100vh - Npx)` : ce calcul exigeait par construction la hauteur du contenu de la
          nav NON scrollée (header ~89px + 7 items de nav ~392px + bloc conseiller ~81px, mesurés
          sur le layout réel ci-dessous) avant d'accorder le moindre pixel à la photo — la
          faisant disparaître dès qu'un viewport de navigateur réel (chrome inclus) descend sous
          ~594px de haut, alors que la nav porte déjà `flex-1 min-h-0 overflow-y-auto` précisément
          pour absorber ce cas par un scroll interne. Le minimum (140px / 150px lg) reste
          délibérément au-dessus des deux fondus haut/bas (`h-14`+`h-10` = 96px) qui se
          chevaucheraient sinon ; le maximum (256px / 288px lg, inchangé) plafonne sur les très
          grands écrans. Priorité UX : logo > nav (scrollable si nécessaire) > photo (toujours
          visible, taille minimale garantie) > bloc conseiller.
          Placeholder généré (SVG) en couche de base, TOUJOURS présent ; la photo de marque
          (public/brand/sidebar-night-house.webp) est superposée en `background-image` CSS — tant
          que le fichier n'existe pas, un `background-image` échoue silencieusement (aucune icône
          cassée, contrairement à une balise <img>) et le placeholder reste visible tel quel.
          Aucun JS nécessaire : l'image s'active automatiquement dès que le fichier est déposé. */}
      <div className="hidden md:block relative h-[clamp(140px,22vh,256px)] lg:h-[clamp(150px,22vh,288px)] overflow-hidden shrink-0">
        <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="sbv-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0B2440" />
              <stop offset="100%" stopColor="#02152B" />
            </linearGradient>
          </defs>
          <rect width="200" height="200" fill="url(#sbv-bg)" />
          <g fill="#c59a5b" fillOpacity="0.18">
            <rect x="-10" y="130" width="40" height="70" />
            <rect x="26" y="96" width="30" height="104" />
            <rect x="150" y="118" width="32" height="82" />
            <rect x="178" y="90" width="30" height="110" />
          </g>
          <g fill="#c59a5b" fillOpacity="0.3">
            <rect x="60" y="60" width="36" height="140" />
          </g>
        </svg>
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(/brand/sidebar-night-house.webp)" }}
        />
        {/* Assombrissement léger + fondu vers le navy en haut et en bas — l'image doit sembler
            faire partie de la sidebar, pas une card posée dessus. */}
        <div className="absolute inset-0 bg-navy/20" />
        <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-navy to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-navy to-transparent" />
      </div>

      {/* Conseiller — carte minimale (avatar/initiale, jamais une photo inventée). */}
      <div className="px-3 py-4 border-t border-white/10">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
          <span className="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-full bg-champagne text-[13px] font-semibold text-navy">
            SG
          </span>
          <p className="text-[13px] text-text-inverse/90 truncate">Steven Gausset</p>
        </div>
      </div>
    </aside>
  );
}
