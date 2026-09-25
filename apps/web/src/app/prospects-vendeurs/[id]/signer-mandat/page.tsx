import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getProspectVendeurDuWorkspace } from "@/lib/prospectVendeurRepository";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { deriverStatutProspectVendeur } from "@/types/prospectVendeur";
import { signerMandatProspectVendeurAction } from "@/actions/prospectVendeur";
import ProspectVendeurConversionFormulaire from "@/components/prospectVendeur/ProspectVendeurConversionFormulaire";

type PageProps = { params: Promise<{ id: string }> };

export default async function SignerMandatPage({ params }: PageProps) {
  const { id } = await params;
  // WORKSPACE_SCOPING_V2C1 — ROOT-FIRST, et ici l'ORDRE fait tout : la condition métier ci-dessous
  // ne doit jamais être évaluée sur un prospect qu'on n'a pas prouvé appartenir au workspace.
  // Sinon le statut devient un ORACLE : « perdu »/« mandat signé » renvoie notFound, tout autre
  // état affiche le formulaire — deux réponses distinctes qui révèlent l'état d'une donnée
  // étrangère, alors même que la page semblait refuser l'accès. Le refus de périmètre vient donc
  // AVANT, et rend exactement la même chose qu'un id inexistant.
  const workspaceId = await exigerWorkspaceCourant();
  const prospect = await getProspectVendeurDuWorkspace(id, workspaceId);
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
