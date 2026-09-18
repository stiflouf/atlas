import { getDb, type Executeur } from "@/db/client";
import { dateDuJour, listerMandatsDuBien, mandatCourantDuBien } from "@/lib/mandatRepository";
import { listerPartiesMandat } from "@/lib/partieMandatRepository";
import { LABEL_STATUT_MANDAT, type Bien, type StatutMandat } from "@/types/bien";
import { LABEL_STATUT_MANDAT_DERIVE, type Mandat, type MandatHistorique } from "@/types/mandat";
import type { PartieMandatDetail } from "@/types/partieMandat";

// ADR-060 §1 — LA règle de précédence canonique > legacy, écrite UNE SEULE FOIS pour tous les
// écrans (lot MANDATE_CANONICAL_UI_V1). Décidée PAR ENTITÉ, jamais champ par champ :
//
//   au moins un mandat canonique existe pour le bien  ->  mode "canonique" : tout vient de
//     `mandats` — même sans mandat courant (tous expirés, dernier résilié), même avec un type ou un
//     terme absents (« Non renseigné »). `biens.statut_mandat` / `date_mandat` ne sont JAMAIS relus
//     pour ce bien : un canonique résilié n'affiche jamais le « Actif » legacy figé.
//   aucun mandat canonique  ->  mode "legacy" : les colonnes du bien, avec leur vocabulaire.
//   aucun mandat canonique et legacy inexploitable  ->  mode "aucun".
//
// Le mode dépend de l'EXISTENCE d'un mandat canonique (historique non vide), pas de l'existence
// d'un mandat COURANT : ce sont deux questions distinctes, transportées séparément. Le courant reste
// défini par `mandatCourantDuBien` — jamais recalculé ici depuis l'historique (une seule définition).
//
// Trois requêtes, jamais plus, quel que soit le nombre de mandats : historique (avec successeur),
// courant, parties du courant. Les parties des mandats historiques ne sont pas chargées (elles
// exigeraient une requête par mandat ou un read model batch sans consommateur aujourd'hui).
export type PresentationMandatBien =
  | {
      mode: "canonique";
      mandatCourant: Mandat | undefined;
      historique: MandatHistorique[];
      parties: PartieMandatDetail[];
    }
  | { mode: "legacy"; statutMandat: StatutMandat; dateMandat: string }
  | { mode: "aucun" };

const STATUTS_LEGACY: readonly string[] = ["actif", "suspendu", "expire"];

function legacyExploitable(bien: Pick<Bien, "statutMandat" | "dateMandat">): boolean {
  return STATUTS_LEGACY.includes(bien.statutMandat) && /^\d{4}-\d{2}-\d{2}$/.test(bien.dateMandat ?? "");
}

export async function chargerPresentationMandatBien(
  bien: Pick<Bien, "id" | "statutMandat" | "dateMandat">,
  workspaceId: string,
  aujourdhui: string = dateDuJour(),
  executeur: Executeur = getDb()
): Promise<PresentationMandatBien> {
  const historique = await listerMandatsDuBien(bien.id, workspaceId, aujourdhui, executeur);
  if (historique.length > 0) {
    const mandatCourant = await mandatCourantDuBien(bien.id, workspaceId, aujourdhui, executeur);
    const parties = mandatCourant ? await listerPartiesMandat(mandatCourant.id, workspaceId, executeur) : [];
    return { mode: "canonique", mandatCourant, historique, parties };
  }
  if (legacyExploitable(bien)) return { mode: "legacy", statutMandat: bien.statutMandat, dateMandat: bien.dateMandat };
  return { mode: "aucun" };
}

// Le STATUT EFFECTIF d'un bien vis-à-vis de son mandat, pour les lecteurs qui n'ont besoin que
// d'un libellé et d'un booléen « actif » (bandeau, badge vendeur, points d'attention). Une seule
// traduction, jamais un `if (mode === ...)` dispersé dans les composants.
export type StatutMandatEffectif = {
  actif: boolean;
  libelle: string;
  variante: "success" | "warning" | "danger" | "muted";
};

const VARIANTE_LEGACY: Record<StatutMandat, StatutMandatEffectif["variante"]> = {
  actif: "success",
  suspendu: "warning",
  expire: "danger",
};

export function statutMandatEffectif(presentation: PresentationMandatBien): StatutMandatEffectif {
  switch (presentation.mode) {
    case "canonique": {
      const courant = presentation.mandatCourant;
      if (!courant) return { actif: false, libelle: "Aucun mandat en cours", variante: "muted" };
      // Le courant est `actif` ou `a_venir` par définition (mandatCourantDuBien) : son statut se lit
      // dans l'historique, qui porte la dérivation.
      const statut = presentation.historique.find((m) => m.id === courant.id)?.statut ?? "actif";
      return {
        actif: statut === "actif",
        libelle: LABEL_STATUT_MANDAT_DERIVE[statut],
        variante: statut === "actif" ? "success" : "warning",
      };
    }
    case "legacy":
      return {
        actif: presentation.statutMandat === "actif",
        libelle: LABEL_STATUT_MANDAT[presentation.statutMandat],
        variante: VARIANTE_LEGACY[presentation.statutMandat],
      };
    case "aucun":
      return { actif: false, libelle: "Aucun mandat", variante: "muted" };
  }
}

// Ce que le bandeau affiche à côté du statut commercial : la prise d'effet du mandat courant (ou
// la date legacy), jamais une date inventée quand il n'y a pas de mandat en cours.
export function dateMandatEffective(presentation: PresentationMandatBien): string | undefined {
  if (presentation.mode === "canonique") return presentation.mandatCourant?.dateDebut;
  if (presentation.mode === "legacy") return presentation.dateMandat;
  return undefined;
}
