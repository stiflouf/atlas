import { redirect } from "next/navigation";
import { BookUser } from "lucide-react";
import ChampRecherche from "@/components/ui/ChampRecherche";
import EmptyState from "@/components/ui/EmptyState";
import PaginationSuite from "@/components/ui/PaginationSuite";
import SectionTitle from "@/components/ui/SectionTitle";
import ContactResultatCard from "@/components/contact/ContactResultatCard";
import LegacyContactResultatCard from "@/components/contact/LegacyContactResultatCard";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { rechercherPersonnes } from "@/lib/recherchePersonneRepository";

// ADR-058 — le carnet humain du CRM : on cherche une PERSONNE, sans savoir si elle achète ou vend.
// La page ne fait qu'UN appel métier ; ranking, rôles, statuts et dernière interaction sont décidés
// par le read model, jamais recalculés ici.
//
// Une recherche rend les Contacts canoniques ET les dossiers historiques non rattachés, chacun sous
// sa propre carte : la page ne rapproche jamais deux résultats, même à identité identique. À
// requête vide, seuls les Contacts récents sont montrés (décision du read model).
//
// Recherche en GET (patron ADR-048) : `q` peut contenir un email ou un téléphone, donc figurer
// dans l'URL et l'historique du navigateur. Limite connue ; aucun terme n'est journalisé ici.

const PAR_PAGE = 25;

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx).
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ q?: string; page?: string }> };

function construireHref(params: { q?: string; page?: number }): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

export default async function ContactsPage({ searchParams }: PageProps) {
  const { q, page: pageBrut } = await searchParams;
  const texte = q?.trim() || undefined;
  const pageDemandee = Math.max(1, Number(pageBrut) || 1);

  // ADR-054 — le périmètre vient de la session, jamais d'un paramètre d'URL.
  const workspaceId = await exigerWorkspaceCourant();

  const { items: resultats, hasMore } = await rechercherPersonnes({
    workspaceId,
    q: texte,
    limite: PAR_PAGE,
    decalage: (pageDemandee - 1) * PAR_PAGE,
  });

  // Page hors bornes : sans total, la dernière page valide est inconnue — retour explicite à la
  // première plutôt qu'une page vide silencieuse (même intention qu'ADR-048).
  if (resultats.length === 0 && pageDemandee > 1) {
    redirect(construireHref({ q: texte }));
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-[22px] md:text-[28px] font-semibold text-text-1 leading-tight">Contacts</h1>
        <p className="text-[14px] text-text-3 mt-1">Retrouvez une personne et l’ensemble de ses projets.</p>
      </div>

      <ChampRecherche
        action="/contacts"
        q={texte}
        placeholder="Nom, prénom, email ou téléphone…"
        hrefEffacer={construireHref({})}
      />

      <section>
        <SectionTitle>{texte ? `Résultats pour « ${texte} »` : "Contacts récents"}</SectionTitle>
        {resultats.length === 0 ? (
          texte ? (
            <div className="text-[14px] text-text-3">
              <p>Aucun contact trouvé.</p>
              <p className="mt-1">Essayez avec un nom, un email ou un téléphone.</p>
            </div>
          ) : (
            <EmptyState
              icon={BookUser}
              titre="Aucun contact pour le moment."
              message="Les personnes que vous enregistrez comme acquéreur ou prospect vendeur apparaîtront ici."
            />
          )
        ) : (
          <div className="flex flex-col gap-2">
            {resultats.map((resultat) =>
              resultat.type === "contact" ? (
                <ContactResultatCard key={`contact-${resultat.contactId}`} contact={resultat} />
              ) : (
                <LegacyContactResultatCard
                  key={`${resultat.type}-${resultat.type === "legacy_acquereur" ? resultat.acquereurId : resultat.prospectVendeurId}`}
                  resultat={resultat}
                  q={texte}
                />
              )
            )}
          </div>
        )}

        <PaginationSuite
          page={pageDemandee}
          hasMore={hasMore}
          construireHref={(p) => construireHref({ q: texte, page: p })}
        />
      </section>
    </div>
  );
}
