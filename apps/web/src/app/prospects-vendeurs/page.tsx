import Link from "next/link";
import { redirect } from "next/navigation";
import { User, Plus, UserSearch } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import ChampRecherche from "@/components/ui/ChampRecherche";
import Pagination from "@/components/ui/Pagination";
import EmptyState from "@/components/ui/EmptyState";
import { rechercherProspectsVendeurs, type VueProspectVendeur } from "@/lib/prospectVendeurRepository";
import { getTachesPourProspectVendeur } from "@/lib/tacheRepository";
import { tachePrioritaire, raisonTache } from "@/lib/tachePriority";
import { deriverStatutProspectVendeur, LABEL_STATUT_PROSPECT_VENDEUR } from "@/types/prospectVendeur";
import { LABEL_ORIGINE_LEAD } from "@/types/origineLead";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import type { Tache } from "@/types/tache";

const PAR_PAGE = 25;

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx).
export const dynamic = "force-dynamic";

const TITRE_VUE: Record<VueProspectVendeur, string> = {
  en_cours: "Prospects vendeurs",
  perdus: "Prospects perdus",
  convertis: "Prospects convertis",
  archives: "Prospects archivés",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Échéances dépassées et proches en premier (tri ascendant simple), aucune échéance en dernier —
// basé sur l'échéance de la tâche la plus prioritaire de chaque prospect (ADR-028, remplace
// l'ancien champ simple prochaineActionLe). Inchangé depuis avant ADR-048 : appliqué sur
// l'ENSEMBLE des prospects "en_cours" correspondant à la recherche, AVANT la pagination — pour
// que la page 2 montre bien les 25 prospects suivants par urgence, jamais les 25 suivants par
// creeLe avec un tri d'urgence limité à la seule page courante.
function comparerParEcheance(tachesParProspect: Map<string, Tache[]>) {
  return (a: ProspectVendeur, b: ProspectVendeur): number => {
    const echeanceA = tachePrioritaire(tachesParProspect.get(a.id) ?? [])?.echeance;
    const echeanceB = tachePrioritaire(tachesParProspect.get(b.id) ?? [])?.echeance;
    if (!echeanceA && !echeanceB) return 0;
    if (!echeanceA) return 1;
    if (!echeanceB) return -1;
    return echeanceA < echeanceB ? -1 : echeanceA > echeanceB ? 1 : 0;
  };
}

type PageProps = { searchParams: Promise<{ vue?: string; q?: string; page?: string }> };

function construireHref(params: { vue?: VueProspectVendeur; q?: string; page?: number }): string {
  const sp = new URLSearchParams();
  if (params.vue && params.vue !== "en_cours") sp.set("vue", params.vue);
  if (params.q) sp.set("q", params.q);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/prospects-vendeurs?${qs}` : "/prospects-vendeurs";
}

export default async function ProspectsVendeursPage({ searchParams }: PageProps) {
  const { vue: vueBrute, q, page: pageBrut } = await searchParams;
  const vue: VueProspectVendeur =
    vueBrute === "perdus" || vueBrute === "convertis" || vueBrute === "archives" ? vueBrute : "en_cours";
  const texte = q?.trim() || undefined;
  const pageDemandee = Math.max(1, Number(pageBrut) || 1);

  // ADR-048 : recherche + ordre déterministe côté serveur (creeLe DESC, id DESC), filtrage par vue
  // via le prédicat métier partagé (predicatVue, prospectVendeurRepository.ts — zéro divergence
  // avec listerProspectsVendeurs*()). Retourne l'ensemble correspondant, pas encore paginé : voir
  // rechercherProspectsVendeurs() pour la raison (tri par échéance de tâche à appliquer avant
  // pagination, une donnée que ce repository n'a délibérément pas vocation à connaître).
  const correspondants = await rechercherProspectsVendeurs({ q: texte, vue });

  const listesTaches = await Promise.all(correspondants.map((p) => getTachesPourProspectVendeur(p.id)));
  const tachesParProspect = new Map<string, Tache[]>(correspondants.map((p, i) => [p.id, listesTaches[i]]));

  if (vue === "en_cours") correspondants.sort(comparerParEcheance(tachesParProspect));

  const total = correspondants.length;
  const totalPages = Math.max(1, Math.ceil(total / PAR_PAGE));

  if (total > 0 && pageDemandee > totalPages) {
    redirect(construireHref({ vue, q: texte, page: totalPages }));
  }

  const debut = (pageDemandee - 1) * PAR_PAGE;
  const prospects = correspondants.slice(debut, debut + PAR_PAGE);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] md:text-[28px] font-semibold text-text-1 leading-tight">
            {TITRE_VUE[vue]}
          </h1>
          <p className="text-[14px] text-text-3 mt-1">{total} prospect{total > 1 ? "s" : ""}</p>
        </div>
        {vue === "en_cours" && (
          <Link
            href="/prospects-vendeurs/nouveau"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3.5 py-2 rounded-lg shrink-0"
          >
            <Plus size={14} />
            Ajouter un prospect vendeur
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        {vue !== "en_cours" && (
          <Link href={construireHref({ q: texte })} className="text-[13px] font-medium text-accent hover:text-accent-hover transition-colors">
            ← Voir les prospects en cours
          </Link>
        )}
        {vue !== "perdus" && (
          <Link href={construireHref({ vue: "perdus", q: texte })} className="text-[13px] font-medium text-accent hover:text-accent-hover transition-colors">
            Voir les perdus →
          </Link>
        )}
        {vue !== "convertis" && (
          <Link href={construireHref({ vue: "convertis", q: texte })} className="text-[13px] font-medium text-accent hover:text-accent-hover transition-colors">
            Voir les convertis →
          </Link>
        )}
        {vue !== "archives" && (
          <Link href={construireHref({ vue: "archives", q: texte })} className="text-[13px] font-medium text-accent hover:text-accent-hover transition-colors">
            Voir les archivés →
          </Link>
        )}
      </div>

      <ChampRecherche
        action="/prospects-vendeurs"
        q={texte}
        placeholder="Rechercher par nom, prénom…"
        champsCaches={vue !== "en_cours" ? { vue } : undefined}
        hrefEffacer={construireHref({ vue })}
      />

      <section>
        <SectionTitle>{TITRE_VUE[vue]}</SectionTitle>
        {prospects.length === 0 ? (
          texte ? (
            <p className="text-[14px] text-text-3">Aucun résultat pour « {texte} ».</p>
          ) : (
            <EmptyState
              icon={UserSearch}
              titre="Aucun prospect dans cette vue"
              message="Les propriétaires que vous démarchez apparaîtront ici, avec leur statut et leurs prochaines tâches."
              cta={vue === "en_cours" ? { href: "/prospects-vendeurs/nouveau", libelle: "Ajouter un prospect vendeur" } : undefined}
            />
          )
        ) : (
          <div className="flex flex-col gap-2">
            {prospects.map((prospect) => {
              const statut = deriverStatutProspectVendeur(prospect);
              const localisation = prospect.ville ?? prospect.secteurBienPotentiel ?? prospect.adresseBienPotentiel;
              const tachePrincipale = tachePrioritaire(tachesParProspect.get(prospect.id) ?? []);
              return (
                <Link key={prospect.id} href={`/prospects-vendeurs/${prospect.id}`}>
                  <Card className="hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow duration-150">
                    <div className="flex items-center gap-4 p-4">
                      <div className="w-10 h-10 rounded-lg bg-accent-light flex items-center justify-center shrink-0">
                        <User size={18} className="text-accent" strokeWidth={1.8} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-text-1 truncate">
                          {prospect.prenom ? `${prospect.prenom} ` : ""}
                          {prospect.nom}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <Badge variant="default">{LABEL_STATUT_PROSPECT_VENDEUR[statut]}</Badge>
                          {prospect.origineLead && <Badge variant="muted">{LABEL_ORIGINE_LEAD[prospect.origineLead]}</Badge>}
                          {localisation && <span className="text-[13px] text-text-2">{localisation}</span>}
                        </div>
                        {tachePrincipale && (
                          <p className="text-[12px] text-text-3 mt-1.5">
                            {raisonTache(tachePrincipale)}
                            {tachePrincipale.echeance && ` — ${formatDate(tachePrincipale.echeance)}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}

        <Pagination
          page={pageDemandee}
          totalPages={totalPages}
          construireHref={(p) => construireHref({ vue, q: texte, page: p })}
        />
      </section>
    </div>
  );
}
