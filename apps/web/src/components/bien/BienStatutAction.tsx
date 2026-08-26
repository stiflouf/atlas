import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Button from "@/components/ui/Button";
import IconTile from "@/components/ui/IconTile";
import type { Bien } from "@/types/bien";
import {
  annulerCompromisAction,
  marquerCompromisSigneAction,
  marquerOffreEnCoursAction,
  retirerOffreAction,
} from "@/actions/statutCommercialBien";
import { archiverBienAction, desarchiverBienAction } from "@/actions/archivageBien";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bandeau statut + action (design validé Claude Design, artifact 7615625f) — fusionne l'ancienne
// carte "État du dossier" et l'ancienne barre d'actions en un seul bandeau. Mêmes conditions/
// actions/ordre qu'avant (aucune règle métier changée) : la PREMIÈRE action de jalon applicable
// dans l'ordre existant devient l'action primaire (navy), les suivantes restent visibles à côté
// (au plus 2 sont applicables simultanément avec les règles actuelles) — jamais de nouvelle logique
// de priorisation inventée. Les actions non-commerciales (Modifier/Archiver/+Tâche/Visite) sont
// repliées sous un <details> natif (pas de nouveau JS client), même pattern que l'accordéon
// Acquéreurs compatibles déjà présent dans BienTabs.
export default function BienStatutAction({
  bien,
  statutLabel,
  raisonTacheTexte,
  dateMandatFormatee,
  prochaineVisiteHref,
}: {
  bien: Bien;
  statutLabel: React.ReactNode;
  raisonTacheTexte?: string;
  dateMandatFormatee: string;
  prochaineVisiteHref?: string;
}) {
  const bienReel = UUID_REGEX.test(bien.id);
  const actif = !bien.archiveLe;

  const actionsJalon: React.ReactNode[] = [];
  if (bienReel && actif) {
    if (!bien.offreEnCoursLe) {
      actionsJalon.push(
        <form key="offre-en-cours" action={marquerOffreEnCoursAction}>
          <input type="hidden" name="id" value={bien.id} />
          <Button type="submit" variant={actionsJalon.length === 0 ? "primary" : "secondary"} size="sm">
            Marquer une offre en cours
          </Button>
        </form>
      );
    }
    if (bien.offreEnCoursLe && !bien.compromisSigneLe) {
      actionsJalon.push(
        <form key="retirer-offre" action={retirerOffreAction}>
          <input type="hidden" name="id" value={bien.id} />
          <Button type="submit" variant="danger" size="sm">
            Retirer l&#39;offre
          </Button>
        </form>
      );
    }
    if (!bien.compromisSigneLe) {
      actionsJalon.push(
        <form key="marquer-compromis" action={marquerCompromisSigneAction}>
          <input type="hidden" name="id" value={bien.id} />
          <Button type="submit" variant={actionsJalon.length === 0 ? "primary" : "secondary"} size="sm">
            Marquer compromis signé
          </Button>
        </form>
      );
    }
    if (bien.compromisSigneLe) {
      actionsJalon.push(
        <form key="annuler-compromis" action={annulerCompromisAction}>
          <input type="hidden" name="id" value={bien.id} />
          <Button type="submit" variant="danger" size="sm">
            Annuler le compromis
          </Button>
        </form>
      );
    }
  }

  const aDesActionsSecondaires = Boolean(prochaineVisiteHref) || actif || bienReel;

  return (
    <div className="bg-surface border border-border rounded-xl shadow-[0_2px_8px_rgba(18,32,56,0.06)] p-4 md:p-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* IconTile navy (design validé Claude Design, artifact ec9f41b8) — purement visuel, ancre
            ce bandeau comme le point d'ancrage "que dois-je faire maintenant ?" de la fiche, même
            traitement que la tuile StatTile taille="lead" d'Aujourd'hui. */}
        <div className="flex items-start gap-3 min-w-0">
          <IconTile icon={ArrowRight} tone="navy" shape="circle" size={38} iconSize={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              {statutLabel}
              <span className="text-[12px] text-text-3">Mandat depuis le {dateMandatFormatee}</span>
            </div>
            {raisonTacheTexte && <p className="text-[14px] text-text-1 leading-snug">{raisonTacheTexte}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {actionsJalon}
          {aDesActionsSecondaires && (
            <details className="relative">
              <summary className="list-none cursor-pointer text-[13px] font-medium text-accent hover:text-accent-hover select-none px-1 py-1.5">
                Voir toutes les actions
              </summary>
              <div className="absolute right-0 z-10 mt-1 flex flex-col gap-1.5 bg-surface border border-border rounded-lg shadow-[0_2px_8px_rgba(18,32,56,0.08)] p-2.5 min-w-[220px]">
                {prochaineVisiteHref && (
                  <Link
                    href={prochaineVisiteHref}
                    className="text-[13px] font-medium text-text-1 hover:text-accent px-2 py-1.5 rounded-md hover:bg-surface-muted transition-colors"
                  >
                    Préparer la visite →
                  </Link>
                )}
                {actif && (
                  <Link
                    href={`/taches/nouveau?bienId=${bien.id}`}
                    className="text-[13px] font-medium text-text-1 hover:text-accent px-2 py-1.5 rounded-md hover:bg-surface-muted transition-colors"
                  >
                    + Ajouter une tâche
                  </Link>
                )}
                {bienReel && (
                  <>
                    <Link
                      href={`/biens/${bien.id}/modifier`}
                      className="text-[13px] font-medium text-text-1 hover:text-accent px-2 py-1.5 rounded-md hover:bg-surface-muted transition-colors"
                    >
                      Modifier le bien
                    </Link>
                    <form action={bien.archiveLe ? desarchiverBienAction : archiverBienAction}>
                      <input type="hidden" name="id" value={bien.id} />
                      <button
                        type="submit"
                        className="w-full text-left text-[13px] font-medium text-text-2 hover:text-danger px-2 py-1.5 rounded-md hover:bg-danger-light transition-colors"
                      >
                        {bien.archiveLe ? "Désarchiver" : "Archiver"}
                      </button>
                    </form>
                  </>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
