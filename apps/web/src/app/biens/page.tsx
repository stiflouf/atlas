import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronRight, Plus } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import ChampRecherche from "@/components/ui/ChampRecherche";
import Pagination from "@/components/ui/Pagination";
import { listerBiens, rechercherBiensPage } from "@/lib/bienRepository";

const PAR_PAGE = 25;

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx) : sans ce
// flag, la liste figerait au moment du build.
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ archives?: string; q?: string; page?: string }> };

function construireHref(params: { archives?: boolean; q?: string; page?: number }): string {
  const sp = new URLSearchParams();
  if (params.archives) sp.set("archives", "1");
  if (params.q) sp.set("q", params.q);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/biens?${qs}` : "/biens";
}

export default async function BiensPage({ searchParams }: PageProps) {
  const { archives, q, page: pageBrut } = await searchParams;
  const modeArchives = archives === "1";
  const texte = q?.trim() || undefined;
  const pageDemandee = Math.max(1, Number(pageBrut) || 1);

  const { lignes: biensPage, total } = await rechercherBiensPage({
    q: texte,
    archives: modeArchives,
    page: pageDemandee,
    parPage: PAR_PAGE,
  });

  // Page hors bornes (ex. ?page=99 sur 2 pages de résultats) : jamais une page vide silencieuse,
  // toujours une redirection explicite vers la dernière page valide (ADR-048).
  if (biensPage.length === 0 && total > 0 && pageDemandee > 1) {
    const totalPagesReel = Math.max(1, Math.ceil(total / PAR_PAGE));
    redirect(construireHref({ archives: modeArchives, q: texte, page: totalPagesReel }));
  }

  // Fallback démo (ADR-048) : préserve le comportement historique de listerBiens() quand aucun
  // bien réel n'existe encore — recherche/pagination n'a jamais de sens sur ce jeu figé, affiché
  // uniquement sur la vue par défaut (pas de recherche, page 1, biens actifs).
  const aucunBienReel = total === 0 && !texte && !modeArchives;
  const biensDemo = aucunBienReel ? await listerBiens() : undefined;
  const biens = biensDemo ?? biensPage;
  const totalAffiche = biensDemo ? biensDemo.length : total;
  const totalPages = Math.max(1, Math.ceil(totalAffiche / PAR_PAGE));

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] md:text-[28px] font-semibold text-[#0f172a] leading-tight">
            {modeArchives ? "Biens archivés" : "Biens"}
          </h1>
          <p className="text-[14px] text-[#94a3b8] mt-1">
            {totalAffiche} {modeArchives ? "biens archivés" : "mandats actifs"}
          </p>
        </div>
        {!modeArchives && (
          <Link
            href="/biens/nouveau"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg shrink-0"
          >
            <Plus size={14} />
            Ajouter un bien
          </Link>
        )}
      </div>

      <Link
        href={construireHref({ archives: !modeArchives, q: texte })}
        className="inline-block text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors mb-6"
      >
        {modeArchives ? "← Voir les biens actifs" : "Voir les archives →"}
      </Link>

      <ChampRecherche
        action="/biens"
        q={texte}
        placeholder="Rechercher par référence, adresse, ville…"
        champsCaches={modeArchives ? { archives: "1" } : undefined}
        hrefEffacer={construireHref({ archives: modeArchives })}
      />

      <section>
        <SectionTitle>{modeArchives ? "Biens archivés" : "Mandats en cours"}</SectionTitle>
        {biens.length === 0 ? (
          <p className="text-[14px] text-[#94a3b8]">
            {texte
              ? `Aucun résultat pour « ${texte} ».`
              : modeArchives
                ? "Aucun bien archivé."
                : "Aucun bien actif."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {biens.map((bien) => (
              <Link key={bien.id} href={`/biens/${bien.id}`}>
                <Card className="hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow duration-150">
                  <div className="flex items-center gap-4 p-4">
                    <div className="w-10 h-10 rounded-lg bg-[#eef2ff] flex items-center justify-center shrink-0">
                      <Building2 size={18} className="text-[#4338ca]" strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-[14px] font-medium text-[#0f172a] truncate">{bien.titre}</p>
                      </div>
                      <p className="text-[13px] text-[#64748b]">{bien.adresse}, {bien.codePostal} {bien.ville}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[13px] font-medium text-[#0f172a]">{formatPrix(bien.prix)}</span>
                        <span className="text-[12px] text-[#94a3b8]">{bien.surface} m² · {bien.pieces} pièces</span>
                        <Badge variant="accent">{bien.reference}</Badge>
                        {bien.archiveLe && (
                          <Badge variant="muted">Archivé le {formatDate(bien.archiveLe)}</Badge>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-[#94a3b8] shrink-0" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {!biensDemo && (
          <Pagination
            page={pageDemandee}
            totalPages={totalPages}
            construireHref={(p) => construireHref({ archives: modeArchives, q: texte, page: p })}
          />
        )}
      </section>
    </div>
  );
}
