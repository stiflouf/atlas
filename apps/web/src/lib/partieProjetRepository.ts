import { eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { exigerContactActif } from "@/lib/contactActif";
import {
  partiesProjet as partiesProjetTable,
  projetsAcquereur as projetsAcquereurTable,
  projetsVendeur as projetsVendeurTable,
} from "@/db/schema";
import type { CiblePartieProjet, PartieProjet, RolePartieProjet } from "@/types/partieProjet";

// ADR-055 §B — accès à la relation contact ↔ projet, partagée par les deux côtés du modèle
// canonique. Un module dédié plutôt qu'une copie côté vendeur : l'invariant inter-workspaces est
// tenu ici et nulle part ailleurs, et deux implémentations concurrentes finiraient par diverger.

type LignePartie = typeof partiesProjetTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NULL Postgres -> undefined métier : une partie acquéreur n'a pas un projet vendeur qui serait
// `null`, elle n'en a pas.
function ligneVersPartie(ligne: LignePartie): PartieProjet {
  return {
    id: ligne.id,
    contactId: ligne.contactId,
    projetAcquereurId: ligne.projetAcquereurId ?? undefined,
    projetVendeurId: ligne.projetVendeurId ?? undefined,
    role: ligne.role as RolePartieProjet,
    creeLe: ligne.creeLe.toISOString(),
  };
}

export type NouvellePartieProjet = { contactId: string; role: RolePartieProjet } & CiblePartieProjet;

// Lit le périmètre du projet visé, quel que soit son côté. Retourne undefined si le projet n'existe
// pas : l'appelant transforme ce vide en refus explicite plutôt qu'en insertion orpheline.
async function workspaceDuProjet(
  input: NouvellePartieProjet,
  executeur: Executeur
): Promise<string | undefined> {
  if (input.projetAcquereurId !== undefined) {
    const [projet] = await executeur
      .select({ workspaceId: projetsAcquereurTable.workspaceId })
      .from(projetsAcquereurTable)
      .where(eq(projetsAcquereurTable.id, input.projetAcquereurId))
      .limit(1);
    return projet?.workspaceId;
  }
  const [projet] = await executeur
    .select({ workspaceId: projetsVendeurTable.workspaceId })
    .from(projetsVendeurTable)
    .where(eq(projetsVendeurTable.id, input.projetVendeurId))
    .limit(1);
  return projet?.workspaceId;
}

// ADR-054 — `parties_projet` est une FEUILLE : elle ne porte pas de `workspace_id`, donc aucune
// contrainte de base ne peut refuser une participation qui traverserait deux périmètres. Cet
// invariant est tenu ICI, sur le seul chemin d'écriture canonique, et il échoue bruyamment : relier
// un contact du workspace A à un projet du workspace B fabriquerait une fuite entre deux
// conseillers, pas une donnée approximative.
//
// Les deux lectures se font dans l'`executeur` reçu : dans une transaction, elles voient le contact
// et le projet qui viennent d'y être créés, et le refus annule tout le reste avec elle.
// ADR-059 §10 — contact lu SOUS VERROU (transaction ou savepoint) : un absorbé ne participe plus à
// rien (`ErreurContactFusionne`), et une fusion concurrente ne laisse jamais une participation
// orpheline sur lui. Jamais réécrit vers le survivant.
export async function ajouterPartieProjet(
  input: NouvellePartieProjet,
  executeur: Executeur = getDb()
): Promise<PartieProjet> {
  return executeur.transaction(async (tx) => {
  const { workspaceId: workspaceContact } = await exigerContactActif(input.contactId, tx);

  const workspaceProjet = await workspaceDuProjet(input, tx);
  if (!workspaceProjet) {
    throw new Error(`Projet introuvable : ${input.projetAcquereurId ?? input.projetVendeurId}`);
  }

  if (workspaceContact !== workspaceProjet) {
    throw new Error("Une partie de projet ne peut pas relier un contact et un projet de workspaces différents");
  }

  const [ligne] = await tx
    .insert(partiesProjetTable)
    .values({
      contactId: input.contactId,
      projetAcquereurId: input.projetAcquereurId ?? null,
      projetVendeurId: input.projetVendeurId ?? null,
      role: input.role,
    })
    .returning();
  return ligneVersPartie(ligne);
  });
}

// Les deux sens de la relation. Un projet peut avoir plusieurs contacts (couple, coacquéreurs,
// indivision) ; un contact peut porter plusieurs projets — y compris un projet acquéreur ET un
// projet vendeur en même temps. Aucun des deux n'est un cas particulier de l'autre.
export async function listerPartiesDuProjetAcquereur(projetAcquereurId: string): Promise<PartieProjet[]> {
  if (!UUID_REGEX.test(projetAcquereurId)) return [];
  const lignes = await getDb()
    .select()
    .from(partiesProjetTable)
    .where(eq(partiesProjetTable.projetAcquereurId, projetAcquereurId));
  return lignes.map(ligneVersPartie);
}

export async function listerPartiesDuProjetVendeur(projetVendeurId: string): Promise<PartieProjet[]> {
  if (!UUID_REGEX.test(projetVendeurId)) return [];
  const lignes = await getDb()
    .select()
    .from(partiesProjetTable)
    .where(eq(partiesProjetTable.projetVendeurId, projetVendeurId));
  return lignes.map(ligneVersPartie);
}

export async function listerPartiesDuContact(contactId: string): Promise<PartieProjet[]> {
  if (!UUID_REGEX.test(contactId)) return [];
  const lignes = await getDb().select().from(partiesProjetTable).where(eq(partiesProjetTable.contactId, contactId));
  return lignes.map(ligneVersPartie);
}
