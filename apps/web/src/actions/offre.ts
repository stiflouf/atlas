"use server";

import { redirect } from "next/navigation";
import { getCompteRenduVisiteById } from "@/lib/compteRenduVisiteRepository";
import { accepterOffre, creerOffre, refuserOffre, rendreOffreCaduque, retirerOffre, type ResultatDecisionOffre } from "@/lib/offreRepository";
import { traiterExecutionsEnAttente } from "@/lib/automatisations/moteur";
import type { StatutOffre } from "@/types/offre";
import { estMotifPerteHumain } from "@/types/motifPerte";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { ErreurSaisie, avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

// ADR-061 (lot OFFER_LIFECYCLE_FOUNDATION_V1) — les gestes humains sur l'Offre. Pipeline :
// session → workspace de SESSION (jamais depuis le formulaire) → parsing → writer transactionnel
// du repository (verrou du bien, résultat typé) → exécutions d'automatisation après COMMIT →
// redirection. Les refus métier sont des messages explicites, jamais une erreur SQL brute.

const TRANSITIONS_VALIDES: StatutOffre[] = ["acceptee", "refusee", "retiree", "caduque"];

function parseMontant(valeur: FormDataEntryValue | null): number | undefined {
  const montant = Number(valeur);
  return Number.isFinite(montant) && montant > 0 ? montant : undefined;
}

function parseDateOptionnelle(valeur: FormDataEntryValue | null): string | undefined {
  const date = String(valeur ?? "").trim();
  return date !== "" ? date : undefined;
}

// Refus explicite (throw) si le bien ou l'acquéreur est invalide/inexistant/archivé — une offre
// est un nouveau fait métier structuré, jamais posé sur une entité sortie des flux actifs
// (ADR-012/ADR-014/ADR-015). Refuse aussi si un compteRenduVisiteId coché ne correspond pas
// exactement au même bien/acquéreur ou a une dateVisite postérieure à dateOffre (ADR-019).
// Doublon accidentel (ADR-044) : relu SOUS VERROU par le writer, confirmable explicitement.
// L'offre naît `en_cours`, ses liens et l'événement `offre_recue` sont écrits dans la même
// transaction ; `biens.offre_en_cours_le` n'est plus touché (ADR-061 §12).
export async function ajouterOffreAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const bienId = String(formData.get("bienId") ?? "");
    const acquereurId = String(formData.get("acquereurId") ?? "");
    const montant = parseMontant(formData.get("montant"));
    const dateOffre = String(formData.get("dateOffre") ?? "").trim();
    const dateValidite = parseDateOptionnelle(formData.get("dateValidite"));
    const compteRenduVisiteIds = formData.getAll("compteRenduVisiteIds").map(String).filter((id) => id !== "");
    const confirmerMalgreExistante = formData.get("confirmerNouvelleOffreMalgreExistante") != null;

    if (!montant) throw new ErreurSaisie("Le montant de l'offre doit être un nombre positif.");
    if (!dateOffre) throw new ErreurSaisie("La date de l'offre est obligatoire.");

    for (const compteRenduVisiteId of compteRenduVisiteIds) {
      const compteRendu = await getCompteRenduVisiteById(compteRenduVisiteId, workspaceId);
      if (!compteRendu) throw new ErreurSaisie("Visite introuvable.");
      if (compteRendu.bienId !== bienId) throw new ErreurSaisie("Cette visite ne concerne pas ce bien.");
      if (compteRendu.acquereurId !== acquereurId) throw new ErreurSaisie("Cette visite ne concerne pas cet acquéreur.");
      if (compteRendu.dateVisite > dateOffre) {
        throw new ErreurSaisie("Une visite postérieure à l'offre ne peut pas y être liée.");
      }
    }

    const resultat = await creerOffre({ bienId, acquereurId, montant, dateOffre, dateValidite }, compteRenduVisiteIds, workspaceId, {
      confirmerMalgreExistante,
    });
    switch (resultat.statut) {
      case "bien_introuvable":
        throw new ErreurSaisie("Bien introuvable.");
      case "acquereur_introuvable":
        throw new ErreurSaisie("Acquéreur introuvable.");
      case "bien_archive":
        throw new ErreurSaisie("Impossible d'ajouter une offre sur un bien archivé.");
      case "acquereur_archive":
        throw new ErreurSaisie("Impossible d'ajouter une offre pour un acquéreur archivé.");
      case "doublon_paire":
        throw new ErreurSaisie(
          "Une offre en cours existe déjà pour cet acquéreur sur ce bien — confirmez explicitement pour en créer une nouvelle."
        );
      case "creee":
        break;
    }
    await traiterExecutionsEnAttente(resultat.idsExecutionsATraiter);

    redirect(`/biens/${bienId}`);
  });
}

function messageRefus(resultat: Exclude<ResultatDecisionOffre, { statut: "decidee" }>): string {
  switch (resultat.statut) {
    case "introuvable":
      return "Offre introuvable.";
    case "deja_finalisee":
      return "Cette offre est déjà dans un statut final.";
    case "transition_interdite":
      return "Transition de statut invalide.";
    case "bien_archive":
      return "Impossible de modifier une offre sur un bien archivé.";
    case "acquereur_archive":
      return "Impossible de modifier une offre pour un acquéreur archivé.";
    case "acceptation_active_existante":
      return "Une autre offre est déjà acceptée sur ce bien : rendez son acceptation caduque avant d'en accepter une nouvelle.";
  }
}

// ADR-061 §2-§6 — `acceptee` / `refusee` / `retiree` depuis `en_cours`, `caduque` depuis
// `acceptee` : la matrice, l'atomicité, l'exclusivité (les autres offres en cours du bien sont
// refusées, motif système) et l'unicité de l'acceptation active sont tenues par le repository. Le
// motif système `autre_offre_acceptee` n'est jamais accepté en saisie humaine. Aucune inférence
// d'acteur : seul le motif choisi par le conseiller fait foi.
export async function changerStatutOffreAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const offreId = String(formData.get("offreId") ?? "");
    const statut = String(formData.get("statut") ?? "") as StatutOffre;
    const dateDecision = String(formData.get("dateDecision") ?? "").trim();
    const motifPerteBrut = String(formData.get("motifPerte") ?? "").trim();
    const bienIdRetour = String(formData.get("bienId") ?? "");

    if (!TRANSITIONS_VALIDES.includes(statut)) {
      throw new ErreurSaisie("Transition de statut invalide.");
    }

    let resultat: ResultatDecisionOffre;
    if (statut === "acceptee") {
      if (!dateDecision) throw new ErreurSaisie("La date de décision est obligatoire.");
      if (motifPerteBrut) throw new ErreurSaisie("Un motif de perte n'a pas de sens pour une offre acceptée.");
      resultat = await accepterOffre(offreId, dateDecision, workspaceId);
    } else {
      if (!estMotifPerteHumain(motifPerteBrut)) throw new ErreurSaisie("Le motif de la perte est obligatoire.");
      if (statut === "caduque") {
        resultat = await rendreOffreCaduque(offreId, motifPerteBrut, workspaceId);
      } else {
        if (!dateDecision) throw new ErreurSaisie("La date de décision est obligatoire.");
        resultat =
          statut === "refusee"
            ? await refuserOffre(offreId, dateDecision, motifPerteBrut, workspaceId)
            : await retirerOffre(offreId, dateDecision, motifPerteBrut, workspaceId);
      }
    }
    if (resultat.statut !== "decidee") throw new ErreurSaisie(messageRefus(resultat));
    await traiterExecutionsEnAttente(resultat.idsExecutionsATraiter);

    redirect(`/biens/${resultat.offre.bienId || bienIdRetour}`);
  });
}
