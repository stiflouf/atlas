import Card from "@/components/ui/Card";
import SectionTitle from "@/components/ui/SectionTitle";
import {
  chargerResultats,
  chargerPipeline,
  chargerActivite,
  chargerDelaisPertes,
  type MontantParMois,
} from "@/lib/dashboardRepository";

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx) : sans ce
// flag, le tableau de bord figerait au moment du build.
export const dynamic = "force-dynamic";

function formatPrix(montant: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    montant
  );
}

function formatPourcentage(taux: number | undefined): string {
  if (taux === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 }).format(taux);
}

function formatJours(jours: number | undefined): string {
  if (jours === undefined) return "—";
  const arrondi = Math.round(jours * 10) / 10;
  return `${arrondi} j`;
}

function formatMoyenne(valeur: number | undefined): string {
  if (valeur === undefined) return "—";
  return (Math.round(valeur * 10) / 10).toString();
}

function formatMois(mois: string): string {
  const [annee, moisNum] = mois.split("-");
  const date = new Date(Number(annee), Number(moisNum) - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function MetricCard({
  label,
  valeur,
  reserve,
}: {
  label: string;
  valeur: string;
  reserve?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[12px] text-[#94a3b8]">{label}</p>
      <p className="text-[22px] font-semibold text-[#0f172a] leading-tight">{valeur}</p>
      {reserve && <p className="text-[11px] text-[#94a3b8] leading-snug">{reserve}</p>}
    </div>
  );
}

function ParMoisListe({ items }: { items: MontantParMois[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-[#94a3b8]">Aucune donnée pour l'instant.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(({ mois, montant }) => (
        <li key={mois} className="flex items-center justify-between text-[13px]">
          <span className="text-[#64748b] capitalize">{formatMois(mois)}</span>
          <span className="font-medium text-[#0f172a]">{formatPrix(montant)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const [resultats, pipeline, activite, delaisPertes] = await Promise.all([
    chargerResultats(),
    chargerPipeline(),
    chargerActivite(),
    chargerDelaisPertes(),
  ]);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-[22px] md:text-[28px] font-semibold text-[#0f172a] leading-tight">Tableau de bord</h1>
        <p className="text-[14px] text-[#94a3b8] mt-1">Vue d'ensemble de l'activité commerciale</p>
      </div>

      <section className="mb-8">
        <SectionTitle>Résultats</SectionTitle>
        <Card className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5 mb-6">
            <MetricCard label="Ventes finalisées" valeur={resultats.nombreVentes.toString()} />
            <MetricCard
              label="Volume vendu"
              valeur={formatPrix(resultats.volumeVendu)}
              reserve="Volume de transaction, pas le chiffre d'affaires du conseiller."
            />
            <MetricCard
              label="Taux compromis → vente"
              valeur={formatPourcentage(resultats.tauxCompromisVente)}
              reserve="Calculé sur les compromis résolus (réalisés ou annulés)."
            />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Réalisé par mois</p>
          <ParMoisListe items={resultats.realiseParMois} />
        </Card>
      </section>

      <section className="mb-8">
        <SectionTitle>Pipeline</SectionTitle>
        <Card className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-6">
            <MetricCard
              label="Compromis en cours"
              valeur={pipeline.compromisEnCours.toString()}
              reserve="Biens archivés exclus."
            />
            <MetricCard
              label="Volume sous compromis"
              valeur={formatPrix(pipeline.volumeSousCompromis)}
              reserve="Biens archivés exclus."
            />
            <MetricCard
              label="Offres en cours"
              valeur={pipeline.offresEnCours.toString()}
              reserve="Biens archivés exclus."
            />
            <MetricCard
              label="Volume des offres en cours"
              valeur={formatPrix(pipeline.volumeOffresEnCours)}
              reserve="Biens archivés exclus."
            />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">
            Pipeline prévisionnel par mois
          </p>
          <p className="text-[11px] text-[#94a3b8] mb-2">
            Basé sur la date d'acte prévue des compromis en cours — non garantie, sujette à décalage ou annulation.
          </p>
          <ParMoisListe items={pipeline.pipelinePrevisionnelParMois} />
        </Card>
      </section>

      <section className="mb-8">
        <SectionTitle>Activité</SectionTitle>
        <Card className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <MetricCard label="Visites enregistrées" valeur={activite.visitesEnregistrees.toString()} />
            <MetricCard label="Offres enregistrées" valeur={activite.offresEnregistrees.toString()} />
            <MetricCard label="Compromis enregistrés" valeur={activite.compromisEnregistres.toString()} />
            <MetricCard
              label="Visites avant vente (moyenne)"
              valeur={formatMoyenne(activite.moyenneVisitesAvantVente)}
              reserve="Calculé uniquement sur les ventes disposant d'au moins un compte rendu de visite."
            />
            <MetricCard
              label="Taux visite → offre"
              valeur={formatPourcentage(activite.tauxVisiteOffre)}
              reserve="Calculé uniquement à partir des visites explicitement associées à une offre."
            />
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Délais et pertes</SectionTitle>
        <Card className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <MetricCard
              label="Délai offre → compromis"
              valeur={formatJours(delaisPertes.delaiMoyenOffreCompromisJours)}
              reserve="Uniquement les compromis liés à une offre enregistrée."
            />
            <MetricCard
              label="Délai compromis → acte"
              valeur={formatJours(delaisPertes.delaiMoyenCompromisActeJours)}
            />
            <MetricCard label="Compromis annulés" valeur={delaisPertes.compromisAnnules.toString()} />
            <MetricCard
              label="Volume des compromis annulés"
              valeur={formatPrix(delaisPertes.volumeCompromisAnnules)}
            />
            <MetricCard
              label="Délai moyen entre une visite liée et l'offre"
              valeur={formatJours(delaisPertes.delaiMoyenVisiteOffreJours)}
              reserve="Calculé uniquement à partir des visites explicitement associées à une offre."
            />
          </div>
        </Card>
      </section>
    </div>
  );
}
