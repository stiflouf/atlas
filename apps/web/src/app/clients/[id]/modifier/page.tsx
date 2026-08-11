import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { modifierAcquereurAction } from "@/actions/modifierAcquereur";
import AcquereurFormulaire from "@/components/client/AcquereurFormulaire";
import { getClientById } from "@/lib/clientRepository";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageProps = { params: Promise<{ id: string }> };

// Réservé aux acquéreurs réels — un acquéreur mocké (id non-UUID) n'a aucune ligne à modifier en
// base.
export default async function ModifierAcquereurPage({ params }: PageProps) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const acquereur = await getClientById(id);
  if (!acquereur) notFound();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={`/clients/${acquereur.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {acquereur.prenom} {acquereur.nom}
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-6">
        Modifier l'acquéreur
      </h1>

      <AcquereurFormulaire
        acquereur={acquereur}
        action={modifierAcquereurAction}
        libelleSubmit="Enregistrer les modifications"
      />
    </div>
  );
}
