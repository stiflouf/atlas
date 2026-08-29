import Link from "next/link";
import { Camera, Images } from "lucide-react";
import Badge from "@/components/ui/Badge";
import PhotoPrincipale from "@/components/bien/PhotoPrincipale";
import type { Bien } from "@/types/bien";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

const LABEL_TYPE_BIEN: Record<Bien["type"], string> = {
  appartement: "Appartement",
  maison: "Maison",
  studio: "Studio",
  loft: "Loft",
  local_commercial: "Local commercial",
};

// Hero de la Fiche Bien (design validé Claude Design, artifact 7615625f) — reprend le langage
// visuel déjà validé sur la Liste Biens (photo + statut/prix en overlay sur scrim navy, ADR-052 §14
// pour photoPrincipaleId) à l'échelle d'une fiche complète. Le scrim et le fallback sans photo
// restent intégralement délégués à PhotoPrincipale/PropertyVisual — ce composant ne fait jamais de
// lecture directe du stockage ni de seconde logique de galerie.
export default function BienHero({
  bien,
  photoPrincipaleId,
  nombrePhotos,
  statutCommercialLabel,
  statutCommercialVariant,
}: {
  bien: Bien;
  photoPrincipaleId?: string;
  nombrePhotos: number;
  statutCommercialLabel: string;
  statutCommercialVariant: "default" | "accent" | "success";
}) {
  const bienReel = UUID_REGEX.test(bien.id);
  // Signal direct "y a-t-il une vraie photo principale ?" — même source que PhotoPrincipale
  // ci-dessous (jamais nombrePhotos, qui ne sert qu'au compteur de galerie). Pilote uniquement le
  // libellé et la position du CTA ci-dessous, jamais une seconde logique de fallback (ADR-052).
  const aPhoto = Boolean(photoPrincipaleId);

  return (
    <div className="relative w-full h-56 md:h-[280px]">
      <PhotoPrincipale type={bien.type} photoPrincipaleId={photoPrincipaleId} format="hero" scrim className="w-full h-full" />

      <div className="absolute left-3 top-3">
        <Badge variant={statutCommercialVariant}>{statutCommercialLabel}</Badge>
      </div>

      {bienReel && (
        <Link
          href={`/biens/${bien.id}/photos`}
          // Décalé vers le bas quand il n'y a aucune photo (top-11 au lieu de top-3) : sans photo,
          // PropertyVisual affiche son propre repère "Visuel DOMIORA" au même coin (right-2 top-2,
          // voir PropertyVisual.tsx) — sans ce décalage les deux se superposent et le repère devient
          // illisible, exactement l'ambiguïté "photo réelle ?" que ce repère doit lever.
          className={`absolute right-3 ${aPhoto ? "top-3" : "top-11"} inline-flex items-center gap-1.5 rounded-full bg-white/[0.16] backdrop-blur-sm border border-white/35 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-white/[0.26] transition-colors`}
        >
          <Camera size={14} />
          {aPhoto ? "Gérer les photos" : "Ajouter des photos"}
        </Link>
      )}

      {photoPrincipaleId && nombrePhotos > 1 && (
        <Link
          href={`/biens/${bien.id}/photos`}
          className="absolute right-3 bottom-14 md:bottom-16 inline-flex items-center gap-1.5 rounded-full bg-[#030a1c]/45 border border-white/30 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#030a1c]/65 transition-colors"
        >
          <Images size={13} />
          {nombrePhotos} photos
        </Link>
      )}

      <div className="absolute left-0 right-0 bottom-0 px-4 py-3.5 md:px-6 md:py-4">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] text-white/70 mb-0.5 truncate">
              Réf. {bien.reference} · {LABEL_TYPE_BIEN[bien.type]}
              {bien.pieces ? ` · ${bien.pieces} pièce${bien.pieces > 1 ? "s" : ""}` : ""}
            </p>
            <h1 className="font-serif text-[19px] md:text-[26px] leading-tight text-white font-semibold truncate">
              {bien.adresse}, {bien.codePostal} {bien.ville}
            </h1>
          </div>
          <p className="text-[19px] md:text-[26px] leading-tight text-white font-semibold shrink-0 tabular-nums">
            {formatPrix(bien.prix)}
          </p>
        </div>
      </div>
    </div>
  );
}
