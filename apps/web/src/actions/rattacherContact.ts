"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import {
  creerContactEtRattacherAcquereur,
  creerContactEtRattacherProspectVendeur,
  rattacherAcquereurAuContact,
  rattacherProspectVendeurAuContact,
  type ResultatCreationEtRattachement,
  type ResultatRattachement,
} from "@/lib/rattachementContact";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

// ADR-055 §H — le GESTE HUMAIN de rattachement. Deux actions volontairement DISTINCTES, jamais un
// « trouver ou créer » : choisir une personne existante et en déclarer une nouvelle sont deux
// décisions différentes, et les confondre derrière un seul bouton reviendrait à laisser la machine
// trancher celle que l'humain n'a pas prise.
//
// Aucun rattachement n'est jamais déduit d'un email, d'un téléphone ou d'un nom identiques. La
// recherche de candidats sert à ce qu'un humain RECONNAISSE quelqu'un, pas à ce que le produit le
// devine.

// Les refus sont des issues normales et visibles, jamais des exceptions silencieuses : elles
// reviennent à l'écran en paramètre, qui les affiche.
function messageRefus(resultat: ResultatRattachement | ResultatCreationEtRattachement): string {
  switch (resultat.statut) {
    case "deja_rattache":
      // JAMAIS de relink silencieux. Changer la personne canonique d'un dossier est une opération
      // à risque — elle emporterait tout l'historique relationnel avec elle — et aura son propre
      // geste, avec ses propres garanties.
      return "deja_rattache";
    case "contact_introuvable":
      return "contact_introuvable";
    case "workspaces_differents":
      return "workspace";
    default:
      return "introuvable";
  }
}

export async function rattacherAcquereurContactExistantAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!acquereurId || !contactId) notFound();

  const resultat = await getDb().transaction((tx) =>
    rattacherAcquereurAuContact(acquereurId, contactId, workspaceId, tx)
  );
  if (resultat.statut !== "rattache") {
    redirect(`/clients/${acquereurId}?rattachement=${messageRefus(resultat)}`);
  }
  redirect(`/clients/${acquereurId}`);
}

// « Créer un contact depuis ce dossier » : l'action ne lit pas le dossier elle-même — l'identité
// est relue SOUS VERROU par la primitive, dans le workspace de session, et la création + le
// rattachement forment une seule transaction : sur refus, aucun contact n'est créé.
export async function creerContactDepuisAcquereurAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const acquereurId = String(formData.get("acquereurId") ?? "");
  if (!acquereurId) notFound();

  const resultat = await creerContactEtRattacherAcquereur(acquereurId, workspaceId);
  if (resultat.statut !== "rattache") {
    redirect(`/clients/${acquereurId}?rattachement=${messageRefus(resultat)}`);
  }
  redirect(`/clients/${acquereurId}`);
}

export async function rattacherProspectVendeurContactExistantAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const prospectId = String(formData.get("prospectId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!prospectId || !contactId) notFound();

  const resultat = await getDb().transaction((tx) =>
    rattacherProspectVendeurAuContact(prospectId, contactId, workspaceId, tx)
  );
  if (resultat.statut !== "rattache") {
    redirect(`/prospects-vendeurs/${prospectId}?rattachement=${messageRefus(resultat)}`);
  }
  redirect(`/prospects-vendeurs/${prospectId}`);
}

export async function creerContactDepuisProspectVendeurAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const prospectId = String(formData.get("prospectId") ?? "");
  if (!prospectId) notFound();

  const resultat = await creerContactEtRattacherProspectVendeur(prospectId, workspaceId);
  if (resultat.statut !== "rattache") {
    redirect(`/prospects-vendeurs/${prospectId}?rattachement=${messageRefus(resultat)}`);
  }
  redirect(`/prospects-vendeurs/${prospectId}`);
}
