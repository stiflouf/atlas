import { joursCivilsEcoules } from "@/lib/temps";
import { deriverStatutProspectVendeur } from "@/types/prospectVendeur";
import { construireIdOpportunite } from "./id";
import type { ContexteOpportunites } from "./contexte";
import type { Opportunite } from "@/types/opportunite";

// Seuil de silence avant qu'une proposition de mandat sans réponse devienne une relance à faire.
// Valeur produit assumée, jamais un réglage caché : en dessous, le vendeur n'a simplement pas
// encore eu le temps de répondre.
export const SEUIL_RELANCE_MANDAT_JOURS = 3;

function nomComplet(personne: { prenom?: string; nom: string }): string {
  return personne.prenom ? `${personne.prenom} ${personne.nom}` : personne.nom;
}

// CAS 1 — proposition de mandat restée sans réponse. Faits utilisés : mandatProposeLe posé,
// mandatSigneLe absent, aucune perte déclarée. Aucune interprétation du silence : DOMIORA dit
// depuis combien de jours la proposition attend, jamais pourquoi.
export function regleRelanceProspectVendeur(contexte: ContexteOpportunites, maintenant: Date): Opportunite[] {
  return contexte.prospectsVendeurs.flatMap((prospect) => {
    if (deriverStatutProspectVendeur(prospect) !== "mandat_propose") return [];
    if (!prospect.mandatProposeLe) return [];

    const depuisJours = joursCivilsEcoules(new Date(prospect.mandatProposeLe), maintenant);
    if (depuisJours < SEUIL_RELANCE_MANDAT_JOURS) return [];

    const cible = { type: "prospectVendeur", id: prospect.id } as const;
    return [
      {
        id: construireIdOpportunite("relance_prospect_vendeur", cible),
        type: "relance_prospect_vendeur",
        priorite: "moyenne",
        cible,
        titre: `Relancer ${nomComplet(prospect)} — mandat proposé depuis ${depuisJours} jour${depuisJours > 1 ? "s" : ""}`,
        raison: `La proposition de mandat a été transmise il y a ${depuisJours} jour${depuisJours > 1 ? "s" : ""} et n'est ni signée ni close.`,
        action: { libelle: "Voir la fiche", href: `/prospects-vendeurs/${prospect.id}` },
        depuisJours,
      },
    ];
  });
}

// CAS 2 — deux situations de suivi, toutes deux ancrées sur une Visite réelle (ADR-040) :
// (a) visite réalisée dont aucun compte rendu ne rend compte ;
// (b) compte rendu marquant un acquéreur intéressé, sans prochaine étape enregistrée.
// Une visite déjà suivie (compte rendu ET prochaine étape) ne produit rien : c'est exactement le
// doublon que le lot doit éviter.
export function regleSuiviVisite(contexte: ContexteOpportunites, maintenant: Date): Opportunite[] {
  const acquereurParId = new Map(contexte.acquereurs.map((a) => [a.id, a]));
  const bienParId = new Map(contexte.biens.map((b) => [b.id, b]));

  return contexte.visites.flatMap((visite) => {
    if (visite.statut !== "realisee") return [];
    const acquereur = acquereurParId.get(visite.acquereurId);
    const bien = bienParId.get(visite.bienId);
    // Acquéreur ou bien archivé/introuvable : rien à proposer, jamais une carte pointant dans le vide.
    if (!acquereur || !bien) return [];

    // Rattachement par visiteId (ADR-040) ; à défaut — comptes rendus antérieurs à cette ADR —
    // par la coïncidence exacte bien + acquéreur + date, jamais par simple proximité de date.
    const compteRendu = contexte.comptesRendus.find(
      (cr) =>
        cr.visiteId === visite.id ||
        (cr.bienId === visite.bienId && cr.acquereurId === visite.acquereurId && cr.dateVisite === visite.datePrevue)
    );

    const cible = { type: "visite", id: visite.id } as const;
    const depuisJours = joursCivilsEcoules(new Date(`${visite.datePrevue}T12:00:00Z`), maintenant);
    if (depuisJours < 0) return [];

    if (!compteRendu) {
      return [
        {
          id: construireIdOpportunite("suivi_visite", cible, "compte_rendu_absent"),
          type: "suivi_visite",
          priorite: "moyenne",
          cible,
          titre: `Faire le suivi de la visite de ${nomComplet(acquereur)}`,
          raison: `La visite du ${bien.adresse} a eu lieu il y a ${depuisJours} jour${depuisJours > 1 ? "s" : ""} et aucun compte rendu n'a encore été enregistré.`,
          action: { libelle: "Ouvrir la visite", href: `/visites/${visite.id}` },
          depuisJours,
        },
      ];
    }

    if (compteRendu.interet === "interesse" && !compteRendu.prochaineEtape) {
      return [
        {
          id: construireIdOpportunite("suivi_visite", cible, "prochaine_etape_absente"),
          type: "suivi_visite",
          priorite: "moyenne",
          cible,
          titre: `Donner une suite à la visite de ${nomComplet(acquereur)}`,
          raison: `Le compte rendu indique un acquéreur intéressé par ${bien.adresse}, sans prochaine étape enregistrée.`,
          action: { libelle: "Ouvrir la visite", href: `/visites/${visite.id}` },
          depuisJours,
        },
      ];
    }

    return [];
  });
}

// CAS 3 — rapprochement compatible jamais exploité. Le verdict vient du moteur canonique
// (ADR-034), jamais recalculé ici. Trois conditions cumulatives : statut global compatible,
// acquéreur réellement en recherche, et aucune visite déjà enregistrée sur cette paire.
export function regleMatchAExploiter(contexte: ContexteOpportunites): Opportunite[] {
  const acquereurParId = new Map(contexte.acquereurs.map((a) => [a.id, a]));
  const bienParId = new Map(contexte.biens.map((b) => [b.id, b]));
  const pairesVisitees = new Set(contexte.visites.map((v) => `${v.bienId}:${v.acquereurId}`));

  return contexte.compatibilites.flatMap((resultat) => {
    if (resultat.statutGlobal !== "compatible") return [];
    if (pairesVisitees.has(`${resultat.bienId}:${resultat.acquereurId}`)) return [];

    const acquereur = acquereurParId.get(resultat.acquereurId);
    const bien = bienParId.get(resultat.bienId);
    if (!acquereur || !bien) return [];
    // Un acquéreur déjà engagé (offre, compromis, acte) n'a pas à se voir proposer un autre bien ;
    // un acquéreur en découverte n'a pas encore de projet assez défini pour une proposition.
    if (acquereur.stadeProjet !== "recherche_active") return [];

    const cible = { type: "acquereur", id: acquereur.id } as const;
    const criteresRetenus = resultat.criteres
      .filter((c) => c.statut === "compatible")
      .map((c) => c.label);

    return [
      {
        id: construireIdOpportunite("match_a_exploiter", cible, resultat.bienId),
        type: "match_a_exploiter",
        priorite: "moyenne",
        cible,
        titre: `Proposer ${bien.reference} à ${nomComplet(acquereur)}`,
        raison: `${criteresRetenus.length > 0 ? `${criteresRetenus.join(", ")} : tous compatibles. ` : ""}Aucune visite n'est enregistrée sur ce rapprochement.`,
        action: { libelle: "Voir l'acquéreur", href: `/clients/${acquereur.id}` },
      },
    ];
  });
}

// CAS 4 — information manquante sur le BIEN qui empêche de qualifier un rapprochement. Une seule
// opportunité par (bien, critère), quel que soit le nombre d'acquéreurs concernés : l'action à
// mener est unique, c'est de renseigner la donnée. Jamais une proposition commerciale — un
// rapprochement « à vérifier » n'est pas un rapprochement compatible (ADR-034).
export function regleInformationAVerifier(contexte: ContexteOpportunites): Opportunite[] {
  const acquereurParId = new Map(contexte.acquereurs.map((a) => [a.id, a]));
  const bienParId = new Map(contexte.biens.map((b) => [b.id, b]));

  // Clé (bien, critère) -> libellé du critère + noms des acquéreurs dont la qualification dépend
  // de cette information.
  const parBienEtCritere = new Map<string, { bienId: string; critere: string; label: string; acquereurs: string[] }>();

  for (const resultat of contexte.compatibilites) {
    if (resultat.statutGlobal !== "a_verifier") continue;
    const acquereur = acquereurParId.get(resultat.acquereurId);
    if (!acquereur || !bienParId.has(resultat.bienId)) continue;

    for (const critere of resultat.criteres) {
      if (critere.statut !== "a_verifier") continue;
      const cle = `${resultat.bienId}:${critere.critere}`;
      const entree = parBienEtCritere.get(cle) ?? {
        bienId: resultat.bienId,
        critere: critere.critere,
        label: critere.label,
        acquereurs: [],
      };
      entree.acquereurs.push(nomComplet(acquereur));
      parBienEtCritere.set(cle, entree);
    }
  }

  return [...parBienEtCritere.values()].map((entree) => {
    const bien = bienParId.get(entree.bienId)!;
    const cible = { type: "bien", id: entree.bienId } as const;
    const noms = entree.acquereurs.join(", ");
    return {
      id: construireIdOpportunite("information_a_verifier", cible, entree.critere),
      type: "information_a_verifier",
      priorite: "basse",
      cible,
      titre: `Vérifier : ${entree.label.toLowerCase()} — ${bien.reference}`,
      raison: `Cette information manque sur le bien et laisse le rapprochement avec ${noms} au statut « À vérifier ».`,
      action: { libelle: "Voir le bien", href: `/biens/${entree.bienId}` },
    };
  });
}
