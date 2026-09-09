import { eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import {
  contacts as contactsTable,
  partiesProjet as partiesProjetTable,
  projetsAcquereur as projetsAcquereurTable,
} from "@/db/schema";
import type { StadeProjet } from "@/types/client";
import type { PartieProjet, ProjetAcquereur, RolePartieProjet } from "@/types/projetAcquereur";

// ADR-055 §B — accès au projet acquéreur canonique et à ses parties. Volontairement réduit à ce
// dont le lot a besoin : créer un projet, le relire, y rattacher des contacts, et parcourir la
// relation dans ses DEUX sens — c'est cette double lecture qui prouve que le modèle est réellement
// N:N, et non une relation 1:N déguisée.

type LigneProjet = typeof projetsAcquereurTable.$inferSelect;
type LignePartie = typeof partiesProjetTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NULL Postgres -> undefined métier, jamais false : un critère non documenté n'est pas un refus
// (même traduction que ligneVersAcquereur).
function ligneVersProjet(ligne: LigneProjet): ProjetAcquereur {
  return {
    id: ligne.id,
    budgetMin: ligne.budgetMin,
    budgetMax: ligne.budgetMax,
    criteres: ligne.criteres,
    stadeProjet: ligne.stadeProjet as StadeProjet,
    piecesMin: ligne.piecesMin ?? undefined,
    surfaceMin: ligne.surfaceMin ?? undefined,
    accessibiliteRequise: ligne.accessibiliteRequise ?? undefined,
    necessiteParking: ligne.necessiteParking ?? undefined,
    necessiteExterieur: ligne.necessiteExterieur ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    archiveLe: ligne.archiveLe?.toISOString(),
  };
}

function ligneVersPartie(ligne: LignePartie): PartieProjet {
  return {
    id: ligne.id,
    contactId: ligne.contactId,
    projetAcquereurId: ligne.projetAcquereurId,
    role: ligne.role as RolePartieProjet,
    creeLe: ligne.creeLe.toISOString(),
  };
}

export type NouveauProjetAcquereur = Omit<ProjetAcquereur, "id" | "creeLe" | "archiveLe">;

// `workspaceId` est un paramètre OBLIGATOIRE (ADR-054) : il vient du contexte authentifié, jamais
// d'un littéral. `executeur` optionnel, même patron que `creerAcquereur`/`creerContact` : permet de
// créer le projet dans la même transaction que le contact et le dossier historique.
export async function creerProjetAcquereur(
  input: NouveauProjetAcquereur,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ProjetAcquereur> {
  const [ligne] = await executeur
    .insert(projetsAcquereurTable)
    .values({
      workspaceId,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      criteres: input.criteres,
      stadeProjet: input.stadeProjet,
      piecesMin: input.piecesMin ?? null,
      surfaceMin: input.surfaceMin ?? null,
      accessibiliteRequise: input.accessibiliteRequise ?? null,
      necessiteParking: input.necessiteParking ?? null,
      necessiteExterieur: input.necessiteExterieur ?? null,
    })
    .returning();
  return ligneVersProjet(ligne);
}

// Aucun filtrage par workspace en lecture : ce lot ne l'active pas (il reste un lot à part entière,
// pour pouvoir en caractériser les régressions séparément). Même choix que `getContactById`.
export async function getProjetAcquereurById(id: string): Promise<ProjetAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .select()
    .from(projetsAcquereurTable)
    .where(eq(projetsAcquereurTable.id, id))
    .limit(1);
  return ligne ? ligneVersProjet(ligne) : undefined;
}

export type NouvellePartieProjet = {
  contactId: string;
  projetAcquereurId: string;
  role: RolePartieProjet;
};

// ADR-054 — `parties_projet` est une FEUILLE : elle ne porte pas de `workspace_id`, donc aucune
// contrainte de base ne peut refuser une participation qui traverserait deux périmètres. Cet
// invariant est tenu ICI, sur le seul chemin d'écriture canonique, et il échoue bruyamment : relier
// un contact du workspace A à un projet du workspace B fabriquerait une fuite entre deux
// conseillers, pas une donnée approximative.
//
// Les deux lectures se font dans l'`executeur` reçu : dans une transaction, elles voient le contact
// et le projet qui viennent d'y être créés, et le refus annule tout le reste avec elle.
export async function ajouterPartieProjet(
  input: NouvellePartieProjet,
  executeur: Executeur = getDb()
): Promise<PartieProjet> {
  const [contact] = await executeur
    .select({ workspaceId: contactsTable.workspaceId })
    .from(contactsTable)
    .where(eq(contactsTable.id, input.contactId))
    .limit(1);
  if (!contact) throw new Error(`Contact introuvable : ${input.contactId}`);

  const [projet] = await executeur
    .select({ workspaceId: projetsAcquereurTable.workspaceId })
    .from(projetsAcquereurTable)
    .where(eq(projetsAcquereurTable.id, input.projetAcquereurId))
    .limit(1);
  if (!projet) throw new Error(`Projet acquéreur introuvable : ${input.projetAcquereurId}`);

  if (contact.workspaceId !== projet.workspaceId) {
    throw new Error(
      "Une partie de projet ne peut pas relier un contact et un projet de workspaces différents"
    );
  }

  const [ligne] = await executeur
    .insert(partiesProjetTable)
    .values({
      contactId: input.contactId,
      projetAcquereurId: input.projetAcquereurId,
      role: input.role,
    })
    .returning();
  return ligneVersPartie(ligne);
}

// Les deux sens de la relation. Un projet peut avoir plusieurs contacts (couple, coacquéreurs) ;
// un contact peut porter plusieurs projets (recherches successives ou parallèles). Aucun des deux
// n'est un cas particulier de l'autre.
export async function listerPartiesDuProjet(projetAcquereurId: string): Promise<PartieProjet[]> {
  if (!UUID_REGEX.test(projetAcquereurId)) return [];
  const lignes = await getDb()
    .select()
    .from(partiesProjetTable)
    .where(eq(partiesProjetTable.projetAcquereurId, projetAcquereurId));
  return lignes.map(ligneVersPartie);
}

export async function listerPartiesDuContact(contactId: string): Promise<PartieProjet[]> {
  if (!UUID_REGEX.test(contactId)) return [];
  const lignes = await getDb().select().from(partiesProjetTable).where(eq(partiesProjetTable.contactId, contactId));
  return lignes.map(ligneVersPartie);
}
