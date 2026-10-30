import { Zap } from "lucide-react";
import IconTile from "@/components/ui/IconTile";
import { CATALOGUE_REGLES_AUTOMATISATION } from "@/lib/automatisations/catalogueRegles";
import { listerConfigurationsAutomatisation } from "@/lib/automatisations/configurationAutomatisationRepository";
import { getDerniereExecutionPourRegle } from "@/lib/automatisations/executionAutomatisationRepository";
import { getDernierRunScanPourRegle } from "@/lib/automatisations/runScanAutomatisationRepository";
import { basculerAutomatisationAction, definirSeuilAutomatisationAction } from "@/actions/automatisations";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import {
  deriverEtatExecutionAutomatisation,
  deriverEtatRunScanAutomatisation,
  estRegleTemporelle,
  LIBELLE_SEUIL_REGLE_TEMPORELLE,
  type EtatExecutionAutomatisation,
  type EtatRunScanAutomatisation,
} from "@/types/automatisation";

const LABEL_ETAT_EXECUTION: Record<EtatExecutionAutomatisation, string> = {
  a_traiter: "À traiter",
  reussie: "Réussie",
  echouee: "Échouée",
};

const COULEUR_ETAT_EXECUTION: Record<EtatExecutionAutomatisation, string> = {
  a_traiter: "text-warning",
  reussie: "text-success",
  echouee: "text-danger",
};

const LABEL_ETAT_RUN: Record<EtatRunScanAutomatisation, string> = {
  en_cours: "En cours",
  termine: "Terminé",
  echoue: "Échoué",
};

const COULEUR_ETAT_RUN: Record<EtatRunScanAutomatisation, string> = {
  en_cours: "text-warning",
  termine: "text-success",
  echoue: "text-danger",
};

// Règles temporelles (ADR-033, généralisées AUTOMATION_ENGINE_GENERALIZATION_V1, étendues
// VISIT_AUTOMATION_V1) — les seules à exposer un seuil et un dernier passage de scanner, distinct de
// la dernière exécution ADR-032 (qui n'existe que si une occurrence a été trouvée).
//
// PILOT_PRODUCTION_HARDENING_V1 — `estRegleTemporelle` et `LIBELLE_SEUIL_REGLE_TEMPORELLE` viennent
// de types/automatisation.ts : cet écran ne tient plus sa propre liste. L'ancienne liste locale en
// comptait 4 là où la Server Action en exigeait 6, ce qui privait `visite_j_1` et
// `visite_sans_compte_rendu` de champ de seuil — donc rendait leur activation impossible.

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx, app/biens/page.tsx) :
// sans ce flag, next build tente de pré-générer cette page en interrogeant la DB au moment du build —
// échec garanti dès que la DB n'est pas joignable à cet instant (ex. réseau privé Railway, disponible
// seulement au runtime, jamais pendant le build).
export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Page de lecture + bascule (ADR-032) — pas de constructeur de règles, le catalogue reste en code.
// Aucun retry automatique n'est proposé ici : une exécution "À traiter" laissée par un crash entre
// le commit métier et le traitement synchrone reste visible, jamais invisible, mais son retraitement
// reste hors périmètre V1 (aucun worker).
export default async function PageAutomatisations() {
  // WORKSPACE_SCOPING_V2B5 — le périmètre est résolu UNE FOIS, à la frontière de l'écran, et passé
  // aux trois lectures. Les trois lisaient auparavant sans filtre : un conseiller voyait
  // l'activation, la dernière exécution et le dernier scan d'un autre workspace. Chacune filtre
  // maintenant en SQL (jamais un tri en mémoire après lecture globale : l'activation, le « dernier »
  // et le `limit(1)` n'ont de sens qu'à l'intérieur du périmètre).
  const workspaceId = await exigerWorkspaceCourant();

  const configurations = await listerConfigurationsAutomatisation(workspaceId);
  const configParCode = new Map(configurations.map((c) => [c.regleCode, c]));

  const lignes = await Promise.all(
    CATALOGUE_REGLES_AUTOMATISATION.map(async (regle) => ({
      regle,
      config: configParCode.get(regle.code),
      derniereExecution: await getDerniereExecutionPourRegle(regle.code, workspaceId),
      dernierRun: estRegleTemporelle(regle.code)
        ? await getDernierRunScanPourRegle(regle.code, workspaceId)
        : undefined,
    }))
  );

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <div className="flex items-start gap-3 mb-6">
        <IconTile icon={Zap} tone="navy" size={36} iconSize={17} className="mt-0.5" />
        <div>
          <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight">
            Automatisations
          </h1>
          <p className="text-[14px] text-text-2 mt-1">
            Chaque règle réagit à un événement métier précis et ne peut créer qu'une tâche — jamais un envoi, jamais
            une suppression. Une règle nouvellement ajoutée démarre toujours désactivée.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {lignes.map(({ regle, config, derniereExecution, dernierRun }) => {
          const active = config?.active ?? false;
          const etat = derniereExecution ? deriverEtatExecutionAutomatisation(derniereExecution) : undefined;
          const etatRun = dernierRun ? deriverEtatRunScanAutomatisation(dernierRun) : undefined;
          const estTemporelle = estRegleTemporelle(regle.code);
          // Narrowing explicite : le libellé n'existe QUE pour une règle temporelle, et il
          // existe alors forcément (Record complet). Plus aucun `?? "Après"` : un repli
          // générique inventerait un sens métier faux pour une règle oubliée.
          const libelleSeuil = estRegleTemporelle(regle.code) ? LIBELLE_SEUIL_REGLE_TEMPORELLE[regle.code] : undefined;
          return (
            <div key={regle.code} className="bg-surface border border-border rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <IconTile icon={Zap} tone="champagne" size={30} iconSize={14} className="mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-text-1">{regle.nom}</p>
                    <p className="text-[13px] text-text-2 mt-0.5">{regle.description}</p>
                    <p className="text-[11px] text-text-3 mt-1">Action produite : création d'une tâche</p>
                  </div>
                </div>
                <form action={basculerAutomatisationAction}>
                  <input type="hidden" name="regleCode" value={regle.code} />
                  <input type="hidden" name="active" value={active ? "0" : "1"} />
                  <button
                    type="submit"
                    className={`text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0 ${
                      active ? "bg-accent-light text-accent" : "bg-surface-muted text-text-2"
                    }`}
                  >
                    {active ? "Activée" : "Désactivée"}
                  </button>
                </form>
              </div>

              {libelleSeuil && (
                <form
                  action={definirSeuilAutomatisationAction}
                  className="flex items-center gap-2 mt-3 pt-3 border-t border-border"
                >
                  <input type="hidden" name="regleCode" value={regle.code} />
                  <label className="text-[12px] text-text-2">
                    {libelleSeuil.prefixe}
                    <input
                      type="number"
                      name="seuilJours"
                      min={1}
                      required
                      defaultValue={config?.seuilJours ?? ""}
                      className="w-16 mx-1.5 border border-border-md rounded px-2 py-1 text-[12px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                    />
                    {libelleSeuil.suffixe}
                  </label>
                  <button type="submit" className="text-[12px] font-medium text-accent hover:text-accent-hover transition-colors">
                    Enregistrer
                  </button>
                  {config?.seuilJours == null && (
                    <span className="text-[11px] text-danger">Seuil requis avant activation</span>
                  )}
                </form>
              )}

              {derniereExecution && etat && (
                <p className="text-[12px] text-text-3 mt-3 pt-3 border-t border-border">
                  Dernière exécution : {formatDate(derniereExecution.demarreeLe)} —{" "}
                  <span className={`font-medium ${COULEUR_ETAT_EXECUTION[etat]}`}>{LABEL_ETAT_EXECUTION[etat]}</span>
                </p>
              )}

              {estTemporelle && dernierRun && etatRun && (
                <p className="text-[12px] text-text-3 mt-2">
                  Dernière détection : {formatDate(dernierRun.demarreLe)} —{" "}
                  <span className={`font-medium ${COULEUR_ETAT_RUN[etatRun]}`}>{LABEL_ETAT_RUN[etatRun]}</span>
                  {dernierRun.nombreCandidats != null && ` — ${dernierRun.nombreCandidats} candidat(s) analysé(s)`}
                  {dernierRun.nombreOccurrencesCreees != null && `, ${dernierRun.nombreOccurrencesCreees} relance(s) créée(s)`}
                </p>
              )}
              {estTemporelle && !dernierRun && (
                <p className="text-[12px] text-text-3 mt-2">
                  Aucun scan encore effectué — sans déclencheur externe configuré, le moteur temporel ne s'exécute pas
                  spontanément.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
