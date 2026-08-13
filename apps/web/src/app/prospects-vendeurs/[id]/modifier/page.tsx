import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { modifierProspectVendeurAction } from "@/actions/prospectVendeur";
import ProspectVendeurFormulaire from "@/components/prospectVendeur/ProspectVendeurFormulaire";
import { getProspectVendeurById } from "@/lib/prospectVendeurRepository";

type PageProps = { params: Promise<{ id: string }> };

export default async function ModifierProspectVendeurPage({ params }: PageProps) {
  const { id } = await params;
  const prospect = await getProspectVendeurById(id);
  if (!prospect) notFound();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={`/prospects-vendeurs/${prospect.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {prospect.prenom ? `${prospect.prenom} ` : ""}
        {prospect.nom}
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-6">
        Modifier le prospect vendeur
      </h1>

      <ProspectVendeurFormulaire
        prospect={prospect}
        action={modifierProspectVendeurAction}
        libelleSubmit="Enregistrer les modifications"
      />
    </div>
  );
}
