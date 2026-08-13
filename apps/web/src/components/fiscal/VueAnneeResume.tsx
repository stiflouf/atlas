import { formatMontantCentimes } from "@/types/remuneration";
import type { ResultatFiscal } from "@/types/resultatFiscal";
import type { ResultatMicroBnc } from "@/lib/fiscal/microBnc";
import type { ResultatFranchiseTva } from "@/lib/fiscal/franchiseTva";
import type { EligibiliteRfr } from "@/lib/fiscal/versementLiberatoire";
import type { ProjectionFinAnnee } from "@/lib/fiscal/projectionFinAnnee";
import { libelleRaisonIndisponibilite } from "@/lib/fiscal/libellesRaisons";
import ExplicationCalcul from "./ExplicationCalcul";

type Props = {
  annee: number;
  cotisations: ResultatFiscal<number>;
  cfp: ResultatFiscal<number>;
  vfl: ResultatFiscal<number>;
  eligibiliteRfr: EligibiliteRfr;
  microBnc: ResultatMicroBnc;
  franchiseTva: ResultatFranchiseTva;
  projection: ProjectionFinAnnee;
};

function LigneMontant({
  label,
  resultat,
}: {
  label: string;
  resultat: ResultatFiscal<number>;
}) {
  return (
    <div className="py-1.5 border-b border-[#f1f5f9] last:border-b-0">
      <div className="flex justify-between text-[13px]">
        <span className="text-[#64748b]">{label}</span>
        {resultat.statut === "indisponible" ? (
          <span className="text-[#94a3b8]">Indisponible</span>
        ) : (
          <span className="font-medium text-[#0f172a]">
            {formatMontantCentimes(resultat.statut === "calcule" ? resultat.valeur : resultat.valeurConnue)}
            {resultat.statut === "partiel" && (
              <span className="text-[11px] text-[#b45309] ml-1.5 font-normal">estimation partielle</span>
            )}
          </span>
        )}
      </div>
      {resultat.statut !== "indisponible" && (
        <ExplicationCalcul provenance={resultat.provenance} assiette={resultat.assiette} />
      )}
    </div>
  );
}

// Cinq blocs demandés (ADR-024, UX) : ce que j'ai encaissé, ce que je devrais provisionner, où j'en
// suis par rapport aux seuils, ce qui pourrait encore arriver, ce qu'Atlas ne sait pas encore
// calculer et pourquoi. Aucun jargon sans explication — voir ExplicationCalcul et libellesRaisons.
export default function VueAnneeResume({
  annee,
  cotisations,
  cfp,
  vfl,
  eligibiliteRfr,
  microBnc,
  franchiseTva,
  projection,
}: Props) {
  const raisons = new Map<string, void>();
  for (const resultat of [cotisations, cfp, vfl]) {
    if (resultat.statut !== "calcule") for (const r of resultat.raisons) raisons.set(libelleRaisonIndisponibilite(r));
  }
  if (microBnc.statut !== "calcule") for (const r of microBnc.raisons) raisons.set(libelleRaisonIndisponibilite(r));
  if (franchiseTva.statut !== "calcule") for (const r of franchiseTva.raisons) raisons.set(libelleRaisonIndisponibilite(r));
  if (eligibiliteRfr.statut === "indisponible") for (const r of eligibiliteRfr.raisons) raisons.set(libelleRaisonIndisponibilite(r));
  const raisonsUniques = [...raisons.keys()];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[15px] font-semibold text-[#0f172a] mb-2">Ce que j&apos;ai encaissé — {annee}</h2>
        <div className="bg-white border border-[#e2e8f0] rounded-lg px-4 py-3">
          <div className="flex justify-between text-[13px]">
            <span className="text-[#64748b]">
              Recettes connues ({projection.encaisseReel.couverture === "complete" ? "couverture complète" : "couverture partielle"})
            </span>
            <span className="font-semibold text-[#0f172a]">
              {formatMontantCentimes(projection.encaisseReel.montantConnuCentimes)}
            </span>
          </div>
          <ExplicationCalcul provenance={[]} assiette={projection.encaisseReel} />
        </div>
      </div>

      <div>
        <h2 className="text-[15px] font-semibold text-[#0f172a] mb-2">Ce que je devrais provisionner</h2>
        <div className="bg-white border border-[#e2e8f0] rounded-lg px-4 py-1">
          <LigneMontant label="Cotisations sociales" resultat={cotisations} />
          <LigneMontant label="Contribution formation professionnelle (CFP)" resultat={cfp} />
          <LigneMontant label="Versement libératoire de l'impôt" resultat={vfl} />
        </div>
        {eligibiliteRfr.statut === "calcule" && (
          <p className="text-[12px] text-[#94a3b8] mt-2">
            Éligibilité au versement libératoire selon le revenu fiscal de référence :{" "}
            {eligibiliteRfr.eligible ? "vous êtes sous le seuil" : "vous dépassez le seuil"} (
            {formatMontantCentimes(eligibiliteRfr.rfrParPartCentimes)}/part, seuil {formatMontantCentimes(eligibiliteRfr.seuilCentimes)}
            /part). Ce contrôle n&apos;active jamais le versement libératoire tout seul — seule votre situation
            fiscale le fait.
          </p>
        )}
      </div>

      <div>
        <h2 className="text-[15px] font-semibold text-[#0f172a] mb-2">Où j&apos;en suis par rapport aux seuils</h2>
        <div className="flex flex-col gap-3">
          {microBnc.statut !== "indisponible" && (
            <div className="bg-white border border-[#e2e8f0] rounded-lg px-4 py-3">
              <p className="text-[13px] text-[#64748b] mb-1">Plafond micro-BNC</p>
              <div className="flex justify-between text-[13px]">
                <span>
                  {formatMontantCentimes(
                    microBnc.statut === "calcule" ? microBnc.valeur.plafondPleinCentimes : microBnc.valeurConnue.plafondPleinCentimes
                  )}{" "}
                  de plafond
                </span>
                <span className="font-medium">
                  {(microBnc.statut === "calcule" ? microBnc.valeur.anneeCourante : microBnc.valeurConnue.anneeCourante).statut ===
                  "connue"
                    ? "Statut connu"
                    : "Non déterminable pour l'instant"}
                </span>
              </div>
              {(microBnc.statut === "calcule" ? microBnc.valeur.anneeCreation : microBnc.valeurConnue.anneeCreation) && (
                <p className="text-[12px] text-[#94a3b8] mt-1">
                  Année de création d&apos;activité : une valeur de référence proratisée existe pour le mécanisme légal
                  des années de référence, mais ce n&apos;est pas un seuil de sortie immédiate du régime micro.
                </p>
              )}
            </div>
          )}
          {franchiseTva.statut !== "indisponible" && (
            <div className="bg-white border border-[#e2e8f0] rounded-lg px-4 py-3">
              <p className="text-[13px] text-[#64748b] mb-1">Franchise en base de TVA</p>
              {(() => {
                const v = franchiseTva.statut === "calcule" ? franchiseTva.valeur : franchiseTva.valeurConnue;
                return (
                  <>
                    <div className="flex justify-between text-[13px]">
                      <span>Marge avant le seuil de base ({formatMontantCentimes(v.seuilBaseCentimes)})</span>
                      <span className="font-medium">{formatMontantCentimes(v.margeAvantSeuilBaseCentimes)}</span>
                    </div>
                    <div className="flex justify-between text-[13px]">
                      <span>Marge avant le seuil majoré ({formatMontantCentimes(v.seuilMajoreCentimes)})</span>
                      <span className="font-medium">{formatMontantCentimes(v.margeAvantSeuilMajoreCentimes)}</span>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-[15px] font-semibold text-[#0f172a] mb-2">Ce qui pourrait encore arriver cette année</h2>
        <div className="bg-white border border-[#e2e8f0] rounded-lg px-4 py-1">
          <div className="flex justify-between text-[13px] py-1.5 border-b border-[#f1f5f9]">
            <span className="text-[#64748b]">Ventes finalisées, pas encore encaissées</span>
            <span className="font-medium">
              {projection.finaliseNonEncaisseRestant.montantCentimes === undefined
                ? "Aucune date connue"
                : formatMontantCentimes(projection.finaliseNonEncaisseRestant.montantCentimes)}
            </span>
          </div>
          <div className="flex justify-between text-[13px] py-1.5">
            <span className="text-[#64748b]">Compromis en cours, pas encore finalisés</span>
            <span className="font-medium">
              {projection.compromisEnCoursRestant.montantCentimes === undefined
                ? "Aucune date connue"
                : formatMontantCentimes(projection.compromisEnCoursRestant.montantCentimes)}
            </span>
          </div>
        </div>
        {projection.projectionCouverteFinAnneeCentimes !== undefined && (
          <p className="text-[12px] text-[#94a3b8] mt-2">
            Projection couverte fin d&apos;année (encaissé + restant connu et daté) :{" "}
            <span className="font-medium text-[#0f172a]">
              {formatMontantCentimes(projection.projectionCouverteFinAnneeCentimes)}
            </span>
            . Une rémunération sans date prévue n&apos;est jamais comptée ici.
          </p>
        )}
      </div>

      {raisonsUniques.length > 0 && (
        <div>
          <h2 className="text-[15px] font-semibold text-[#0f172a] mb-2">
            Ce qu&apos;Atlas ne sait pas encore calculer, et pourquoi
          </h2>
          <ul className="flex flex-col gap-1.5">
            {raisonsUniques.map((texte) => (
              <li key={texte} className="text-[12px] text-[#64748b] flex gap-1.5">
                <span aria-hidden>—</span>
                <span>{texte}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
