"use server";

import { redirect } from "next/navigation";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { getCompromisById } from "@/lib/compromisRepository";
import {
  enregistrerRemuneration,
  getRemunerationParCompromis,
  marquerRemunerationEncaissee,
  modifierRemunerationPrevisionnelle,
} from "@/lib/remunerationRepository";
import { parseMontantCentimes } from "@/types/remuneration";

// undefined = absent (champ optionnel non renseigné), null n'est jamais retourné par ce helper —
// distinct de parseMontantCentimesOuNull utilisé par la correction (§ modifierRemunerationAction).
function parseMontantCentimesOptionnel(valeur: FormDataEntryValue | null): number | undefined {
  const brut = String(valeur ?? "").trim();
  return brut === "" ? undefined : parseMontantCentimes(brut);
}

// Distingue explicitement "vide" (⇒ null, remise à NULL) de "invalide" (⇒ undefined, l'appelant doit
// throw) — jamais confondus, condition du point 4 (correction = remplacement complet, pas de patch
// partiel avec undefined = "ne pas toucher").
function parseMontantCentimesOuNull(valeur: FormDataEntryValue | null): number | null | undefined {
  const brut = String(valeur ?? "").trim();
  if (brut === "") return null;
  return parseMontantCentimes(brut);
}

function parseDateOptionnelle(valeur: FormDataEntryValue | null): string | undefined {
  const date = String(valeur ?? "").trim();
  return date !== "" ? date : undefined;
}

function parseDateOuNull(valeur: FormDataEntryValue | null): string | null {
  const date = String(valeur ?? "").trim();
  return date !== "" ? date : null;
}

// Refus explicite (throw) si le compromis est introuvable ou annulé, si le compromis est en_cours et
// que le bien/acquéreur est archivé (archivage commercial ≠ clôture du suivi financier historique :
// aucun blocage d'archivage si le compromis est realise, ADR-021), si le montant de rémunération du
// conseiller est absent/≤0, si les honoraires totaux sont renseignés mais ≤0, ou si une rémunération
// existe déjà pour ce compromis (contrainte UNIQUE en base, vérifiée ici pour un message clair).
export async function ajouterRemunerationAction(formData: FormData): Promise<void> {
  const compromisId = String(formData.get("compromisId") ?? "");

  const compromisActuel = await getCompromisById(compromisId);
  if (!compromisActuel) throw new Error("Compromis introuvable.");
  if (compromisActuel.statut === "annule") {
    throw new Error("Impossible d'ajouter une rémunération sur un compromis annulé.");
  }

  if (compromisActuel.statut === "en_cours") {
    const [bien, acquereur] = await Promise.all([
      getBienById(compromisActuel.bienId),
      getClientById(compromisActuel.acquereurId),
    ]);
    if (bien?.archiveLe || acquereur?.archiveLe) {
      throw new Error(
        "Impossible d'ajouter une rémunération prévisionnelle sur un compromis en cours dont le bien ou l'acquéreur est archivé."
      );
    }
  }

  const remunerationExistante = await getRemunerationParCompromis(compromisId);
  if (remunerationExistante) {
    throw new Error("Une rémunération existe déjà pour ce compromis — utilisez la correction.");
  }

  const montantRemunerationConseillerCentimes = parseMontantCentimesOptionnel(
    formData.get("montantRemunerationConseiller")
  );
  if (!montantRemunerationConseillerCentimes || montantRemunerationConseillerCentimes <= 0) {
    throw new Error("Le montant de la rémunération du conseiller doit être un nombre positif.");
  }

  const montantHonorairesTotalCentimes = parseMontantCentimesOptionnel(formData.get("montantHonorairesTotal"));
  if (montantHonorairesTotalCentimes !== undefined && montantHonorairesTotalCentimes <= 0) {
    throw new Error("Le montant des honoraires totaux, s'il est renseigné, doit être un nombre positif.");
  }

  const dateEncaissementPrevue = parseDateOptionnelle(formData.get("dateEncaissementPrevue"));

  await enregistrerRemuneration({
    compromisId,
    montantRemunerationConseillerCentimes,
    montantHonorairesTotalCentimes,
    dateEncaissementPrevue,
  });

  redirect(`/biens/${compromisActuel.bienId}`);
}

// Refus explicite si la rémunération est introuvable, si le compromis est annulé, si le compromis
// est en_cours et le bien/acquéreur archivé (même exception qu'à la création), ou si le montant de
// rémunération du conseiller est invalide. Remplacement complet des trois champs corrigibles : un
// champ laissé vide dans le formulaire repasse explicitement à NULL en base (jamais "ignoré"). Si
// modifierRemunerationPrevisionnelle retourne undefined, la rémunération vient d'être marquée
// encaissée entre la lecture et l'écriture (gel concurrent, ADR-021) — throw dédié.
export async function modifierRemunerationAction(formData: FormData): Promise<void> {
  const compromisId = String(formData.get("compromisId") ?? "");

  const remunerationActuelle = await getRemunerationParCompromis(compromisId);
  if (!remunerationActuelle) throw new Error("Rémunération introuvable.");

  const compromisActuel = await getCompromisById(compromisId);
  if (!compromisActuel) throw new Error("Compromis introuvable.");
  if (compromisActuel.statut === "annule") {
    throw new Error("Impossible de corriger une rémunération sur un compromis annulé.");
  }
  if (remunerationActuelle.dateEncaissementReelle) {
    throw new Error("Cette rémunération est encaissée, ses montants ne sont plus modifiables.");
  }

  if (compromisActuel.statut === "en_cours") {
    const [bien, acquereur] = await Promise.all([
      getBienById(compromisActuel.bienId),
      getClientById(compromisActuel.acquereurId),
    ]);
    if (bien?.archiveLe || acquereur?.archiveLe) {
      throw new Error(
        "Impossible de corriger une rémunération prévisionnelle sur un compromis en cours dont le bien ou l'acquéreur est archivé."
      );
    }
  }

  const montantRemunerationConseillerCentimes = parseMontantCentimesOptionnel(
    formData.get("montantRemunerationConseiller")
  );
  if (!montantRemunerationConseillerCentimes || montantRemunerationConseillerCentimes <= 0) {
    throw new Error("Le montant de la rémunération du conseiller doit être un nombre positif.");
  }

  const montantHonorairesTotalCentimes = parseMontantCentimesOuNull(formData.get("montantHonorairesTotal"));
  if (montantHonorairesTotalCentimes === undefined) {
    throw new Error("Le montant des honoraires totaux, s'il est renseigné, doit être un nombre positif.");
  }
  if (montantHonorairesTotalCentimes !== null && montantHonorairesTotalCentimes <= 0) {
    throw new Error("Le montant des honoraires totaux, s'il est renseigné, doit être un nombre positif.");
  }

  const dateEncaissementPrevue = parseDateOuNull(formData.get("dateEncaissementPrevue"));

  const resultat = await modifierRemunerationPrevisionnelle(compromisId, {
    montantRemunerationConseillerCentimes,
    montantHonorairesTotalCentimes,
    dateEncaissementPrevue,
  });
  if (!resultat) {
    throw new Error("Cette rémunération vient d'être marquée comme encaissée, elle n'est plus modifiable.");
  }

  redirect(`/biens/${compromisActuel.bienId}`);
}

// Refus explicite si la rémunération est introuvable, si le compromis n'est pas realise, si la date
// réelle de l'acte est absente (garde de cohérence, ne devrait jamais arriver si statut === realise,
// même réflexe que compromis.ts/ADR-017), ou si la date d'encaissement réelle est manquante. Aucune
// vérification d'archivage : explicitement autorisé après archivage du bien/acquéreur (ADR-021, le
// règlement financier d'une vente déjà conclue ne s'arrête pas à l'archivage du dossier commercial).
// Si marquerRemunerationEncaissee retourne undefined, la rémunération est déjà encaissée (gel
// concurrent) — throw dédié.
export async function marquerRemunerationEncaisseeAction(formData: FormData): Promise<void> {
  const compromisId = String(formData.get("compromisId") ?? "");

  const remunerationActuelle = await getRemunerationParCompromis(compromisId);
  if (!remunerationActuelle) throw new Error("Rémunération introuvable.");
  if (remunerationActuelle.dateEncaissementReelle) {
    throw new Error("Cette rémunération est déjà marquée comme encaissée.");
  }

  const compromisActuel = await getCompromisById(compromisId);
  if (!compromisActuel) throw new Error("Compromis introuvable.");
  if (compromisActuel.statut !== "realise") {
    throw new Error("Une rémunération ne peut être marquée encaissée que sur un compromis réalisé.");
  }
  if (!compromisActuel.dateActeReelle) {
    throw new Error("La date réelle de l'acte doit être renseignée avant de marquer la rémunération encaissée.");
  }

  const dateEncaissementReelle = parseDateOptionnelle(formData.get("dateEncaissementReelle"));
  if (!dateEncaissementReelle) {
    throw new Error("La date d'encaissement réelle est obligatoire.");
  }

  const resultat = await marquerRemunerationEncaissee(compromisId, dateEncaissementReelle);
  if (!resultat) {
    throw new Error("Cette rémunération est déjà marquée comme encaissée.");
  }

  redirect(`/biens/${compromisActuel.bienId}`);
}
