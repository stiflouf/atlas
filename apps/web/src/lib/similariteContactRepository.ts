import { and, asc, desc, eq, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { contacts as contactsTable } from "@/db/schema";
import { assemblerResultatsContacts } from "@/lib/rechercheContactRepository";
import { cleEmailSql, cleNomPrenom, cleTelephoneSql } from "@/lib/similariteContactNormalisation";
import type { ContactSimilaire, SignalSimilariteContact } from "@/types/similariteContact";

// ADR-055 §H — SIGNALER que deux Contacts partagent un email ou un téléphone, et s'arrêter là.
//
// Ce module est une LECTURE : il ne fusionne pas, ne rattache pas, ne crée rien, ne persiste
// aucune suggestion. Il calcule à la demande, depuis un Contact du workspace courant, la liste
// bornée des autres Contacts du même workspace qui partagent une clé forte (email ou téléphone
// normalisés). Nom et prénom ne sont jamais un déclencheur : deux « Jean Martin » avec des
// coordonnées distinctes sont deux personnes jusqu'à preuve du contraire. Ils ne servent qu'à
// corroborer un signal fort déjà présent.
//
// Aucun score : chaque candidat porte les FAITS qui l'ont fait remonter, et rien d'autre. « 87 %
// similaire » ne se justifierait par aucune règle explicable ; « même email » si.
//
// Ni dossiers historiques, ni références externes, ni fournisseur : le rapprochement d'un dossier
// legacy avec un Contact est un autre geste (rattachementContact.ts), et ADR-056 range les
// identités fournisseur hors de toute déduction.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LIMITE_CANDIDATS = 10;

type ClesSource = { email: string | null; telephone: string | null };

// LE déclencheur, et lui seul : même email OU même téléphone, sur des clés non absentes. Isolé
// pour que le test structurel puisse vérifier que ni le nom ni le prénom n'y entrent.
function conditionCandidats(cles: ClesSource): SQL | undefined {
  const conditions: SQL[] = [];
  if (cles.email !== null) conditions.push(eq(cleEmailSql(contactsTable.email), cles.email));
  if (cles.telephone !== null) conditions.push(eq(cleTelephoneSql(contactsTable.telephone), cles.telephone));
  return conditions.length > 0 ? or(...conditions) : undefined;
}

// `undefined` = source introuvable (id invalide, inconnu, ou d'un autre workspace — sans
// distinction, pour ne rien révéler hors périmètre) ; `[]` = source trouvée, aucun candidat.
export async function trouverContactsSimilaires(
  contactId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ContactSimilaire[] | undefined> {
  if (!UUID_REGEX.test(contactId)) return undefined;

  // REQUÊTE 1 — la source et ses clés, calculées par les mêmes expressions que le filtre.
  const [source] = await executeur
    .select({
      nom: contactsTable.nom,
      prenom: contactsTable.prenom,
      cleEmail: cleEmailSql(contactsTable.email),
      cleTelephone: cleTelephoneSql(contactsTable.telephone),
    })
    .from(contactsTable)
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.workspaceId, workspaceId)))
    .limit(1);
  if (!source) return undefined;

  const condition = conditionCandidats({ email: source.cleEmail, telephone: source.cleTelephone });
  // Sans email ni téléphone exploitable, rien ne peut remonter — même avec dix homonymes.
  if (!condition) return [];

  // REQUÊTE 2 — les candidats, ordonnés et bornés en SQL : signaux forts décroissants, puis nom,
  // puis id. L'ordre est décidé une fois et l'enrichissement ne le rejoue pas.
  const memeEmail = sql<boolean>`${cleEmailSql(contactsTable.email)} = ${source.cleEmail}`;
  const memeTelephone = sql<boolean>`${cleTelephoneSql(contactsTable.telephone)} = ${source.cleTelephone}`;
  const nbSignauxForts = sql<number>`(coalesce(${memeEmail}, false)::int + coalesce(${memeTelephone}, false)::int)`;
  const candidats = await executeur
    .select({
      id: contactsTable.id,
      nom: contactsTable.nom,
      prenom: contactsTable.prenom,
      email: contactsTable.email,
      telephone: contactsTable.telephone,
      memeEmail,
      memeTelephone,
    })
    .from(contactsTable)
    .where(and(eq(contactsTable.workspaceId, workspaceId), ne(contactsTable.id, contactId), condition))
    .orderBy(desc(nbSignauxForts), asc(contactsTable.nom), asc(contactsTable.id))
    .limit(LIMITE_CANDIDATS);
  if (candidats.length === 0) return [];

  // REQUÊTES 3 et 4 (batchées sur les ids retenus) — rôles et projets par le même assembleur que
  // la recherche : une seule définition du rôle dérivé, et un nombre de requêtes indépendant du
  // nombre de candidats.
  const enrichis = await assemblerResultatsContacts(candidats, executeur);
  const parId = new Map(enrichis.map((r) => [r.contactId, r]));

  const cleSource = cleNomPrenom(source.nom, source.prenom ?? undefined);
  return candidats.map((candidat) => {
    const signaux: SignalSimilariteContact[] = [];
    if (candidat.memeEmail) signaux.push("email");
    if (candidat.memeTelephone) signaux.push("telephone");
    if (cleSource !== undefined && cleNomPrenom(candidat.nom, candidat.prenom ?? undefined) === cleSource) {
      signaux.push("nom_prenom");
    }
    const resume = parId.get(candidat.id);
    return {
      contactId: candidat.id,
      nom: candidat.nom,
      prenom: candidat.prenom ?? undefined,
      email: candidat.email ?? undefined,
      telephone: candidat.telephone ?? undefined,
      signaux,
      roles: resume?.roles ?? [],
      nbProjets: (resume?.projetsAcquereur.length ?? 0) + (resume?.projetsVendeur.length ?? 0),
    };
  });
}
