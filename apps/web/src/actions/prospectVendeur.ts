"use server";

import { notFound, redirect } from "next/navigation";
import {
  getProspectVendeurDuWorkspace,
  creerProspectVendeur,
  modifierProspectVendeur,
  qualifierProspectVendeur,
  enregistrerEstimationProspectVendeur,
  planifierRdvEstimationProspectVendeur,
  marquerRdvEstimationRealiseProspectVendeur,
  proposerMandatProspectVendeur,
  signerMandatProspectVendeur,
  marquerProspectVendeurPerdu,
  archiverProspectVendeur,
  desarchiverProspectVendeur,
} from "@/lib/prospectVendeurRepository";
import { ajouterNoteProspectVendeur } from "@/lib/noteProspectVendeurRepository";
import { getDb } from "@/db/client";
import { creerContact, modifierIdentiteContact } from "@/lib/contactRepository";
import { creerProjetVendeur } from "@/lib/projetVendeurRepository";
import { ajouterPartieProjet } from "@/lib/partieProjetRepository";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";
import { traiterExecutionsEnAttente } from "@/lib/automatisations/moteur";
import { parseProspectVendeurFormData, parseSignatureMandatFormData } from "@/lib/prospectVendeurFormulaire";
import { resoudreSourceIdentiteProspectVendeur } from "@/lib/identiteContactEffective";
import { parseMontantCentimes } from "@/types/remuneration";
import { deriverStatutProspectVendeur } from "@/types/prospectVendeur";
import { MOTIFS_PERTE_PROSPECT_VENDEUR, type MotifPerteProspectVendeur } from "@/types/motifPerteProspectVendeur";
import { TYPES_NOTE_PROSPECT_VENDEUR, type TypeNoteProspectVendeur } from "@/types/noteProspectVendeur";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { parseFaitsMandatFormData } from "@/lib/mandatFormulaire";
import { ErreurSaisie, avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

function parseDateOptionnelle(valeur: FormDataEntryValue | null): string | undefined {
  const date = String(valeur ?? "").trim();
  return date !== "" ? date : undefined;
}

// <input type="datetime-local"> -> Date. rdv_estimation_prevu_le/realise_le portent l'heure
// (ADR-027, correction n° 3) — jamais tronqués à une simple date.
function parseDateHeure(valeur: FormDataEntryValue | null): Date | undefined {
  const brut = String(valeur ?? "").trim();
  if (!brut) return undefined;
  const date = new Date(brut);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// Guard partagée par tous les jalons de pipeline (ADR-027) : aucune séquence stricte imposée entre
// qualification/estimation/rendez-vous/mandat proposé, seuls perte et signature sont terminaux.
// WORKSPACE_SCOPING_V2A (ADR-054) — la résolution passe par le reader SCOPÉ : hors périmètre, le
// prospect est introuvable, exactement comme un id inexistant (`notFound()`). Cette seule ligne
// couvre les six jalons qui partagent cette garde ; les writers portent en plus le périmètre dans
// leur `WHERE`, et c'est cette seconde preuve qui est contraignante.
async function chargerProspectPourJalon(id: string, workspaceId: string): Promise<ProspectVendeur> {
  const prospect = await getProspectVendeurDuWorkspace(id, workspaceId);
  if (!prospect) notFound();
  const statut = deriverStatutProspectVendeur(prospect);
  if (statut === "perdu") throw new ErreurSaisie("Ce prospect est marqué perdu — aucun jalon ne peut plus être posé.");
  if (statut === "mandat_signe") throw new ErreurSaisie("Le mandat est déjà signé — aucun jalon ne peut plus être posé.");
  return prospect;
}

export async function creerProspectVendeurAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    // ADR-054 — appartenance explicite du prospect vendeur (table racine).
    const workspaceId = await exigerWorkspaceCourant();
    const donnees = parseProspectVendeurFormData(formData);

    // ADR-055 — modèle canonique créé dans la MÊME transaction que l'opportunité qui le référence :
    // l'identité (Contact), le projet de vente, et la participation qui les relie. Toujours un nouveau
    // contact, jamais un rapprochement automatique — voir creerAcquereurAction pour le rationale
    // complet (ADR-055 §H).
    //
    // Le rôle n'est pas une colonne du contact : c'est cette participation qui fait de cette personne
    // un vendeur. `vendeur` (et non `co_vendeur`) parce que l'opportunité historique ne décrit qu'une
    // identité — celle du contact principal, seule que sache représenter ADR-027 §1.
    //
    // Un seul `tx` du début à la fin : les quatre écritures existent toutes ou aucune. Le prospect
    // vendeur reste la SOURCE DE VÉRITÉ de son workflow — rien ne lit encore le modèle canonique.
    const prospect = await getDb().transaction(async (tx) => {
      const contact = await creerContact(
        { nom: donnees.nom, prenom: donnees.prenom, email: donnees.email, telephone: donnees.telephone },
        workspaceId,
        tx
      );
      const projet = await creerProjetVendeur(
        { origineLead: donnees.origineLead, origineLeadDetail: donnees.origineLeadDetail },
        workspaceId,
        tx
      );
      await ajouterPartieProjet({ contactId: contact.id, projetVendeurId: projet.id, role: "vendeur" }, tx);
      return creerProspectVendeur({ ...donnees, contactId: contact.id, projetVendeurId: projet.id }, workspaceId, tx);
    });

    redirect(`/prospects-vendeurs/${prospect.id}`);
  });
}

// ADR-057 — l'identité d'un prospect RATTACHÉ vit sur son Contact, exactement comme celle d'un
// acquéreur. Deux trous préexistants sont fermés au passage, tous deux relevés par l'audit
// d'identité : cette action n'exigeait aucun workspace, et son writer n'en portait pas non plus.
//
// UNE SEULE TRANSACTION : source de vérité résolue, Contact écrit, prospect écrit. Les séparer
// laisserait un état où la fiche montre une adresse et les communications en utilisent une autre.
export async function modifierProspectVendeurAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    // ADR-054 — périmètre du prospect modifié, du Contact et de ses verrous.
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    if (!id) notFound();

    const donnees = parseProspectVendeurFormData(formData);

    const prospect = await getDb().transaction(async (tx) => {
      // Résolue DANS la transaction : décider d'après un pont lu avant elle reviendrait à écrire sur
      // la foi d'un état périmé. Lève si la référence est cassée — fail closed, jamais un repli
      // silencieux vers le dossier.
      const source = await resoudreSourceIdentiteProspectVendeur(id, tx);

      if (source.source === "contact") {
        // Le writer Contact est TRANSVERSE et ignore les rôles : c'est le même que celui de
        // l'acquéreur, et il pose lui-même le verrou humain (ADR-056 §4) sur les champs corrigés.
        const contact = await modifierIdentiteContact(
          source.contactId,
          { nom: donnees.nom, prenom: donnees.prenom, email: donnees.email, telephone: donnees.telephone },
          workspaceId,
          tx
        );
        if (!contact) throw new Error("Contact canonique introuvable pour ce prospect vendeur.");
      }

      // Aucun Contact, aucun projet vendeur n'est créé au passage pour un prospect historique — le
      // rattachement de l'historique est un geste explicite, réservé à son propre lot.
      return modifierProspectVendeur(
        id,
        donnees,
        source.source === "contact" ? "contact_canonique" : "dossier",
        workspaceId,
        tx
      );
    });
    if (!prospect) notFound();
    redirect(`/prospects-vendeurs/${prospect.id}`);
  });
}

export async function qualifierProspectVendeurAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    if (!id) notFound();
    await chargerProspectPourJalon(id, workspaceId);
    await qualifierProspectVendeur(id, workspaceId);
    redirect(`/prospects-vendeurs/${id}`);
  });
}

export async function enregistrerEstimationProspectVendeurAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    if (!id) notFound();
    await chargerProspectPourJalon(id, workspaceId);

    const estimationProposeeCentimes = parseMontantCentimes(String(formData.get("estimationProposeeCentimes") ?? ""));
    if (estimationProposeeCentimes === undefined || estimationProposeeCentimes <= 0) {
      throw new ErreurSaisie("Le montant de l'estimation doit être un nombre positif.");
    }
    const estimationProposeeLe = parseDateOptionnelle(formData.get("estimationProposeeLe"));
    if (!estimationProposeeLe) throw new ErreurSaisie("La date de l'estimation est obligatoire.");

    await enregistrerEstimationProspectVendeur(id, estimationProposeeCentimes, estimationProposeeLe, workspaceId);
    redirect(`/prospects-vendeurs/${id}`);
  });
}

export async function planifierRdvEstimationProspectVendeurAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    if (!id) notFound();
    await chargerProspectPourJalon(id, workspaceId);

    const rdvEstimationPrevuLe = parseDateHeure(formData.get("rdvEstimationPrevuLe"));
    if (!rdvEstimationPrevuLe) throw new ErreurSaisie("La date et l'heure du rendez-vous sont obligatoires.");

    await planifierRdvEstimationProspectVendeur(id, rdvEstimationPrevuLe, workspaceId);
    redirect(`/prospects-vendeurs/${id}`);
  });
}

export async function marquerRdvEstimationRealiseProspectVendeurAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    // ADR-054 — appartenance explicite de l'événement métier (table racine).
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    if (!id) notFound();
    const prospectAvant = await chargerProspectPourJalon(id, workspaceId);

    const rdvEstimationRealiseLe = parseDateHeure(formData.get("rdvEstimationRealiseLe"));
    if (!rdvEstimationRealiseLe) throw new ErreurSaisie("La date et l'heure du rendez-vous réalisé sont obligatoires.");

    // ADR-027 : « un rendez-vous planifié dans le futur n'est jamais un jalon commercial franchi ».
    // rdv_estimation_realise_le est une date DÉCLARÉE (le conseiller saisit quand le rendez-vous a
    // réellement eu lieu) : sans cette garde, valider le formulaire prérempli avec la date PRÉVUE
    // persiste un rendez-vous « tenu » à une date qui n'est pas encore arrivée, fait avancer le
    // statut vers `rendez_vous` et pose dernier_contact_le à l'instant serveur — deux dates
    // contradictoires pour le même fait. Même règle et même tolérance d'horloge cliente que
    // transmissionDossierNotaire.ts (date déclarée d'un fait accompli). Ne borne jamais le passé :
    // enregistrer a posteriori un rendez-vous ancien reste légitime.
    const maintenant = new Date();
    if (rdvEstimationRealiseLe.getTime() > maintenant.getTime() + 5 * 60 * 1000) {
      throw new ErreurSaisie("Un rendez-vous ne peut pas être marqué réalisé à une date future.");
    }

    // Événement `rdv_estimation_realise` émis UNIQUEMENT sur une vraie transition (ADR-032,
    // correction n°1) — jamais si le rendez-vous était déjà marqué réalisé (ce repository autorise
    // toujours une correction de date, qui ne doit jamais réémettre l'événement).
    const estTransitionReelle = prospectAvant.rdvEstimationRealiseLe === undefined;
    const idsExecutionsATraiter = await getDb().transaction(async (tx) => {
      await marquerRdvEstimationRealiseProspectVendeur(id, rdvEstimationRealiseLe, workspaceId, tx);
      if (!estTransitionReelle) return [];
      const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions(
        { typeEvenement: "rdv_estimation_realise", prospectVendeurId: id },
        workspaceId,
        tx
      );
      return idsExecutionsATraiter;
    });
    await traiterExecutionsEnAttente(idsExecutionsATraiter);

    redirect(`/prospects-vendeurs/${id}`);
  });
}

export async function proposerMandatProspectVendeurAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    if (!id) notFound();
    await chargerProspectPourJalon(id, workspaceId);
    await proposerMandatProspectVendeur(id, workspaceId);
    redirect(`/prospects-vendeurs/${id}`);
  });
}

// ADR-027, correction n° 6 : aucune valeur fictive — parseSignatureMandatFormData rejette
// explicitement toute soumission dont un champ obligatoire de `biens` serait vide, pré-rempli ou
// non. ADR-060 §13/§16 : l'action n'est qu'une orchestration — session, workspace de session, id du
// formulaire, faits du bien et du mandat validés, UN appel au repository qui relit le prospect SOUS
// VERROU dans ce workspace. Un prospect d'un autre workspace est introuvable ; un prospect déjà
// signé ou perdu est refusé par le repository lui-même, jamais sur la foi d'une lecture antérieure.
export async function signerMandatProspectVendeurAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    // ADR-054 — appartenance explicite du bien créé et de l'événement `mandat_signe`.
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    if (!id) notFound();

    const donneesBien = parseSignatureMandatFormData(formData);
    const faitsMandat = parseFaitsMandatFormData(formData);
    const resultat = await signerMandatProspectVendeur(id, donneesBien, workspaceId, faitsMandat);
    if (resultat.statut === "introuvable") notFound();
    if (resultat.statut === "perdu") throw new ErreurSaisie("Ce prospect est marqué perdu — aucun jalon ne peut plus être posé.");
    if (resultat.statut === "deja_signe") throw new ErreurSaisie("Le mandat est déjà signé — aucun jalon ne peut plus être posé.");

    // Traitement synchrone après le COMMIT (déjà acté à l'intérieur de signerMandatProspectVendeur,
    // ADR-032) — jamais avant, jamais susceptible de faire échouer la conversion elle-même.
    await traiterExecutionsEnAttente(resultat.idsExecutionsATraiter);

    redirect(`/biens/${resultat.bien.id}`);
  });
}

export async function marquerProspectVendeurPerduAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    if (!id) notFound();

    const prospect = await getProspectVendeurDuWorkspace(id, workspaceId);
    if (!prospect) notFound();
    if (deriverStatutProspectVendeur(prospect) === "mandat_signe") {
      throw new ErreurSaisie("Le mandat est déjà signé — impossible de marquer ce prospect comme perdu.");
    }

    const motifPerte = String(formData.get("motifPerte") ?? "") as MotifPerteProspectVendeur;
    if (!MOTIFS_PERTE_PROSPECT_VENDEUR.includes(motifPerte)) throw new ErreurSaisie("Le motif de perte est obligatoire.");
    const datePerte = parseDateOptionnelle(formData.get("datePerte"));
    if (!datePerte) throw new ErreurSaisie("La date de perte est obligatoire.");

    await marquerProspectVendeurPerdu(id, motifPerte, datePerte, workspaceId);
    redirect(`/prospects-vendeurs/${id}`);
  });
}

export async function archiverProspectVendeurAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  const prospect = await archiverProspectVendeur(id, workspaceId);
  if (!prospect) notFound();
  redirect(`/prospects-vendeurs/${id}`);
}

export async function desarchiverProspectVendeurAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();
  const prospect = await desarchiverProspectVendeur(id, workspaceId);
  if (!prospect) notFound();
  redirect(`/prospects-vendeurs/${id}`);
}

// ADR-027, correction n° 2 : le type choisi détermine si dernier_contact_le avance (voir
// noteProspectVendeurRepository.ajouterNoteProspectVendeur) — aucune logique dupliquée ici.
export async function ajouterNoteProspectVendeurAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    if (!id) notFound();

    const type = String(formData.get("type") ?? "") as TypeNoteProspectVendeur;
    if (!TYPES_NOTE_PROSPECT_VENDEUR.includes(type)) throw new ErreurSaisie("Type de note invalide.");
    const contenu = String(formData.get("contenu") ?? "").trim();
    if (!contenu) throw new ErreurSaisie("Le contenu de la note ne peut pas être vide.");

    // Hors périmètre : aucune note, et surtout aucun `dernier_contact_le` avancé — `notFound()`,
    // comme pour un prospect qui n'existe pas.
    const note = await ajouterNoteProspectVendeur(id, type, contenu, workspaceId);
    if (!note) notFound();
    redirect(`/prospects-vendeurs/${id}`);
  });
}

