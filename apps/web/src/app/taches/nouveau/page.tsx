import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { creerTacheAction } from "@/actions/creerTache";
import CibleTacheSelecteur from "@/components/tache/CibleTacheSelecteur";
import { listerBiens } from "@/lib/bienRepository";
import { listerClients } from "@/lib/clientRepository";
import { listerProspectsVendeurs } from "@/lib/prospectVendeurRepository";

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx) : sans ce
// flag, les select bien/acquéreur/prospect vendeur figeraient la liste au moment du build.
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ bienId?: string; acquereurId?: string; prospectVendeurId?: string }> };

export default async function NouvelleTachePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [biens, clients, prospects] = await Promise.all([
    listerBiens(),
    listerClients(),
    listerProspectsVendeurs(),
  ]);

  // Préremplissage depuis une fiche (?bienId=/?acquereurId=/?prospectVendeurId=) : uniquement si
  // l'id correspond réellement à une entrée chargée, sinon le select reste sur "Aucun" — pas
  // d'erreur pour un id obsolète ou mal formé. Priorité bien > acquéreur > prospect vendeur si
  // plusieurs paramètres étaient malgré tout présents simultanément dans l'URL (aucun point
  // d'entrée actuel — BienStatutAction/AcquereurHero — n'en génère qu'un seul à la fois ; garde
  // défensive uniquement, cohérente avec le garde backend "au plus une cible").
  const bienIdValide = biens.some((b) => b.id === params.bienId) ? params.bienId : undefined;
  const acquereurIdValide = clients.some((c) => c.id === params.acquereurId) ? params.acquereurId : undefined;
  const prospectVendeurIdValide = prospects.some((p) => p.id === params.prospectVendeurId)
    ? params.prospectVendeurId
    : undefined;

  const bienIdPreselectionne = bienIdValide ?? "";
  const acquereurIdPreselectionne = !bienIdValide && acquereurIdValide ? acquereurIdValide : "";
  const prospectVendeurIdPreselectionne =
    !bienIdValide && !acquereurIdValide && prospectVendeurIdValide ? prospectVendeurIdValide : "";

  // Retour dérivé de la cible réellement préremplie (correctif UX) — jamais un returnUrl
  // arbitraire pris depuis l'URL : uniquement l'un des trois ids déjà validés ci-dessus contre les
  // entités réellement chargées. Sans contexte, comportement générique inchangé (retour "/").
  const redirectTo = bienIdPreselectionne
    ? `/biens/${bienIdPreselectionne}`
    : acquereurIdPreselectionne
      ? `/clients/${acquereurIdPreselectionne}`
      : prospectVendeurIdPreselectionne
        ? `/prospects-vendeurs/${prospectVendeurIdPreselectionne}`
        : "/";

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Aujourd'hui
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mb-6">
        Nouvelle tâche
      </h1>

      <form action={creerTacheAction} className="flex flex-col gap-4">
        <div>
          <label className={labelCls}>Titre *</label>
          <input
            name="titre"
            required
            className={inputCls}
            placeholder="Relancer Mme Dupont concernant la maison de Sainte-Geneviève"
          />
        </div>

        <div>
          <label className={labelCls}>Contexte</label>
          <textarea name="contexte" rows={3} className={inputCls} placeholder="Appeler avant vendredi" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Type</label>
            <select name="type" defaultValue="autre" className={inputCls}>
              <option value="appel">Appel</option>
              <option value="email">Email</option>
              <option value="message">Message</option>
              <option value="document">Document</option>
              <option value="relance">Relance</option>
              <option value="autre">Autre</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Priorité</label>
            <select name="priorite" defaultValue="normale" className={inputCls}>
              <option value="haute">Haute</option>
              <option value="normale">Normale</option>
              <option value="basse">Basse</option>
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>Échéance</label>
          <input name="echeance" type="date" className={inputCls} placeholder="Sans échéance" />
        </div>

        <input type="hidden" name="redirectTo" value={redirectTo} />

        <CibleTacheSelecteur
          biens={biens.map((bien) => ({ id: bien.id, label: bien.titre }))}
          acquereurs={clients.map((client) => ({ id: client.id, label: `${client.prenom} ${client.nom}` }))}
          prospectsVendeurs={prospects.map((prospect) => ({
            id: prospect.id,
            label: `${prospect.prenom ? `${prospect.prenom} ` : ""}${prospect.nom}`,
          }))}
          bienIdInitial={bienIdPreselectionne}
          acquereurIdInitial={acquereurIdPreselectionne}
          prospectVendeurIdInitial={prospectVendeurIdPreselectionne}
        />

        <button
          type="submit"
          className="self-start mt-2 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-4 py-2.5 rounded-lg"
        >
          Créer la tâche
        </button>
      </form>
    </div>
  );
}
