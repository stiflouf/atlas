"use server";

import { redirect } from "next/navigation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { annulerBrouillonBonVisite, creerBonVisite, signerBonVisite } from "@/lib/bonVisiteRepository";
import { validerEtDecoderSignatureImage } from "@/lib/bonVisite/validationSignatureImage";
import type { RoleSignataire } from "@/types/bonVisite";

// Création d'un nouveau bon (brouillon, §19) pour une Visite — jamais bloqué par le statut de la
// Visite sauf `annulee` (§35), vérifié dans le writer, jamais ici.
export async function creerBonVisiteAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const visiteId = String(formData.get("visiteId") ?? "");
  if (!visiteId) redirect("/");

  const resultat = await creerBonVisite(visiteId, workspaceId);
  if (resultat.statut === "cree") {
    redirect(`/visites/${visiteId}/bon-de-visite/${resultat.bonVisite.id}`);
  }
  redirect(`/visites/${visiteId}`);
}

// §34 : seul un brouillon peut être annulé — silencieusement sans effet si l'état a changé entre
// l'affichage du bouton et la soumission (même patron que annulerVisiteAction).
export async function annulerBrouillonBonVisiteAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  const visiteId = String(formData.get("visiteId") ?? "");
  if (id) {
    await annulerBrouillonBonVisite(id, workspaceId);
  }
  redirect(`/visites/${visiteId}`);
}

const ROLES_VALIDES: RoleSignataire[] = ["principal", "secondaire"];

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

// Writer central de signature (§21) — jamais de validation de la signature/du consentement côté
// client seulement (§29/§30/§44) : la même image data URL et le même booléen de consentement sont
// revalidés ici, avant tout appel au repository. Un refus redirige vers la page de signature avec
// un motif lisible en query string (?erreur=...) plutôt qu'un throw brut — une signature refusée
// (canvas vide, case non cochée) est un cas normal du parcours, pas une exception technique.
export async function signerBonVisiteAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const bonVisiteId = String(formData.get("bonVisiteId") ?? "");
  const visiteId = String(formData.get("visiteId") ?? "");
  const pageSignature = `/visites/${visiteId}/bon-de-visite/${bonVisiteId}`;
  if (!bonVisiteId || !visiteId) redirect("/");

  const nomSignataire = String(formData.get("nomSignataire") ?? "").trim();
  const prenomSignataire = parseTexteOptionnel(formData.get("prenomSignataire"));
  const emailSignataire = parseTexteOptionnel(formData.get("emailSignataire"));
  const contactId = parseTexteOptionnel(formData.get("contactId"));
  const roleValeur = String(formData.get("roleSignataire") ?? "principal");
  const roleSignataire: RoleSignataire = ROLES_VALIDES.includes(roleValeur as RoleSignataire)
    ? (roleValeur as RoleSignataire)
    : "principal";
  const consentementConfirme = formData.get("consentement") === "on";
  const signatureDataUrl = String(formData.get("signatureImage") ?? "");

  if (!nomSignataire) redirect(`${pageSignature}?erreur=nom_signataire_manquant`);
  if (!consentementConfirme) redirect(`${pageSignature}?erreur=consentement_manquant`);

  const validation = await validerEtDecoderSignatureImage(signatureDataUrl);
  if (validation.statut !== "valide") redirect(`${pageSignature}?erreur=${validation.statut}`);

  const resultat = await signerBonVisite(
    {
      bonVisiteId,
      contactId,
      nomSignataire,
      prenomSignataire,
      emailSignataire,
      roleSignataire,
      signatureImagePng: validation.buffer,
      consentementConfirme,
    },
    workspaceId
  );

  if (resultat.statut !== "signe") redirect(`${pageSignature}?erreur=${resultat.statut}`);
  redirect(`/visites/${visiteId}`);
}
