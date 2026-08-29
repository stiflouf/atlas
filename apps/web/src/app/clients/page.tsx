import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import ChampRecherche from "@/components/ui/ChampRecherche";
import Pagination from "@/components/ui/Pagination";
import Avatar from "@/components/ui/Avatar";
import { listerClients, rechercherAcquereursPage } from "@/lib/clientRepository";

const PAR_PAGE = 25;

const stadeLabel: Record<string, string> = {
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
  return qs ? `/clients?${qs}` : "/clients";
}

// Liste volontairement minimale (nom, budget, stade projet) — la fiche vers laquelle elle
// pointe (/clients/[id]) l'est tout autant : pas d'historique, hors périmètre.
export default async function ClientsPage({ searchParams }: PageProps) {
  const { archives, q, page: pageBrut } = await searchParams;
  const modeArchives = archives === "1";
  const texte = q?.trim() || undefined;
  const pageDemandee = Math.max(1, Number(pageBrut) || 1);

  const { lignes: clientsPage, total } = await rechercherAcquereursPage({
    q: texte,
    archives: modeArchives,
    page: pageDemandee,
    parPage: PAR_PAGE,
  });

  // Page hors bornes : jamais une page vide silencieuse, toujours une redirection explicite vers
  // la dernière page valide (ADR-048).
  if (clientsPage.length === 0 && total > 0 && pageDemandee > 1) {
    const totalPagesReel = Math.max(1, Math.ceil(total / PAR_PAGE));
    redirect(construireHref({ archives: modeArchives, q: texte, page: totalPagesReel }));
  }

  // Fallback démo (ADR-048) : préserve le comportement historique de listerClients() quand aucun
  // acquéreur réel n'existe encore.
  const aucunClientReel = total === 0 && !texte && !modeArchives;
  const clientsDemo = aucunClientReel ? await listerClients() : undefined;
  const clients = clientsDemo ?? clientsPage;
  const totalAffiche = clientsDemo ? clientsDemo.length : total;
  const totalPages = Math.max(1, Math.ceil(totalAffiche / PAR_PAGE));

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] md:text-[28px] font-semibold text-text-1 leading-tight">
            {modeArchives ? "Acquéreurs archivés" : "Clients"}
          </h1>
          <p className="text-[14px] text-text-3 mt-1">
            {totalAffiche} {modeArchives ? "acquéreurs archivés" : "acquéreurs"}
          </p>
        </div>
        {!modeArchives && (
          <Link
            href="/clients/nouveau"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3.5 py-2 rounded-lg shrink-0"
          >
            <Plus size={14} />
            Ajouter un acquéreur
          </Link>
        )}
      </div>

      <Link
        href={construireHref({ archives: !modeArchives, q: texte })}
        className="inline-block text-[13px] font-medium text-accent hover:text-accent-hover transition-colors mb-6"
      >
        {modeArchives ? "← Voir les acquéreurs actifs" : "Voir les archives →"}
      </Link>

      <ChampRecherche
        action="/clients"
        q={texte}
        placeholder="Rechercher par nom, prénom…"
        champsCaches={modeArchives ? { archives: "1" } : undefined}
        hrefEffacer={construireHref({ archives: modeArchives })}
      />

      <section>
        <SectionTitle>{modeArchives ? "Acquéreurs archivés" : "Acquéreurs"}</SectionTitle>
        {clients.length === 0 ? (
          <p className="text-[14px] text-text-3">
            {texte
              ? `Aucun résultat pour « ${texte} ».`
              : modeArchives
                ? "Aucun acquéreur archivé."
                : "Aucun acquéreur actif."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {clients.map((client) => (
              <Link key={client.id} href={`/clients/${client.id}`}>
                <Card variant="interactive">
                  <div className="flex items-center gap-4 p-3">
                    <Avatar initiales={`${client.prenom.charAt(0)}${client.nom.charAt(0)}`} size={40} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-text-1 truncate">
                        {client.prenom} {client.nom}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[13px] text-text-2">
                          {formatPrix(client.budgetMin)} – {formatPrix(client.budgetMax)}
                        </span>
                        <Badge variant="default">{stadeLabel[client.stadeProjet] ?? client.stadeProjet}</Badge>
                        {client.archiveLe && (
                          <Badge variant="muted">Archivé le {formatDate(client.archiveLe)}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {!clientsDemo && (
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
