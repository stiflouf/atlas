import Link from "next/link";
import Badge from "@/components/ui/Badge";
import type { RendezVous, TypeRdv } from "@/types/agenda";
import type { StatutRendezVous } from "@/lib/rendezVous";
import type { ContexteRendezVous, TypeMetierRdv } from "@/types/contexteRendezVous";
import { SEUIL_AMBIGU, SEUIL_FORT } from "@/lib/matching/resoudre";
import { getClientById } from "@/lib/clientRepository";
import { getBienById } from "@/lib/bienRepository";
import ConfirmationBienRdv from "./ConfirmationBienRdv";

type BadgeConfig = { label: string; variant: "accent" | "default" | "muted" | "success" };

// Couleur du point de la timeline — dérivée de la même variante que le Badge (ADR-inchangé),
// jamais une seconde logique de catégorisation.
const DOT_COLOR: Record<BadgeConfig["variant"], string> = {
  accent: "bg-champagne",
  default: "bg-navy",
  muted: "bg-text-3",
  success: "bg-success",
};

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
  dernier = false,
}: {
  rdv: RendezVous;
  statut: StatutRendezVous;
  contexte?: ContexteRendezVous;
  dateLabel?: string;
  // Timeline (passe enrichissement visuel) — omet le rail de connexion sous le dernier item d'une
  // liste, purement décoratif.
  dernier?: boolean;
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
    <div className="flex gap-3">
      {/* Heure — colonne fixe alignée sur toute la timeline. */}
      <div className="w-14 shrink-0 text-right pt-0.5">
        <span className="text-[12px] font-medium text-text-secondary tabular-nums leading-tight">
          {dateLabel && <span className="block text-[11px] text-text-muted">{dateLabel}</span>}
          {rdv.journeeEntiere ? "Toute la journée" : rdv.heure}
        </span>
      </div>

      {/* Rail — point coloré par type + ligne de connexion vers l'item suivant. */}
      <div className="flex flex-col items-center shrink-0">
        <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${DOT_COLOR[variant]}`} />
        {!dernier && <span className="w-px flex-1 bg-border-subtle mt-1" />}
      </div>

      <div className="flex-1 min-w-0 pb-6">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant={variant}>{label}</Badge>
          {statut === "en_cours" && !rdv.journeeEntiere && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              En cours
            </span>
          )}
        </div>
        <p className="text-[14px] font-medium text-text-primary leading-snug">{rdv.titre}</p>
        {rdv.lieu && <p className="text-[13px] text-text-secondary mt-0.5 truncate">{rdv.lieu}</p>}
        {rdv.client && (
          <p className="text-[13px] text-text-muted mt-0.5">
            {rdv.client.prenom} {rdv.client.nom}
          </p>
        )}

        {preparationDisponible && (
          <Link
            href={`/visites/${rdv.id}/preparer`}
            className="inline-block mt-1.5 text-[13px] font-medium text-action-primary hover:text-action-primary-hover transition-colors"
          >
            Préparer&nbsp;→
          </Link>
        )}
        {!preparationDisponible && rdv.type === "appel" && callHref && (
          <a
            href={callHref}
            className="inline-block mt-1.5 text-[13px] font-medium text-action-primary hover:text-action-primary-hover transition-colors"
          >
            Appeler&nbsp;→
          </a>
        )}
        {!preparationDisponible && candidatsBanniere.length > 0 && (
          <div className="mt-1.5">
            <ConfirmationBienRdv rdvId={rdv.id} candidats={candidatsBanniere} />
          </div>
        )}
      </div>
    </div>
  );
}
