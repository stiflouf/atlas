import type { DestinataireCandidat } from "@/lib/communications/contexteCommunication";
import type { RepereRelationnel } from "@/types/repereRelationnel";

// VALUE-07B (ADR-053) — POLITIQUE DE PERTINENCE des repères relationnels dans la préparation d'une
// communication. Fonction domaine PURE : aucune requête, aucun React, aucune dépendance au
// fournisseur de rédaction ni au protocole d'appel. Elle vit délibérément AVANT la chaîne de
// rédaction, jamais dans le prompt ni dans l'adaptateur — une politique portée par un prompt est
// une demande, pas une règle, et une politique portée par l'UI est contournable depuis un autre
// écran.
//
// Ce qu'elle décide : quels repères le CONSEILLER a le droit de voir pendant qu'il prépare un
// message. Ce qu'elle ne décide pas, et ne décidera jamais tant qu'ADR-053 tient : ce qui entre
// dans le message, dans les faits autorisés (VALUE-04/VALUE-05) ou dans le contexte transmis au
// fournisseur. Un repère affiché n'est pas une donnée de rédaction.
//
// AUTORISÉ ≠ PERTINENT ≠ UTILISÉ : `utilisableCommunication` ouvre uniquement la première porte.

export type ReperesPourCommunication = {
  // Portent leur `libelle` parce qu'il faut bien l'AFFICHER. Aucune règle de ce module ne le lit.
  reperesAffichables: RepereRelationnel[];
  // Signal STRUCTUREL, dérivé de la seule `categorie`. Il dit « une préférence de contact existe »,
  // jamais laquelle : connaître le canal préféré demanderait d'interpréter le libellé libre, ce
  // qu'ADR-008 interdit et qu'ADR-053 referme explicitement. Le conseiller lit le repère et
  // tranche lui-même.
  presencePreferenceContact: boolean;
};

// Les repères n'existent que pour un acquéreur (`reperes_relationnels_acquereur.acquereur_id`).
// Un prospect vendeur, un notaire ou un destinataire non encore choisi n'en ont structurellement
// aucun — quatre des neuf intentions (ADR-031) sont donc vides par construction, jamais par
// filtrage.
export function selectionnerReperesPourCommunication(
  destinataire: DestinataireCandidat | undefined,
  reperes: RepereRelationnel[]
): ReperesPourCommunication {
  if (destinataire?.type !== "acquereur") return { reperesAffichables: [], presencePreferenceContact: false };

  const reperesAffichables = reperes.filter(
    (repere) =>
      // Appartenance revérifiée ici, et pas seulement au chargement : la fonction doit rester vraie
      // seule, y compris si un appelant futur lui passait une liste plus large.
      repere.acquereurId === destinataire.id &&
      // Un repère archivé (ADR-012) n'est jamais utilisable en communication, quelle que soit la
      // valeur de `utilisableCommunication`.
      !repere.archiveLe &&
      repere.utilisableCommunication
  );

  return {
    reperesAffichables,
    presencePreferenceContact: reperesAffichables.some((repere) => repere.categorie === "preference_contact"),
  };
}
