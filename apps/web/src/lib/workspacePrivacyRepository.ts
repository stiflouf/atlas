import { eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { workspaces } from "@/db/schema";
import type { IdentiteResponsablePartielle } from "@/lib/privacy/identiteResponsable";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — I/O de l'identité du responsable du traitement.
//
// Module séparé de `workspaceRepository.ts` plutôt qu'ajouté dedans : celui-ci porte le modèle
// d'APPARTENANCE (ADR-054) et son en-tête affirme qu'il ne décide jamais d'un droit d'accès. Y
// mêler une identité juridique brouillerait les deux sujets. Convention ADR-007 respectée : seuls
// les `*Repository.ts` parlent à Postgres.
//
// Les deux fonctions prennent un `workspaceId` EXPLICITE et ne le résolvent jamais elles-mêmes :
// l'appelant a déjà prouvé le périmètre et le rôle (`exigerOwnerWorkspaceCourant`). Un repository
// qui lirait la session serait appelable depuis un contexte machine sans qu'on s'en aperçoive.

const CHAMPS_PRIVACY = {
  controllerLegalName: workspaces.controllerLegalName,
  controllerLegalForm: workspaces.controllerLegalForm,
  controllerTradeName: workspaces.controllerTradeName,
  controllerAddressLine1: workspaces.controllerAddressLine1,
  controllerAddressLine2: workspaces.controllerAddressLine2,
  controllerPostalCode: workspaces.controllerPostalCode,
  controllerCity: workspaces.controllerCity,
  controllerCountryCode: workspaces.controllerCountryCode,
  controllerSiren: workspaces.controllerSiren,
  privacyRightsEmail: workspaces.privacyRightsEmail,
  dpoName: workspaces.dpoName,
  dpoEmail: workspaces.dpoEmail,
  privacyIdentityModifieLe: workspaces.privacyIdentityModifieLe,
} as const;

// Rend `null` si le workspace n'existe pas — distinct d'une identité entièrement vide, qui est un
// workspace réel sans identité renseignée. Confondre les deux ferait passer un périmètre inexistant
// pour un périmètre à configurer.
export async function getIdentiteResponsable(
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<IdentiteResponsablePartielle | null> {
  const lignes = await executeur
    .select(CHAMPS_PRIVACY)
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return lignes[0] ?? null;
}

export type ChampsIdentiteResponsable = Omit<IdentiteResponsablePartielle, "privacyIdentityModifieLe">;

// SEUL writer de ces colonnes. Écrit TOUS les champs à chaque fois, y compris ceux à `null` : le
// formulaire présente l'identité entière, et un champ que l'utilisateur a vidé doit redevenir NULL.
// Un `UPDATE` partiel qui ignorerait les absences rendrait un champ impossible à effacer une fois
// renseigné.
//
// `privacyIdentityModifieLe` est posé ici, et jamais par l'appelant : la date de dernière
// modification appartient à l'écriture. `new Date()` est l'horloge du processus, comme partout
// ailleurs dans le dépôt pour une colonne de ce type.
//
// Rend `null` si aucune ligne n'a été touchée (workspace inexistant) : l'action le traduit, le
// repository ne lève pas.
export async function enregistrerIdentiteResponsable(
  workspaceId: string,
  champs: ChampsIdentiteResponsable,
  executeur: Executeur = getDb()
): Promise<IdentiteResponsablePartielle | null> {
  const lignes = await executeur
    .update(workspaces)
    .set({ ...champs, privacyIdentityModifieLe: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning(CHAMPS_PRIVACY);
  return lignes[0] ?? null;
}
