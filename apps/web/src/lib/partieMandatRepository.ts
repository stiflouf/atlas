import { and, asc, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { verrouillerContactActif } from "@/lib/contactActif";
import { verrouillerMandat } from "@/lib/mandatRepository";
import {
  biens as biensTable,
  contacts as contactsTable,
  mandats as mandatsTable,
  partiesMandat as partiesMandatTable,
} from "@/db/schema";
import type { PartieMandat, PartieMandatDetail, RolePartieMandat } from "@/types/partieMandat";

// ADR-060 §16 (lot MANDATE_PARTIES_V1) — accès à la relation mandat ↔ contact. SEUL module qui écrit
// `parties_mandat` en dehors du moteur de fusion (qui, lui, ne fait que repointer et dédoubler).
//
// WORKSPACE (ADR-054 §7) : `parties_mandat` est une FEUILLE sans `workspace_id`. Chaque lecture et
// chaque écriture remonte partie → mandat → bien → workspace de SESSION ; un mandat, une partie ou
// un contact d'un autre workspace est INTROUVABLE, indistinguable d'un id inconnu.
//
// ORDRE DE VERROUS, le même partout où deux lignes sont prises : le MANDAT d'abord (scoped via son
// bien, `verrouillerMandat`), le CONTACT ensuite (`verrouillerContactActif`, ADR-059 §10). Le moteur
// de fusion ne verrouille que des contacts : un writer qui tient le mandat et attend le contact ne
// bloque jamais une fusion qui tient le contact — pas de cycle. Le verrou du mandat sérialise aussi
// deux ajouts concurrents de la même personne : la vérification « déjà partie » est faite sous ce
// verrou, l'UNIQUE en base n'est que le dernier filet.
//
// Ce module n'invente aucune partie : rien n'est copié depuis `parties_projet` ni depuis un
// propriétaire legacy — la signature, la création directe et l'enregistrement d'un mandat existant
// continuent de fonctionner sans partie. Aucun rôle obligatoire : « au moins un mandant » est une
// règle de workflow, pas de ce repository.

type LignePartie = typeof partiesMandatTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ligneVersPartie(ligne: LignePartie): PartieMandat {
  return {
    id: ligne.id,
    mandatId: ligne.mandatId,
    contactId: ligne.contactId,
    role: ligne.role as RolePartieMandat,
    creeLe: ligne.creeLe.toISOString(),
  };
}

export type NouvellePartieMandat = { contactId: string; role: RolePartieMandat };

// `deja_partie` rend la partie existante : UNIQUE(mandat, contact) fait qu'une personne n'a qu'un
// rôle à la fois — un second rôle n'est jamais une seconde ligne, c'est `modifierRolePartieMandat`.
export type ResultatAjoutPartieMandat =
  | { statut: "ajoutee"; partie: PartieMandat }
  | { statut: "mandat_introuvable" }
  | { statut: "contact_introuvable" }
  | { statut: "contact_fusionne" }
  | { statut: "deja_partie"; partie: PartieMandat };

export async function ajouterPartieMandat(
  mandatId: string,
  input: NouvellePartieMandat,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatAjoutPartieMandat> {
  return executeur.transaction(async (tx) => {
    // 1. Le mandat, sous verrou, dans le workspace de session via son bien.
    const mandat = await verrouillerMandat(mandatId, workspaceId, tx);
    if (mandat.statut !== "verrouille") return { statut: "mandat_introuvable" };

    // 2. Le contact, sous verrou, actif et du même workspace (ADR-059 §10 : un absorbé n'est pas
    // une destination ; jamais réécrit vers son survivant).
    const contact = await verrouillerContactActif(input.contactId, tx, workspaceId);
    if (contact.statut === "introuvable") return { statut: "contact_introuvable" };
    if (contact.statut === "fusionne") return { statut: "contact_fusionne" };

    // 3. Une personne, une fois par mandat — vérifié sous le verrou du mandat.
    const [existante] = await tx
      .select()
      .from(partiesMandatTable)
      .where(and(eq(partiesMandatTable.mandatId, mandatId), eq(partiesMandatTable.contactId, input.contactId)))
      .limit(1);
    if (existante) return { statut: "deja_partie", partie: ligneVersPartie(existante) };

    const [ligne] = await tx
      .insert(partiesMandatTable)
      .values({ mandatId, contactId: input.contactId, role: input.role })
      .returning();
    return { statut: "ajoutee", partie: ligneVersPartie(ligne) };
  });
}

// Relit une partie SOUS VERROU (la ligne `parties_mandat` seule), dans le workspace de session via
// mandat → bien. Aucun verrou sur le mandat ni sur le contact : retirer ou requalifier une partie ne
// crée aucune ligne et ne change aucune clé d'unicité.
async function verrouillerPartie(partieId: string, workspaceId: string, tx: Executeur): Promise<LignePartie | undefined> {
  if (!UUID_REGEX.test(partieId)) return undefined;
  const [trouvee] = await tx
    .select({ partie: partiesMandatTable })
    .from(partiesMandatTable)
    .innerJoin(mandatsTable, eq(partiesMandatTable.mandatId, mandatsTable.id))
    .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
    .where(and(eq(partiesMandatTable.id, partieId), eq(biensTable.workspaceId, workspaceId)))
    .for("update", { of: partiesMandatTable });
  return trouvee?.partie;
}

// Corrige une sélection humaine : la RELATION disparaît, jamais le contact ni le mandat. Suppression
// physique — la relation n'est pas un fait daté (ADR-011 ne s'applique pas), et `parties_projet`
// suit la même convention sous le moteur de fusion.
export type ResultatRetraitPartieMandat = { statut: "retiree"; partie: PartieMandat } | { statut: "introuvable" };

export async function retirerPartieMandat(
  partieId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatRetraitPartieMandat> {
  return executeur.transaction(async (tx) => {
    const partie = await verrouillerPartie(partieId, workspaceId, tx);
    if (!partie) return { statut: "introuvable" };
    await tx.delete(partiesMandatTable).where(eq(partiesMandatTable.id, partie.id));
    return { statut: "retiree", partie: ligneVersPartie(partie) };
  });
}

// mandant ↔ representant : une mise à jour de la même ligne, jamais retirer puis réajouter (qui
// perdrait `cree_le` et ouvrirait une fenêtre sans partie).
export type ResultatModificationRolePartieMandat = { statut: "modifiee"; partie: PartieMandat } | { statut: "introuvable" };

export async function modifierRolePartieMandat(
  partieId: string,
  role: RolePartieMandat,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatModificationRolePartieMandat> {
  return executeur.transaction(async (tx) => {
    const partie = await verrouillerPartie(partieId, workspaceId, tx);
    if (!partie) return { statut: "introuvable" };
    if (partie.role === role) return { statut: "modifiee", partie: ligneVersPartie(partie) };
    const [ligne] = await tx.update(partiesMandatTable).set({ role }).where(eq(partiesMandatTable.id, partie.id)).returning();
    return { statut: "modifiee", partie: ligneVersPartie(ligne) };
  });
}

// Les parties d'un mandat avec l'identité canonique de chaque Contact, en UNE requête jointe (jamais
// une requête par partie). Le workspace passe par le bien : un mandat d'un autre workspace, ou
// inconnu, n'a aucune partie — comme un mandat legacy qui n'en a jamais reçu. Ordre d'ajout, stable.
export async function listerPartiesMandat(
  mandatId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<PartieMandatDetail[]> {
  if (!UUID_REGEX.test(mandatId)) return [];
  const lignes = await executeur
    .select({
      partie: partiesMandatTable,
      contact: {
        id: contactsTable.id,
        nom: contactsTable.nom,
        prenom: contactsTable.prenom,
        email: contactsTable.email,
        telephone: contactsTable.telephone,
      },
    })
    .from(partiesMandatTable)
    .innerJoin(contactsTable, eq(partiesMandatTable.contactId, contactsTable.id))
    .innerJoin(mandatsTable, eq(partiesMandatTable.mandatId, mandatsTable.id))
    .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
    .where(and(eq(partiesMandatTable.mandatId, mandatId), eq(biensTable.workspaceId, workspaceId)))
    .orderBy(asc(partiesMandatTable.creeLe), asc(partiesMandatTable.id));
  return lignes.map(({ partie, contact }) => ({
    ...ligneVersPartie(partie),
    contact: {
      id: contact.id,
      nom: contact.nom,
      prenom: contact.prenom ?? undefined,
      email: contact.email ?? undefined,
      telephone: contact.telephone ?? undefined,
    },
  }));
}
