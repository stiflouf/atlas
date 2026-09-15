import type { contacts as contactsTable } from "@/db/schema";
import type { Contact } from "@/types/contact";

// ADR-059 — ce qu'est un Contact ACTIF et ce qu'est un Contact ABSORBÉ, écrit une fois. Actif :
// `fusionneDansContactId` absent. Absorbé : présent, avec sa date (la base garantit qu'ils vont
// ensemble). Aucune autre nuance : pas de « en cours », pas de « partiellement fusionné ».

export type ContactFusionne = Contact & { fusionneDansContactId: string; fusionneLe: string };

export function estContactFusionne(contact: Contact): contact is ContactFusionne {
  return contact.fusionneDansContactId !== undefined && contact.fusionneLe !== undefined;
}

// Borne de résolution d'une chaîne A → B → C. Les writers futurs refuseront d'absorber dans un
// contact déjà absorbé, mais un read model ne fait pas confiance aux écrivains qui n'existent
// pas encore : au-delà, ou en cas de cycle, la lecture s'arrête sur un état explicite.
export const MAX_CHAINE_FUSION = 10;

// NULL Postgres -> undefined métier, jamais une chaîne vide (même traduction que ligneVersBien).
// Écrit une fois : le repository Contact et la garde d'écriture (`contactActif.ts`) la partagent.
export function contactDepuisLigne(ligne: typeof contactsTable.$inferSelect): Contact {
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
