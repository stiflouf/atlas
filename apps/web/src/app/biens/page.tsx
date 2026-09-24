import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Plus, Building2, SearchX, Archive } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import ChampRecherche from "@/components/ui/ChampRecherche";
import Pagination from "@/components/ui/Pagination";
import PhotoPrincipale from "@/components/bien/PhotoPrincipale";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import { rechercherBiensPage } from "@/lib/bienRepository";
import { statutCommercialBienEffectif, LABEL_STATUT_COMMERCIAL, type StatutCommercial } from "@/lib/statutCommercialBien";
import { chargerEtatsOffresParBien } from "@/lib/offreRepository";
import { listerCompromisParBiens } from "@/lib/compromisRepository";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

const PAR_PAGE = 25;

// ADR-061 §11 — statut commercial EFFECTIF en liste : offres et compromis de la page chargés EN LOT
// (deux requêtes pour N biens, jamais une par ligne, §12 : pas de requête coûteuse en liste), puis
// la même règle que la fiche (`statutCommercialBienEffectif`) — plus jamais les seuls jalons legacy.
const VARIANT_STATUT_COMMERCIAL: Record<StatutCommercial, "default" | "accent" | "success"> = {
  en_commercialisation: "default",
  offre_en_cours: "accent",
  offre_acceptee: "accent",
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

  // WORKSPACE_SCOPING_V2B1 — le périmètre est résolu AVANT la requête de liste (il était jusqu'ici
  // obtenu plus bas, seulement pour les enrichissements) et entre dans le SQL : lignes, total et
  // pagination portent tous le même filtre.
  const workspaceId = await exigerWorkspaceCourant();
  const { lignes: biensPage, total } = await rechercherBiensPage({
    workspaceId,
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

  // WORKSPACE_SCOPING_V2B1 — le repli démo d'ADR-048 est retiré : « vide veut dire vide ». Un
  // workspace sans bien voit son état vide, jamais le catalogue de démonstration — qui n'appartient
  // à aucun périmètre et s'afficherait donc identiquement chez tout le monde.
  const biens = biensPage;
  const totalAffiche = total;
  const [etatsOffres, compromisParBien] = await Promise.all([
    chargerEtatsOffresParBien(biens, workspaceId),
    listerCompromisParBiens(biens.map((b) => b.id), workspaceId),
  ]);
  const statutCommercialDe = (bien: (typeof biens)[number]) => {
    const etat = etatsOffres.get(bien.id);
    return statutCommercialBienEffectif(bien, etat?.mode === "canonique" ? etat.offres : [], compromisParBien.get(bien.id) ?? []);
  };
  const totalPages = Math.max(1, Math.ceil(totalAffiche / PAR_PAGE));

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      <div className="mb-6 flex items-end justify-between gap-4 border-b border-border-subtle pb-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-champagne">
            {modeArchives ? "Archives" : "Portefeuille"}
          </p>
          <h1 className="font-serif text-[28px] md:text-[34px] font-semibold text-text-primary leading-[1.05] mt-1.5">
            {modeArchives ? "Biens archivés" : "Biens"}
          </h1>
          <p className="text-[13px] text-text-muted mt-1.5">
            {totalAffiche} {modeArchives ? "biens archivés" : "mandats actifs"}
            {" · "}
            <Link
              href={construireHref({ archives: !modeArchives, q: texte })}
              className="font-medium text-action-primary hover:text-action-primary-hover transition-colors"
            >
              {modeArchives ? "voir les biens actifs" : "voir les archives"}
            </Link>
          </p>
        </div>
        {!modeArchives && (
          <ButtonLink href="/biens/nouveau" variant="primary" size="md" className="inline-flex items-center gap-1.5">
            <Plus size={14} />
            Ajouter un bien
          </ButtonLink>
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
                      <PhotoPrincipale
                        type={bien.type}
                        photoPrincipaleId={bien.photoPrincipaleId}
                        format="card"
                        scrim
                        arrondi={false}
                        className="w-full"
                      />
                      {/* Un seul badge sur le média : le statut commercial. La référence redevient
                          une métadonnée, en pied de card. */}
                      <span className="absolute left-2.5 top-2.5">
                        <Badge variant={VARIANT_STATUT_COMMERCIAL[statutCommercialDe(bien)]}>
                          {LABEL_STATUT_COMMERCIAL[statutCommercialDe(bien)]}
                        </Badge>
                      </span>
                      {/* Le prix sur le voile : c'est l'information cherchée en premier, et elle
                          libère le bloc texte. */}
                      <span className="absolute left-3 bottom-2.5 text-[19px] font-semibold text-white tabular-nums drop-shadow-[0_1px_8px_rgba(3,10,28,0.6)]">
                        {formatPrix(bien.prix)}
                      </span>
                    </div>
                    <div className="p-4 flex-1 flex flex-col">
                      <p className="text-[15px] font-medium text-text-primary truncate">{bien.titre}</p>
                      <p className="text-[13px] text-text-secondary truncate mt-0.5">
                        {bien.adresse}, {bien.codePostal} {bien.ville}
                      </p>
                      <div className="flex items-baseline justify-between gap-2 mt-auto pt-3">
                        <span className="text-[12px] text-text-secondary">
                          {bien.surface} m² · {bien.pieces} pièces
                        </span>
                        <span className="text-[11px] tracking-[0.06em] text-text-muted tabular-nums">
                          {bien.reference}
                        </span>
                      </div>
                      {bien.archiveLe && (
                        <p className="text-[11px] text-text-muted mt-1.5">Archivé le {formatDate(bien.archiveLe)}</p>
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
                      <PhotoPrincipale
                        type={bien.type}
                        photoPrincipaleId={bien.photoPrincipaleId}
                        format="thumb"
                        className="w-20 h-20 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-text-primary truncate">{bien.titre}</p>
                        <p className="text-[13px] text-text-secondary truncate">{bien.adresse}, {bien.codePostal} {bien.ville}</p>
                        <div className="flex items-baseline gap-2.5 mt-1.5">
                          <span className="text-[16px] font-semibold text-text-primary tabular-nums">
                            {formatPrix(bien.prix)}
                          </span>
                          <span className="text-[12px] text-text-muted">
                            {bien.surface} m² · {bien.pieces} pièces
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <Badge variant={VARIANT_STATUT_COMMERCIAL[statutCommercialDe(bien)]}>
                            {LABEL_STATUT_COMMERCIAL[statutCommercialDe(bien)]}
                          </Badge>
                          <span className="text-[11px] tracking-[0.06em] text-text-muted tabular-nums">
                            {bien.reference}
                          </span>
                          {bien.archiveLe && (
                            <span className="text-[11px] text-text-muted">Archivé le {formatDate(bien.archiveLe)}</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-text-muted shrink-0" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        )}

        <Pagination
          page={pageDemandee}
          totalPages={totalPages}
          construireHref={(p) => construireHref({ archives: modeArchives, q: texte, page: p })}
        />
      </section>
    </div>
  );
}
