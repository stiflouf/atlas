import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { creerActionAction } from "@/actions/creerAction";
import { listerBiens } from "@/lib/bienRepository";
import { listerClients } from "@/lib/clientRepository";

const inputCls =
  "w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]";
const labelCls = "text-[12px] font-medium text-[#64748b] mb-1 block";

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx) : sans ce
// flag, les select bien/acquéreur figeraient la liste au moment du build.
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ bienId?: string; acquereurId?: string }> };

export default async function NouvelleActionPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [biens, clients] = await Promise.all([listerBiens(), listerClients()]);

  // Préremplissage depuis une fiche bien/client (?bienId=/?acquereurId=) : uniquement si l'id
  // correspond réellement à une entrée chargée, sinon le select reste simplement sur "Aucun" —
  // pas d'erreur pour un id obsolète ou mal formé.
  const bienIdPreselectionne = biens.some((b) => b.id === params.bienId) ? params.bienId : "";
  const acquereurIdPreselectionne = clients.some((c) => c.id === params.acquereurId) ? params.acquereurId : "";

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Aujourd'hui
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-6">
        Nouvelle action
      </h1>

      <form action={creerActionAction} className="flex flex-col gap-4">
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
          <input name="echeance" type="date" className={inputCls} />
        </div>

        <div className="border-t border-[#f1f5f9] pt-4 mt-2">
          <p className="text-[12px] text-[#94a3b8] mb-3">
            Une action peut concerner un bien, un acquéreur, les deux, ou ni l'un ni l'autre
            pour une tâche générale.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Bien</label>
              <select name="bienId" defaultValue={bienIdPreselectionne} className={inputCls}>
                <option value="">Aucun</option>
                {biens.map((bien) => (
                  <option key={bien.id} value={bien.id}>
                    {bien.titre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Acquéreur</label>
              <select name="acquereurId" defaultValue={acquereurIdPreselectionne} className={inputCls}>
                <option value="">Aucun</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.prenom} {client.nom}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="self-start mt-2 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-4 py-2.5 rounded-lg"
        >
          Créer l'action
        </button>
      </form>
    </div>
  );
}
