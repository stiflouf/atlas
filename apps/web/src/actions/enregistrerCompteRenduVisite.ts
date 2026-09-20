"use server";

import { redirect } from "next/navigation";
import { creerCompteRenduEtRealiserVisite } from "@/lib/compteRenduVisiteRepository";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { traiterExecutionsEnAttente } from "@/lib/automatisations/moteur";
import type { Interet } from "@/types/compteRenduVisite";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

const INTERETS_VALIDES: Interet[] = ["interesse", "a_reflechir", "pas_interesse", "inconnu"];

function parseInteret(valeur: FormDataEntryValue | null): Interet | undefined {
  return INTERETS_VALIDES.includes(valeur as Interet) ? (valeur as Interet) : undefined;
}

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

// Refus simple, sans insertion, si le retour est vide après trim, si interet ne correspond à
// aucune des 4 valeurs contrôlées, ou si le bien/l'acquéreur est archivé — jamais un nouveau
// compte rendu sur une entité sortie des flux actifs (ADR-012). Comme pour ajouterNoteBienAction,
// ce cas n'est normalement pas atteignable depuis l'UI (formulaire remplacé par un message sur
// une fiche archivée) ; le garde-fou couvre un appel contourné.
//
// visiteId (ADR-040) est optionnel : absent si la page de préparation n'a pas pu matérialiser de
// Visite Atlas (bien/acquéreur mockés — non réels, cas déjà impossible en pratique dès qu'au
// moins un bien réel existe, voir bienRepository.getBienById) — le compte rendu s'enregistre
// alors exactement comme avant ADR-040, sans transition de statut associée.
//
// VISIT_NATIVE_LIFECYCLE_V1 (ADR-063) — la validation "cette Visite existe / cible bien ce couple
// bien-acquéreur / est encore planifiee" est désormais posée SOUS LE VERROU, à l'intérieur de la
// même transaction que l'INSERT du compte rendu et l'UPDATE de la Visite
// (`creerCompteRenduEtRealiserVisite`, compteRenduVisiteRepository.ts) — jamais relue ici hors
// transaction, ce qui exposait une fenêtre de course avec une annulation/un second compte rendu
// concurrent (§17/§18 du brief).
export async function enregistrerCompteRenduVisiteAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  // ADR-054 — appartenance explicite de l'événement métier (table racine).
  const workspaceId = await exigerWorkspaceCourant();
  const bienId = String(formData.get("bienId") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const visiteIdSoumis = String(formData.get("visiteId") ?? "");
  const dateVisite = String(formData.get("dateVisite") ?? "");
  const retour = String(formData.get("retour") ?? "").trim();
  const interet = parseInteret(formData.get("interet"));

  if (bienId && acquereurId && dateVisite && retour && interet) {
    const [bien, acquereur] = await Promise.all([getBienById(bienId), getClientById(acquereurId)]);
    if (bien && !bien.archiveLe && acquereur && !acquereur.archiveLe) {
      const resultat = await creerCompteRenduEtRealiserVisite(
        {
          bienId,
          acquereurId,
          visiteId: visiteIdSoumis || undefined,
          dateVisite,
          retour,
          interet,
          prochaineEtape: parseTexteOptionnel(formData.get("prochaineEtape")),
        },
        workspaceId
      );

      // Le perdant d'une course réalisation/annulation (§17/§18 du brief) — la Visite visée a déjà
      // été tranchée par un autre geste au moment du verrou — n'enregistre jamais un second compte
      // rendu orphelin : retour direct sur la fiche du bien, message honnête, jamais une écriture
      // silencieuse.
      if (resultat.statut === "visite_deja_finalisee") {
        redirect(`/biens/${bienId}`);
      }

      // Traitement effectif (création éventuelle d'une tâche) synchrone juste après le COMMIT,
      // jamais à l'intérieur de la transaction : son échec ne doit jamais faire échouer
      // l'enregistrement du compte rendu déjà durable.
      await traiterExecutionsEnAttente(resultat.idsExecutionsATraiter);

      // VALUE-02 — retour sur la fiche de la visite qui vient d'être traitée, jamais sur la fiche
      // du bien : le conseiller y voit immédiatement la suite recommandée et les suivis déjà
      // planifiés. Repli sur le bien quand aucune Visite Atlas n'a pu être reliée (compte rendu
      // enregistré hors cycle ADR-040) — il n'existe alors aucune fiche visite où atterrir.
      if (resultat.visite) redirect(`/visites/${resultat.visite.id}`);
    }
  }

  redirect(`/biens/${bienId}`);
}
