"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { enregistrerCompteRenduVisite } from "@/lib/compteRenduVisiteRepository";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { getVisiteById, marquerVisiteRealisee } from "@/lib/visiteRepository";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";
import { traiterExecutionsEnAttente } from "@/lib/automatisations/moteur";
import type { Interet } from "@/types/compteRenduVisite";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

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
export async function enregistrerCompteRenduVisiteAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const bienId = String(formData.get("bienId") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const visiteIdSoumis = String(formData.get("visiteId") ?? "");
  const dateVisite = String(formData.get("dateVisite") ?? "");
  const retour = String(formData.get("retour") ?? "").trim();
  const interet = parseInteret(formData.get("interet"));

  if (bienId && acquereurId && dateVisite && retour && interet) {
    const [bien, acquereur] = await Promise.all([getBienById(bienId), getClientById(acquereurId)]);
    if (bien && !bien.archiveLe && acquereur && !acquereur.archiveLe) {
      // La visite n'est reliée que si elle existe réellement, cible bien ce même couple
      // bien/acquéreur, et est encore 'planifiee' — jamais une transition sur une visite déjà
      // réalisée/annulée par ailleurs (contournement de formulaire, double soumission).
      const visite = visiteIdSoumis ? await getVisiteById(visiteIdSoumis) : undefined;
      const visiteValide =
        visite && visite.bienId === bienId && visite.acquereurId === acquereurId && visite.statut === "planifiee"
          ? visite
          : undefined;

      // Transaction unique (ADR-032/040) : le compte rendu, la transition éventuelle de la visite
      // vers 'realisee' et l'événement métier `visite_realisee` (+ le snapshot des exécutions à
      // traiter selon l'activation en vigueur MAINTENANT) sont aussi durables les uns que les
      // autres — jamais un trou entre "visite enregistrée" et "événement émis". Le traitement
      // effectif (création éventuelle d'une tâche) reste synchrone juste après le COMMIT, jamais
      // à l'intérieur : son échec ne doit jamais faire échouer l'enregistrement du compte rendu.
      const { idsExecutionsATraiter } = await getDb().transaction(async (tx) => {
        const compteRendu = await enregistrerCompteRenduVisite(
          {
            bienId,
            acquereurId,
            visiteId: visiteValide?.id,
            dateVisite,
            retour,
            interet,
            prochaineEtape: parseTexteOptionnel(formData.get("prochaineEtape")),
          },
          tx
        );
        if (visiteValide) {
          await marquerVisiteRealisee(visiteValide.id, tx);
        }
        return emettreEvenementEtPreparerExecutions(
          { typeEvenement: "visite_realisee", compteRenduVisiteId: compteRendu.id },
          tx
        );
      });
      await traiterExecutionsEnAttente(idsExecutionsATraiter);

      // VALUE-02 — retour sur la fiche de la visite qui vient d'être traitée, jamais sur la fiche
      // du bien : le conseiller y voit immédiatement la suite recommandée et les suivis déjà
      // planifiés. Repli sur le bien quand aucune Visite Atlas n'a pu être reliée (compte rendu
      // enregistré hors cycle ADR-040) — il n'existe alors aucune fiche visite où atterrir.
      if (visiteValide) redirect(`/visites/${visiteValide.id}`);
    }
  }

  redirect(`/biens/${bienId}`);
}
