import Image from "next/image";
import type { TypeBien } from "@/types/bien";

// Visuel d'un Bien — remplace BienVisualPlaceholder (composition SVG générative) par la famille
// photographique DOMIORA : blue hour, façade rasante, ouvertures dorées.
//
// Le placeholder est TOUJOURS signé « Visuel DOMIORA » : il ne doit jamais pouvoir être pris pour
// la photographie réelle du mandat.
//
// Aucune vraie photo n'est gérée ici : le type `Bien` ne porte aujourd'hui aucun champ photo, et
// l'architecture de cette capacité (plusieurs photos ? un ordre ? une photo principale ?) relève
// d'un cadrage métier séparé — pas d'une passe design. Aucun paramètre n'est donc exposé « en
// prévision » : l'API décrit exactement ce que le modèle sait fournir.

// Choix du visuel, exhaustif sur TypeBien. Pas de `default` : ajouter une valeur à l'enum casse la
// compilation ici, ce qui est voulu.
//
// `neutre` n'est pas une catégorie de bien — c'est l'absence assumée de visuel dédié. Représenter
// un local commercial par une façade d'habitation serait sémantiquement faux ; un panneau navy de
// marque ne prétend rien.
type Visuel = "maison" | "appartement" | "neutre";

const VISUEL_PAR_TYPE: Record<TypeBien, Visuel> = {
  maison: "maison",
  appartement: "appartement",
  // Fallback temporaire explicite : un studio et un loft sont des logements dans un ensemble
  // collectif, le cadrage « appartement » (balcons d'angle) n'est pas faux pour eux. À remplacer
  // par des assets dédiés dans la prochaine famille photographique.
  studio: "appartement",
  loft: "appartement",
  // Aucun asset dédié, et aucun asset d'habitation ne serait honnête ici.
  local_commercial: "neutre",
};

const PHOTO_PAR_VISUEL: Record<Exclude<Visuel, "neutre">, { src: string; libelle: string }> = {
  maison: { src: "/brand/bien-maison.webp", libelle: "Maison" },
  appartement: { src: "/brand/bien-appartement.webp", libelle: "Appartement" },
};

// Format d'affichage — pilote le ratio, le `sizes` de next/image et la forme du marqueur. Les
// trois formats correspondent aux trois emplacements réels : hero de fiche Bien, card de grille
// Liste Biens, vignette de ligne mobile.
type Format = "hero" | "card" | "thumb";

const CONFIG_FORMAT: Record<
  Format,
  { ratio: string; sizes: string; marqueur: "label" | "dot" | "aucun"; priority: boolean }
> = {
  // Seule image au-dessus de la ligne de flottaison sur la fiche → priority.
  hero: { ratio: "aspect-[2/1]", sizes: "(max-width: 768px) 100vw, 896px", marqueur: "label", priority: true },
  // 1 col mobile, 2 col md, 3 col lg dans un max-w-6xl → ~360px au plus large.
  card: {
    ratio: "aspect-[3/2]",
    sizes: "(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 360px",
    marqueur: "dot",
    priority: false,
  },
  // 80×80 fixe (w-20 h-20) : un libellé y serait illisible. L'aria-label le porte toujours.
  thumb: { ratio: "aspect-square", sizes: "80px", marqueur: "aucun", priority: false },
};

export default function PropertyVisual({
  type,
  format = "card",
  scrim = false,
  arrondi = true,
  className = "",
}: {
  type: TypeBien;
  format?: Format;
  /** Voile navy en pied d'image, pour poser du texte par-dessus (prix en card, titre en hero). */
  scrim?: boolean;
  /**
   * false pour un média plein-bord en haut d'une Card qui gère déjà son rounded-xl +
   * overflow-hidden — évite le double-arrondi qui laisse un liseré entre média et texte.
   */
  arrondi?: boolean;
  className?: string;
}) {
  const config = CONFIG_FORMAT[format];
  const visuel = VISUEL_PAR_TYPE[type];
  const photo = visuel === "neutre" ? null : PHOTO_PAR_VISUEL[visuel];

  return (
    <div
      className={`relative overflow-hidden bg-navy ${arrondi ? "rounded-xl" : ""} ${config.ratio} ${className}`}
      role="img"
      aria-label={
        photo
          ? `Visuel DOMIORA — ${photo.libelle}, aucune photo pour ce bien`
          : "Visuel DOMIORA — aucune photo pour ce bien"
      }
    >
      {photo ? (
        <>
          <Image src={photo.src} alt="" fill sizes={config.sizes} priority={config.priority} className="object-cover" />
          {/* Harmonisation sur le bleu nuit DOMIORA. Aplat volontaire : un mix-blend-mode
              forcerait une couche de compositing par instance, coûteux dès qu'une grille en
              affiche une dizaine. */}
          <span aria-hidden className="absolute inset-0 bg-navy/[0.17]" />
        </>
      ) : (
        // Panneau neutre : dégradé navy + filet champagne. Aucune architecture représentée, donc
        // aucune promesse visuelle fausse sur la nature du bien.
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-[#0b1f42] to-[#020817] after:absolute after:inset-x-0 after:bottom-1/3 after:h-px after:bg-champagne/25"
        />
      )}

      {scrim && (
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-[#030a1c]/[0.82] via-[#030a1c]/[0.28] to-transparent"
        />
      )}

      {config.marqueur === "label" && (
        <span
          aria-hidden
          className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-[#030a1c]/[0.74] py-[3px] pl-1.5 pr-2"
        >
          <span className="h-[5px] w-[5px] rounded-full bg-champagne" />
          <span className="text-[9px] font-medium uppercase tracking-[0.07em] text-white/[0.86]">Visuel DOMIORA</span>
        </span>
      )}

      {/* Card étroite : le libellé entrerait en collision avec le badge de statut et le prix. Un
          point champagne suffit à signaler le placeholder, l'infobulle porte le sens. */}
      {config.marqueur === "dot" && (
        <span
          aria-hidden
          title="Visuel DOMIORA — aucune photo pour ce bien"
          className="absolute bottom-2.5 right-2.5 h-[7px] w-[7px] rounded-full bg-champagne ring-[3px] ring-[#030a1c]/50"
        />
      )}
    </div>
  );
}
