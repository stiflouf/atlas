import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { creerAcquereurAction } from "@/actions/creerAcquereur";
import AcquereurFormulaire from "@/components/client/AcquereurFormulaire";

export default function NouvelAcquereurPage() {
  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Clients
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mb-6">
        Ajouter un acquéreur
      </h1>

      <AcquereurFormulaire action={creerAcquereurAction} libelleSubmit="Créer l'acquéreur" />
    </div>
  );
}
