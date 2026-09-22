"use server";

import { redirect } from "next/navigation";
import {
  creerCompromis,
  deciderCompromis,
  modifierDateActeCompromis,
  type ResultatCreationCompromis,
  type ResultatDecisionCompromis,
  type ResultatModificationDateActe,
} from "@/lib/compromisRepository";
import { traiterExecutionsEnAttente } from "@/lib/automatisations/moteur";
import type { StatutCompromis } from "@/types/compromis";
import { estMotifPerteHumain } from "@/types/motifPerte";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { ErreurSaisie, avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

// ADR-061 §13 (lot OFFER_LIFECYCLE_FOUNDATION_V1) — création et transitions du Compromis passent par
// des writers transactionnels scoped (verrou du bien, même ordre que l'Offre), qui rendent un
// résultat typé traduit ici en message ; les événements `compromis_signe` / `compromis_realise` /
// `compromis_annule` sont émis dans la transaction du writer, traités après COMMIT.

const TRANSITIONS_VALIDES: StatutCompromis[] = ["realise", "annule"];

function parseMontant(valeur: FormDataEntryValue | null): number | undefined {
  const montant = Number(valeur);
  return Number.isFinite(montant) && montant > 0 ? montant : undefined;
}

function parseDateOptionnelle(valeur: FormDataEntryValue | null): string | undefined {
  const date = String(valeur ?? "").trim();
  return date !== "" ? date : undefined;
}

function parseOffreIdOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const id = String(valeur ?? "").trim();
  return id !== "" ? id : undefined;
}

// Refus explicite (throw) si le bien/acquéreur est invalide ou archivé, si un compromis est déjà
// en_cours pour ce bien (garde d'unicité applicative, ADR-016), ou si l'offre liée ne correspond
// pas au bien/acquéreur/statut attendu. Couplage : pose compromisSigneLe sur le bien dans la
// même action, un seul geste conseiller.
//
// Transaction unique englobant l'enregistrement du compromis, la pose de compromisSigneLe et
// l'émission de l'événement `compromis_signe` (ADR-032, correction validée) : corrige une absence
// d'atomicité préexistante entre les deux premières écritures (auparavant deux appels séquentiels
// non transactionnels) en même temps qu'elle y accroche le moteur d'automatisations.
export async function ajouterCompromisAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const bienId = String(formData.get("bienId") ?? "");
    const acquereurId = String(formData.get("acquereurId") ?? "");
    const prixConvenu = parseMontant(formData.get("prixConvenu"));
    const dateSignature = String(formData.get("dateSignature") ?? "").trim();
    const dateActe = parseDateOptionnelle(formData.get("dateActe"));
    const offreId = parseOffreIdOptionnel(formData.get("offreId"));

    if (!prixConvenu) throw new ErreurSaisie("Le prix convenu doit être un nombre positif.");
    if (!dateSignature) throw new ErreurSaisie("La date de signature est obligatoire.");

    const resultat = await creerCompromis({ bienId, acquereurId, offreId, prixConvenu, dateSignature, dateActe }, workspaceId);
    if (resultat.statut !== "cree") throw new ErreurSaisie(messageRefusCreation(resultat));
    await traiterExecutionsEnAttente(resultat.idsExecutionsATraiter);

    redirect(`/biens/${bienId}`);
  });
}

function messageRefusCreation(resultat: Exclude<ResultatCreationCompromis, { statut: "cree" }>): string {
  switch (resultat.statut) {
    case "bien_introuvable":
      return "Bien introuvable.";
    case "acquereur_introuvable":
      return "Acquéreur introuvable.";
    case "bien_archive":
      return "Impossible d'ajouter un compromis sur un bien archivé.";
    case "acquereur_archive":
      return "Impossible d'ajouter un compromis pour un acquéreur archivé.";
    case "compromis_en_cours_existant":
      return "Un compromis est déjà en cours pour ce bien.";
    case "offre_introuvable":
      return "Offre introuvable.";
    case "offre_autre_bien":
      return "Cette offre ne concerne pas ce bien.";
    case "offre_incoherente":
      return "Cette offre ne concerne pas cet acquéreur.";
    case "offre_non_acceptee":
      return "Cette offre n'est pas acceptée.";
    case "offre_deja_utilisee":
      return "Cette offre est déjà associée à un compromis.";
  }
}

function messageRefusDecision(resultat: Exclude<ResultatDecisionCompromis, { statut: "decide" }> | Exclude<ResultatModificationDateActe, { statut: "modifie" }>): string {
  switch (resultat.statut) {
    case "introuvable":
      return "Compromis introuvable.";
    case "deja_finalise":
      return "Ce compromis est déjà dans un statut final.";
    case "bien_archive":
      return "Impossible de modifier un compromis sur un bien archivé.";
    case "acquereur_archive":
      return "Impossible de modifier un compromis pour un acquéreur archivé.";
  }
}

// Refus explicite (throw) si le compromis est introuvable, si le bien ou l'acquéreur est
// archivé, si le compromis n'est plus 'en_cours', ou (transition 'realise' uniquement) si
// dateActeReelle est absente/invalide — une vente ne doit jamais être marquée 'realise' sans date
// réelle (ADR-017). L'écriture statut+dateActeReelle est atomique (marquerCompromisRealise).
// Transition 'annule' (ADR-020) : dateAnnulation et motifAnnulation obligatoires, refus explicite
// sinon, aucune écriture — écriture atomique via marquerCompromisAnnule. Aucune inférence
// d'acteur : seul le motif choisi par le conseiller fait foi.
// Ne modifie jamais compromisSigneLe, l'archivage du bien, ni stadeProjet de l'acquéreur —
// gestes commerciaux volontairement séparés (ADR-014/ADR-016/ADR-017).
export async function changerStatutCompromisAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const compromisId = String(formData.get("compromisId") ?? "");
    const statut = String(formData.get("statut") ?? "") as StatutCompromis;

    if (!TRANSITIONS_VALIDES.includes(statut)) {
      throw new ErreurSaisie("Transition de statut invalide.");
    }

    let resultat: ResultatDecisionCompromis;
    if (statut === "realise") {
      const dateActeReelle = parseDateOptionnelle(formData.get("dateActeReelle"));
      if (!dateActeReelle) {
        throw new ErreurSaisie("La date réelle de signature de l'acte est obligatoire pour marquer une vente réalisée.");
      }
      resultat = await deciderCompromis(compromisId, { statut: "realise", dateActeReelle }, workspaceId);
    } else {
      const dateAnnulation = parseDateOptionnelle(formData.get("dateAnnulation"));
      if (!dateAnnulation) {
        throw new ErreurSaisie("La date d'annulation est obligatoire.");
      }
      const motifAnnulation = String(formData.get("motifAnnulation") ?? "").trim();
      if (!estMotifPerteHumain(motifAnnulation)) {
        throw new ErreurSaisie("Le motif de l'annulation est obligatoire.");
      }
      resultat = await deciderCompromis(compromisId, { statut: "annule", dateAnnulation, motifAnnulation }, workspaceId);
    }
    if (resultat.statut !== "decide") throw new ErreurSaisie(messageRefusDecision(resultat));
    await traiterExecutionsEnAttente(resultat.idsExecutionsATraiter);

    redirect(`/biens/${resultat.compromis.bienId}`);
  });
}

// Modification de la date d'acte PRÉVUE (ADR-046) — jamais une transition de statut, action
// séparée et volontairement distincte de changerStatutCompromisAction. Refus explicite (throw) si
// le compromis est introuvable, si le bien ou l'acquéreur est archivé, ou si le compromis n'est
// plus 'en_cours' — les statuts terminaux (realise/annule) représentent l'historique constaté,
// jamais rétrospectivement modifié via ce chemin (seule dateActeReelle, posée atomiquement avec la
// transition 'realise', fait foi à ce stade). Relit le compromis à chaque appel, jamais une
// confiance dans un état affiché au GET : une course entre l'affichage du formulaire et sa
// soumission (le compromis devient 'realise'/'annule' entre-temps) est donc refusée ici, pas
// seulement masquée côté UI. `dateActe` reste nullable : un champ vide efface explicitement la
// date (report sans nouvelle date connue) — jamais remplacé par une estimation inventée.
export async function modifierDateActeAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const compromisId = String(formData.get("compromisId") ?? "");
    const dateActe = parseDateOptionnelle(formData.get("dateActe"));

    const resultat = await modifierDateActeCompromis(compromisId, dateActe, workspaceId);
    if (resultat.statut === "deja_finalise") throw new ErreurSaisie("La date d'acte prévue n'est modifiable que pour un compromis en cours.");
    if (resultat.statut !== "modifie") throw new ErreurSaisie(messageRefusDecision(resultat));

    redirect(`/biens/${resultat.compromis.bienId}`);
  });
}
