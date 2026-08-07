import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import Badge from "@/components/ui/Badge";
import BienTabs from "@/components/bien/BienTabs";
import { getBienById } from "@/data/biens";

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

type PageProps = { params: Promise<{ id: string }> };

export default async function FicheBien({ params }: PageProps) {
  const { id } = await params;
  const bien = getBienById(id);
  if (!bien) notFound();

  const dateMandat = new Date(bien.dateMandat).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      {/* Retour */}
      <Link
        href="/biens"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Biens
      </Link>

      {/* En-tête du bien */}
      <div className="mb-8">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-[#eef2ff] flex items-center justify-center shrink-0 mt-0.5">
            <Building2 size={18} className="text-[#4338ca]" strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight">
              {bien.titre}
            </h1>
            <p className="text-[14px] text-[#64748b] mt-0.5">
              {bien.adresse}, {bien.codePostal} {bien.ville}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <span className="text-[20px] font-semibold text-[#0f172a]">{formatPrix(bien.prix)}</span>
          <span className="text-[14px] text-[#64748b]">{bien.surface} m²</span>
          <span className="text-[14px] text-[#94a3b8]">·</span>
          <span className="text-[14px] text-[#64748b]">{bien.pieces} pièces</span>
          <Badge variant="accent">{bien.reference}</Badge>
          <Badge variant="default">Mandat depuis le {dateMandat}</Badge>
        </div>
      </div>

      {/* Onglets */}
      <BienTabs bien={bien} />
    </div>
  );
}
