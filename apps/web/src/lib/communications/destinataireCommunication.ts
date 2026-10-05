import { getAcquereurDuWorkspace } from "@/lib/clientRepository";
import { listerCompromisPourBien } from "@/lib/compromisRepository";
import { getProspectVendeurDuWorkspace, getProspectVendeurParBien } from "@/lib/prospectVendeurRepository";
import type { ProfilAcquereur } from "@/types/client";
import type { DocumentBien } from "@/types/documentBien";
import type { Contact } from "@/types/contact";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import type { DestinataireCandidat } from "./contexteCommunication";

export function versCandidatProspectVendeur(p: ProspectVendeur): DestinataireCandidat {
  return { type: "prospectVendeur", id: p.id, nom: p.nom, prenom: p.prenom, email: p.email };
}

export function versCandidatAcquereur(a: ProfilAcquereur): DestinataireCandidat {
  return { type: "acquereur", id: a.id, nom: a.nom, prenom: a.prenom, email: a.email };
}

// TASK_CONTACT_TARGET_V1 (ADR-064) — l'identité CANONIQUE devient un destinataire. Projection pure
// des quatre champs qu'elle porte déjà : aucun repli sur un dossier historique (ADR-057 — le repli
// est au niveau de l'agrégat d'identité, et un contact sans email n'a PAS d'email, il n'en a pas un
// qui serait celui de son ancien dossier).
//
// L'appelant doit avoir résolu l'identité ACTIVE avant d'appeler (ADR-059) : cette fonction ne lit
// rien et ne vérifie rien — elle traduit le contact qu'on lui donne.
export function versCandidatContact(contact: Contact): DestinataireCandidat {
  return { type: "contact", id: contact.id, nom: contact.nom, prenom: contact.prenom, email: contact.email };
}

// Destinataires structurellement atteignables depuis un bien (ADR-031) : le contact vendeur
// principal ayant converti ce bien (ADR-027, au plus un — bienId porte une contrainte UNIQUE) et
// l'acquéreur du compromis le plus pertinent (en_cours, sinon le plus récent). Les deux peuvent
// coexister — jamais tranché arbitrairement ici : l'appelant présente un choix humain si plusieurs
// candidats sont retournés (correction n°1).
export async function resoudreDestinatairesDepuisBien(bienId: string, workspaceId: string): Promise<DestinataireCandidat[]> {
  const [prospectVendeur, compromisListe] = await Promise.all([
    getProspectVendeurParBien(bienId),
    listerCompromisPourBien(bienId, workspaceId),
  ]);

  const candidats: DestinataireCandidat[] = [];
  if (prospectVendeur) candidats.push(versCandidatProspectVendeur(prospectVendeur));

  const compromisActuel =
    compromisListe.find((c) => c.statut === "en_cours") ??
    [...compromisListe].sort((a, b) => (a.dateSignature < b.dateSignature ? 1 : -1))[0];
  if (compromisActuel) {
    const acquereur = await getAcquereurDuWorkspace(compromisActuel.acquereurId, workspaceId);
    if (acquereur) candidats.push(versCandidatAcquereur(acquereur));
  }

  return candidats;
}

// Résolution depuis un document/constat de checklist (ADR-031, correction n°2) : un destinataire
// n'est présélectionné QUE si le document choisi porte lui-même un rattachement personne
// structuré et NON AMBIGU (acquereurId OU prospectVendeurId, jamais les deux à la fois — un
// document rattaché aux deux simultanément est traité comme ambigu, pas de présélection). Sinon,
// repli sur les mêmes candidats structurels que le bien — jamais une correspondance
// "type de document -> personne supposée" inventée : cela prépare proprement l'arrivée future de
// contacts syndic/notaire sans coder de règle implicite aujourd'hui.
export async function resoudreDestinatairesDepuisDocument(
  document: DocumentBien | undefined,
  bienId: string,
  workspaceId: string
): Promise<DestinataireCandidat[]> {
  if (document?.acquereurId && !document.prospectVendeurId) {
    const acquereur = await getAcquereurDuWorkspace(document.acquereurId, workspaceId);
    if (acquereur) return [versCandidatAcquereur(acquereur)];
  }
  if (document?.prospectVendeurId && !document.acquereurId) {
    const prospectVendeur = await getProspectVendeurDuWorkspace(document.prospectVendeurId, workspaceId);
    if (prospectVendeur) return [versCandidatProspectVendeur(prospectVendeur)];
  }
  return resoudreDestinatairesDepuisBien(bienId, workspaceId);
}
