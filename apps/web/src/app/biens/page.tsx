import Link from "next/link";
import { Building2, ChevronRight, Plus } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import { listerBiens, listerBiensArchives } from "@/lib/bienRepository";

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx) : sans ce
// flag, la liste figerait au moment du build.
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ archives?: string }> };

export default async function BiensPage({ searchParams }: PageProps) {
  const { archives } = await searchParams;
  const modeArchives = archives === "1";
  const biens = modeArchives ? await listerBiensArchives() : await listerBiens();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] md:text-[28px] font-semibold text-[#0f172a] leading-tight">
            {modeArchives ? "Biens archivés" : "Biens"}
          </h1>
          <p className="text-[14px] text-[#94a3b8] mt-1">
            {biens.length} {modeArchives ? "biens archivés" : "mandats actifs"}
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
        href={modeArchives ? "/biens" : "/biens?archives=1"}
        className="inline-block text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors mb-6"
      >
        {modeArchives ? "← Voir les biens actifs" : "Voir les archives →"}
      </Link>

      <section>
        <SectionTitle>{modeArchives ? "Biens archivés" : "Mandats en cours"}</SectionTitle>
        {biens.length === 0 ? (
          <p className="text-[14px] text-[#94a3b8]">
            {modeArchives ? "Aucun bien archivé." : "Aucun bien actif."}
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
      </section>
    </div>
  );
}
