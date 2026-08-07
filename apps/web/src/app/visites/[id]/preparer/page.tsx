import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, User, TrendingDown } from "lucide-react";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import PrepObjections from "@/components/visite/PrepObjections";
import { getPreparationByRdvId } from "@/data/preparations";

type PageProps = { params: Promise<{ id: string }> };

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatPrixM2(prixM2: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prixM2) + "/m²";
}

const stadeLabel: Record<string, string> = {
  decouverte: "Découverte",
  recherche_active: "Recherche active",
  offre: "En attente d'offre",
  compromis: "Compromis",
  acte: "Acte",
};

export default async function PreparerVisite({ params }: PageProps) {
  const { id } = await params;
  const prep = getPreparationByRdvId(id);
  if (!prep) notFound();

  const { bien, acquereur: aq, analyseMarche: marche, contextQuartier: quartier } = prep;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      {/* Retour */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Aujourd'hui
      </Link>

      {/* En-tête */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="accent">Préparation de visite</Badge>
          <span className="text-[13px] text-[#94a3b8]">{prep.heureVisite}</span>
        </div>
        <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mt-2">
          {bien.titre}
        </h1>
        <p className="text-[14px] text-[#64748b] mt-0.5">{bien.adresse}, {bien.codePostal} {bien.ville}</p>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <span className="text-[15px] font-semibold text-[#0f172a]">{formatPrix(bien.prix)}</span>
          <span className="text-[13px] text-[#94a3b8]">{bien.surface} m² · {bien.pieces} pièces</span>
        </div>
      </div>

      {/* Profil acquéreur */}
      <section className="mb-8 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <User size={15} className="text-[#94a3b8]" strokeWidth={1.8} />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
            Acquéreur
          </span>
        </div>
        <p className="text-[15px] font-medium text-[#0f172a]">
          {aq.prenom} {aq.nom}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="default">{stadeLabel[aq.stadeProjet]}</Badge>
          <Badge variant="muted">
            {formatPrix(aq.budgetMin)} – {formatPrix(aq.budgetMax)}
          </Badge>
        </div>
        {aq.criteres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {aq.criteres.map((c) => (
              <span key={c} className="text-[12px] bg-[#f8f9fa] text-[#64748b] px-2 py-0.5 rounded">
                {c}
              </span>
            ))}
          </div>
        )}
        {aq.notes && (
          <p className="text-[13px] text-[#94a3b8] mt-3 leading-relaxed border-t border-[#f1f5f9] pt-3">
            {aq.notes}
          </p>
        )}
      </section>

      {/* Points forts */}
      <section className="mb-8">
        <SectionTitle>Points forts à mettre en valeur</SectionTitle>
        <div className="flex flex-col gap-2">
          {prep.pointsForts.map((point, i) => (
            <div key={i} className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 flex items-start gap-3">
              <span className="text-[#4338ca] font-medium shrink-0 mt-0.5">·</span>
              <p className="text-[14px] text-[#0f172a] leading-snug">{point}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Vigilances */}
      <section className="mb-8">
        <SectionTitle>Points de vigilance</SectionTitle>
        <div className="flex flex-col gap-2">
          {prep.vigilances.map((v, i) => (
            <div key={i} className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 flex items-start gap-3">
              <span className="text-[#dc2626] shrink-0 mt-0.5 text-[13px] font-medium">!</span>
              <p className="text-[14px] text-[#64748b] leading-snug">{v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Questions */}
      <section className="mb-8">
        <SectionTitle>Questions à poser</SectionTitle>
        <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-[#f1f5f9]">
          {prep.questionsASuggerer.map((q, i) => (
            <p key={i} className="py-3 text-[14px] text-[#0f172a] leading-snug">
              {q}
            </p>
          ))}
        </div>
      </section>

      {/* Objections */}
      <section className="mb-8">
        <SectionTitle>Objections probables</SectionTitle>
        <PrepObjections objections={prep.objectionsProbables} />
      </section>

      {/* Contexte quartier */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <MapPin size={13} className="text-[#94a3b8]" strokeWidth={1.8} />
          <SectionTitle>Quartier</SectionTitle>
        </div>
        <p className="text-[14px] text-[#64748b] leading-relaxed mb-4">{quartier.description}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Transports</p>
            {quartier.transports.map((t) => (
              <p key={t} className="text-[13px] text-[#0f172a] py-0.5">{t}</p>
            ))}
          </div>
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Commerces</p>
            {quartier.commerces.map((c) => (
              <p key={c} className="text-[13px] text-[#0f172a] py-0.5">{c}</p>
            ))}
          </div>
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Écoles</p>
            {quartier.ecoles.map((e) => (
              <p key={e} className="text-[13px] text-[#0f172a] py-0.5">{e}</p>
            ))}
          </div>
          {quartier.pointsAttention.length > 0 && (
            <div className="bg-[#fef2f2] rounded-lg p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#dc2626] mb-2">À mentionner</p>
              {quartier.pointsAttention.map((p) => (
                <p key={p} className="text-[13px] text-[#64748b] py-0.5">{p}</p>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Analyse de marché */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown size={13} className="text-[#94a3b8]" strokeWidth={1.8} />
          <SectionTitle>Marché</SectionTitle>
        </div>

        <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 mb-3">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <p className="text-[11px] text-[#94a3b8] uppercase tracking-wider">Prix moyen secteur</p>
              <p className="text-[16px] font-semibold text-[#0f172a] mt-0.5">{formatPrixM2(marche.prixMoyenM2)}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#94a3b8] uppercase tracking-wider">Ce bien</p>
              <p className="text-[16px] font-semibold text-[#4338ca] mt-0.5">
                {formatPrixM2(Math.round(bien.prix / bien.surface))}
              </p>
            </div>
          </div>
          <p className="text-[13px] text-[#64748b] mt-3 leading-snug">{marche.ecartAvecMarche}</p>
          <p className="text-[13px] text-[#94a3b8] mt-1">{marche.tendance}</p>
        </div>

        <div className="flex flex-col gap-2">
          {marche.comparables.map((comp) => (
            <div key={comp.adresse} className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-[#64748b] truncate">{comp.adresse}</p>
                <p className="text-[11px] text-[#94a3b8] mt-0.5">
                  Vendu le {new Date(comp.dateVente).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[14px] font-medium text-[#0f172a]">{formatPrix(comp.prix)}</p>
                <p className="text-[11px] text-[#94a3b8]">{formatPrixM2(comp.prixM2)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Histoire locale */}
      {prep.histoireLocale && (
        <section className="mb-8">
          <SectionTitle>Histoire locale</SectionTitle>
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
            <p className="text-[14px] text-[#64748b] leading-relaxed">{prep.histoireLocale}</p>
          </div>
        </section>
      )}
    </div>
  );
}
