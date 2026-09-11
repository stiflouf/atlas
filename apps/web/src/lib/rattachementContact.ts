import { and, eq, isNull, or, ilike, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb, type Executeur } from "@/db/client";
import {
  acquereurs as acquereursTable,
  contacts as contactsTable,
  partiesProjet as partiesProjetTable,
  prospectsVendeurs as prospectsVendeursTable,
} from "@/db/schema";
import { creerContact } from "@/lib/contactRepository";
import { ajouterPartieProjet } from "@/lib/partieProjetRepository";
import type { Contact } from "@/types/contact";

// ADR-055 §H + ADR-057 — RATTACHER un dossier historique à une identité canonique, et rien d'autre.
//
// La doctrine tient en une phrase : SUGGÉRER n'est pas RATTACHER. Le produit peut proposer des
// candidats ; il ne décide jamais que deux dossiers décrivent la même personne. Un doublon se
// corrige, une fusion à tort ne se corrige pas — un couple partage une adresse, une famille un
// numéro, et deux homonymes existent.
//
// Ce module ne canonicalise QUE l'identité. Il ne crée jamais de projet acquéreur ou vendeur : un
// dossier peut légitimement porter un `contact_id` sans projet canonique, et en fabriquer un
// affirmerait une intention immobilière que personne n'a constatée.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Issues NORMALES, jamais des exceptions : l'appelant en fait un message, pas une page d'erreur.
// Seules les incohérences réellement impossibles lèvent.
export type ResultatRattachement =
  | { statut: "rattache"; contactId: string; partieCreee: boolean }
  | { statut: "dossier_introuvable" }
  | { statut: "contact_introuvable" }
  | { statut: "deja_rattache"; contactId: string }
  | { statut: "workspaces_differents" };

type Dossier = {
  table: PgTable;
  id: AnyPgColumn;
  contactId: AnyPgColumn;
  workspaceId: AnyPgColumn;
  projetId: AnyPgColumn;
  role: "acquereur" | "vendeur";
  cleProjet: "projetAcquereurId" | "projetVendeurId";
};

const ACQUEREUR: Dossier = {
  table: acquereursTable,
  id: acquereursTable.id,
  contactId: acquereursTable.contactId,
  workspaceId: acquereursTable.workspaceId,
  projetId: acquereursTable.projetAcquereurId,
  role: "acquereur",
  cleProjet: "projetAcquereurId",
};

const PROSPECT_VENDEUR: Dossier = {
  table: prospectsVendeursTable,
  id: prospectsVendeursTable.id,
  contactId: prospectsVendeursTable.contactId,
  workspaceId: prospectsVendeursTable.workspaceId,
  projetId: prospectsVendeursTable.projetVendeurId,
  role: "vendeur",
  cleProjet: "projetVendeurId",
};

async function rattacher(
  dossier: Dossier,
  dossierId: string,
  contactId: string,
  workspaceId: string,
  executeur: Executeur
): Promise<ResultatRattachement> {
  if (!UUID_REGEX.test(dossierId) || !UUID_REGEX.test(contactId)) return { statut: "dossier_introuvable" };

  const [contact] = await executeur
    .select({ workspaceId: contactsTable.workspaceId })
    .from(contactsTable)
    .where(eq(contactsTable.id, contactId))
    .limit(1);
  if (!contact) return { statut: "contact_introuvable" };
  // ADR-054 — aucune relation ne traverse deux périmètres. Vérifié avant l'écriture, et à nouveau
  // par `ajouterPartieProjet` pour la partie : deux gardes, aucune ne suffit seule.
  if (contact.workspaceId !== workspaceId) return { statut: "workspaces_differents" };

  const [ligneAvant] = await executeur
    .select({ contactId: dossier.contactId, workspaceId: dossier.workspaceId, projetId: dossier.projetId })
    .from(dossier.table)
    .where(eq(dossier.id, dossierId))
    .limit(1);
  if (!ligneAvant) return { statut: "dossier_introuvable" };
  if (ligneAvant.workspaceId !== workspaceId) return { statut: "dossier_introuvable" };
  if (ligneAvant.contactId !== null) return { statut: "deja_rattache", contactId: ligneAvant.contactId as string };

  // LA GARDE DE CONCURRENCE est dans le `WHERE`, pas dans la lecture ci-dessus : deux rattachements
  // simultanés du même dossier verraient tous deux `contact_id IS NULL`, et le second écraserait la
  // décision du premier. `contact_id IS NULL` dans la condition rend l'écriture atomique — le
  // perdant ne met à jour aucune ligne et reçoit un refus explicite, jamais un succès silencieux.
  const misesAJour = await executeur
    .update(dossier.table)
    .set({ contactId })
    .where(and(eq(dossier.id, dossierId), eq(dossier.workspaceId, workspaceId), isNull(dossier.contactId)))
    .returning({ id: dossier.id, projetId: dossier.projetId });
  if (misesAJour.length === 0) {
    const [relu] = await executeur
      .select({ contactId: dossier.contactId })
      .from(dossier.table)
      .where(eq(dossier.id, dossierId))
      .limit(1);
    return relu?.contactId
      ? { statut: "deja_rattache", contactId: relu.contactId as string }
      : { statut: "dossier_introuvable" };
  }

  // La PARTIE n'est créée que si un projet canonique existe déjà. Ce lot ne canonicalise pas le
  // projet : un dossier sans `projet_*_id` reste sans partie, et c'est cohérent — une participation
  // sans projet ne rattache personne à rien (CHECK « exactement une cible »).
  const projetId = misesAJour[0]!.projetId as string | null;
  if (!projetId) return { statut: "rattache", contactId, partieCreee: false };

  const [partieExistante] = await executeur
    .select({ id: partiesProjetTable.id })
    .from(partiesProjetTable)
    .where(
      and(
        eq(partiesProjetTable.contactId, contactId),
        eq(dossier.role === "acquereur" ? partiesProjetTable.projetAcquereurId : partiesProjetTable.projetVendeurId, projetId)
      )
    )
    .limit(1);
  if (partieExistante) return { statut: "rattache", contactId, partieCreee: false };

  await ajouterPartieProjet({ contactId, [dossier.cleProjet]: projetId, role: dossier.role } as never, executeur);
  return { statut: "rattache", contactId, partieCreee: true };
}

export async function rattacherAcquereurAuContact(
  acquereurId: string,
  contactId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatRattachement> {
  return rattacher(ACQUEREUR, acquereurId, contactId, workspaceId, executeur);
}

export async function rattacherProspectVendeurAuContact(
  prospectId: string,
  contactId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatRattachement> {
  return rattacher(PROSPECT_VENDEUR, prospectId, contactId, workspaceId, executeur);
}

// CRÉER puis rattacher, dans la transaction de l'appelant. L'identité du nouveau contact est
// l'INSTANTANÉ du dossier tel qu'il est aujourd'hui — jamais un rapprochement avec un contact
// existant, même à email identique.
//
// Si le rattachement échoue (dossier déjà rattaché entre-temps, workspace incohérent), la
// transaction de l'appelant est abandonnée et aucun contact orphelin ne subsiste : c'est pour cela
// que cette fonction n'ouvre pas sa propre transaction.
export type ResultatCreationEtRattachement =
  | { statut: "rattache"; contact: Contact; partieCreee: boolean }
  | Exclude<ResultatRattachement, { statut: "rattache" }>;

async function creerEtRattacher(
  dossier: Dossier,
  dossierId: string,
  identite: { nom: string; prenom?: string; email?: string; telephone?: string },
  workspaceId: string,
  executeur: Executeur
): Promise<ResultatCreationEtRattachement> {
  const contact = await creerContact(identite, workspaceId, executeur);
  const resultat = await rattacher(dossier, dossierId, contact.id, workspaceId, executeur);
  if (resultat.statut !== "rattache") return resultat;
  return { statut: "rattache", contact, partieCreee: resultat.partieCreee };
}

export async function creerContactEtRattacherAcquereur(
  acquereurId: string,
  identite: { nom: string; prenom?: string; email?: string; telephone?: string },
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatCreationEtRattachement> {
  return creerEtRattacher(ACQUEREUR, acquereurId, identite, workspaceId, executeur);
}

export async function creerContactEtRattacherProspectVendeur(
  prospectId: string,
  identite: { nom: string; prenom?: string; email?: string; telephone?: string },
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatCreationEtRattachement> {
  return creerEtRattacher(PROSPECT_VENDEUR, prospectId, identite, workspaceId, executeur);
}

// CANDIDATS, jamais une décision. Cette recherche existe pour qu'un humain reconnaisse une personne
// qu'il connaît — elle ne classe pas, ne score pas, et n'est jamais appelée par un chemin
// d'écriture. Le jour où Contact deviendra le pivot de recherche du produit, ce sera son propre lot.
export async function rechercherContactsCandidats(
  q: string,
  workspaceId: string,
  limite = 20,
  executeur: Executeur = getDb()
): Promise<Contact[]> {
  const texte = q.trim();
  if (texte.length === 0) return [];
  const motif = `%${texte}%`;
  const filtre: SQL | undefined = or(
    ilike(contactsTable.nom, motif),
    ilike(contactsTable.prenom, motif),
    ilike(contactsTable.email, motif),
    ilike(contactsTable.telephone, motif)
  );

  const lignes = await executeur
    .select()
    .from(contactsTable)
    .where(and(eq(contactsTable.workspaceId, workspaceId), filtre))
    .orderBy(contactsTable.nom)
    .limit(limite);

  return lignes.map((ligne) => ({
    id: ligne.id,
    nom: ligne.nom,
    prenom: ligne.prenom ?? undefined,
    email: ligne.email ?? undefined,
    telephone: ligne.telephone ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  }));
}
