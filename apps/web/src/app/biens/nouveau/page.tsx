import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { creerBienAction } from "@/actions/creerBien";
import BienFormulaire from "@/components/bien/BienFormulaire";

export default function NouveauBienPage() {
  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href="/biens"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Biens
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-6">
        Ajouter un bien
      </h1>

      <BienFormulaire action={creerBienAction} libelleSubmit="Créer le bien" />
    </div>
  );
}
