import Card from "@/components/ui/Card";
import SectionTitle from "@/components/ui/SectionTitle";
import {
  chargerResultats,
  chargerPipeline,
  chargerActivite,
  chargerDelais,
  chargerPertes,
  chargerRemuneration,
  chargerProjectionAnnuelle,
  chargerPipelineVendeur,
  type MontantParMois,
  type MontantCentimesParMois,
  type MontantCentimesParMoisAnnuel,
  type PerteParMotif,
} from "@/lib/dashboardRepository";
import { LABEL_MOTIF_PERTE } from "@/types/motifPerte";
import { formatMontantCentimes } from "@/types/remuneration";
import { LABEL_STATUT_PROSPECT_VENDEUR } from "@/types/prospectVendeur";

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

// Inconnu ≠ zéro (ADR-021) : une population sans aucune ligne remuneration renseignée affiche
// "Pas encore renseignée", jamais "0 €" — un total à 0 laisserait croire à une mesure exhaustive.
function formatMontantCentimesOuInconnu(centimes: number | undefined): string {
  if (centimes === undefined) return "Pas encore renseignée";
  return formatMontantCentimes(centimes);
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
      <p className="text-[12px] text-text-3">{label}</p>
      <p className="text-[22px] font-semibold text-text-1 leading-tight">{valeur}</p>
      {reserve && <p className="text-[11px] text-text-3 leading-snug">{reserve}</p>}
    </div>
  );
}

function ParMoisListe({ items }: { items: MontantParMois[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-text-3">Aucune donnée pour l'instant.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(({ mois, montant }) => (
        <li key={mois} className="flex items-center justify-between text-[13px]">
          <span className="text-text-2 capitalize">{formatMois(mois)}</span>
          <span className="font-medium text-text-1">{formatPrix(montant)}</span>
        </li>
      ))}
    </ul>
  );
}

function ParMoisCentimesListe({ items }: { items: MontantCentimesParMois[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-text-3">Aucune donnée pour l'instant.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(({ mois, montantCentimes }) => (
        <li key={mois} className="flex items-center justify-between text-[13px]">
          <span className="text-text-2 capitalize">{formatMois(mois)}</span>
          <span className="font-medium text-text-1">{formatMontantCentimes(montantCentimes)}</span>
        </li>
      ))}
    </ul>
  );
}

// Toujours 12 lignes (janvier -> décembre, zero-remplies côté SQL) — jamais "Pas encore
// renseignée" par cellule : le zero-remplissage garantit qu'une valeur existe pour chaque mois.
// Un 0 € signifie "0 € parmi les rémunérations disposant d'une date permettant de les positionner
// dans ce mois", pas une couverture exhaustive — voir la réserve affichée sous le tableau.
function VentilationAnnuelleTable({ items }: { items: MontantCentimesParMoisAnnuel[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] text-text-3">
            <th className="font-medium pb-1.5 pr-3">Mois</th>
            <th className="font-medium pb-1.5 pr-3">Prévisionnel</th>
            <th className="font-medium pb-1.5 pr-3">Finalisé non encaissé</th>
            <th className="font-medium pb-1.5">Encaissé</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ mois, previsionnelCentimes, finaliseNonEncaisseCentimes, encaisseCentimes }) => (
            <tr key={mois} className="border-t border-border">
              <td className="py-1.5 pr-3 text-text-2 capitalize">{formatMois(mois)}</td>
              <td className="py-1.5 pr-3 text-text-1">{formatMontantCentimes(previsionnelCentimes)}</td>
              <td className="py-1.5 pr-3 text-text-1">{formatMontantCentimes(finaliseNonEncaisseCentimes)}</td>
              <td className="py-1.5 text-text-1">{formatMontantCentimes(encaisseCentimes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Motif NULL historique jamais affiché ici ni reclassé (ADR-020) : la liste ne contient que les
// motifs explicitement renseignés — voir la réserve affichée au-dessus de chaque liste.
function ParMotifListe({ items }: { items: PerteParMotif[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-text-3">Aucune perte avec motif renseigné pour l'instant.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(({ motif, nombre, volume }) => (
        <li key={motif} className="flex items-center justify-between text-[13px]">
          <span className="text-text-2">
            {LABEL_MOTIF_PERTE[motif]} <span className="text-text-3">({nombre})</span>
          </span>
          <span className="font-medium text-text-1">{formatPrix(volume)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const [resultats, pipeline, activite, delais, pertes, remuneration, projection, pipelineVendeur] = await Promise.all([
    chargerResultats(),
    chargerPipeline(),
    chargerActivite(),
    chargerDelais(),
    chargerPertes(),
    chargerRemuneration(),
    chargerProjectionAnnuelle(),
    chargerPipelineVendeur(),
  ]);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-[22px] md:text-[28px] font-semibold text-text-1 leading-tight">Tableau de bord</h1>
        <p className="text-[14px] text-text-3 mt-1">Vue d'ensemble de l'activité commerciale</p>
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">Réalisé par mois</p>
          <ParMoisListe items={resultats.realiseParMois} />
        </Card>
      </section>

      <section id="remuneration" className="mb-8">
        <SectionTitle>Rémunération</SectionTitle>
        <Card className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5 mb-6">
            <MetricCard
              label="Rémunération prévisionnelle"
              valeur={formatMontantCentimesOuInconnu(remuneration.remunerationPrevisionnelleCentimes)}
              reserve={`Biens archivés exclus. Renseignée sur ${remuneration.nombreRemunerationsPrevisionnellesRenseignees} compromis en cours sur ${remuneration.nombreCompromisEnCoursEligibles}.`}
            />
            <MetricCard
              label="Rémunération associée à une vente finalisée"
              valeur={formatMontantCentimesOuInconnu(remuneration.remunerationVenteFinaliseeNonEncaisseeCentimes)}
              reserve={`Vente finalisée non encaissée, biens archivés inclus. Renseignée sur ${remuneration.nombreRemunerationsVentesFinaliseesRenseignees} ventes finalisées sur ${remuneration.nombreVentesFinalisees}.`}
            />
            <MetricCard
              label="Rémunération encaissée"
              valeur={formatMontantCentimesOuInconnu(remuneration.remunerationEncaisseeCentimes)}
              reserve="Biens archivés inclus."
            />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
            Rémunération encaissée par mois
          </p>
          <ParMoisCentimesListe items={remuneration.remunerationEncaisseeParMoisCentimes} />
        </Card>
      </section>

      <section id="projection" className="mb-8">
        <SectionTitle>Projection {projection.annee}</SectionTitle>
        <Card className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-6">
            <MetricCard
              label="Encaissé depuis le 1er janvier"
              valeur={formatMontantCentimesOuInconnu(projection.encaisseDepuisJanvierCentimes)}
              reserve={`Biens archivés inclus. ${remuneration.nombreRemunerationsVentesFinaliseesRenseignees}/${remuneration.nombreVentesFinalisees} ventes finalisées disposent d'une rémunération renseignée — ce montant ne peut refléter que celles-ci.`}
            />
            <MetricCard
              label="Finalisé non encaissé à ce jour"
              valeur={formatMontantCentimesOuInconnu(remuneration.remunerationVenteFinaliseeNonEncaisseeCentimes)}
              reserve="Toutes années confondues. Les rémunérations sans date d'encaissement prévue restent incluses dans ce total mais sont absentes de la ventilation mensuelle."
            />
            <MetricCard
              label="Prévisionnel restant jusqu'au 31 décembre"
              valeur={formatMontantCentimesOuInconnu(projection.previsionnelRestantCentimes)}
              reserve={`Biens archivés exclus. ${remuneration.nombreCompromisEnCoursEligibles} compromis en cours éligibles. ${remuneration.nombreRemunerationsPrevisionnellesRenseignees}/${remuneration.nombreCompromisEnCoursEligibles} disposent d'une rémunération renseignée. ${projection.nombreRemunerationsPrevisionnellesAvecDatePrevue}/${remuneration.nombreRemunerationsPrevisionnellesRenseignees} disposent en plus d'une date d'encaissement prévue.`}
            />
            <MetricCard
              label="Encaissements attendus dépassés"
              valeur={formatMontantCentimesOuInconnu(projection.encaissementsAttendusDepassesCentimes)}
              reserve={`${projection.nombreEncaissementsAttendusDepasses} vente(s) concernée(s). Biens archivés inclus. ${remuneration.nombreVentesFinalisees} ventes finalisées au total, ${remuneration.nombreRemunerationsVentesFinaliseesRenseignees}/${remuneration.nombreVentesFinalisees} disposent d'une rémunération renseignée. Parmi les ventes non encore encaissées, ${projection.nombreFinaliseNonEncaisseAvecDatePrevue}/${projection.nombreFinaliseNonEncaisseRenseignees} disposent en plus d'une date d'encaissement prévue.`}
            />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
            Janvier → décembre {projection.annee}
          </p>
          <VentilationAnnuelleTable items={projection.ventilationMensuelle} />
          <p className="text-[11px] text-text-3 mt-2">
            {`Ventilation limitée aux rémunérations avec une date connue (${projection.nombreRemunerationsPrevisionnellesAvecDatePrevue}/${remuneration.nombreRemunerationsPrevisionnellesRenseignees} prévisionnelles, ${projection.nombreFinaliseNonEncaisseAvecDatePrevue}/${projection.nombreFinaliseNonEncaisseRenseignees} finalisées non encaissées) — les totaux globaux ci-dessus incluent aussi celles sans date. Un mois passé non nul dans la colonne "Prévisionnel" ne signifie pas un dépassement au sens de "Encaissements attendus dépassés", strictement réservée aux compromis réalisés.`}
          </p>
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
            Pipeline prévisionnel par mois
          </p>
          <p className="text-[11px] text-text-3 mb-2">
            Basé sur la date d'acte prévue des compromis en cours — non garantie, sujette à décalage ou annulation.
          </p>
          <ParMoisListe items={pipeline.pipelinePrevisionnelParMois} />
        </Card>
      </section>

      <section className="mb-8">
        <SectionTitle>Pipeline vendeur</SectionTitle>
        <Card className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-6">
            <MetricCard label="Prospects en cours" valeur={pipelineVendeur.nombreEnCours.toString()} />
            <MetricCard
              label="Estimations en cours"
              valeur={formatMontantCentimesOuInconnu(pipelineVendeur.volumeEstimationsEnCoursCentimes)}
              reserve={`${pipelineVendeur.nombreEstimationsEnCoursRenseignees}/${pipelineVendeur.nombreEnCours} prospects en cours disposent d'une estimation renseignée.`}
            />
            <MetricCard
              label="Taux de conversion (parmi les opportunités clôturées)"
              valeur={formatPourcentage(pipelineVendeur.tauxConversionOpportunitesCloturees)}
              reserve={`${pipelineVendeur.nombreSignes} signé(s) sur ${pipelineVendeur.nombreSignes + pipelineVendeur.nombrePerdus} opportunité(s) clôturée(s) (signées + perdues). Les prospects encore en cours n'entrent jamais dans ce ratio.`}
            />
            <MetricCard
              label="Délai moyen prospect → mandat signé"
              valeur={formatJours(pipelineVendeur.delaiMoyenProspectMandatSigneJours)}
            />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
            Répartition des prospects en cours par statut
          </p>
          {pipelineVendeur.nombreEnCours === 0 ? (
            <p className="text-[13px] text-text-3">Aucun prospect en cours pour l'instant.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {Object.entries(pipelineVendeur.nombreParStatutEnCours)
                .filter(([, nombre]) => nombre > 0)
                .map(([statut, nombre]) => (
                  <li key={statut} className="flex items-center justify-between text-[13px]">
                    <span className="text-text-2">
                      {LABEL_STATUT_PROSPECT_VENDEUR[statut as keyof typeof LABEL_STATUT_PROSPECT_VENDEUR]}
                    </span>
                    <span className="font-medium text-text-1">{nombre}</span>
                  </li>
                ))}
            </ul>
          )}
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

      <section className="mb-8">
        <SectionTitle>Délais</SectionTitle>
        <Card className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
            <MetricCard
              label="Délai offre → compromis"
              valeur={formatJours(delais.delaiMoyenOffreCompromisJours)}
              reserve="Uniquement les compromis liés à une offre enregistrée."
            />
            <MetricCard label="Délai compromis → acte" valeur={formatJours(delais.delaiMoyenCompromisActeJours)} />
            <MetricCard
              label="Délai moyen entre une visite liée et l'offre"
              valeur={formatJours(delais.delaiMoyenVisiteOffreJours)}
              reserve="Calculé uniquement à partir des visites explicitement associées à une offre."
            />
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Pertes commerciales</SectionTitle>
        <Card className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-6">
            <MetricCard label="Offres refusées" valeur={pertes.offresRefusees.toString()} />
            <MetricCard label="Offres retirées" valeur={pertes.offresRetirees.toString()} />
            <MetricCard
              label="Volume des offres perdues"
              valeur={formatPrix(pertes.volumeOffresPerdues)}
              reserve="Montant proposé, jamais accepté — pas un chiffre d'affaires."
            />
            <MetricCard label="Compromis annulés" valeur={pertes.compromisAnnules.toString()} />
            <MetricCard
              label="Volume de transactions interrompues"
              valeur={formatPrix(pertes.volumeCompromisAnnules)}
              reserve="Volume de transaction, pas un chiffre d'affaires."
            />
          </div>

          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
            Offres perdues par motif
          </p>
          <p className="text-[11px] text-text-3 mb-2">Calculé uniquement sur les pertes disposant d'un motif renseigné.</p>
          <ParMotifListe items={pertes.pertesOffresParMotif} />

          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2 mt-6">
            Compromis annulés par motif
          </p>
          <p className="text-[11px] text-text-3 mb-2">Calculé uniquement sur les pertes disposant d'un motif renseigné.</p>
          <ParMotifListe items={pertes.pertesCompromisParMotif} />

          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2 mt-6">
            Offres perdues par mois
          </p>
          <p className="text-[11px] text-text-3 mb-2">
            Calculé uniquement sur les pertes disposant d'une date de décision fiable.
          </p>
          <ParMoisListe items={pertes.pertesOffresParMois} />

          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2 mt-6">
            Compromis annulés par mois
          </p>
          <p className="text-[11px] text-text-3 mb-2">
            Calculé uniquement sur les pertes disposant d'une date d'annulation fiable.
          </p>
          <ParMoisListe items={pertes.pertesCompromisParMois} />
        </Card>
      </section>
    </div>
  );
}
