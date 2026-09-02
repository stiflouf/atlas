import Link from "next/link";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import type { ActionMemoire, EvenementMemoire, MemoireRelationnelleAcquereur } from "@/lib/relations/memoireAcquereur";
import type { RepriseContactAcquereur } from "@/lib/communications/repriseContactAcquereur";

// VALUE-03 — « Mémoire de la relation ». Rend visible un read model entièrement dérivé
// (memoireAcquereur.ts) : aucune décision n'est prise ici, aucune donnée n'est reformulée.
// Volontairement une seule Card en quatre blocs plutôt que quatre Cards : la mémoire doit se lire
// d'un seul regard, pas se parcourir. Aucune primitive nouvelle, aucune mention d'IA, aucun score.

function formatJour(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function Ligne({ evenement }: { evenement: EvenementMemoire }) {
  const contenu = (
    <>
      <span className="text-[12px] text-text-3 tabular-nums shrink-0 w-[108px]">{formatJour(evenement.date)}</span>
      <span className="min-w-0">
        <span className="text-[13.5px] text-text-1">{evenement.titre}</span>
        {evenement.detail && <span className="text-[13px] text-text-3"> — {evenement.detail}</span>}
      </span>
    </>
  );

  return (
    <li className="flex items-baseline gap-3">
      {evenement.href ? (
        <Link href={evenement.href} className="flex items-baseline gap-3 min-w-0 hover:text-accent transition-colors">
          {contenu}
        </Link>
      ) : (
        contenu
      )}
    </li>
  );
}

// VALUE-04 — quand la reprise de contact passe par une tâche déjà ouverte, elle s'attache à la
// ligne de cette tâche plutôt que d'ouvrir une seconde ligne : une seule représentation de la même
// action, jamais « la tâche » puis « préparer le message pour la tâche ».
function ActionLigne({ action, reprise }: { action: ActionMemoire; reprise?: RepriseContactAcquereur }) {
  const contenu = (
    <>
      <p className="text-[13.5px] text-text-1 leading-snug">{action.titre}</p>
      {action.detail && <p className="text-[12.5px] text-text-3 mt-0.5 leading-snug">{action.detail}</p>}
    </>
  );

  return (
    <li>
      {action.href ? (
        <Link href={action.href} className="block hover:text-accent transition-colors">
          {contenu}
        </Link>
      ) : (
        contenu
      )}
      {reprise && (
        <Link
          href={reprise.href}
          className="inline-block text-[12.5px] font-medium text-accent hover:text-accent-hover transition-colors mt-1"
        >
          {reprise.libelle} →
        </Link>
      )}
    </li>
  );
}

// Reprise de contact sans tâche : sa propre ligne, précédée de « pourquoi maintenant ? ». La raison
// vient des moteurs existants (VALUE-01, faits structurés de visite) — jamais recalculée pour cet
// affichage, jamais une urgence inventée.
function RepriseLigne({ reprise }: { reprise: RepriseContactAcquereur }) {
  return (
    <li>
      <Link href={reprise.href} className="block hover:text-accent transition-colors">
        <p className="text-[13.5px] text-text-1 leading-snug">{reprise.libelle}</p>
        <p className="text-[12.5px] text-text-3 mt-0.5 leading-snug">{reprise.raison}</p>
      </Link>
    </li>
  );
}

export default function AcquereurMemoireRelation({
  memoire,
  reprise,
}: {
  memoire: MemoireRelationnelleAcquereur;
  reprise?: RepriseContactAcquereur;
}) {
  const { etatActuel, faitsARetenir, historique, actions } = memoire;
  const repriseAutonome = reprise && !reprise.tacheId ? reprise : undefined;

  return (
    <section>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">Mémoire de la relation</h2>
      <Card className="p-4 md:p-5 flex flex-col gap-4">
        <div className="flex items-baseline gap-2.5 flex-wrap">
          {/* `stadeProjet`, seul statut canonique de l'acquéreur — jamais un état relationnel
              calculé pour l'occasion. */}
          <Badge variant="default">{etatActuel.libelle}</Badge>
          {etatActuel.precisions.map((precision) => (
            <span key={precision} className="text-[13.5px] text-text-1">
              {precision}
            </span>
          ))}
        </div>

        <div className="border-t border-border pt-3.5">
          <p className="text-[11px] font-medium text-text-2 mb-1.5">À retenir</p>
          <div className="flex flex-col gap-1">
            {faitsARetenir.map((fait) => (
              <div key={fait.cle} className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] text-text-3">{fait.libelle}</span>
                <span className="text-[13px] font-medium text-text-1 text-right">{fait.valeur}</span>
              </div>
            ))}
          </div>
          {/* Frontière explicite : les notes et critères libres restent consultables dans leur
              section, jamais promus en fait structuré (aucune extraction, aucun résumé). */}
          <p className="text-[11px] text-text-3 mt-2">Données structurées uniquement — le texte libre reste en notes.</p>
        </div>

        <div className="border-t border-border pt-3.5">
          <p className="text-[11px] font-medium text-text-2 mb-1.5">Historique</p>
          {historique.length === 0 ? (
            <p className="text-[13px] text-text-3">Aucun fait daté enregistré pour l&#39;instant.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {historique.map((evenement) => (
                <Ligne key={evenement.id} evenement={evenement} />
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border pt-3.5">
          <p className="text-[11px] font-medium text-text-2 mb-1.5">À faire maintenant</p>
          {actions.length === 0 && !repriseAutonome ? (
            <p className="text-[13px] text-text-3">Aucune action en attente sur cette relation.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {repriseAutonome && <RepriseLigne reprise={repriseAutonome} />}
              {actions.map((action) => (
                <ActionLigne
                  key={action.cle}
                  action={action}
                  reprise={reprise?.tacheId && action.cle === `tache:${reprise.tacheId}` ? reprise : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>
    </section>
  );
}
