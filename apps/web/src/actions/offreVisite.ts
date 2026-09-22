"use server";

import { redirect } from "next/navigation";
import { getOffreById } from "@/lib/offreRepository";
import { getCompteRenduVisiteById } from "@/lib/compteRenduVisiteRepository";
import {
  lierVisiteAOffre,
  retirerLienVisiteOffre,
  getLienOffreVisite,
  getLienOffreVisiteById,
} from "@/lib/offreVisiteRepository";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { ErreurSaisie, avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

// Rattachement rétroactif (ADR-019) : contrairement au rattachement fait à la création d'une
// offre (voir ajouterOffreAction), ce chemin permet de lier une visite à une offre déjà
// existante, à tout moment, tant que le bien/acquéreur correspondent et que la visite précède
// l'offre. Refus explicite (throw) sinon — jamais d'inférence, jamais de garde d'archivage : lier
// une visite à une offre documente un rapprochement entre deux faits déjà enregistrés, ce n'est
// pas la création d'un nouveau fait commercial sur une entité active (même principe qu'ADR-018,
// l'historique inclut les entités archivées).
export async function lierVisiteAOffreAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const offreId = String(formData.get("offreId") ?? "");
    const compteRenduVisiteId = String(formData.get("compteRenduVisiteId") ?? "");

    const [offre, compteRendu] = await Promise.all([
      getOffreById(offreId, workspaceId),
      getCompteRenduVisiteById(compteRenduVisiteId, workspaceId),
    ]);
    if (!offre) throw new ErreurSaisie("Offre introuvable.");
    if (!compteRendu) throw new ErreurSaisie("Visite introuvable.");
    if (offre.bienId !== compteRendu.bienId) throw new ErreurSaisie("Cette visite ne concerne pas ce bien.");
    if (offre.acquereurId !== compteRendu.acquereurId) throw new ErreurSaisie("Cette visite ne concerne pas cet acquéreur.");
    if (compteRendu.dateVisite > offre.dateOffre) {
      throw new ErreurSaisie("Une visite postérieure à l'offre ne peut pas y être liée.");
    }

    const lienExistant = await getLienOffreVisite(offreId, compteRenduVisiteId);
    if (lienExistant) throw new ErreurSaisie("Cette visite est déjà liée à cette offre.");

    await lierVisiteAOffre(offreId, compteRenduVisiteId);

    redirect(`/biens/${offre.bienId}`);
  });
}

// Correction d'une liaison faite par erreur (ADR-019) : supprime uniquement la ligne de liaison,
// jamais la visite ni l'offre elles-mêmes. Le bien de redirection est retrouvé côté serveur à
// partir du lien puis de son offre — jamais depuis un bienId fourni par le formulaire, qui ne
// serait qu'une donnée de confort côté navigateur, pas une source fiable.
export async function delierVisiteAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const lienId = String(formData.get("lienId") ?? "");

    const lien = await getLienOffreVisiteById(lienId);
    if (!lien) throw new ErreurSaisie("Lien introuvable.");
    const offre = await getOffreById(lien.offreId, workspaceId);
    if (!offre) throw new ErreurSaisie("Offre introuvable.");

    await retirerLienVisiteOffre(lienId);

    redirect(`/biens/${offre.bienId}`);
  });
}
