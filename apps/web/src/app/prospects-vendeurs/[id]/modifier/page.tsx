import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { modifierProspectVendeurAction } from "@/actions/prospectVendeur";
import ProspectVendeurFormulaire from "@/components/prospectVendeur/ProspectVendeurFormulaire";
import { getProspectVendeurDuWorkspace } from "@/lib/prospectVendeurRepository";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

type PageProps = { params: Promise<{ id: string }> };

export default async function ModifierProspectVendeurPage({ params }: PageProps) {
  const { id } = await params;
  // WORKSPACE_SCOPING_V2C1 — ROOT-FIRST. Cette page n'avait AUCUNE notion de workspace : elle
  // préremplissait le formulaire avec l'identité entière d'un prospect quelconque (nom, téléphone,
  // e-mail, adresse du bien potentiel, origine du lead). Les writers, eux, étaient déjà fermés par
  // V2A — seule la lecture fuyait.
  const workspaceId = await exigerWorkspaceCourant();
  const prospect = await getProspectVendeurDuWorkspace(id, workspaceId);
  if (!prospect) notFound();

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

      <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mb-6">
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
