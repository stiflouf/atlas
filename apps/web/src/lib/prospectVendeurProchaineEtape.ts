import { deriverStatutProspectVendeur, type ProspectVendeur } from "@/types/prospectVendeur";

// Cockpit de prise de mandat (design validé) — la « prochaine étape » du conseiller est la
// TRANSITION QUI SUIT le stade dérivé, jamais une recommandation. Table de correspondance fixe,
// sans score, sans heuristique, sans IA : deux lectures de la même fiche donnent la même action.
// Ne dérive JAMAIS un stade lui-même (deriverStatutProspectVendeur reste l'unique source, ADR-027)
// — se contente de le traduire en action.
export type ActionJalon =
  | "qualifier"
  | "marquer_rdv_realise"
  | "enregistrer_estimation"
  | "proposer_mandat"
  | "signer_mandat";

// Action de second rang affichée à côté de la primaire, uniquement quand l'état réel la rend
// utile — jamais une troisième option systématique.
export type AppuiProchaineEtape = "planifier_rdv" | "mettre_a_jour_estimation";

export type ProchaineEtape = {
  action: ActionJalon;
  titre: string;
  appui?: AppuiProchaineEtape;
};

// `undefined` = plus aucune transition possible. Les deux états terminaux (perdu, mandat signé)
// sont déjà refusés côté serveur par chargerProspectPourJalon (actions/prospectVendeur.ts) : cette
// fonction ne fait que refléter cette garde, elle ne la duplique pas comme règle métier.
export function deriverProchaineEtape(prospect: ProspectVendeur): ProchaineEtape | undefined {
  switch (deriverStatutProspectVendeur(prospect)) {
    case "prospect":
      return { action: "qualifier", titre: "Qualifier le prospect" };
    case "qualification":
      return {
        action: "marquer_rdv_realise",
        titre: "Marquer le rendez-vous d'estimation réalisé",
        // Proposer la planification seulement si aucune date n'est encore prévue : replanifier est
        // déjà atteignable sous « Corriger un jalon », inutile de l'imposer ici.
        appui: prospect.rdvEstimationPrevuLe ? undefined : "planifier_rdv",
      };
    case "rendez_vous":
      return { action: "enregistrer_estimation", titre: "Enregistrer l'estimation" };
    case "estimation":
      return {
        action: "proposer_mandat",
        titre: "Marquer le mandat comme proposé",
        appui: "mettre_a_jour_estimation",
      };
    case "mandat_propose":
      return { action: "signer_mandat", titre: "Signer le mandat et créer le bien" };
    case "mandat_signe":
    case "perdu":
      return undefined;
  }
}
