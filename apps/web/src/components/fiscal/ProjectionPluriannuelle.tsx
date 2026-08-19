import { formatMontantCentimes } from "@/types/remuneration";
import { PRODUCT_NAME } from "@/lib/branding";
import type {
  ConsequencesFiscalesProjetees,
  ProjectionAnneeFiscale,
  ResultatFiscalProjete,
} from "@/types/projectionFiscale";
import { libelleRaisonIndisponibilite } from "@/lib/fiscal/libellesRaisons";
import ExplicationCalculProjection from "./ExplicationCalculProjection";

function LigneResultat({ label, resultat }: { label: string; resultat: ResultatFiscalProjete<number> }) {
  return (
    <div className="py-1 border-b border-border last:border-b-0">
      <div className="flex justify-between text-[12px]">
        <span className="text-text-2">{label}</span>
        {resultat.statut === "indisponible" ? (
          <span className="text-text-3">Indisponible</span>
        ) : (
          <span className="font-medium text-text-1">
            {formatMontantCentimes(resultat.statut === "calcule" ? resultat.valeur : resultat.valeurConnue)}
            {resultat.statut === "partiel" && <span className="text-[11px] text-warning ml-1 font-normal">partiel</span>}
          </span>
        )}
      </div>
      {resultat.statut !== "indisponible" && <ExplicationCalculProjection provenance={resultat.provenance} />}
    </div>
  );
}

function BlocConsequences({ consequences }: { consequences: ConsequencesFiscalesProjetees }) {
  return (
    <div className="mt-2 pl-3 border-l-2 border-border-md">
      <LigneResultat label="Cotisations sociales estimées" resultat={consequences.cotisations} />
      <LigneResultat label="CFP estimée" resultat={consequences.cfp} />
      <LigneResultat label="Versement libératoire estimé" resultat={consequences.vfl} />
      <div className="text-[12px] text-text-2 py-1">
        Seuil micro-BNC :{" "}
        {consequences.microBnc.statut === "connue" ? (
          <span className="font-medium text-text-1">
            {consequences.microBnc.depasse ? "risque de dépassement" : "maintien probable"} (
            {formatMontantCentimes(consequences.microBnc.plafondCentimes)})
          </span>
        ) : (
          <span className="text-text-3">données insuffisantes</span>
        )}
      </div>
      <div className="text-[12px] text-text-2 py-1">
        Franchise TVA :{" "}
        {consequences.franchiseTva.statut === "connue" ? (
          <span className="font-medium text-text-1">
            marge de {formatMontantCentimes(consequences.franchiseTva.margeAvantSeuilMajoreCentimes)} avant le seuil majoré
          </span>
        ) : (
          <span className="text-text-3">indisponible</span>
        )}
      </div>
    </div>
  );
}

function toutesLesRaisons(consequences: ConsequencesFiscalesProjetees | undefined): string[] {
  if (!consequences) return [];
  const raisons = new Map<string, void>();
  for (const r of [consequences.cotisations, consequences.cfp, consequences.vfl]) {
    if (r.statut !== "calcule") for (const raison of r.raisons) raisons.set(libelleRaisonIndisponibilite(raison));
  }
  if (consequences.microBnc.statut === "indeterminee") {
    for (const raison of consequences.microBnc.raisons) raisons.set(libelleRaisonIndisponibilite(raison));
  }
  if (consequences.franchiseTva.statut === "indisponible") {
    for (const raison of consequences.franchiseTva.raisons) raisons.set(libelleRaisonIndisponibilite(raison));
  }
  return [...raisons.keys()];
}

// Une carte par année (ADR-025). Pipeline et tendance statistique restent deux blocs strictement
// séparés (correction n° 1) — jamais additionnés, jamais un "total projeté" affiché. L'hypothèse
// utilisateur (bloc D) n'apparaît que si elle a été saisie pour cette requête (formulaire GET natif,
// jamais persistée, correction n° 5).
function CarteAnnee({ projection }: { projection: ProjectionAnneeFiscale }) {
  const raisons = new Map<string, void>();
  for (const texte of toutesLesRaisons(projection.pipeline.consequencesFiscales)) raisons.set(texte);
  for (const texte of toutesLesRaisons(projection.statistique.consequencesFiscales)) raisons.set(texte);
  if (projection.hypothese) for (const texte of toutesLesRaisons(projection.hypothese.consequencesFiscales)) raisons.set(texte);
  const raisonsUniques = [...raisons.keys()];

  return (
    <div className="bg-surface border border-border-md rounded-lg px-4 py-3">
      <h3 className="text-[15px] font-semibold text-text-1 mb-3">{projection.annee}</h3>

      <div className="mb-3">
        <div className="flex justify-between text-[13px]">
          <span className="text-text-2">Pipeline connu (compromis déjà engagés)</span>
          <span className="font-semibold text-text-1">
            {projection.pipeline.montantCentimes === undefined
              ? "Aucune date connue"
              : formatMontantCentimes(projection.pipeline.montantCentimes)}
          </span>
        </div>
        {projection.pipeline.consequencesFiscales && <BlocConsequences consequences={projection.pipeline.consequencesFiscales} />}
      </div>

      <div className="mb-3 pt-3 border-t border-border">
        <div className="flex justify-between text-[13px]">
          <span className="text-text-2">
            Tendance statistique
            {projection.statistique.moisHistoriqueUtilises > 0 && ` (basée sur ${projection.statistique.moisHistoriqueUtilises} mois d'historique)`}
          </span>
          <span className="font-semibold text-text-1">
            {projection.statistique.montantCentimes === undefined
              ? "Données insuffisantes"
              : formatMontantCentimes(projection.statistique.montantCentimes)}
          </span>
        </div>
        {projection.statistique.montantCentimes === undefined && (
          <p className="text-[11px] text-text-3 mt-1">
            Nécessite au moins 6 mois d&apos;historique entièrement couverts par {PRODUCT_NAME} ({projection.statistique.moisHistoriqueUtilises}{" "}
            disponible{projection.statistique.moisHistoriqueUtilises > 1 ? "s" : ""} aujourd&apos;hui) — jamais mélangée au pipeline connu.
          </p>
        )}
        {projection.statistique.consequencesFiscales && <BlocConsequences consequences={projection.statistique.consequencesFiscales} />}
      </div>

      {projection.hypothese && (
        <div className="mb-3 pt-3 border-t border-border">
          <div className="flex justify-between text-[13px]">
            <span className="text-text-2">Votre hypothèse (non enregistrée)</span>
            <span className="font-semibold text-text-1">{formatMontantCentimes(projection.hypothese.montantAnnuelCentimes)}</span>
          </div>
          <BlocConsequences consequences={projection.hypothese.consequencesFiscales} />
        </div>
      )}

      <form method="get" className="flex items-end gap-2 pt-3 border-t border-border">
        <div className="flex-1">
          <label className="text-[11px] text-text-3 mb-1 block" htmlFor={`hypothese-${projection.annee}`}>
            Simuler une hypothèse annuelle pour {projection.annee} (€, non enregistrée)
          </label>
          <input
            id={`hypothese-${projection.annee}`}
            name={`hypothese_${projection.annee}`}
            type="number"
            step="0.01"
            min="0"
            placeholder="ex. 72000"
            className="w-full border border-border-md rounded-lg px-3 py-1.5 text-[13px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          />
        </div>
        <button type="submit" className="text-[12px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3 py-1.5 rounded-lg">
          Simuler
        </button>
      </form>

      {raisonsUniques.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[11px] font-medium text-text-2 mb-1">Ce que {PRODUCT_NAME} ne sait pas encore calculer :</p>
          <ul className="flex flex-col gap-1">
            {raisonsUniques.map((texte) => (
              <li key={texte} className="text-[11px] text-text-3 flex gap-1.5">
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

export default function ProjectionPluriannuelle({ projections }: { projections: ProjectionAnneeFiscale[] }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-text-3">
        Le pipeline connu et la tendance statistique sont deux lectures indépendantes du même chiffre d&apos;affaires
        possible — ils ne s&apos;additionnent jamais entre eux. Aucun changement de régime signalé ci-dessous n&apos;est
        une certitude juridique, uniquement une projection.
      </p>
      {projections.map((projection) => (
        <CarteAnnee key={projection.annee} projection={projection} />
      ))}
    </div>
  );
}
