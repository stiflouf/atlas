import { and, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { contacts as contactsTable } from "@/db/schema";
import { estContactFusionne, MAX_CHAINE_FUSION } from "@/lib/contactFusion";
import { verrouillerChamp } from "@/lib/provenance/champVerrouilleRepository";
import type { Contact } from "@/types/contact";

// ADR-055 §A — accès à l'identité canonique. Volontairement réduit à ce dont le lot a besoin :
// créer un contact et le relire. Aucune fonction de recherche, de fusion ou de rapprochement n'est
// exposée — les écrire sans besoin réel reviendrait à figer des critères de déduplication que ce
// lot s'interdit précisément de choisir (ADR-055 §H : jamais de fusion silencieuse).

type LigneContact = typeof contactsTable.$inferSelect;

// NULL Postgres -> undefined métier, jamais une chaîne vide : un contact sans email n'a pas
// d'email, il n'en a pas un qui serait "" (même traduction que ligneVersBien).
function ligneVersContact(ligne: LigneContact): Contact {
  return {
    id: ligne.id,
    nom: ligne.nom,
    prenom: ligne.prenom ?? undefined,
    email: ligne.email ?? undefined,
    telephone: ligne.telephone ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
    fusionneDansContactId: ligne.fusionneDansContactId ?? undefined,
    fusionneLe: ligne.fusionneLe?.toISOString(),
  };
}

export type NouveauContact = Omit<Contact, "id" | "creeLe" | "modifieLe" | "fusionneDansContactId" | "fusionneLe">;

// Crée TOUJOURS un nouveau contact — jamais de "trouver ou créer". C'est la décision centrale du
// lot : rapprocher automatiquement sur un email ou un téléphone fusionnerait deux personnes
// distinctes mal saisies (un couple partage une adresse, une famille un numéro), et ce produit ne
// fusionne jamais deux humains sans qu'un humain l'ait décidé. Un doublon reste corrigeable ;
// une fusion à tort ne l'est pas.
//
// `workspaceId` est un paramètre OBLIGATOIRE (ADR-054) : il vient du contexte authentifié
// (`exigerWorkspaceCourant`), jamais d'un littéral. `executeur` optionnel, même patron que
// `creerBien` : permet de créer le contact dans la même transaction que le dossier qui le
// référence, pour qu'aucun des deux ne puisse exister sans l'autre.
export async function creerContact(
  input: NouveauContact,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Contact> {
  const [ligne] = await executeur
    .insert(contactsTable)
    .values({
      workspaceId,
      nom: input.nom,
      prenom: input.prenom ?? null,
      email: input.email ?? null,
      telephone: input.telephone ?? null,
    })
    .returning();
  return ligneVersContact(ligne);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Aucun filtrage par workspace ici : ce lot n'active pas l'isolation en lecture (elle reste un lot
// à part entière, pour pouvoir en caractériser les régressions séparément). Le workspace est déjà
// porté par la ligne, prêt pour ce jour-là.
export async function getContactById(id: string): Promise<Contact | undefined> {
  // Même garde que bienRepository : ne jamais tenter un cast Postgres sur un identifiant non-UUID.
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, id)).limit(1);
  return ligne ? ligneVersContact(ligne) : undefined;
}

// ADR-054 — lecture d'un contact DANS un périmètre : un contact d'un autre workspace est introuvable,
// pas interdit — rien ne doit permettre d'inférer son existence. C'est la lecture qu'un écran
// d'édition emploie avant d'appeler le writer, qui revérifie lui-même le périmètre.
//
// ADR-059 — lecture GÉNÉRIQUE : elle rend aussi un contact absorbé, avec son marqueur. Rendre
// l'état fusionné invisible ici le rendrait invisible partout ; c'est à chaque appelant de décider
// (un éditeur refuse, une fiche explique). Les recherches actives, elles, filtrent en SQL.
export async function getContactDuWorkspace(
  id: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Contact | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select()
    .from(contactsTable)
    .where(and(eq(contactsTable.id, id), eq(contactsTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersContact(ligne) : undefined;
}

// ADR-057 — le PREMIER chemin d'écriture d'un contact existant. `contacts` était strictement
// append-only jusqu'ici : une ligne portait l'identité telle qu'elle était à la création du dossier,
// et toute correction ultérieure la laissait en arrière.
//
// Cette primitive est HUMAINE par construction — il n'existe aucun chemin machine vers elle (le Sync
// Engine ne connaît pas encore `contacts`). C'est ce qui lui permet, contrairement à
// `modifierChampProjetAcquereur` qui est partagé avec l'import, de poser elle-même le VERROU
// d'ADR-056 §4 : une valeur corrigée par un humain n'est plus jamais réécrite par une
// synchronisation, et seul un geste humain explicite lèvera le verrou.
//
// Seuls les champs RÉELLEMENT changés sont verrouillés. ADR-056 définit l'override local comme
// « une valeur modifiée par un humain » : rouvrir un formulaire et le réenregistrer à l'identique
// n'est pas une correction, et verrouillerait sinon les quatre champs d'un coup — un futur
// connecteur ne pourrait plus jamais rien alimenter, sans que personne ne l'ait décidé.
//
// Ce module ne connaît ni `acquereurs`, ni l'UI, ni Gmail : il écrit une identité, c'est tout.
const CHAMPS_IDENTITE = ["nom", "prenom", "email", "telephone"] as const;

export async function modifierIdentiteContact(
  id: string,
  input: NouveauContact,
  // ADR-054 — le périmètre vient de l'appelant, jamais d'un littéral, et il est VÉRIFIÉ ici : une
  // identité ne se corrige pas depuis un autre workspace.
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Contact | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;

  const [actuel] = await executeur.select().from(contactsTable).where(eq(contactsTable.id, id)).limit(1);
  if (!actuel) return undefined;
  if (actuel.workspaceId !== workspaceId) {
    throw new Error("Un contact d'un autre workspace ne peut pas être modifié");
  }
  // ADR-059 — un contact absorbé est FIGÉ : son identité est celle qu'il avait à la fusion, et la
  // personne se corrige désormais sur le survivant. Vérifié ici, dans le writer, même si tout écran
  // l'empêche en amont.
  if (estContactFusionne(ligneVersContact(actuel))) {
    throw new Error("Un contact fusionné ne peut plus être modifié");
  }

  const [ligne] = await executeur
    .update(contactsTable)
    .set({
      nom: input.nom,
      prenom: input.prenom ?? null,
      email: input.email ?? null,
      telephone: input.telephone ?? null,
      modifieLe: new Date(),
    })
    .where(eq(contactsTable.id, id))
    .returning();
  if (!ligne) return undefined;

  for (const champ of CHAMPS_IDENTITE) {
    const avant = actuel[champ] ?? undefined;
    const apres = input[champ] ?? undefined;
    if (avant !== apres) await verrouillerChamp({ type: "contact", id }, champ, workspaceId, executeur);
  }

  return ligneVersContact(ligne);
}

// ADR-059 — MARQUER un contact comme absorbé : le SECOND et dernier writer de `contacts` (avec
// `modifierIdentiteContact`). Il ne pose que le marqueur ; tout ce qui entoure une fusion —
// verrous de lignes, repoint des dépendances, identité finale, journal — est orchestré par le
// moteur (`fusionContactRepository.ts`) dans la transaction qu'il passe ici. Appelé hors de cette
// transaction, il poserait un pointeur sans trace : c'est pourquoi `executeur` est OBLIGATOIRE.
//
// Les gardes sont refaites ici même si le moteur les a déjà vérifiées : un writer ne fait pas
// confiance à son appelant. `undefined` = absorbé introuvable dans ce workspace.
export async function marquerContactFusionne(
  contactAbsorbeId: string,
  contactSurvivantId: string,
  workspaceId: string,
  executeur: Executeur
): Promise<Contact | undefined> {
  if (!UUID_REGEX.test(contactAbsorbeId) || !UUID_REGEX.test(contactSurvivantId)) return undefined;
  if (contactAbsorbeId === contactSurvivantId) {
    throw new Error("Un contact ne peut pas être absorbé par lui-même");
  }
  const [absorbe] = await executeur.select().from(contactsTable).where(eq(contactsTable.id, contactAbsorbeId)).limit(1);
  if (!absorbe || absorbe.workspaceId !== workspaceId) return undefined;
  if (absorbe.fusionneDansContactId !== null) {
    throw new Error("Un contact déjà fusionné ne peut pas être absorbé une seconde fois");
  }
  const [survivant] = await executeur
    .select({ workspaceId: contactsTable.workspaceId, fusionneDansContactId: contactsTable.fusionneDansContactId })
    .from(contactsTable)
    .where(eq(contactsTable.id, contactSurvivantId))
    .limit(1);
  if (!survivant || survivant.workspaceId !== workspaceId) {
    throw new Error("Le contact survivant est introuvable dans ce workspace");
  }
  if (survivant.fusionneDansContactId !== null) {
    throw new Error("Un contact déjà fusionné ne peut pas être survivant");
  }

  const [ligne] = await executeur
    .update(contactsTable)
    .set({ fusionneDansContactId: contactSurvivantId, fusionneLe: new Date() })
    .where(eq(contactsTable.id, contactAbsorbeId))
    .returning();
  return ligne ? ligneVersContact(ligne) : undefined;
}

// ADR-059 — RÉSOUDRE le contact actif derrière un id, en suivant `fusionne_dans_contact_id` : A → B
// → C rend C. Aucune compaction (A n'est jamais réécrit vers C) : la trace de chaque fusion vaut
// plus que la vitesse d'une lecture. Bornée et protégée contre les cycles : un read model ne fait
// pas confiance à des écrivains qui n'existent pas encore.
//
// `introuvable` = l'id de départ n'existe pas dans ce workspace (indistinguable d'un autre
// workspace). `chaine_invalide` = cycle, profondeur > MAX_CHAINE_FUSION, ou maillon manquant hors
// périmètre : un état que le moteur futur interdit, rendu explicite plutôt que bouclé.
export type ResolutionContactActif =
  | { statut: "actif"; contact: Contact; chaine: string[] }
  | { statut: "introuvable" }
  | { statut: "chaine_invalide" };

export async function resoudreContactActif(
  contactId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResolutionContactActif> {
  const chaine: string[] = [];
  const vus = new Set<string>();
  let courant = await getContactDuWorkspace(contactId, workspaceId, executeur);
  if (!courant) return { statut: "introuvable" };

  while (estContactFusionne(courant)) {
    if (vus.has(courant.id) || chaine.length >= MAX_CHAINE_FUSION) return { statut: "chaine_invalide" };
    vus.add(courant.id);
    chaine.push(courant.id);
    const suivant = await getContactDuWorkspace(courant.fusionneDansContactId, workspaceId, executeur);
    if (!suivant) return { statut: "chaine_invalide" };
    courant = suivant;
  }
  return { statut: "actif", contact: courant, chaine };
}
