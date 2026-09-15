import { getDb } from "@/db/client";
import { getContactCanoniqueDeLAcquereur } from "@/lib/clientRepository";
import { getContactCanoniqueDuProspectVendeur } from "@/lib/prospectVendeurRepository";
import { ErreurContactFusionne } from "@/lib/contactActif";
import { creerInteraction } from "@/lib/interactionRepository";
import {
  enregistrerReferenceExterne,
  resoudreEntiteCanonique,
} from "@/lib/provenance/referenceExterneRepository";

// ADR-031-bis + ADR-055 §G + ADR-056 — le PREMIER fait relationnel canonique produit par un
// fournisseur réel. Un email parti de DOMIORA vers une personne que DOMIORA connaît canoniquement
// devient un échange dans sa mémoire relationnelle, et l'identifiant Gmail de ce message devient
// l'identité externe de cet échange.
//
//   Gmail send ── message.id ──> [ici] ──> interaction (email/sortant)
//                                     └──> reference_externe (gmail/message/<message.id>)
//
// Ce module ne parle JAMAIS à Google : il est appelé APRÈS la réponse de l'API, avec un
// identifiant déjà obtenu. Aucun pull, aucune lecture de boîte, aucun scope supplémentaire.
//
// DEUX FAITS DISTINCTS, jamais fusionnés (ADR-055 §H, ADR-031-bis) :
//   `envois_email`  — audit TECHNIQUE de la tentative : clé d'idempotence, état incertain, hash,
//                     catégorie d'erreur. Rien de tout cela n'a de sens dans une interaction.
//   `interactions`  — le fait relationnel : cette personne a reçu un email de nous, ce jour-là.
// L'audit reste la source de vérité de « l'email est-il parti ? » ; l'interaction ne répond qu'à
// « que s'est-il passé dans cette relation ? ».

// Les deux seuls destinataires que le flux de communication sait produire aujourd'hui
// (`DestinataireCandidat`), et les deux seuls dont le pont vers un contact canonique existe en
// colonne. Un troisième type (syndic, notaire) ne produira une interaction que le jour où sa
// relation à un contact sera écrite quelque part — jamais devinée.
export type DestinataireEnvoi =
  | { type: "acquereur"; id: string }
  | { type: "prospectVendeur"; id: string };

export type ResultatFinalisationCanonique =
  | { statut: "interaction_creee"; interactionId: string }
  // L'identité Gmail est déjà rattachée à une interaction : ce message a déjà été ingéré.
  | { statut: "deja_ingere"; interactionId: string }
  // Aucun contact canonique : le destinataire n'est pas rattaché, ou n'est pas un type supporté.
  // Ce n'est PAS une erreur — c'est l'état de toutes les lignes antérieures à ADR-055.
  | { statut: "aucun_contact_canonique" }
  // ADR-059 §10 — l'email est PARTI (Google l'a confirmé, l'audit `envois_email` est déjà réussi),
  // mais le contact que le dossier désignait a été absorbé entre la construction de l'envoi et sa
  // finalisation. Aucune interaction n'est écrite — ni sur l'absorbé (figé), ni sur le survivant
  // (l'envoi a été décidé dans un contexte devenu périmé ; réécrire la cible masquerait la course).
  | { statut: "email_envoye_contact_fusionne"; contactId: string };

// Le pont vers l'identité canonique, lu en COLONNE et jamais déduit. Aucun repli par email,
// téléphone ou nom : deux personnes peuvent partager une adresse, une adresse peut changer de
// main, et une fusion à tort ne se défait pas (ADR-055 §H).
async function contactCanoniqueDuDestinataire(
  destinataire: DestinataireEnvoi,
  executeur: Parameters<typeof creerInteraction>[1]
): Promise<string | undefined> {
  return destinataire.type === "acquereur"
    ? getContactCanoniqueDeLAcquereur(destinataire.id, executeur)
    : getContactCanoniqueDuProspectVendeur(destinataire.id, executeur);
}

// Vocabulaire Gmail conservé tel quel (ADR-056 §2) : la ressource s'appelle `messages` chez Google,
// et `message` ici. Pas de préfixe `gmail-` sur l'identifiant — contrairement à
// `visites.rendez_vous_calendar_id`, exception antérieure et gelée : Google fournit un id stable,
// c'est celui-là qui est stocké.
const FOURNISSEUR_GMAIL = "gmail";
const TYPE_ENTITE_EXTERNE_MESSAGE = "message";

// Écrit le fait canonique correspondant à un envoi Gmail DÉJÀ RÉUSSI.
//
// `survenuLe` est la date de succès de l'envoi, celle que `marquerEnvoiReussi()` vient d'écrire —
// passée par l'appelant plutôt que relue d'une horloge : `envois_email.reussi_le` et
// `interactions.survenu_le` décrivent le même fait, ils ne peuvent pas dériver de deux
// millisecondes.
//
// Interaction et référence dans UNE transaction : une interaction sans son identité externe serait
// invisible au prochain rapprochement, et un futur pull Gmail la recréerait en double.
export async function finaliserEnvoiGmailReussi(input: {
  gmailMessageId: string;
  survenuLe: string;
  destinataire?: DestinataireEnvoi;
  // ADR-054 — le périmètre vient de l'appelant authentifié, jamais d'un littéral.
  workspaceId: string;
}): Promise<ResultatFinalisationCanonique> {
  // Capturé avant la transaction : à l'intérieur de la closure, TypeScript ne conserve pas le
  // rétrécissement obtenu sur une propriété du paramètre.
  const destinataire = input.destinataire;
  if (!destinataire) return { statut: "aucun_contact_canonique" };

  return getDb().transaction(async (tx) => {
    const identite = {
      fournisseur: FOURNISSEUR_GMAIL,
      typeEntiteExterne: TYPE_ENTITE_EXTERNE_MESSAGE,
      idExterne: input.gmailMessageId,
    };

    // IDEMPOTENCE, et dans cet ordre : l'identité externe est interrogée AVANT que quoi que ce soit
    // ne soit créé. Créer l'interaction d'abord laisserait, au rejeu, une interaction orpheline que
    // la contrainte d'unicité refuserait ensuite de rattacher.
    const deja = await resoudreEntiteCanonique(identite, input.workspaceId, tx);
    if (deja?.type === "interaction") return { statut: "deja_ingere", interactionId: deja.id } as const;

    const contactId = await contactCanoniqueDuDestinataire(destinataire, tx);
    if (!contactId) return { statut: "aucun_contact_canonique" } as const;

    // AUCUN contexte métier. Le flux d'envoi connaît un `bienId` (ce dont le message parle) et le
    // dossier du destinataire (une propriété de la personne) — ni l'un ni l'autre n'établit dans
    // quel dossier l'échange a eu lieu. Une interaction sans contexte reste un fait complet ; un
    // contexte choisi pour remplir une colonne serait une affirmation que personne n'a faite.
    //
    // AUCUN contenu. Le corps n'est jamais persisté (ADR-031-bis, seul un SHA-256 existe) et
    // `interactions` n'a pas de champ `sujet`. Recopier l'objet dans `contenu` le ferait passer
    // pour le message. L'interaction affirme ce qui est durablement vrai : qui, quoi, quand, dans
    // quel sens.
    // `creerInteraction` lit le contact SOUS VERROU : une fusion concurrente est soit déjà commise
    // (contact absorbé → refus explicite ci-dessous), soit en attente de notre verrou (elle
    // repointera cette interaction vers le survivant). Jamais un échange orphelin sur un absorbé.
    let interaction;
    try {
      interaction = await creerInteraction({ contactId, type: "email", sens: "sortant", survenuLe: input.survenuLe }, tx);
    } catch (erreur) {
      if (erreur instanceof ErreurContactFusionne) return { statut: "email_envoye_contact_fusionne", contactId } as const;
      throw erreur;
    }

    // La contrainte UNIQUE (workspace, fournisseur, type, id externe) est ce qui tient l'invariant
    // « un message Gmail, une interaction » face à deux finalisations concurrentes : la seconde
    // échoue ici, et SA transaction emporte SON interaction. Aucun verrou applicatif, aucun lock
    // distribué — la base tranche.
    await enregistrerReferenceExterne(
      { ...identite, cible: { type: "interaction", id: interaction.id } },
      input.workspaceId,
      tx
    );

    return { statut: "interaction_creee", interactionId: interaction.id } as const;
  });
}
