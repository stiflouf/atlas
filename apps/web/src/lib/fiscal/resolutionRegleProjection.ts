import { resoudreRegle, listerHistoriqueRegle } from "@/lib/referentielFiscalRepository";
import { provenanceDe } from "@/lib/fiscal/resolutionTranche";
import type { RegleFiscale } from "@/types/regleFiscale";
import type { ProvenanceRegleProjection } from "@/types/projectionFiscale";

function aujourdHuiIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Forme "riche" (règle brute, avec valeur/unité) utilisée pour le calcul — jamais exposée telle
// quelle à l'UI, voir provenanceProjectionDe ci-dessous pour la forme d'affichage.
export type RegleResolueProjection =
  | { origine: "officielle"; regle: RegleFiscale }
  | { origine: "hypothese_reconduction"; regleReconduite: RegleFiscale; anneeDerniereRegleOfficielle: number }
  | { origine: "indisponible"; code: string };

// ADR-025, correction obligatoire n° 3 : dateFinValidite = NULL signifie "toujours en vigueur à ce
// jour", jamais "publiée pour couvrir une année lointaine". Pour une date future, une règle n'est
// "officielle" que si sa dateFinValidite est explicitement connue et postérieure à la date demandée
// (preuve qu'une publication couvre réellement cette date) — sinon c'est au mieux une reconduction
// hypothétique de la dernière règle connue, jamais matérialisée en base (aucun appel à
// insererRegleFiscale ici).
export async function resoudreRegleProjection(
  code: string,
  categorieActivite: string,
  date: string
): Promise<RegleResolueProjection> {
  const aujourdhui = aujourdHuiIso();
  const regleActuelle = await resoudreRegle(code, categorieActivite, date);

  if (date <= aujourdhui) {
    // Date passée ou présente : le mécanisme ADR-023 fait foi tel quel, aucune notion de
    // "reconduction hypothétique" n'a de sens ici.
    return regleActuelle ? { origine: "officielle", regle: regleActuelle } : { origine: "indisponible", code };
  }

  if (regleActuelle && regleActuelle.dateFinValidite !== undefined) {
    // Fin de validité explicitement publiée et postérieure à la date (résoudreRegle garantit déjà
    // dateFinValidite > date) : quelqu'un a réellement borné cette règle jusque-là.
    return { origine: "officielle", regle: regleActuelle };
  }

  // Reconduction hypothétique : soit la règle actuellement ouverte (dateFinValidite NULL) trouvée
  // ci-dessus, soit — si aucune règle ne couvre même la date via une fenêtre ouverte (ex. une règle
  // dont la seule fin connue est déjà dépassée) — la plus récente règle jamais publiée pour ce code,
  // peu importe qu'elle ait officiellement expiré.
  const historique = await listerHistoriqueRegle(code, categorieActivite);
  const derniereConnue = regleActuelle ?? historique[historique.length - 1];
  if (!derniereConnue) return { origine: "indisponible", code };

  return {
    origine: "hypothese_reconduction",
    regleReconduite: derniereConnue,
    anneeDerniereRegleOfficielle: Number(derniereConnue.dateDebutValidite.slice(0, 4)),
  };
}

export function provenanceProjectionDe(regle: RegleResolueProjection): ProvenanceRegleProjection {
  switch (regle.origine) {
    case "officielle":
      return { origine: "officielle", regle: provenanceDe(regle.regle) };
    case "hypothese_reconduction":
      return {
        origine: "hypothese_reconduction",
        regleReconduite: provenanceDe(regle.regleReconduite),
        anneeDerniereRegleOfficielle: regle.anneeDerniereRegleOfficielle,
      };
    case "indisponible":
      return { origine: "indisponible", code: regle.code };
  }
}

export function valeurDe(regle: RegleResolueProjection): number | undefined {
  if (regle.origine === "officielle") return regle.regle.valeur;
  if (regle.origine === "hypothese_reconduction") return regle.regleReconduite.valeur;
  return undefined;
}
