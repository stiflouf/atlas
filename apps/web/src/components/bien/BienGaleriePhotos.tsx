import Link from "next/link";
import Image from "next/image";
import { Camera, Star } from "lucide-react";

// Filmstrip de la galerie réelle (design validé Claude Design, artifact ec9f41b8) — rendu par
// page.tsx uniquement quand le bien a plus d'une photo (0 ou 1 photo : aucun filmstrip, jamais un
// faux état de galerie). `photoIds` est déjà dans l'ordre déterministe ADR-052 (ordre ASC, cree_le
// ASC, id ASC — voir listerPhotosBien), jamais retrié ici. Aucune lightbox dans ce chantier (hors
// périmètre) : chaque vignette et la tuile finale renvoient simplement vers la page de gestion des
// photos déjà fonctionnelle, un seul comportement de clic, cohérent avec "Gérer les photos" dans le
// hero.
export default function BienGaleriePhotos({ bienId, photoIds }: { bienId: string; photoIds: string[] }) {
  const hrefGestion = `/biens/${bienId}/photos`;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {photoIds.map((id, index) => (
        <Link key={id} href={hrefGestion} className="relative w-28 h-20 rounded-lg overflow-hidden shrink-0 bg-ink-900">
          {/* unoptimized : l'Image Optimizer de Next ne transmet jamais le cookie de session vers
              une route protégée (ADR-052 §19, même contrainte que PhotoPrincipale et la page de
              gestion des photos) — le navigateur charge directement cette URL en same-origin,
              cookie inclus. */}
          <Image src={`/api/photos-bien/${id}`} alt="" fill unoptimized sizes="112px" className="object-cover" />
          {index === 0 && (
            <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-[#030a1c]/[0.74] px-1.5 py-0.5 text-[10px] font-medium text-white">
              <Star size={10} />
              Principale
            </span>
          )}
        </Link>
      ))}
      <Link
        href={hrefGestion}
        className="flex flex-col items-center justify-center gap-1 w-28 h-20 rounded-lg shrink-0 bg-champagne-light text-navy hover:bg-champagne-light/80 transition-colors"
      >
        <Camera size={16} />
        <span className="text-[11px] font-medium">Gérer les photos</span>
      </Link>
    </div>
  );
}
