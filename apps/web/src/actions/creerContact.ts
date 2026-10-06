"use server";

import { redirect } from "next/navigation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { parseContactFormData } from "@/lib/contactFormulaire";
import { creerContact } from "@/lib/contactRepository";
import { avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

// CONTACT_STANDALONE_CREATION_V1 — enregistrer une PERSONNE, sans lui inventer de rôle.
//
// Jusqu'ici un contact canonique ne naissait qu'en remorque d'un dossier (creerAcquereurAction,
// prospectVendeur.ts, ou le rattrapage `creerContactEtRattacher*`). Le carnet (ADR-058) était donc
// alimenté uniquement par les gens qui achètent ou qui vendent, alors qu'un Contact est une
// identité et rien d'autre (ADR-055 §A) : ni rôle, ni projet, ni donnée commerciale. Un notaire, un
// syndic, une connaissance ne pouvaient pas y entrer sans qu'on leur fabrique une intention
// d'acquisition que personne n'a constatée.
//
// Cette action ORCHESTRE et n'écrit pas : le writer reste `creerContact`, celui-là même que les
// deux chemins dossier appellent déjà. Aucune seconde logique de création n'est introduite.
//
// AUCUNE TRANSACTION, et c'est volontaire : les chemins dossier en ouvrent une parce qu'un contact
// sans son projet, ou un projet sans son porteur, serait un état que personne n'a voulu. Ici il n'y
// a qu'une ligne à écrire — l'envelopper ne protégerait rien.
//
// AUCUNE DÉDUPLICATION : `creerContact` crée toujours, jamais « trouver ou créer » (ADR-055 §H).
// Un homonyme, un email ou un téléphone déjà présents chez quelqu'un d'autre sont acceptés tels
// quels — un couple partage une adresse, une famille un numéro. Un doublon se corrige par une
// fusion humaine (ADR-059) ; une fusion à tort ne se défait pas.
export async function creerContactAction(
  _etatPrecedent: EtatFormulaire,
  formData: FormData
): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    // ADR-054 — le périmètre vient de la session, et le writer l'exige en paramètre. Le formulaire
    // n'a aucun champ de workspace, et `parseContactFormData` ne lit que les quatre champs
    // d'identité : un `workspaceId` forgé dans la requête n'a nulle part où entrer.
    const workspaceId = await exigerWorkspaceCourant();
    const saisie = parseContactFormData(formData);
    const contact = await creerContact(saisie, workspaceId);
    redirect(`/contacts/${contact.id}`);
  });
}
