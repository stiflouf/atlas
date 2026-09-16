import { and, eq, isNull, or, ilike, type SQL } from "drizzle-orm";
import { verrouillerContactActif } from "@/lib/contactActif";
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
  // L'INSTANTANÉ d'identité du dossier, source du Contact créé « depuis ce dossier ».
  identite: { nom: AnyPgColumn; prenom: AnyPgColumn; email: AnyPgColumn; telephone: AnyPgColumn };
  role: "acquereur" | "vendeur";
  cleProjet: "projetAcquereurId" | "projetVendeurId";
};

const ACQUEREUR: Dossier = {
  table: acquereursTable,
  id: acquereursTable.id,
  contactId: acquereursTable.contactId,
  workspaceId: acquereursTable.workspaceId,
  projetId: acquereursTable.projetAcquereurId,
  identite: {
    nom: acquereursTable.nom,
    prenom: acquereursTable.prenom,
    email: acquereursTable.email,
    telephone: acquereursTable.telephone,
  },
  role: "acquereur",
  cleProjet: "projetAcquereurId",
};

const PROSPECT_VENDEUR: Dossier = {
  table: prospectsVendeursTable,
  id: prospectsVendeursTable.id,
  contactId: prospectsVendeursTable.contactId,
  workspaceId: prospectsVendeursTable.workspaceId,
  projetId: prospectsVendeursTable.projetVendeurId,
  identite: {
    nom: prospectsVendeursTable.nom,
    prenom: prospectsVendeursTable.prenom,
    email: prospectsVendeursTable.email,
    telephone: prospectsVendeursTable.telephone,
  },
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

  // ADR-059 §10 — un contact absorbé n'est plus une destination : on ne rattache jamais un dossier
  // à une personne dont l'historique continue ailleurs. Lu SOUS VERROU par la garde partagée, dans
  // la transaction de l'appelant : une fusion concurrente ne peut pas glisser entre la lecture et
  // l'UPDATE du dossier.
  const contact = await verrouillerContactActif(contactId, executeur);
  if (contact.statut !== "actif") return { statut: "contact_introuvable" };
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

// CRÉER un Contact À L'IMAGE du dossier, puis rattacher : UNE transaction, ou rien.
//
// L'identité du nouveau contact est l'INSTANTANÉ du dossier tel qu'il est RELU ICI, sous verrou —
// jamais une valeur venue du navigateur, jamais un rapprochement avec un contact existant, même à
// email identique. Le dossier est lu `FOR UPDATE`, dans le workspace de l'appelant, AVANT toute
// écriture : deux créations concurrentes pour le même dossier se sérialisent sur sa ligne, la
// seconde le trouve rattaché et ne crée rien. Un dossier d'un autre workspace est INTROUVABLE —
// jamais lu, donc jamais copié.
//
// Un refus survenu après l'INSERT du contact est LEVÉ, pas retourné : la transaction est annulée et
// aucun contact orphelin ne subsiste. C'est pour cela que cette fonction ouvre sa propre
// transaction (un savepoint si l'appelant en tient déjà une) et traduit le refus en résultat
// métier seulement une fois sortie.
export type ResultatCreationEtRattachement =
  | { statut: "rattache"; contact: Contact; partieCreee: boolean }
  | { statut: "deja_rattache"; contactId: string }
  | { statut: "dossier_introuvable" };

type RefusCreationEtRattachement = Exclude<ResultatCreationEtRattachement, { statut: "rattache" }>;

// Porte un refus MÉTIER à travers `transaction()` pour obtenir le rollback ; jamais exposée.
class RefusRattachement extends Error {
  constructor(readonly refus: RefusCreationEtRattachement) {
    super(`rattachement refusé : ${refus.statut}`);
  }
}

// Les colonnes d'identité du dossier arrivent par le descripteur : drizzle ne peut plus en inférer
// le type. Les colonnes acquéreur sont NOT NULL mais peuvent porter une chaîne vide historique :
// une absence côté Contact est plus juste qu'un champ vide (ADR-057).
type LigneDossierVerrouillee = {
  contactId: string | null;
  nom: string;
  prenom: string | null;
  email: string | null;
  telephone: string | null;
};

async function creerEtRattacher(
  dossier: Dossier,
  dossierId: string,
  workspaceId: string,
  executeur: Executeur
): Promise<ResultatCreationEtRattachement> {
  if (!UUID_REGEX.test(dossierId)) return { statut: "dossier_introuvable" };
  try {
    return await executeur.transaction(async (tx) => {
      const [ligne] = (await tx
        .select({
          contactId: dossier.contactId,
          nom: dossier.identite.nom,
          prenom: dossier.identite.prenom,
          email: dossier.identite.email,
          telephone: dossier.identite.telephone,
        })
        .from(dossier.table)
        .where(and(eq(dossier.id, dossierId), eq(dossier.workspaceId, workspaceId)))
        .for("update")) as LigneDossierVerrouillee[];
      if (!ligne) throw new RefusRattachement({ statut: "dossier_introuvable" });
      if (ligne.contactId !== null) throw new RefusRattachement({ statut: "deja_rattache", contactId: ligne.contactId });

      const contact = await creerContact(
        {
          nom: ligne.nom,
          prenom: ligne.prenom || undefined,
          email: ligne.email || undefined,
          telephone: ligne.telephone || undefined,
        },
        workspaceId,
        tx
      );
      const resultat = await rattacher(dossier, dossierId, contact.id, workspaceId, tx);
      if (resultat.statut === "rattache") return { statut: "rattache", contact, partieCreee: resultat.partieCreee };
      if (resultat.statut === "deja_rattache" || resultat.statut === "dossier_introuvable") {
        throw new RefusRattachement(resultat);
      }
      // Le contact vient d'être créé, actif, dans ce workspace : ces refus sont impossibles ici.
      throw new Error(`Rattachement incohérent après création du contact : ${resultat.statut}`);
    });
  } catch (erreur) {
    if (erreur instanceof RefusRattachement) return erreur.refus;
    throw erreur;
  }
}

export async function creerContactEtRattacherAcquereur(
  acquereurId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatCreationEtRattachement> {
  return creerEtRattacher(ACQUEREUR, acquereurId, workspaceId, executeur);
}

export async function creerContactEtRattacherProspectVendeur(
  prospectId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatCreationEtRattachement> {
  return creerEtRattacher(PROSPECT_VENDEUR, prospectId, workspaceId, executeur);
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
    // ADR-059 — jamais un contact absorbé parmi les candidats.
    .where(and(eq(contactsTable.workspaceId, workspaceId), isNull(contactsTable.fusionneDansContactId), filtre))
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
