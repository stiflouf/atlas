import { and, count, desc, eq, getTableColumns, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { exigerContactActif } from "@/lib/contactActif";
import { resoudreContactActif } from "@/lib/contactRepository";
import type { NavigationContactDossier } from "@/types/contact";
import { acquereurs as acquereursTable } from "@/db/schema";
import { clients as clientsDemo, getClientById as getClientDemoById } from "@/data/clients";
import { resoudreSourcesCriteres } from "@/lib/criteresAcquereurEffectifs";
import {
  filtreIdentiteEffective,
  identiteEffectiveSql,
  joindreContactCanonique,
  resoudreSourcesIdentiteAcquereur,
} from "@/lib/identiteContactEffective";
import type { ProfilAcquereur, StadeProjet } from "@/types/client";
import type { PageResultat } from "@/types/pagination";

type LigneAcquereur = typeof acquereursTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bugfix pilote : le repli mock ci-dessous ne doit jamais atteindre la production (id non-UUID
// comme "client-001" inutilisable comme FK réelle — voir la contamination Postgres SQLSTATE 22P02
// constatée). Hors production (dev/tests), comportement historique inchangé.
function estProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// NULL Postgres -> undefined métier, jamais interprété comme false — même principe que
// bienRepository.ts.
function ligneVersAcquereur(ligne: LigneAcquereur): ProfilAcquereur {
  return {
    id: ligne.id,
    prenom: ligne.prenom,
    nom: ligne.nom,
    email: ligne.email,
    telephone: ligne.telephone,
    budgetMin: ligne.budgetMin,
    budgetMax: ligne.budgetMax,
    criteres: ligne.criteres,
    stadeProjet: ligne.stadeProjet as StadeProjet,
    notes: ligne.notes,
    datePremiereContact: ligne.datePremiereContact,
    piecesMin: ligne.piecesMin ?? undefined,
    surfaceMin: ligne.surfaceMin ?? undefined,
    accessibiliteRequise: ligne.accessibiliteRequise ?? undefined,
    necessiteParking: ligne.necessiteParking ?? undefined,
    necessiteExterieur: ligne.necessiteExterieur ?? undefined,
    archiveLe: ligne.archiveLe?.toISOString(),
  };
}

// ADR-055 §B + ADR-057 — PROJECTION D'AFFICHAGE, pour les CRITÈRES et pour l'IDENTITÉ.
// Depuis que le projet canonique fait foi pour ses critères et le Contact pour l'identité,
// un dossier rattaché ne peut plus être rendu tel qu'il est stocké : ses colonnes de critères ne
// sont plus écrites (voir `modifierAcquereur`, cible `projet_canonique`) et affichent une valeur
// gelée à la création. Les montrer produirait exactement le mensonge symétrique de celui que la
// bascule des lectures a corrigé — l'écran annoncerait un budget que le matching n'utilise pas.
//
// La RÈGLE de source n'est pas réécrite ici : `lib/criteresAcquereurEffectifs.ts` la tient, et le
// moteur de compatibilité s'appuie sur le même module. Une seule question, une seule réponse.
//
// `listerClientsActifsPersistes()` est volontairement LAISSÉE BRUTE : ses seuls consommateurs
// (synchroniseur et baseline ADR-036) résolvent eux-mêmes le profil du moteur juste après, et
// superposer deux fois la même règle coûterait une requête sans rien garantir de plus.
async function appliquerCriteresEffectifs(
  acquereurs: ProfilAcquereur[],
  executeur: Executeur = getDb()
): Promise<ProfilAcquereur[]> {
  if (acquereurs.length === 0) return acquereurs;
  const [criteres, identites] = await Promise.all([
    resoudreSourcesCriteres(
      acquereurs.map((a) => a.id),
      executeur
    ),
    resoudreSourcesIdentiteAcquereur(
      acquereurs.map((a) => a.id),
      executeur
    ),
  ]);
  return acquereurs.map((acquereur) => {
    // DEUX ponts INDÉPENDANTS, et c'est voulu : un dossier peut être rattaché à un Contact sans
    // projet canonique, ou l'inverse. Chacun applique sa propre règle d'agrégat sur son propre
    // périmètre, et aucun ne complète l'autre.
    const sourceCriteres = criteres.get(acquereur.id);
    const sourceIdentite = identites.get(acquereur.id);
    // Repli au niveau de l'AGRÉGAT : soit la source canonique fournit tous ses champs, soit aucun.
    // Un NULL canonique reste `undefined` — jamais recomblé avec la vieille valeur du dossier.
    const avecCriteres =
      sourceCriteres && sourceCriteres.source === "projet"
        ? { ...acquereur, ...sourceCriteres.criteres }
        : acquereur;
    // `email` et `telephone` sont réécrits même à `undefined` : c'est précisément le cas qui
    // distingue « le Contact n'a pas d'adresse » d'un repli sur celle du dossier.
    return sourceIdentite && sourceIdentite.source === "contact"
      ? {
          ...avecCriteres,
          nom: sourceIdentite.identite.nom,
          prenom: sourceIdentite.identite.prenom,
          email: sourceIdentite.identite.email,
          telephone: sourceIdentite.identite.telephone,
        }
      : avecCriteres;
  });
}

// Acquéreurs réels si au moins un existe, sinon les acquéreurs de démonstration — jamais un
// mélange, même principe que listerBiens(). La bascule compte TOUTES les lignes réelles
// (archivées comprises) — seul le résultat retourné exclut les archivés (ADR-012).
export async function listerClients(): Promise<ProfilAcquereur[]> {
  try {
    const lignes = await getDb().select().from(acquereursTable);
    if (lignes.length > 0) return appliquerCriteresEffectifs(lignes.filter((l) => !l.archiveLe).map(ligneVersAcquereur));
  } catch (erreur) {
    console.error("[acquereurs] lecture Postgres indisponible :", erreur);
    if (estProduction()) throw erreur;
    return clientsDemo;
  }
  if (estProduction()) return [];
  return clientsDemo;
}

// Réservé aux consommateurs qui ont besoin d'entités structurellement persistées (FK-able) — ADR-036
// (synchroniseur de compatibilité) uniquement. Même principe que listerBiensActifsPersistes()
// (bienRepository.ts) : interroge la table réelle directement, AUCUN repli mock. Ne remplace jamais
// listerClients() : le comportement produit existant (UI, matching flou) reste strictement inchangé.
export async function listerClientsActifsPersistes(): Promise<ProfilAcquereur[]> {
  const lignes = await getDb().select().from(acquereursTable);
  return lignes.filter((l) => !l.archiveLe).map(ligneVersAcquereur);
}

// VISIT_NATIVE_ENTRY_V1 — lecteurs SCOPÉS WORKSPACE (ADR-054), même contrat que
// `listerBiensActifsDuWorkspace`/`getBienDuWorkspace` (bienRepository.ts) : filtrage SQL direct,
// aucun repli mock, archivés exclus, identité et critères effectifs (ADR-055/057) appliqués comme
// partout. `listerClients()` (lecteur global à repli démo) reste inchangé pour ses appelants legacy.
export async function listerAcquereursActifsDuWorkspace(workspaceId: string, executeur: Executeur = getDb()): Promise<ProfilAcquereur[]> {
  const lignes = await executeur
    .select()
    .from(acquereursTable)
    .where(and(eq(acquereursTable.workspaceId, workspaceId), isNull(acquereursTable.archiveLe)))
    .orderBy(desc(acquereursTable.creeLe), desc(acquereursTable.id));
  return appliquerCriteresEffectifs(lignes.map(ligneVersAcquereur), executeur);
}

export async function getAcquereurDuWorkspace(id: string, workspaceId: string, executeur: Executeur = getDb()): Promise<ProfilAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select()
    .from(acquereursTable)
    .where(and(eq(acquereursTable.id, id), eq(acquereursTable.workspaceId, workspaceId)))
    .limit(1);
  if (!ligne) return undefined;
  const [acquereur] = await appliquerCriteresEffectifs([ligneVersAcquereur(ligne)], executeur);
  return acquereur;
}

// Réservé aux acquéreurs réels archivés — aucun repli mock.
export async function listerClientsArchives(): Promise<ProfilAcquereur[]> {
  try {
    const lignes = await getDb().select().from(acquereursTable);
    return appliquerCriteresEffectifs(lignes.filter((l) => l.archiveLe).map(ligneVersAcquereur));
  } catch (erreur) {
    console.error("[acquereurs] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// ADR-048 — recherche + pagination serveur, réservée à la page /clients. Ne remplace jamais
// listerClients() : le cockpit, le dashboard et les <select> de contexte continuent d'appeler la
// fonction existante, intégralement, sans pagination (voir docs/adr/048-...). Aucun repli mock ici
// (contrairement à listerClients()) : la recherche/pagination n'a pas de sens sur un jeu de
// démonstration figé, exposé uniquement avant toute création réelle.
//
// Ordre déterministe explicite (ADR-048) : aucun repository de ce projet n'avait d'ORDER BY avant
// cette ADR, l'ordre observé n'était donc jamais une garantie. `creeLe DESC` (le plus récent en
// premier, cohérent avec la lecture habituelle d'une liste), `id DESC` en tie-breaker pour deux
// lignes insérées à la même transaction/même timestamp — jamais un ordre implicite non déterministe
// qui déplacerait silencieusement des lignes d'une page à l'autre.
//
// ADR-057 — le filtre `q` porte sur l'identité EFFECTIVE (Contact pour un dossier rattaché,
// instantané sinon), c'est-à-dire sur ce que la liste affiche : chercher « Bob » ne remonte plus une
// ligne rendue « Alice ». Filtre en SQL, avant LIMIT/OFFSET et dans le COUNT — jamais en mémoire.
export async function rechercherAcquereursPage(params: {
  q?: string;
  archives: boolean;
  page: number;
  parPage: number;
}): Promise<PageResultat<ProfilAcquereur>> {
  const texte = params.q?.trim();
  const conditionArchive = params.archives ? isNotNull(acquereursTable.archiveLe) : isNull(acquereursTable.archiveLe);
  const conditionTexte: SQL | undefined = texte
    ? filtreIdentiteEffective(texte, identiteEffectiveSql(acquereursTable.contactId, acquereursTable))
    : undefined;
  const conditions = conditionTexte ? and(conditionArchive, conditionTexte) : conditionArchive;

  const page = Math.max(1, Math.floor(params.page) || 1);
  const offset = (page - 1) * params.parPage;

  const [lignes, [{ total }]] = await Promise.all([
    joindreContactCanonique(getDb().select(getTableColumns(acquereursTable)).from(acquereursTable).$dynamic(), acquereursTable.contactId)
      .where(conditions)
      .orderBy(desc(acquereursTable.creeLe), desc(acquereursTable.id))
      .limit(params.parPage)
      .offset(offset),
    joindreContactCanonique(getDb().select({ total: count() }).from(acquereursTable).$dynamic(), acquereursTable.contactId).where(conditions),
  ]);

  return { lignes: await appliquerCriteresEffectifs(lignes.map(ligneVersAcquereur)), total };
}

// Même règle de repli que getBienById() : dataset réel non vide => lookup DB uniquement, même
// pour un id de démo direct.
// ADR-055 — le PONT vers l'identité canonique, et rien d'autre. Une primitive dédiée plutôt que
// `contactId` ajouté à `ProfilAcquereur` : ce champ n'a aucun sens pour un écran, et l'exposer sur
// le type que toute l'application lit inviterait à le rendre partout.
//
// `undefined` couvre DEUX cas volontairement indistincts ici — acquéreur inexistant, et acquéreur
// existant mais non rattaché (toutes les lignes antérieures à ADR-055). L'appelant n'en fait qu'une
// chose : ne rien écrire de canonique. Aucun repli mock : ce chemin ne sert pas l'affichage.
// ADR-059 — la destination de « Voir le contact » depuis un dossier : le Contact ACTIF final,
// résolu par la seule primitive de parcours du produit (`resoudreContactActif`), dans le workspace
// du dossier. Lecture pure : un dossier qui pointerait encore un absorbé n'est pas corrigé ici.
// Un pont vers un contact introuvable ou une chaîne invalide est une corruption de l'identité
// canonique du dossier : erreur contrôlée, jamais un lien fabriqué ni un bouton muet.
export async function getNavigationContactDeLAcquereur(
  acquereurId: string,
  executeur: Executeur = getDb()
): Promise<NavigationContactDossier> {
  if (!UUID_REGEX.test(acquereurId)) return {};
  const [ligne] = await executeur
    .select({ contactId: acquereursTable.contactId, workspaceId: acquereursTable.workspaceId })
    .from(acquereursTable)
    .where(eq(acquereursTable.id, acquereurId))
    .limit(1);
  if (!ligne?.contactId) return {};
  const resolution = await resoudreContactActif(ligne.contactId, ligne.workspaceId, executeur);
  if (resolution.statut !== "actif") {
    throw new Error(`Contact canonique incohérent pour le dossier acquéreur ${acquereurId} (${resolution.statut})`);
  }
  return { contactId: ligne.contactId, contactActifId: resolution.contact.id };
}

export async function getContactCanoniqueDeLAcquereur(
  acquereurId: string,
  executeur: Executeur = getDb()
): Promise<string | undefined> {
  if (!UUID_REGEX.test(acquereurId)) return undefined;
  const [ligne] = await executeur
    .select({ contactId: acquereursTable.contactId })
    .from(acquereursTable)
    .where(eq(acquereursTable.id, acquereurId))
    .limit(1);
  return ligne?.contactId ?? undefined;
}

export async function getClientById(id: string): Promise<ProfilAcquereur | undefined> {
  try {
    if (UUID_REGEX.test(id)) {
      const [ligne] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, id)).limit(1);
      if (ligne) {
        const [effectif] = await appliquerCriteresEffectifs([ligneVersAcquereur(ligne)]);
        return effectif;
      }
    }

    const [{ total }] = await getDb().select({ total: sql<number>`count(*)::int` }).from(acquereursTable);
    if (total > 0) return undefined;
  } catch (erreur) {
    console.error("[acquereurs] lecture Postgres indisponible :", erreur);
    if (estProduction()) throw erreur;
    return getClientDemoById(id);
  }
  if (estProduction()) return undefined;
  return getClientDemoById(id);
}

// ADR-057 — `email` et `telephone` redeviennent OBLIGATOIRES ici, alors qu'ils sont optionnels en
// lecture. Ce n'est pas une incohérence : `acquereurs.email`/`telephone` sont `NOT NULL` en base, une
// création DOIT donc les fournir. C'est la lecture qui a changé de nature — elle peut désormais
// rendre l'identité d'un Contact, où l'adresse peut légitimement être inconnue.
export type NouvelAcquereur = Omit<ProfilAcquereur, "id" | "prenom" | "email" | "telephone"> & {
  prenom: string;
  email: string;
  telephone: string;
  // ADR-055 — pont OPTIONNEL vers l'identité canonique. Optionnel et non requis : les chemins qui
  // ne connaissent pas encore le modèle canonique (tests d'intégration, seed, appels internes)
  // continuent de fonctionner à l'identique en le laissant absent, et la ligne reste alors
  // simplement non rattachée. Aucun rattachement n'est jamais deviné ici.
  contactId?: string;
  // ADR-055 §B — pont OPTIONNEL vers le projet canonique, même discipline que `contactId` :
  // absent = ligne non rattachée, jamais un rattachement deviné.
  projetAcquereurId?: string;
};

// Insertion pure : la validation métier (budgetMin <= budgetMax, etc.) est de la responsabilité
// de l'appelant (Server Action), pas de ce repository.
// ADR-054 — `workspaceId` est un paramètre OBLIGATOIRE, jamais une valeur que ce repository
// choisirait : il vient du contexte authentifié (`exigerWorkspaceCourant()`) ou du contexte
// d'exécution machine (`resoudreWorkspaceExecutionMachine()`). Aucun repli, aucun `?? "default"` —
// la migration 0033 a retiré le DEFAULT SQL précisément pour qu'un oubli échoue immédiatement au
// lieu d'être silencieusement rangé dans le workspace historique.
// ADR-059 §10 — un dossier ne naît jamais rattaché à un contact absorbé : si un `contactId` est
// fourni, le contact est lu SOUS VERROU (actif, dans ce workspace) AVANT l'insertion. Sans
// `contactId`, comportement inchangé.
export async function creerAcquereur(
  input: NouvelAcquereur,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ProfilAcquereur> {
  return executeur.transaction(async (tx) => {
  if (input.contactId) await exigerContactActif(input.contactId, tx, workspaceId);
  const [ligne] = await tx
    .insert(acquereursTable)
    .values({
      workspaceId,
      contactId: input.contactId ?? null,
      projetAcquereurId: input.projetAcquereurId ?? null,
      prenom: input.prenom,
      nom: input.nom,
      email: input.email,
      telephone: input.telephone,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      criteres: input.criteres,
      stadeProjet: input.stadeProjet,
      notes: input.notes,
      datePremiereContact: input.datePremiereContact,
      piecesMin: input.piecesMin ?? null,
      surfaceMin: input.surfaceMin ?? null,
      accessibiliteRequise: input.accessibiliteRequise ?? null,
      necessiteParking: input.necessiteParking ?? null,
      necessiteExterieur: input.necessiteExterieur ?? null,
    })
    .returning();
  return ligneVersAcquereur(ligne);
  });
}

// ADR-055 §B — OÙ vont les CRITÈRES de cette modification (l'identité a sa propre cible, voir
// `CibleIdentiteAcquereur`). Paramètre OBLIGATOIRE, jamais une valeur
// par défaut : se tromper de cible n'échoue pas, ça écrit au mauvais endroit et le produit affiche
// ensuite une valeur que le matching n'utilise pas. Même discipline que `workspaceId` (ADR-054), et
// pour la même raison — un oubli doit refuser de compiler, pas être silencieusement rangé quelque
// part.
//
//   'dossier'          -> le dossier porte ses critères (aucun projet canonique rattaché)
//   'projet_canonique' -> le projet les porte ; cet UPDATE n'y touche PAS
//
// `projet_canonique` n'est PAS un cas dégradé : c'est l'établissement de la propriété des données.
// Continuer à écrire les colonnes du dossier « pour rester synchronisé » recréerait deux sources de
// vérité — précisément ce que la bascule des lectures a défait.
export type CibleCriteresAcquereur = "dossier" | "projet_canonique";

// ADR-057 — même discipline pour l'IDENTITÉ, et deux ponts INDÉPENDANTS : un dossier peut être
// rattaché à un Contact sans projet canonique, ou l'inverse. Les fusionner en un seul drapeau
// « canonique » ferait écrire au mauvais endroit à la première ligne asymétrique.
//
//   'dossier'           -> le dossier porte son identité (aucun Contact rattaché)
//   'contact_canonique' -> le Contact la porte ; cet UPDATE n'y touche PAS
export type CibleIdentiteAcquereur = "dossier" | "contact_canonique";

export type CiblesEcritureAcquereur = {
  criteres: CibleCriteresAcquereur;
  identite: CibleIdentiteAcquereur;
};

// Update pur, même principe que creerAcquereur. modifieLe posé explicitement (voir
// bienRepository.modifierBien pour le détail). Retourne undefined si id ne correspond à aucune
// ligne réelle plutôt que de supposer une modification effective.
export async function modifierAcquereur(
  id: string,
  input: NouvelAcquereur,
  cibles: CiblesEcritureAcquereur,
  // ADR-054 — le périmètre est vérifié DANS le `WHERE` : un id d'un autre workspace ne correspond à
  // aucune ligne, la fonction rend `undefined`, et l'appelant en fait un `notFound()`. Un filtre
  // applicatif posé après coup laisserait passer la première écriture qui l'oublierait.
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ProfilAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  // Parcours, notes et date de premier contact restent portés par le dossier dans tous les cas :
  // ni `contacts` ni `projets_acquereur` n'ont d'écran pour eux (dette nommée dans DATA_MODEL.md).
  const colonnesDossier = {
    stadeProjet: input.stadeProjet,
    notes: input.notes,
    datePremiereContact: input.datePremiereContact,
    modifieLe: new Date(),
  };
  const colonnesIdentite =
    cibles.identite === "dossier"
      ? { prenom: input.prenom, nom: input.nom, email: input.email, telephone: input.telephone }
      : {};
  const colonnesCriteres =
    cibles.criteres === "dossier"
      ? {
          budgetMin: input.budgetMin,
          budgetMax: input.budgetMax,
          criteres: input.criteres,
          piecesMin: input.piecesMin ?? null,
          surfaceMin: input.surfaceMin ?? null,
          accessibiliteRequise: input.accessibiliteRequise ?? null,
          necessiteParking: input.necessiteParking ?? null,
          necessiteExterieur: input.necessiteExterieur ?? null,
        }
      : {};

  const [ligne] = await executeur
    .update(acquereursTable)
    .set({ ...colonnesDossier, ...colonnesIdentite, ...colonnesCriteres })
    .where(and(eq(acquereursTable.id, id), eq(acquereursTable.workspaceId, workspaceId)))
    .returning();
  return ligne ? ligneVersAcquereur(ligne) : undefined;
}

// Archivage/désarchivage : jamais un DELETE, uniquement archiveLe qui bascule (voir
// bienRepository.archiverBien pour le détail des garanties FK).
export async function archiverAcquereur(
  id: string,
  executeur: Executeur = getDb()
): Promise<ProfilAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(acquereursTable)
    .set({ archiveLe: new Date() })
    .where(eq(acquereursTable.id, id))
    .returning();
  return ligne ? ligneVersAcquereur(ligne) : undefined;
}

export async function desarchiverAcquereur(
  id: string,
  executeur: Executeur = getDb()
): Promise<ProfilAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(acquereursTable)
    .set({ archiveLe: null })
    .where(eq(acquereursTable.id, id))
    .returning();
  return ligne ? ligneVersAcquereur(ligne) : undefined;
}
