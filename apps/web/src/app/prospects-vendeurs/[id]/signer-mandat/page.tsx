import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getProspectVendeurById } from "@/lib/prospectVendeurRepository";
import { deriverStatutProspectVendeur } from "@/types/prospectVendeur";
import { signerMandatProspectVendeurAction } from "@/actions/prospectVendeur";
import ProspectVendeurConversionFormulaire from "@/components/prospectVendeur/ProspectVendeurConversionFormulaire";

type PageProps = { params: Promise<{ id: string }> };

export default async function SignerMandatPage({ params }: PageProps) {
  const { id } = await params;
  const prospect = await getProspectVendeurById(id);
  if (!prospect) notFound();

  const statut = deriverStatutProspectVendeur(prospect);
  if (statut === "perdu" || statut === "mandat_signe") notFound();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={`/prospects-vendeurs/${prospect.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {prospect.prenom ? `${prospect.prenom} ` : ""}
        {prospect.nom}
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mb-2">
        Signer le mandat
      </h1>
      <p className="text-[13px] text-text-2 mb-6">
        Crée le bien correspondant et clôt ce prospect vendeur comme converti. Cette action est
        définitive.
      </p>

      <ProspectVendeurConversionFormulaire prospect={prospect} action={signerMandatProspectVendeurAction} />
    </div>
  );
}
