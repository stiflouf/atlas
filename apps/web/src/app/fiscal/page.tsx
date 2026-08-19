import { PRODUCT_NAME } from "@/lib/branding";
import { obtenirDossierFiscalDefaut } from "@/lib/dossierFiscalRepository";
import { chargerProfilFiscalActuel } from "@/lib/profilFiscalRepository";
import { chargerHistoriqueAmorcage } from "@/lib/historiqueAmorcageRepository";
import { chargerRfrFoyer } from "@/lib/rfrFoyerRepository";
import { calculerCotisationsSociales } from "@/lib/fiscal/cotisationsSociales";
import { calculerCfp } from "@/lib/fiscal/cfp";
import { calculerVersementLiberatoire, verifierEligibiliteRfr } from "@/lib/fiscal/versementLiberatoire";
import { calculerMicroBnc } from "@/lib/fiscal/microBnc";
import { calculerFranchiseTva } from "@/lib/fiscal/franchiseTva";
import { calculerProjectionFinAnnee } from "@/lib/fiscal/projectionFinAnnee";
import { calculerProjectionPluriannuelle, HORIZON_PROJECTION_ANNEES } from "@/lib/fiscal/projectionPluriannuelle";
import { enregistrerProfilFiscalAction } from "@/actions/profilFiscal";
import { enregistrerHistoriqueAmorcageAction } from "@/actions/historiqueAmorcage";
import { enregistrerRfrFoyerAction } from "@/actions/rfrFoyer";
import ProfilFiscalFormulaire from "@/components/fiscal/ProfilFiscalFormulaire";
import ProfilFiscalResume from "@/components/fiscal/ProfilFiscalResume";
import HistoriqueAmorcageFormulaire from "@/components/fiscal/HistoriqueAmorcageFormulaire";
import RfrFoyerFormulaire from "@/components/fiscal/RfrFoyerFormulaire";
import VueAnneeResume from "@/components/fiscal/VueAnneeResume";
import ProjectionPluriannuelle from "@/components/fiscal/ProjectionPluriannuelle";
import { formatMontantCentimes, parseMontantCentimes } from "@/types/remuneration";
import { Landmark } from "lucide-react";
import Card from "@/components/ui/Card";
import IconTile from "@/components/ui/IconTile";

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx) : sans ce
// flag, la page figerait au moment du build.
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// ADR-023 (fondations : profil, amorçage, RFR) + ADR-024 (moteur fiscal année courante, "Vue
// {année}") + ADR-025 (projection pluriannuelle N+1 à N+5, ci-dessous). Le référentiel légal
// (regle_fiscale) n'est jamais affiché brut — uniquement via les moteurs fiscal/* et leur
// provenance (ExplicationCalcul/ExplicationCalculProjection).
export default async function FiscalPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const dossierFiscalId = await obtenirDossierFiscalDefaut();
  const [profilActuel, historique, rfr] = await Promise.all([
    chargerProfilFiscalActuel(dossierFiscalId),
    chargerHistoriqueAmorcage(dossierFiscalId),
    chargerRfrFoyer(dossierFiscalId),
  ]);
  const anneeCourante = new Date().getFullYear();
  const [cotisations, cfp, vfl, eligibiliteRfr, microBnc, franchiseTva, projection] = profilActuel
    ? await Promise.all([
        calculerCotisationsSociales(dossierFiscalId, anneeCourante),
        calculerCfp(dossierFiscalId, anneeCourante),
        calculerVersementLiberatoire(dossierFiscalId, anneeCourante),
        verifierEligibiliteRfr(dossierFiscalId, anneeCourante),
        calculerMicroBnc(dossierFiscalId, anneeCourante),
        calculerFranchiseTva(dossierFiscalId, anneeCourante),
        calculerProjectionFinAnnee(dossierFiscalId, anneeCourante),
      ])
    : [];

  // Hypothèses utilisateur ADR-025 : lues depuis la query string d'un formulaire GET natif,
  // jamais persistées (correction n° 5) — valables uniquement pour cette requête.
  const hypotheses: Record<number, number> = {};
  for (let annee = anneeCourante + 1; annee <= anneeCourante + HORIZON_PROJECTION_ANNEES; annee++) {
    const brut = params[`hypothese_${annee}`];
    const valeur = typeof brut === "string" ? parseMontantCentimes(brut) : undefined;
    if (valeur !== undefined) hypotheses[annee] = valeur;
  }
  const projectionsPluriannuelles = profilActuel
    ? await calculerProjectionPluriannuelle(dossierFiscalId, anneeCourante + 1, HORIZON_PROJECTION_ANNEES, hypotheses)
    : undefined;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <div className="flex items-start gap-3 mb-6">
        <IconTile icon={Landmark} tone="navy" size={36} iconSize={17} className="mt-0.5" />
        <div>
          <h1 className="font-serif text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight">
            Ma situation fiscale
          </h1>
          <p className="text-[13px] text-text-2 mt-1">
            Ces informations permettent à {PRODUCT_NAME} de situer vos encaissements par rapport aux règles
            fiscales et sociales applicables.
          </p>
        </div>
      </div>

      {profilActuel && (
        <section className="mb-8">
          <ProfilFiscalResume profil={profilActuel} />
        </section>
      )}

      {profilActuel && cotisations && cfp && vfl && eligibiliteRfr && microBnc && franchiseTva && projection && (
        <section className="mb-10 border-t border-border pt-6">
          <VueAnneeResume
            annee={anneeCourante}
            cotisations={cotisations}
            cfp={cfp}
            vfl={vfl}
            eligibiliteRfr={eligibiliteRfr}
            microBnc={microBnc}
            franchiseTva={franchiseTva}
            projection={projection}
          />
        </section>
      )}

      {profilActuel && projectionsPluriannuelles && (
        <section className="mb-10 border-t border-border pt-6">
          <h2 className="text-[15px] font-semibold text-text-1 mb-1">
            Projection {anneeCourante + 1}–{anneeCourante + HORIZON_PROJECTION_ANNEES}
          </h2>
          <p className="text-[12px] text-text-3 mb-3">
            Aucun changement de régime ci-dessous n&apos;est une certitude juridique — uniquement des
            projections à partir de votre pipeline commercial et de votre rythme d&apos;activité passé.
          </p>
          <ProjectionPluriannuelle projections={projectionsPluriannuelles} />
        </section>
      )}

      <section id="profil" className="mb-10">
        <Card variant="elevated" className="p-5">
          <h2 className="text-[15px] font-semibold text-text-1 mb-3">
            {profilActuel ? "Enregistrer un changement de situation" : "Renseigner ma situation"}
          </h2>
          <ProfilFiscalFormulaire profilActuel={profilActuel} action={enregistrerProfilFiscalAction} />
        </Card>
      </section>

      <section id="amorcage" className="mb-10 border-t border-border pt-6">
        <h2 className="text-[15px] font-semibold text-text-1 mb-1">Recettes des années précédentes</h2>
        <p className="text-[12px] text-text-3 mb-3">
          Optionnel — utile pour situer votre chiffre d&apos;affaires par rapport aux seuils légaux dès
          votre arrivée sur {PRODUCT_NAME}, même si votre activité a commencé avant.
        </p>
        {historique.length > 0 && (
          <ul className="mb-4 flex flex-col gap-1">
            {historique.map((h) => (
              <li
                key={h.annee}
                className="text-[13px] text-text-1 flex justify-between border-b border-border py-1.5"
              >
                <span>
                  {h.annee} (jusqu&apos;au {h.dateFinCouverture})
                </span>
                <span className="font-medium">{formatMontantCentimes(h.montantEncaisseCentimes)}</span>
              </li>
            ))}
          </ul>
        )}
        <HistoriqueAmorcageFormulaire action={enregistrerHistoriqueAmorcageAction} />
      </section>

      <section id="rfr" className="border-t border-border pt-6">
        <h2 className="text-[15px] font-semibold text-text-1 mb-1">Revenu fiscal de référence du foyer</h2>
        <p className="text-[12px] text-text-3 mb-3">
          Optionnel — utile seulement si vous voulez que {PRODUCT_NAME} surveille votre éligibilité au
          versement libératoire pour les années à venir. Ignorez si vous ne voulez pas ce suivi.
        </p>
        {rfr.length > 0 && (
          <ul className="mb-4 flex flex-col gap-1">
            {rfr.map((r) => (
              <li
                key={r.anneeRfr}
                className="text-[13px] text-text-1 flex justify-between border-b border-border py-1.5"
              >
                <span>
                  {r.anneeRfr} ({(r.nombrePartsCentiemes / 100).toLocaleString("fr-FR")} part
                  {r.nombrePartsCentiemes > 100 ? "s" : ""})
                </span>
                <span className="font-medium">{formatMontantCentimes(r.rfrFoyerCentimes)}</span>
              </li>
            ))}
          </ul>
        )}
        <RfrFoyerFormulaire action={enregistrerRfrFoyerAction} />
      </section>
    </div>
  );
}
