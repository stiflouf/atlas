import { getProspectVendeurById } from "@/lib/prospectVendeurRepository";
import type { ChampsTacheAutomatique, CodeRegleAutomatisation, EvenementMetier, TypeEvenementMetier } from "@/types/automatisation";

// Catalogue de règles déterministes (ADR-032) — versionné et testé en code (pas de constructeur
// no-code en V1, pas de règles en base : seule leur ACTIVATION vit en base,
// configurations_automatisation). Chaque règle ne peut produire qu'une tâche (ChampsTacheAutomatique
// est structurellement monomorphe — aucun champ "actionType" générique, voir point 16 de l'audit) :
// étendre le moteur à une autre catégorie d'action nécessiterait de changer ce type lui-même, pas
// d'ajouter un cas dans un switch.
export type ReglAutomatisation = {
  code: CodeRegleAutomatisation;
  nom: string;
  description: string;
  typeEvenement: TypeEvenementMetier;
  // Peut lire (jamais écrire) via les repositories existants pour enrichir la tâche produite ;
  // `undefined` = la règle décide de ne rien produire pour ce cas précis (aucune des 4 règles V1
  // n'utilise cette branche aujourd'hui, mais elle reste honnête plutôt que de forcer une tâche).
  construireTache: (evenement: EvenementMetier) => Promise<ChampsTacheAutomatique | undefined>;
};

export const CATALOGUE_REGLES_AUTOMATISATION: ReglAutomatisation[] = [
  {
    code: "suivi_apres_visite",
    nom: "Suivi après visite",
    description: "Crée une tâche de suivi lorsqu'une visite est marquée réalisée.",
    typeEvenement: "visite_realisee",
    construireTache: async (evenement) => {
      if (!evenement.compteRenduVisiteId) return undefined;
      return {
        titre: "Faire le suivi de la visite",
        type: "relance",
        priorite: "normale",
        cible: { type: "visite", id: evenement.compteRenduVisiteId },
      };
    },
  },
  {
    code: "suivi_apres_rdv_estimation",
    nom: "Suivi après RDV estimation",
    description: "Crée une tâche de suivi lorsqu'un rendez-vous d'estimation est marqué réalisé.",
    typeEvenement: "rdv_estimation_realise",
    construireTache: async (evenement) => {
      if (!evenement.prospectVendeurId) return undefined;
      return {
        titre: "Faire le suivi de l'estimation",
        type: "relance",
        priorite: "normale",
        cible: { type: "prospectVendeur", id: evenement.prospectVendeurId },
      };
    },
  },
  {
    code: "preparation_apres_mandat",
    nom: "Préparation après signature du mandat",
    description: "Crée une tâche de lancement de commercialisation lorsqu'un mandat est signé.",
    typeEvenement: "mandat_signe",
    construireTache: async (evenement) => {
      if (!evenement.prospectVendeurId) return undefined;
      const prospect = await getProspectVendeurById(evenement.prospectVendeurId);
      if (!prospect?.bienId) return undefined;
      return {
        titre: "Lancer la commercialisation du bien",
        type: "autre",
        priorite: "normale",
        cible: { type: "bien", id: prospect.bienId },
      };
    },
  },
  {
    code: "preparation_dossier_notaire_apres_compromis",
    nom: "Préparation du dossier notaire après compromis",
    description: "Crée une tâche de préparation du dossier notaire lorsqu'un compromis est signé.",
    typeEvenement: "compromis_signe",
    construireTache: async (evenement) => {
      if (!evenement.compromisId) return undefined;
      return {
        titre: "Préparer le dossier pour le notaire",
        type: "document",
        priorite: "normale",
        cible: { type: "compromis", id: evenement.compromisId },
      };
    },
  },
];

export const LABEL_REGLE_AUTOMATISATION: Record<CodeRegleAutomatisation, string> = Object.fromEntries(
  CATALOGUE_REGLES_AUTOMATISATION.map((r) => [r.code, r.nom])
) as Record<CodeRegleAutomatisation, string>;

export function trouverRegle(code: CodeRegleAutomatisation): ReglAutomatisation | undefined {
  return CATALOGUE_REGLES_AUTOMATISATION.find((r) => r.code === code);
}

export function reglesPourTypeEvenement(typeEvenement: TypeEvenementMetier): ReglAutomatisation[] {
  return CATALOGUE_REGLES_AUTOMATISATION.filter((r) => r.typeEvenement === typeEvenement);
}
