import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { modifierAcquereurAction } from "@/actions/modifierAcquereur";
import AcquereurFormulaire from "@/components/client/AcquereurFormulaire";
import { getAcquereurDuWorkspace } from "@/lib/clientRepository";
import { nomComplet } from "@/lib/identite/nomPersonne";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageProps = { params: Promise<{ id: string }> };

// Réservé aux acquéreurs réels — un acquéreur mocké (id non-UUID) n'a aucune ligne à modifier en
// base.
export default async function ModifierAcquereurPage({ params }: PageProps) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  // WORKSPACE_SCOPING_V2C1 — ROOT-FIRST : périmètre d'abord, racine scopée ensuite. Cette page
  // préremplissait le formulaire avec l'identité complète d'un acquéreur d'un autre workspace
  // (nom, coordonnées, budget, critères) ; la mutation, elle, était déjà gardée depuis V2.
  const workspaceId = await exigerWorkspaceCourant();
  const acquereur = await getAcquereurDuWorkspace(id, workspaceId);
  if (!acquereur) notFound();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={`/clients/${acquereur.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {nomComplet(acquereur)}
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
