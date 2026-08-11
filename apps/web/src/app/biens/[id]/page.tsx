import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import Badge from "@/components/ui/Badge";
import BienTabs from "@/components/bien/BienTabs";
import { getBienById } from "@/lib/bienRepository";
import { getDossierByBienId, type StatutDossier } from "@/data/dossier";
import { getActionsPourBien } from "@/lib/actionRepository";
import { listerNotesPourBien } from "@/lib/noteBienRepository";
import { listerComptesRendusPourBien } from "@/lib/compteRenduVisiteRepository";
import { actionPrioritaire, raisonAction } from "@/lib/actionPriority";
import { rendezVousDuJour } from "@/data/agenda";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

const statutConfig: Record<StatutDossier, { label: string; variant: "default" | "accent" | "success" }> = {
  en_commercialisation: { label: "En commercialisation", variant: "default" },
  offre_en_cours: { label: "Offre en cours", variant: "accent" },
  compromis_signe: { label: "Compromis signé", variant: "success" },
};

type PageProps = { params: Promise<{ id: string }> };

export default async function FicheBien({ params }: PageProps) {
  const { id } = await params;
  const bien = await getBienById(id);
  if (!bien) notFound();

  const dossier = getDossierByBienId(bien.id);
  const actions = await getActionsPourBien(bien.id);
  const notes = await listerNotesPourBien(bien.id);
  const comptesRendus = await listerComptesRendusPourBien(bien.id);
  const actionPrincipale = actionPrioritaire(actions);
  const prochaineVisite = rendezVousDuJour.find(
    (rdv) => rdv.bien?.id === bien.id && rdv.preparationDisponible
  );

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

        {/* État du dossier — visible immédiatement */}
        {dossier && (
          <div className="mt-4 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statutConfig[dossier.statut].variant}>
                {statutConfig[dossier.statut].label}
              </Badge>
              <span className="text-[12px] text-[#94a3b8]">
                Dernière activité le {formatDate(dossier.derniereActivite)}
              </span>
            </div>
            {actionPrincipale && (
              <p className="text-[14px] text-[#0f172a] leading-snug mt-2">{raisonAction(actionPrincipale)}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 mt-4">
          {prochaineVisite && (
            <Link
              href={`/visites/${prochaineVisite.id}/preparer`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
            >
              Préparer une visite →
            </Link>
          )}
          <Link
            href={`/actions/nouveau?bienId=${bien.id}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4338ca] bg-white border border-[#e2e8f0] hover:border-[#4338ca] transition-colors px-3.5 py-2 rounded-lg"
          >
            + Ajouter une action
          </Link>
          {UUID_REGEX.test(bien.id) && (
            <Link
              href={`/biens/${bien.id}/modifier`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4338ca] bg-white border border-[#e2e8f0] hover:border-[#4338ca] transition-colors px-3.5 py-2 rounded-lg"
            >
              Modifier
            </Link>
          )}
        </div>
      </div>

      {/* Onglets — Contexte, Actions et Notes sont toujours réels ; les autres n'apparaissent que
          si un dossier existe (voir BienTabs, aucun DossierBien artificiel fabriqué ici). */}
      <BienTabs bien={bien} dossier={dossier} actions={actions} notes={notes} comptesRendus={comptesRendus} />
    </div>
  );
}
