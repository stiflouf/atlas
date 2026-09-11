import { eq, inArray } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb, type Executeur } from "@/db/client";
import {
  acquereurs as acquereursTable,
  contacts as contactsTable,
  prospectsVendeurs as prospectsVendeursTable,
} from "@/db/schema";

// ADR-057 — LA RÈGLE DE SOURCE de l'identité humaine, écrite UNE SEULE FOIS pour les deux côtés du
// CRM.
//
//   contact_id présent  ->  le CONTACT fournit nom, prenom, email, telephone
//   contact_id absent   ->  le dossier historique les fournit
//
// Le repli est au niveau de l'AGRÉGAT D'IDENTITÉ, jamais du champ. `contact.email` à NULL veut dire
// « on ne connaît pas son adresse », pas « reprendre celle du dossier ». Reprendre le legacy champ
// à champ ressusciterait une adresse qu'un humain vient précisément d'effacer — et ferait partir un
// email à une personne qui avait demandé à ne plus en recevoir à cette adresse.
//
// Acquéreur et vendeur ne diffèrent que par la TABLE qui porte le pont : la règle, la traduction
// des NULL et la garde fail-closed sont identiques, et le sont restées parce qu'elles sont écrites
// ici et nulle part ailleurs. C'est exactement ce que le modèle Contact affirme — une personne n'a
// pas deux identités selon le rôle sous lequel on la regarde.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IdentiteHumaine = {
  // Seul champ obligatoire, ici comme dans `contacts` : c'est le seul que les deux modèles
  // historiques garantissent.
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
};

// `source` n'est pas décoratif : les chemins d'ÉCRITURE en dépendent pour savoir où écrire, et le
// lire plutôt que le redéduire évite une seconde interprétation du pont.
export type SourceIdentite =
  | { source: "contact"; contactId: string; identite: IdentiteHumaine }
  | { source: "dossier" };

type LigneJointe = {
  dossierId: string;
  contactId: string | null;
  contactTrouveId: string | null;
  nom: string | null;
  prenom: string | null;
  email: string | null;
  telephone: string | null;
};

// NULL Postgres -> undefined métier, jamais une chaîne vide : un contact sans email n'a pas
// d'email, il n'en a pas un qui serait "" (même traduction que `ligneVersContact`).
function identiteDuContact(ligne: LigneJointe): IdentiteHumaine {
  return {
    nom: ligne.nom!,
    prenom: ligne.prenom ?? undefined,
    email: ligne.email ?? undefined,
    telephone: ligne.telephone ?? undefined,
  };
}

// Le SEUL endroit du produit qui joint un dossier à son contact canonique. Paramétré par les deux
// colonnes du pont plutôt que dupliqué par côté : une seconde copie divergerait au premier
// ajustement, et l'écart serait invisible — chaque copie restant verte de son côté.
//
// Une seule requête pour tout un lot, jamais une par dossier : ces fonctions servent des listes
// paginées et l'écran Aujourd'hui.
async function resoudreSources(
  table: PgTable,
  colonneId: AnyPgColumn,
  colonneContactId: AnyPgColumn,
  dossierIds: string[],
  executeur: Executeur
): Promise<Map<string, SourceIdentite>> {
  const idsPersistes = dossierIds.filter((id) => UUID_REGEX.test(id));
  if (idsPersistes.length === 0) return new Map();

  // Les deux colonnes du pont arrivent en paramètre : drizzle ne peut plus en inférer le type de
  // sortie. La forme est garantie par le `select` juste en dessous — elle n'est pas devinée.
  const lignes = (await executeur
    .select({
      dossierId: colonneId,
      contactId: colonneContactId,
      contactTrouveId: contactsTable.id,
      nom: contactsTable.nom,
      prenom: contactsTable.prenom,
      email: contactsTable.email,
      telephone: contactsTable.telephone,
    })
    .from(table)
    .leftJoin(contactsTable, eq(colonneContactId, contactsTable.id))
    .where(inArray(colonneId, idsPersistes))) as LigneJointe[];

  return new Map(
    lignes.map((ligne) => {
      // FAIL CLOSED. La FK `<dossier>.contact_id -> contacts.id` rend ce cas impossible ; y arriver
      // signifie une incohérence de données, jamais un cas métier. Retomber silencieusement sur le
      // dossier afficherait une identité périmée en la présentant comme canonique, et enverrait les
      // emails à l'ancienne adresse sans que rien ne le signale.
      if (ligne.contactId !== null && ligne.contactTrouveId === null) {
        throw new Error(
          `Contact référencé mais introuvable : dossier ${ligne.dossierId} -> contact ${ligne.contactId}`
        );
      }
      const source: SourceIdentite =
        ligne.contactTrouveId === null
          ? { source: "dossier" }
          : { source: "contact", contactId: ligne.contactTrouveId, identite: identiteDuContact(ligne) };
      return [ligne.dossierId, source];
    })
  );
}

// Absence de ligne pour un id : dossier non persisté (jeu de démonstration servi avant toute
// création réelle, ids non-UUID) ou disparu entre deux lectures. Dans les deux cas le dossier en
// mémoire est la seule donnée qui existe — exactement le comportement d'avant la bascule.
const DOSSIER: SourceIdentite = { source: "dossier" };

export async function resoudreSourcesIdentiteAcquereur(
  acquereurIds: string[],
  executeur: Executeur = getDb()
): Promise<Map<string, SourceIdentite>> {
  return resoudreSources(acquereursTable, acquereursTable.id, acquereursTable.contactId, acquereurIds, executeur);
}

export async function resoudreSourceIdentiteAcquereur(
  acquereurId: string,
  executeur: Executeur = getDb()
): Promise<SourceIdentite> {
  return (await resoudreSourcesIdentiteAcquereur([acquereurId], executeur)).get(acquereurId) ?? DOSSIER;
}

export async function resoudreSourcesIdentiteProspectVendeur(
  prospectIds: string[],
  executeur: Executeur = getDb()
): Promise<Map<string, SourceIdentite>> {
  return resoudreSources(
    prospectsVendeursTable,
    prospectsVendeursTable.id,
    prospectsVendeursTable.contactId,
    prospectIds,
    executeur
  );
}

export async function resoudreSourceIdentiteProspectVendeur(
  prospectId: string,
  executeur: Executeur = getDb()
): Promise<SourceIdentite> {
  return (await resoudreSourcesIdentiteProspectVendeur([prospectId], executeur)).get(prospectId) ?? DOSSIER;
}
