import { obtenirDossierFiscalDefaut } from "@/lib/dossierFiscalRepository";
import { chargerProfilFiscalActuel } from "@/lib/profilFiscalRepository";
import { chargerHistoriqueAmorcage } from "@/lib/historiqueAmorcageRepository";
import { chargerRfrFoyer } from "@/lib/rfrFoyerRepository";
import { enregistrerProfilFiscalAction } from "@/actions/profilFiscal";
import { enregistrerHistoriqueAmorcageAction } from "@/actions/historiqueAmorcage";
import { enregistrerRfrFoyerAction } from "@/actions/rfrFoyer";
import ProfilFiscalFormulaire from "@/components/fiscal/ProfilFiscalFormulaire";
import ProfilFiscalResume from "@/components/fiscal/ProfilFiscalResume";
import HistoriqueAmorcageFormulaire from "@/components/fiscal/HistoriqueAmorcageFormulaire";
import RfrFoyerFormulaire from "@/components/fiscal/RfrFoyerFormulaire";
import { formatMontantCentimes } from "@/types/remuneration";

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx) : sans ce
// flag, la page figerait au moment du build.
export const dynamic = "force-dynamic";

// ADR-023 : fondations fiscales seulement — aucune estimation, aucun calcul, seulement la saisie
// du profil, de l'historique d'amorçage et du RFR optionnel. Le référentiel légal (regle_fiscale)
// n'est ni affiché ni consommé ici : cette page ne fait que collecter des faits, jamais les
// combiner (ADR-024).
export default async function FiscalPage() {
  const dossierFiscalId = await obtenirDossierFiscalDefaut();
  const [profilActuel, historique, rfr] = await Promise.all([
    chargerProfilFiscalActuel(dossierFiscalId),
    chargerHistoriqueAmorcage(dossierFiscalId),
    chargerRfrFoyer(dossierFiscalId),
  ]);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-2">
        Ma situation fiscale
      </h1>
      <p className="text-[13px] text-[#64748b] mb-6">
        Ces informations permettent à Atlas de situer vos encaissements par rapport aux règles
        fiscales et sociales applicables. Aucune estimation n&apos;est encore calculée à ce stade.
      </p>

      {profilActuel && (
        <section className="mb-8">
          <ProfilFiscalResume profil={profilActuel} />
        </section>
      )}

      <section className="mb-10">
        <h2 className="text-[15px] font-semibold text-[#0f172a] mb-3">
          {profilActuel ? "Enregistrer un changement de situation" : "Renseigner ma situation"}
        </h2>
        <ProfilFiscalFormulaire profilActuel={profilActuel} action={enregistrerProfilFiscalAction} />
      </section>

      <section className="mb-10 border-t border-[#f1f5f9] pt-6">
        <h2 className="text-[15px] font-semibold text-[#0f172a] mb-1">Recettes des années précédentes</h2>
        <p className="text-[12px] text-[#94a3b8] mb-3">
          Optionnel — utile pour situer votre chiffre d&apos;affaires par rapport aux seuils légaux dès
          votre arrivée sur Atlas, même si votre activité a commencé avant.
        </p>
        {historique.length > 0 && (
          <ul className="mb-4 flex flex-col gap-1">
            {historique.map((h) => (
              <li
                key={h.annee}
                className="text-[13px] text-[#0f172a] flex justify-between border-b border-[#f1f5f9] py-1.5"
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

      <section className="border-t border-[#f1f5f9] pt-6">
        <h2 className="text-[15px] font-semibold text-[#0f172a] mb-1">Revenu fiscal de référence du foyer</h2>
        <p className="text-[12px] text-[#94a3b8] mb-3">
          Optionnel — utile seulement si vous voulez qu&apos;Atlas surveille votre éligibilité au
          versement libératoire pour les années à venir. Ignorez si vous ne voulez pas ce suivi.
        </p>
        {rfr.length > 0 && (
          <ul className="mb-4 flex flex-col gap-1">
            {rfr.map((r) => (
              <li
                key={r.anneeRfr}
                className="text-[13px] text-[#0f172a] flex justify-between border-b border-[#f1f5f9] py-1.5"
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
