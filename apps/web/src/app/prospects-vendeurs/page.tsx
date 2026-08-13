import Link from "next/link";
import { User, Plus } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import {
  listerProspectsVendeurs,
  listerProspectsVendeursPerdus,
  listerProspectsVendeursConvertis,
  listerProspectsVendeursArchives,
} from "@/lib/prospectVendeurRepository";
import { deriverStatutProspectVendeur, LABEL_STATUT_PROSPECT_VENDEUR } from "@/types/prospectVendeur";
import { LABEL_ORIGINE_LEAD } from "@/types/origineLead";
import type { ProspectVendeur } from "@/types/prospectVendeur";

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx).
export const dynamic = "force-dynamic";

type Vue = "en_cours" | "perdus" | "convertis" | "archives";

const TITRE_VUE: Record<Vue, string> = {
  en_cours: "Prospects vendeurs",
  perdus: "Prospects perdus",
  convertis: "Prospects convertis",
  archives: "Prospects archivés",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Échéances dépassées et proches en premier (tri ascendant simple), aucune échéance en dernier.
function comparerParEcheance(a: ProspectVendeur, b: ProspectVendeur): number {
  if (!a.prochaineActionLe && !b.prochaineActionLe) return 0;
  if (!a.prochaineActionLe) return 1;
  if (!b.prochaineActionLe) return -1;
  return a.prochaineActionLe < b.prochaineActionLe ? -1 : a.prochaineActionLe > b.prochaineActionLe ? 1 : 0;
}

type PageProps = { searchParams: Promise<{ vue?: string }> };

export default async function ProspectsVendeursPage({ searchParams }: PageProps) {
  const { vue: vueBrute } = await searchParams;
  const vue: Vue = vueBrute === "perdus" || vueBrute === "convertis" || vueBrute === "archives" ? vueBrute : "en_cours";

  const prospects = await (vue === "perdus"
    ? listerProspectsVendeursPerdus()
    : vue === "convertis"
      ? listerProspectsVendeursConvertis()
      : vue === "archives"
        ? listerProspectsVendeursArchives()
        : listerProspectsVendeurs());

  if (vue === "en_cours") prospects.sort(comparerParEcheance);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] md:text-[28px] font-semibold text-[#0f172a] leading-tight">
            {TITRE_VUE[vue]}
          </h1>
          <p className="text-[14px] text-[#94a3b8] mt-1">{prospects.length} prospect{prospects.length > 1 ? "s" : ""}</p>
        </div>
        {vue === "en_cours" && (
          <Link
            href="/prospects-vendeurs/nouveau"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg shrink-0"
          >
            <Plus size={14} />
            Ajouter un prospect vendeur
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        {vue !== "en_cours" && (
          <Link href="/prospects-vendeurs" className="text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
            ← Voir les prospects en cours
          </Link>
        )}
        {vue !== "perdus" && (
          <Link href="/prospects-vendeurs?vue=perdus" className="text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
            Voir les perdus →
          </Link>
        )}
        {vue !== "convertis" && (
          <Link href="/prospects-vendeurs?vue=convertis" className="text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
            Voir les convertis →
          </Link>
        )}
        {vue !== "archives" && (
          <Link href="/prospects-vendeurs?vue=archives" className="text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
            Voir les archivés →
          </Link>
        )}
      </div>

      <section>
        <SectionTitle>{TITRE_VUE[vue]}</SectionTitle>
        {prospects.length === 0 ? (
          <p className="text-[14px] text-[#94a3b8]">Aucun prospect dans cette vue.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {prospects.map((prospect) => {
              const statut = deriverStatutProspectVendeur(prospect);
              const localisation = prospect.ville ?? prospect.secteurBienPotentiel ?? prospect.adresseBienPotentiel;
              return (
                <Link key={prospect.id} href={`/prospects-vendeurs/${prospect.id}`}>
                  <Card className="hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow duration-150">
                    <div className="flex items-center gap-4 p-4">
                      <div className="w-10 h-10 rounded-lg bg-[#eef2ff] flex items-center justify-center shrink-0">
                        <User size={18} className="text-[#4338ca]" strokeWidth={1.8} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-[#0f172a] truncate">
                          {prospect.prenom ? `${prospect.prenom} ` : ""}
                          {prospect.nom}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <Badge variant="default">{LABEL_STATUT_PROSPECT_VENDEUR[statut]}</Badge>
                          {prospect.origineLead && <Badge variant="muted">{LABEL_ORIGINE_LEAD[prospect.origineLead]}</Badge>}
                          {localisation && <span className="text-[13px] text-[#64748b]">{localisation}</span>}
                        </div>
                        {prospect.prochaineAction && (
                          <p className="text-[12px] text-[#94a3b8] mt-1.5">
                            {prospect.prochaineAction}
                            {prospect.prochaineActionLe && ` — ${formatDate(prospect.prochaineActionLe)}`}
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
      </section>
    </div>
  );
}
