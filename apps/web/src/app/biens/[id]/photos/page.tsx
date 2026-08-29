import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronUp, Images, Star, Trash2 } from "lucide-react";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import PhotosUploader from "@/components/bien/PhotosUploader";
import { getBienById } from "@/lib/bienRepository";
import { listerPhotosBien } from "@/lib/photoBienRepository";
import { deplacerPhotoBienAction, supprimerPhotoBienAction } from "@/actions/gererPhotosBien";
import { NOMBRE_MAX_PHOTOS_PAR_BIEN } from "@/types/photoBien";

// Même rationale que biens/page.tsx (ADR-048) : une requête Postgres seule n'empêche pas la
// génération statique.
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function PhotosBienPage({ params }: PageProps) {
  const { id } = await params;
  const bien = await getBienById(id);
  if (!bien) notFound();

  const photos = await listerPhotosBien(id);
  const placesRestantes = NOMBRE_MAX_PHOTOS_PAR_BIEN - photos.length;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      <Link
        href={`/biens/${id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {bien.titre}
      </Link>

      <div className="mb-6 flex items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-champagne">Photos</p>
          <h1 className="text-[28px] md:text-[34px] font-semibold text-text-1 leading-[1.05] mt-1.5">
            Gérer les photos
          </h1>
          <p className="text-[13px] text-text-3 mt-1.5">
            {photos.length} / {NOMBRE_MAX_PHOTOS_PAR_BIEN} photos
          </p>
        </div>
      </div>

      <PhotosUploader bienId={id} placesRestantes={placesRestantes} />

      {photos.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Images}
            titre="Aucune photo pour ce bien"
            message="Ajoutez des photos pour remplacer le visuel DOMIORA générique dans le portefeuille et sur la fiche."
          />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map((photo, index) => (
            <Card key={photo.id} className="overflow-hidden flex flex-col">
              <div className="relative aspect-[4/3] bg-navy">
                {/* unoptimized : l'Image Optimizer de Next ne transmet jamais le cookie de session
                    vers une route protégée (vérifié dans le code de next@16.3.0, ADR-052 §19) — le
                    navigateur charge directement cette URL en same-origin, cookie inclus. */}
                <Image
                  src={`/api/photos-bien/${photo.id}`}
                  alt=""
                  fill
                  unoptimized
                  sizes="(max-width: 768px) 50vw, 25vw"
                  className="object-cover"
                />
                {index === 0 && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#030a1c]/[0.74] px-2 py-0.5 text-[10px] font-medium text-white">
                    <Star size={10} />
                    Principale
                  </span>
                )}
              </div>
              <div className="p-2.5 flex items-center justify-between gap-1">
                <div className="flex items-center gap-1">
                  <form action={deplacerPhotoBienAction}>
                    <input type="hidden" name="bienId" value={id} />
                    <input type="hidden" name="photoId" value={photo.id} />
                    <input type="hidden" name="direction" value="monter" />
                    <button
                      type="submit"
                      disabled={index === 0}
                      className="p-1.5 rounded-md text-text-2 hover:bg-surface-muted disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Monter"
                    >
                      <ChevronUp size={14} />
                    </button>
                  </form>
                  <form action={deplacerPhotoBienAction}>
                    <input type="hidden" name="bienId" value={id} />
                    <input type="hidden" name="photoId" value={photo.id} />
                    <input type="hidden" name="direction" value="descendre" />
                    <button
                      type="submit"
                      disabled={index === photos.length - 1}
                      className="p-1.5 rounded-md text-text-2 hover:bg-surface-muted disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Descendre"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </form>
                  {index !== 0 && (
                    <form action={deplacerPhotoBienAction}>
                      <input type="hidden" name="bienId" value={id} />
                      <input type="hidden" name="photoId" value={photo.id} />
                      <input type="hidden" name="direction" value="principale" />
                      <button
                        type="submit"
                        className="p-1.5 rounded-md text-text-2 hover:bg-surface-muted"
                        aria-label="Définir comme principale"
                      >
                        <Star size={14} />
                      </button>
                    </form>
                  )}
                </div>
                <form action={supprimerPhotoBienAction}>
                  <input type="hidden" name="bienId" value={id} />
                  <input type="hidden" name="photoId" value={photo.id} />
                  <button
                    type="submit"
                    className="p-1.5 rounded-md text-danger hover:bg-danger-light"
                    aria-label="Supprimer"
                  >
                    <Trash2 size={14} />
                  </button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
