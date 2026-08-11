import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { modifierBienAction } from "@/actions/modifierBien";
import BienFormulaire from "@/components/bien/BienFormulaire";
import { getBienById } from "@/lib/bienRepository";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageProps = { params: Promise<{ id: string }> };

// Réservé aux biens réels — un bien mocké (id non-UUID) n'a aucune ligne à modifier en base.
export default async function ModifierBienPage({ params }: PageProps) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const bien = await getBienById(id);
  if (!bien) notFound();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={`/biens/${bien.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {bien.titre}
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-6">
        Modifier le bien
      </h1>

      <BienFormulaire bien={bien} action={modifierBienAction} libelleSubmit="Enregistrer les modifications" />
    </div>
  );
}
