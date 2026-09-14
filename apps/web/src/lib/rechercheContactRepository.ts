import { and, asc, desc, eq, ilike, inArray, isNull, max, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb, type Executeur } from "@/db/client";
import {
  contacts as contactsTable,
  interactions as interactionsTable,
  partiesProjet as partiesProjetTable,
  projetsAcquereur as projetsAcquereurTable,
  projetsVendeur as projetsVendeurTable,
} from "@/db/schema";
import { deriverStatutProspectVendeur } from "@/types/prospectVendeur";
import type { StadeProjet } from "@/types/client";
import type {
  PageRechercheContact,
  ResultatRechercheContact,
  ResumeProjetAcquereur,
  ResumeProjetVendeur,
  RoleContact,
} from "@/types/rechercheContact";

// ADR-058 — LA RECHERCHE DE PERSONNES. Une ligne par Contact, et rien qui puisse en fusionner deux.
//
// Ce module ne fait AUCUN regroupement par email ou téléphone. Deux contacts qui partagent une
// adresse sont deux personnes tant qu'un humain n'a pas dit le contraire (ADR-055 §H), et les
// afficher côte à côte est exactement ce qui lui permet de trancher. Un `GROUP BY email` serait un
// confort d'affichage qui déciderait à sa place.
//
// TROIS REQUÊTES, quel que soit le nombre de résultats : la page de contacts, puis deux agrégats
// batchés sur les ids retenus. Jamais une requête par contact — une page de 25 résultats coûte
// autant qu'une page d'un seul.
//
// Ce lot ne cherche QUE `contacts`. Les dossiers historiques non rattachés restent invisibles ici :
// ils seront des résultats secondaires explicitement non canoniques, dans leur propre lot.

const PAR_PAGE_DEFAUT = 25;
const PAR_PAGE_MAX = 100;

export type ParametresRechercheContact = {
  // ADR-054 — OBLIGATOIRE, jamais optionnel, jamais de repli. Une recherche de personnes sans
  // périmètre est une fuite de données, pas une commodité.
  workspaceId: string;
  q?: string;
  limite?: number;
  decalage?: number;
};

function borner(limite: number | undefined): number {
  if (limite === undefined) return PAR_PAGE_DEFAUT;
  return Math.max(1, Math.min(PAR_PAGE_MAX, Math.floor(limite)));
}

// Les quatre colonnes d'identité sur lesquelles portent le filtre et le ranking. Paramétrées plutôt
// que figées sur `contacts` : la recherche mixte (recherchePersonneRepository) applique les MÊMES
// paliers aux dossiers historiques, et deux copies de la règle finiraient par diverger.
export type ColonnesIdentite = {
  nom: AnyPgColumn;
  prenom: AnyPgColumn;
  email: AnyPgColumn;
  telephone: AnyPgColumn;
};

const COLONNES_CONTACT: ColonnesIdentite = {
  nom: contactsTable.nom,
  prenom: contactsTable.prenom,
  email: contactsTable.email,
  telephone: contactsTable.telephone,
};

// RANKING DÉTERMINISTE, en paliers explicables : un conseiller doit pouvoir prédire ce que sa
// recherche rend. Exact d'abord (email, téléphone, nom complet), puis préfixe, puis contient.
// Aucun score composite : il ne s'explique pas, et se met à mentir dès qu'on lui ajoute un critère.
//
// Le rang est calculé en SQL pour que le TRI et la PAGINATION portent sur le même ordre — trier en
// mémoire après un `LIMIT` rendrait la page 2 incohérente avec la page 1.
export function expressionRang(texte: string, colonnes: ColonnesIdentite): SQL<number> {
  const exact = texte.toLowerCase();
  const prefixe = `${texte}%`;
  return sql<number>`case
    when lower(${colonnes.email}) = ${exact} then 1
    when lower(${colonnes.telephone}) = ${exact} then 2
    when lower(${nomCompletSql(colonnes)}) = ${exact} then 3
    when ${colonnes.nom} ilike ${prefixe} or ${colonnes.prenom} ilike ${prefixe} then 4
    else 5
  end`;
}

// Le NOM COMPLET est un critère à part entière, et pas seulement un palier de ranking : « Jean
// Dupont » est la façon la plus naturelle de chercher une personne, et aucune colonne prise seule ne
// contient ces deux mots. Sans cette concaténation, la recherche la plus évidente ne rendait rien.
function nomCompletSql(colonnes: ColonnesIdentite): SQL<string> {
  return sql<string>`trim(coalesce(${colonnes.prenom}, '') || ' ' || ${colonnes.nom})`;
}

export function filtreTexte(texte: string, colonnes: ColonnesIdentite): SQL | undefined {
  const motif = `%${texte}%`;
  return or(
    ilike(colonnes.nom, motif),
    ilike(colonnes.prenom, motif),
    ilike(colonnes.email, motif),
    ilike(colonnes.telephone, motif),
    sql`${nomCompletSql(colonnes)} ilike ${motif}`
  );
}

// Rôles et résumés de projets pour TOUTE la page, en une requête. `parties_projet` est la seule
// source du rôle (ADR-055 §A) : il est dérivé de la participation, jamais lu sur le contact.
async function chargerProjets(
  contactIds: string[],
  executeur: Executeur
): Promise<Map<string, { roles: Set<RoleContact>; acquereur: ResumeProjetAcquereur[]; vendeur: ResumeProjetVendeur[] }>> {
  const parContact = new Map<
    string,
    { roles: Set<RoleContact>; acquereur: ResumeProjetAcquereur[]; vendeur: ResumeProjetVendeur[] }
  >();
  if (contactIds.length === 0) return parContact;

  const lignes = await executeur
    .select({
      contactId: partiesProjetTable.contactId,
      role: partiesProjetTable.role,
      projetAcquereurId: projetsAcquereurTable.id,
      stade: projetsAcquereurTable.stadeProjet,
      budgetMin: projetsAcquereurTable.budgetMin,
      budgetMax: projetsAcquereurTable.budgetMax,
      acquereurArchiveLe: projetsAcquereurTable.archiveLe,
      projetVendeurId: projetsVendeurTable.id,
      vendeurArchiveLe: projetsVendeurTable.archiveLe,
      // Les JALONS bruts, pas un statut : la cascade métier est appelée en JS juste après. La
      // réécrire en SQL créerait la seconde vérité qu'ADR-014 refuse partout.
      datePerte: projetsVendeurTable.datePerte,
      mandatSigneLe: projetsVendeurTable.mandatSigneLe,
      mandatProposeLe: projetsVendeurTable.mandatProposeLe,
      estimationProposeeLe: projetsVendeurTable.estimationProposeeLe,
      rdvEstimationRealiseLe: projetsVendeurTable.rdvEstimationRealiseLe,
      qualifieLe: projetsVendeurTable.qualifieLe,
    })
    .from(partiesProjetTable)
    .leftJoin(projetsAcquereurTable, eq(partiesProjetTable.projetAcquereurId, projetsAcquereurTable.id))
    .leftJoin(projetsVendeurTable, eq(partiesProjetTable.projetVendeurId, projetsVendeurTable.id))
    .where(inArray(partiesProjetTable.contactId, contactIds));

  for (const ligne of lignes) {
    const entree =
      parContact.get(ligne.contactId) ?? { roles: new Set<RoleContact>(), acquereur: [], vendeur: [] };

    if (ligne.projetAcquereurId && !ligne.acquereurArchiveLe) {
      entree.roles.add("acquereur");
      entree.acquereur.push({
        projetId: ligne.projetAcquereurId,
        stade: ligne.stade as StadeProjet,
        budgetMin: ligne.budgetMin!,
        budgetMax: ligne.budgetMax!,
      });
    }
    if (ligne.projetVendeurId && !ligne.vendeurArchiveLe) {
      entree.roles.add("vendeur");
      entree.vendeur.push({
        projetId: ligne.projetVendeurId,
        statut: deriverStatutProspectVendeur({
          datePerte: ligne.datePerte ?? undefined,
          mandatSigneLe: ligne.mandatSigneLe?.toISOString(),
          mandatProposeLe: ligne.mandatProposeLe?.toISOString(),
          estimationProposeeLe: ligne.estimationProposeeLe ?? undefined,
          rdvEstimationRealiseLe: ligne.rdvEstimationRealiseLe?.toISOString(),
          qualifieLe: ligne.qualifieLe?.toISOString(),
        }),
      });
    }
    parContact.set(ligne.contactId, entree);
  }
  return parContact;
}

// Une seule requête groupée pour toute la page : `MAX(survenu_le)` par contact, et rien d'autre.
// Ni canal, ni compteur — aucun écran ne les lit encore.
async function chargerDernieresInteractions(
  contactIds: string[],
  executeur: Executeur
): Promise<Map<string, string>> {
  if (contactIds.length === 0) return new Map();
  const lignes = await executeur
    .select({ contactId: interactionsTable.contactId, derniere: max(interactionsTable.survenuLe) })
    .from(interactionsTable)
    .where(inArray(interactionsTable.contactId, contactIds))
    .groupBy(interactionsTable.contactId);
  return new Map(
    lignes.filter((l) => l.derniere !== null).map((l) => [l.contactId, l.derniere!.toISOString()])
  );
}

// La ligne d'identité telle que la requête de page la rend, avant enrichissement.
export type LigneContactRecherche = {
  id: string;
  nom: string;
  prenom: string | null;
  email: string | null;
  telephone: string | null;
};

// ENRICHIR une page de contacts déjà ordonnée : rôles, résumés de projets, dernière interaction.
// Exporté pour que la recherche mixte, qui décide sa propre page, obtienne exactement le même
// résultat canonique — sans qu'une seconde implémentation des agrégats n'apparaisse.
export async function assemblerResultatsContacts(
  page: LigneContactRecherche[],
  executeur: Executeur = getDb()
): Promise<ResultatRechercheContact[]> {
  const contactIds = page.map((l) => l.id);

  // REQUÊTES 2 et 3 — les agrégats, batchés sur les ids de la page. Leur nombre ne dépend pas du
  // nombre de résultats.
  const [projets, interactions] = await Promise.all([
    chargerProjets(contactIds, executeur),
    chargerDernieresInteractions(contactIds, executeur),
  ]);

  // L'assemblage préserve l'ORDRE reçu : le ranking est décidé une fois, en SQL, et
  // l'enrichissement ne le rejoue pas.
  return page.map((ligne) => {
    const contexte = projets.get(ligne.id);
    return {
      contactId: ligne.id,
      nom: ligne.nom,
      prenom: ligne.prenom ?? undefined,
      email: ligne.email ?? undefined,
      telephone: ligne.telephone ?? undefined,
      roles: contexte ? (["acquereur", "vendeur"] as const).filter((r) => contexte.roles.has(r)) : [],
      projetsAcquereur: contexte?.acquereur ?? [],
      projetsVendeur: contexte?.vendeur ?? [],
      derniereInteractionLe: interactions.get(ligne.id),
    };
  });
}

export async function rechercherContacts(
  params: ParametresRechercheContact,
  executeur: Executeur = getDb()
): Promise<PageRechercheContact> {
  const texte = params.q?.trim() ?? "";
  const limite = borner(params.limite);
  const decalage = Math.max(0, Math.floor(params.decalage ?? 0));

  // Une ligne de plus que la page demandée : c'est ce qui dit « il y a une suite » sans payer un
  // second balayage pour un total que personne n'affiche.
  const aDemander = limite + 1;
  const rang = texte.length > 0 ? expressionRang(texte, COLONNES_CONTACT) : undefined;

  // REQUÊTE 1 — la page de contacts. Le filtre de workspace est toujours présent, la recherche
  // textuelle seulement si l'utilisateur a tapé quelque chose. ADR-059 — un contact absorbé n'est
  // plus une personne qu'on cherche : exclu en SQL, AVANT la pagination, jamais filtré en mémoire.
  const conditionTexte = texte.length > 0 ? filtreTexte(texte, COLONNES_CONTACT) : undefined;
  const conditions = and(
    eq(contactsTable.workspaceId, params.workspaceId),
    isNull(contactsTable.fusionneDansContactId),
    conditionTexte
  );

  const base = executeur
    .select({
      id: contactsTable.id,
      nom: contactsTable.nom,
      prenom: contactsTable.prenom,
      email: contactsTable.email,
      telephone: contactsTable.telephone,
    })
    .from(contactsTable)
    .where(conditions);

  // Requête vide -> les contacts les plus récents, ordre stable. Jamais toute la table : la limite
  // s'applique dans les deux cas.
  const lignes = await (rang
    ? base.orderBy(asc(rang), asc(contactsTable.nom), asc(contactsTable.id))
    : base.orderBy(desc(contactsTable.creeLe), asc(contactsTable.id))
  )
    .limit(aDemander)
    .offset(decalage);

  const hasMore = lignes.length > limite;
  const page = hasMore ? lignes.slice(0, limite) : lignes;

  return { items: await assemblerResultatsContacts(page, executeur), hasMore };
}
