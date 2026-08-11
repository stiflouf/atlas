import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import type { RendezVous, TypeRdv } from "@/types/agenda";
import type { StatutRendezVous } from "@/lib/rendezVous";
import type { ContexteRendezVous, TypeMetierRdv } from "@/types/contexteRendezVous";
import { SEUIL_AMBIGU, SEUIL_FORT } from "@/lib/matching/resoudre";
import { getClientById } from "@/lib/clientRepository";
import { getBienById } from "@/lib/bienRepository";
import ConfirmationBienRdv from "./ConfirmationBienRdv";

type BadgeConfig = { label: string; variant: "accent" | "default" | "muted" | "success" };

const typeConfig: Record<TypeRdv, BadgeConfig> = {
  visite: { label: "Visite", variant: "accent" },
  estimation: { label: "Estimation", variant: "default" },
  appel: { label: "Appel", variant: "muted" },
  signature: { label: "Signature", variant: "success" },
  reunion: { label: "Réunion", variant: "muted" },
  evenement: { label: "Événement", variant: "muted" },
};

// Type métier déduit par Atlas (lib/matching/matchType.ts) — utilisé uniquement pour les RDV
// Google encore génériques ("evenement"), jamais pour remplacer un type déjà connu du calendrier.
const typeMetierConfig: Partial<Record<TypeMetierRdv, BadgeConfig>> = {
  visite: { label: "Visite", variant: "accent" },
  estimation: { label: "Estimation", variant: "default" },
  appel: { label: "Appel", variant: "muted" },
  signature: { label: "Signature", variant: "success" },
  prospection: { label: "Prospection", variant: "muted" },
};

function labelCourtBien(titre: string): string {
  return titre.split(" — ")[0] ?? titre;
}

export default async function AgendaCard({
  rdv,
  statut,
  contexte,
  dateLabel,
}: {
  rdv: RendezVous;
  statut: StatutRendezVous;
  contexte?: ContexteRendezVous;
  dateLabel?: string;
}) {
  // Google ne fournit qu'un type générique : si Atlas a déduit un type métier probable du
  // contexte (titre), on l'affiche à la place — sans jamais modifier `rdv.type` lui-même.
  const typeDeduit =
    rdv.type === "evenement" && contexte?.typeMetier && contexte.typeMetier.confidence > 0
      ? typeMetierConfig[contexte.typeMetier.type]
      : undefined;
  const { label, variant } = typeDeduit ?? typeConfig[rdv.type];
  const client = rdv.client ? await getClientById(rdv.client.id) : undefined;
  const callHref = client ? `tel:${client.telephone.replace(/\s+/g, "")}` : undefined;

  // Le contexte n'est exploité que s'il dépasse le seuil "ambigu" au global : en dessous,
  // Atlas n'a rien d'assez solide à proposer et se comporte comme avant ce sprint.
  const contexteExploitable = Boolean(contexte && contexte.overallConfidence >= SEUIL_AMBIGU);
  const bienConfiant =
    contexteExploitable && contexte?.bien && contexte.bien.confidence >= SEUIL_FORT ? contexte.bien : undefined;
  const clientConfiant =
    contexteExploitable && contexte?.client && contexte.client.confidence >= SEUIL_FORT
      ? contexte.client
      : undefined;
  const estVisite = contexteExploitable && contexte?.typeMetier?.type === "visite";
  const preparationDisponible = rdv.preparationDisponible || Boolean(bienConfiant && clientConfiant && estVisite);

  const candidatsBanniereBruts =
    !preparationDisponible && contexteExploitable && contexte?.necessiteConfirmationBien
      ? await Promise.all(
          (contexte.bienCandidats ?? []).map(async (c) => {
            const bien = await getBienById(c.bienId);
            return bien ? { bienId: c.bienId, titre: labelCourtBien(bien.titre) } : undefined;
          })
        )
      : [];
  const candidatsBanniere = candidatsBanniereBruts.filter(
    (c): c is { bienId: string; titre: string } => Boolean(c)
  );

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[13px] font-medium text-[#64748b] tabular-nums">
              {dateLabel && `${dateLabel} · `}
              {rdv.journeeEntiere ? "Toute la journée" : rdv.heure}
            </span>
            <Badge variant={variant}>{label}</Badge>
            {statut === "en_cours" && !rdv.journeeEntiere && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#16a34a]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
                En cours
              </span>
            )}
          </div>
          <p className="text-[14px] font-medium text-[#0f172a] leading-snug">{rdv.titre}</p>
          {rdv.lieu && (
            <p className="text-[13px] text-[#64748b] mt-0.5 truncate">{rdv.lieu}</p>
          )}
          {rdv.client && (
            <p className="text-[13px] text-[#94a3b8] mt-0.5">
              {rdv.client.prenom} {rdv.client.nom}
            </p>
          )}
        </div>

        {preparationDisponible && (
          <Link
            href={`/visites/${rdv.id}/preparer`}
            className="shrink-0 self-center min-h-[44px] flex items-center text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
          >
            Préparer&nbsp;→
          </Link>
        )}
        {!preparationDisponible && rdv.type === "appel" && callHref && (
          <a
            href={callHref}
            className="shrink-0 self-center min-h-[44px] flex items-center text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
          >
            Appeler&nbsp;→
          </a>
        )}
        {!preparationDisponible && candidatsBanniere.length > 0 && (
          <ConfirmationBienRdv rdvId={rdv.id} candidats={candidatsBanniere} />
        )}
      </div>
    </Card>
  );
}
