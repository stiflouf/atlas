"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { enregistrerCompteRenduVisite } from "@/lib/compteRenduVisiteRepository";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";
import { traiterExecutionsEnAttente } from "@/lib/automatisations/moteur";
import type { Interet } from "@/types/compteRenduVisite";

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
export async function enregistrerCompteRenduVisiteAction(formData: FormData): Promise<void> {
  const bienId = String(formData.get("bienId") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const dateVisite = String(formData.get("dateVisite") ?? "");
  const retour = String(formData.get("retour") ?? "").trim();
  const interet = parseInteret(formData.get("interet"));

  if (bienId && acquereurId && dateVisite && retour && interet) {
    const [bien, acquereur] = await Promise.all([getBienById(bienId), getClientById(acquereurId)]);
    if (bien && !bien.archiveLe && acquereur && !acquereur.archiveLe) {
      // Transaction unique (ADR-032) : le compte rendu et l'événement métier `visite_realisee`
      // (+ le snapshot des exécutions à traiter selon l'activation en vigueur MAINTENANT) sont
      // aussi durables l'un que l'autre — jamais un trou entre "visite enregistrée" et "événement
      // émis". Le traitement effectif (création éventuelle d'une tâche) reste synchrone juste
      // après le COMMIT, jamais à l'intérieur : son échec ne doit jamais faire échouer
      // l'enregistrement de la visite elle-même.
      const { idsExecutionsATraiter } = await getDb().transaction(async (tx) => {
        const compteRendu = await enregistrerCompteRenduVisite(
          { bienId, acquereurId, dateVisite, retour, interet, prochaineEtape: parseTexteOptionnel(formData.get("prochaineEtape")) },
          tx
        );
        return emettreEvenementEtPreparerExecutions(
          { typeEvenement: "visite_realisee", compteRenduVisiteId: compteRendu.id },
          tx
        );
      });
      await traiterExecutionsEnAttente(idsExecutionsATraiter);
    }
  }

  redirect(`/biens/${bienId}`);
}
