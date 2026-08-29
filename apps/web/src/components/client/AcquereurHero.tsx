import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import type { ProfilAcquereur, StadeProjet } from "@/types/client";
import { archiverAcquereurAction, desarchiverAcquereurAction } from "@/actions/archivageAcquereur";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LABEL_STADE_PROJET: Record<StadeProjet, string> = {
  decouverte: "Découverte",
  recherche_active: "Recherche active",
  offre: "En attente d'offre",
  compromis: "Compromis",
  acte: "Acte",
};

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Hero de la Fiche Acquéreur Premium — "le brief d'achat" (design validé). Compact et
// informationnel, jamais une bannière : identité réelle, budget immédiatement lisible, actions
// déjà fonctionnelles (inchangées, reprises telles qu'elles existaient avant ce chantier). Aucune
// maturité commerciale/score/priorité/urgence inventée : stadeProjet est le seul statut réel
// disponible sur ProfilAcquereur.
export default function AcquereurHero({ client }: { client: ProfilAcquereur }) {
  const clientReel = UUID_REGEX.test(client.id);
  const actif = !client.archiveLe;

  return (
    <div className="bg-surface border border-border rounded-xl shadow-[0_2px_8px_rgba(18,32,56,0.06)] p-5 md:p-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar initiales={`${client.prenom.charAt(0)}${client.nom.charAt(0)}`} size={52} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="font-serif text-[21px] md:text-[24px] font-semibold text-text-1 leading-tight">
                {client.prenom} {client.nom}
              </h1>
              <Badge variant="default">{LABEL_STADE_PROJET[client.stadeProjet]}</Badge>
              {client.archiveLe && <Badge variant="muted">Archivé le {formatDate(client.archiveLe)}</Badge>}
            </div>
            <p className="text-[13px] text-text-2 truncate">
              {client.email} · {client.telephone}
            </p>
            <p className="text-[12px] text-text-3 mt-0.5">Suivi depuis le {formatDate(client.datePremiereContact)}</p>
          </div>
        </div>

        <div className="shrink-0 md:text-right">
          <p className="text-[11px] text-text-3 mb-0.5">Budget</p>
          <p className="font-serif text-[22px] md:text-[26px] font-semibold text-text-1 leading-none">
            {formatPrix(client.budgetMin)} – {formatPrix(client.budgetMax)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5 mt-4 pt-4 border-t border-border">
        {actif && (
          <ButtonLink href={`/taches/nouveau?acquereurId=${client.id}`} variant="primary" size="md">
            + Ajouter une tâche
          </ButtonLink>
        )}
        {clientReel && (
          <>
            <ButtonLink href={`/clients/${client.id}/modifier`} variant="secondary" size="md">
              Modifier
            </ButtonLink>
            <form action={client.archiveLe ? desarchiverAcquereurAction : archiverAcquereurAction}>
              <input type="hidden" name="id" value={client.id} />
              <Button type="submit" variant="ghost" size="md">
                {client.archiveLe ? "Désarchiver" : "Archiver"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
