import Image from "next/image";
import type { TypeBien } from "@/types/bien";
import PropertyVisual from "@/components/ui/PropertyVisual";

type Format = "hero" | "card" | "thumb";

// Ratios/`sizes` dupliqués depuis PropertyVisual (jamais modifié, ADR-052) : ce composant est le
// SEUL point d'intégration entre la galerie photo réelle et le placeholder de marque, il ne doit
// jamais faire porter cette responsabilité à PropertyVisual lui-même (pas de photoUrl ajouté).
const RATIO_PAR_FORMAT: Record<Format, string> = {
  hero: "aspect-[2/1]",
  card: "aspect-[3/2]",
  thumb: "aspect-square",
};

const SIZES_PAR_FORMAT: Record<Format, string> = {
  hero: "(max-width: 768px) 100vw, 896px",
  card: "(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 360px",
  thumb: "80px",
};

// Contrat cible (ADR-052) : photo principale réelle si `photoPrincipaleId` est fourni, sinon
// PropertyVisual inchangé. `unoptimized` est obligatoire — l'Image Optimizer de Next.js 16.3.0 ne
// transmet jamais le cookie de session vers /api/photos-bien/[photoId] (route protégée), vérifié
// directement dans node_modules/next/dist/server/image-optimizer.js : le navigateur doit charger
// l'URL lui-même en same-origin pour que le cookie parte avec la requête.
export default function PhotoPrincipale({
  type,
  photoPrincipaleId,
  format = "card",
  scrim = false,
  arrondi = true,
  className = "",
}: {
  type: TypeBien;
  photoPrincipaleId?: string;
  format?: Format;
  /** Voile navy en pied d'image, identique à PropertyVisual — s'applique aussi bien à une vraie photo. */
  scrim?: boolean;
  arrondi?: boolean;
  className?: string;
}) {
  if (!photoPrincipaleId) {
    return <PropertyVisual type={type} format={format} scrim={scrim} arrondi={arrondi} className={className} />;
  }

  return (
    <div
      className={`relative overflow-hidden bg-navy ${arrondi ? "rounded-xl" : ""} ${RATIO_PAR_FORMAT[format]} ${className}`}
    >
      <Image
        src={`/api/photos-bien/${photoPrincipaleId}`}
        alt=""
        fill
        unoptimized
        sizes={SIZES_PAR_FORMAT[format]}
        className="object-cover"
      />
      {scrim && (
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-[#030a1c]/[0.82] via-[#030a1c]/[0.28] to-transparent"
        />
      )}
    </div>
  );
}
