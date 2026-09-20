import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import ButtonLink from "@/components/ui/ButtonLink";
import { getVisiteById } from "@/lib/visiteRepository";
import { getClientById } from "@/lib/clientRepository";
import { getBonVisiteById, listerSignaturesPourBonVisite } from "@/lib/bonVisiteRepository";
import { annulerBrouillonBonVisiteAction } from "@/actions/bonVisite";
import BonVisiteSignatureForm from "@/components/visite/BonVisiteSignatureForm";
import { LABEL_STATUT_BON_VISITE } from "@/types/bonVisite";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

type PageProps = { params: Promise<{ id: string; bonId: string }> };

const VARIANT_BADGE_STATUT_BON = { brouillon: "accent", signe: "success", annule: "muted" } as const;

// §26 du brief VISIT_SIGNED_FORM_V1 — surface dédiée de signature, distincte de la fiche Visite
// (qui n'affiche que l'état courant du bon, §25). Entièrement dérivée de Postgres, jamais de Calendar.
const LIBELLE_ERREUR: Record<string, string> = {
  nom_signataire_manquant: "Le nom du signataire est obligatoire.",
  consentement_manquant: "Vous devez confirmer que vous signez volontairement ce bon.",
  absente: "Aucune signature n'a été détectée — veuillez signer dans le cadre prévu.",
  vide: "La signature semble vide — veuillez signer dans le cadre prévu.",
  format_invalide: "La signature n'a pas pu être lue — veuillez réessayer.",
  trop_grande: "La signature est trop volumineuse — veuillez réessayer un tracé plus simple.",
  introuvable: "Ce bon de visite est introuvable.",
  deja_signe: "Ce bon de visite a déjà été signé.",
  deja_annule: "Ce bon de visite a été annulé.",
  contact_introuvable: "Le contact sélectionné est introuvable.",
  contact_fusionne: "Le contact sélectionné a été fusionné avec un autre — veuillez le resélectionner.",
};

export default async function BonVisiteSignaturePage({ params, searchParams }: PageProps & { searchParams: Promise<{ erreur?: string }> }) {
  const { id, bonId } = await params;
  const { erreur } = await searchParams;
  const workspaceId = await exigerWorkspaceCourant();

  const visite = await getVisiteById(id, workspaceId);
  if (!visite) notFound();
  const bon = await getBonVisiteById(bonId, workspaceId);
  if (!bon || bon.visiteId !== visite.id) notFound();

  const acquereur = await getClientById(visite.acquereurId);
  const signatures = bon.statut === "signe" ? await listerSignaturesPourBonVisite(bon.id, workspaceId) : [];

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={`/visites/${visite.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Retour à la visite
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant={VARIANT_BADGE_STATUT_BON[bon.statut]}>{LABEL_STATUT_BON_VISITE[bon.statut]}</Badge>
          <span className="text-[13px] text-text-3">Version {bon.version}</span>
        </div>
        <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mt-2">Bon de visite</h1>
        <p className="text-[14px] text-text-2 mt-0.5">{bon.contenuSnapshot.bien.titre}</p>
      </div>

      {erreur && (
        <div className="mb-6 border border-status-danger/30 bg-status-danger-subtle rounded-lg px-3.5 py-2.5 text-[13px] text-status-danger">
          {LIBELLE_ERREUR[erreur] ?? "Une erreur est survenue."}
        </div>
      )}

      <Card className="p-4 mb-6">
        <p className="text-[13.5px] text-text-1 leading-relaxed whitespace-pre-wrap">{bon.contenuSnapshot.template.texte}</p>
      </Card>

      {bon.statut === "brouillon" && (
        <>
          <BonVisiteSignatureForm
            bonVisiteId={bon.id}
            visiteId={visite.id}
            prenomInitial={acquereur?.prenom}
            nomInitial={acquereur?.nom ?? ""}
            emailInitial={acquereur?.email}
          />
          <form action={annulerBrouillonBonVisiteAction} className="mt-4">
            <input type="hidden" name="id" value={bon.id} />
            <input type="hidden" name="visiteId" value={visite.id} />
            <button type="submit" className="text-[13px] text-text-2 hover:text-danger transition-colors">
              Annuler ce brouillon
            </button>
          </form>
        </>
      )}

      {bon.statut === "signe" && (
        <div className="flex flex-col gap-4">
          {signatures.map((signature) => (
            <div key={signature.id} className="text-[14px] text-text-1">
              Signé par {[signature.prenomSnapshot, signature.nomSnapshot].filter(Boolean).join(" ")} le{" "}
              {new Date(signature.signeLe).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}
            </div>
          ))}
          <ButtonLink href={`/api/bons-visite/${bon.id}/document`} variant="primary" size="md" className="self-start">
            Télécharger le document signé
          </ButtonLink>
        </div>
      )}

      {bon.statut === "annule" && <p className="text-[13px] text-text-3">Ce brouillon a été annulé.</p>}
    </div>
  );
}
