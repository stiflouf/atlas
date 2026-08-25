import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Plus, Building2, SearchX, Archive } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import ChampRecherche from "@/components/ui/ChampRecherche";
import Pagination from "@/components/ui/Pagination";
import PropertyVisual from "@/components/ui/PropertyVisual";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { listerBiens, rechercherBiensPage } from "@/lib/bienRepository";
import { deriverStatutCommercial, LABEL_STATUT_COMMERCIAL, type StatutCommercial } from "@/lib/statutCommercialBien";

const PAR_PAGE = 25;

// Statut dérivé uniquement des champs déjà chargés sur `Bien` (offreEnCoursLe/compromisSigneLe) —
// deriverStatutCommercial() sans second argument ignore volontairement les compromis structurés
// (voir sa doc), aucune requête additionnelle par ligne (§12 : pas de requête coûteuse en liste).
const VARIANT_STATUT_COMMERCIAL: Record<StatutCommercial, "default" | "accent" | "success"> = {
  en_commercialisation: "default",
  offre_en_cours: "accent",
  compromis_signe: "success",
  vendu: "success",
};

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
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      <div className="mb-6 flex items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-champagne">
            {modeArchives ? "Archives" : "Portefeuille"}
          </p>
          <h1 className="font-serif text-[28px] md:text-[34px] font-semibold text-text-1 leading-[1.05] mt-1.5">
            {modeArchives ? "Biens archivés" : "Biens"}
          </h1>
          <p className="text-[13px] text-text-3 mt-1.5">
            {totalAffiche} {modeArchives ? "biens archivés" : "mandats actifs"}
            {" · "}
            <Link
              href={construireHref({ archives: !modeArchives, q: texte })}
              className="font-medium text-accent hover:text-accent-hover transition-colors"
            >
              {modeArchives ? "voir les biens actifs" : "voir les archives"}
            </Link>
          </p>
        </div>
        {!modeArchives && (
          <Link href="/biens/nouveau" className="shrink-0">
            <Button variant="primary" size="md" className="inline-flex items-center gap-1.5">
              <Plus size={14} />
              Ajouter un bien
            </Button>
          </Link>
        )}
      </div>

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
          texte ? (
            <EmptyState
              icon={SearchX}
              titre={`Aucun résultat pour « ${texte} »`}
              message="Aucune référence, adresse ou ville ne correspond. Essayez un terme plus court, ou effacez la recherche."
              cta={{ href: construireHref({ archives: modeArchives }), libelle: "Effacer la recherche" }}
            />
          ) : modeArchives ? (
            <EmptyState
              icon={Archive}
              titre="Aucun bien archivé"
              message="Les biens que vous archivez sortent des flux actifs sans être supprimés. Ils apparaîtront ici."
              cta={{ href: "/biens", libelle: "Voir les biens actifs" }}
            />
          ) : (
            <EmptyState
              icon={Building2}
              titre="Votre portefeuille est vide"
              message="Le premier mandat que vous ajoutez ouvre son suivi documentaire, ses visites et ses projections."
              cta={{ href: "/biens/nouveau", libelle: "Ajouter un bien" }}
            />
          )
        ) : (
          <>
            {/* Desktop/tablette — vraies cards immobilières (média pleine largeur en haut), jamais
                une ligne de tableau. */}
            <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {biens.map((bien) => (
                <Link key={bien.id} href={`/biens/${bien.id}`}>
                  <Card variant="interactive" className="h-full flex flex-col overflow-hidden">
                    <div className="relative">
                      <PropertyVisual type={bien.type} format="card" scrim arrondi={false} className="w-full" />
                      {/* Un seul badge sur le média : le statut commercial. La référence redevient
                          une métadonnée, en pied de card. */}
                      <span className="absolute left-2.5 top-2.5">
                        <Badge variant={VARIANT_STATUT_COMMERCIAL[deriverStatutCommercial(bien)]}>
                          {LABEL_STATUT_COMMERCIAL[deriverStatutCommercial(bien)]}
                        </Badge>
                      </span>
                      {/* Le prix sur le voile : c'est l'information cherchée en premier, et elle
                          libère le bloc texte. font-serif, comme les chiffres porteurs ailleurs. */}
                      <span className="absolute left-3 bottom-2.5 font-serif text-[19px] font-semibold text-white drop-shadow-[0_1px_8px_rgba(3,10,28,0.6)]">
                        {formatPrix(bien.prix)}
                      </span>
                    </div>
                    <div className="p-4 flex-1 flex flex-col">
                      <p className="text-[15px] font-medium text-text-1 truncate">{bien.titre}</p>
                      <p className="text-[13px] text-text-2 truncate mt-0.5">
                        {bien.adresse}, {bien.codePostal} {bien.ville}
                      </p>
                      <div className="flex items-baseline justify-between gap-2 mt-auto pt-3">
                        <span className="text-[12px] text-text-2">
                          {bien.surface} m² · {bien.pieces} pièces
                        </span>
                        <span className="text-[11px] tracking-[0.06em] text-text-3 tabular-nums">
                          {bien.reference}
                        </span>
                      </div>
                      {bien.archiveLe && (
                        <p className="text-[11px] text-text-3 mt-1.5">Archivé le {formatDate(bien.archiveLe)}</p>
                      )}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>

            {/* Mobile — ligne compacte, déjà revue (thumbnail + informations essentielles). */}
            <div className="flex flex-col gap-2 md:hidden">
              {biens.map((bien) => (
                <Link key={bien.id} href={`/biens/${bien.id}`}>
                  <Card variant="interactive">
                    <div className="flex items-center gap-3.5 p-3">
                      <PropertyVisual type={bien.type} format="thumb" className="w-20 h-20 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-text-1 truncate">{bien.titre}</p>
                        <p className="text-[13px] text-text-2 truncate">{bien.adresse}, {bien.codePostal} {bien.ville}</p>
                        <div className="flex items-baseline gap-2.5 mt-1.5">
                          <span className="font-serif text-[16px] font-semibold text-text-1">
                            {formatPrix(bien.prix)}
                          </span>
                          <span className="text-[12px] text-text-3">
                            {bien.surface} m² · {bien.pieces} pièces
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <Badge variant={VARIANT_STATUT_COMMERCIAL[deriverStatutCommercial(bien)]}>
                            {LABEL_STATUT_COMMERCIAL[deriverStatutCommercial(bien)]}
                          </Badge>
                          <span className="text-[11px] tracking-[0.06em] text-text-3 tabular-nums">
                            {bien.reference}
                          </span>
                          {bien.archiveLe && (
                            <span className="text-[11px] text-text-3">Archivé le {formatDate(bien.archiveLe)}</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-text-3 shrink-0" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </>
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
