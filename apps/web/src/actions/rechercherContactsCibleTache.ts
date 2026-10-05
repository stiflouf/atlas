"use server";

import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { rechercherContacts } from "@/lib/rechercheContactRepository";

// TASK_CONTACT_TARGET_V1 (ADR-064) — la recherche qui alimente le choix d'un contact dans
// /taches/nouveau, et rien d'autre.
//
// Pourquoi une Server Action et pas un `<select>` : `contacts` est l'UNITÉ DE RECHERCHE du produit
// (ADR-058), pas une petite nomenclature. Charger tout le carnet dans une liste déroulante serait
// une liste ingérable au premier millier de personnes, et révélerait d'un coup l'intégralité du
// carnet d'adresses dans le HTML d'un formulaire de création de tâche.
//
// Pourquoi pas un formulaire GET natif comme ailleurs (ADR-048, RattachementContactSection) :
// chercher rechargerait la page et effacerait le titre, le contexte et l'échéance déjà saisis. Un
// `<form>` de recherche ne peut pas non plus être imbriqué dans le `<form>` de création.
//
// Ce module ne RÉSOUT rien et n'autorise rien : il propose des candidats à un humain. La cible
// réellement retenue est revérifiée côté serveur par `creerTacheAction` (session, workspace,
// existence, état de fusion) — un id obtenu ici n'est jamais une permission.
export type ContactCandidatCible = {
  id: string;
  nom: string;
  prenom?: string;
  email?: string;
};

// `rechercherContacts` est réutilisé tel quel : il porte déjà le filtre de workspace OBLIGATOIRE,
// le ranking déterministe et l'exclusion SQL des contacts absorbés (ADR-059). Une seconde
// implémentation « légère » pour ce seul écran divergerait de ces trois garanties.
const LIMITE_SUGGESTIONS = 8;

export async function rechercherContactsCibleTacheAction(q: string): Promise<ContactCandidatCible[]> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const texte = q.trim();
  const { items } = await rechercherContacts({ workspaceId, q: texte, limite: LIMITE_SUGGESTIONS });
  // Rôles, projets et dernière interaction ne sortent PAS d'ici : choisir une personne demande de
  // la reconnaître, pas de connaître ses dossiers.
  return items.map((item) => ({ id: item.contactId, nom: item.nom, prenom: item.prenom, email: item.email }));
}
