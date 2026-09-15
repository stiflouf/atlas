import { eq } from "drizzle-orm";
import type { Executeur } from "@/db/client";
import { contacts as contactsTable } from "@/db/schema";
import { contactDepuisLigne, estContactFusionne } from "@/lib/contactFusion";
import type { Contact } from "@/types/contact";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ADR-059 §10 — UN CONTACT ABSORBÉ EST FIGÉ : aucune donnée vivante ne s'y rattache plus. Cette
// primitive est LA garde de tout writer métier qui reçoit un `contact_id` (interaction, partie de
// projet, référence externe, verrou, dossier historique, rattachement) : elle lit la ligne SOUS
// VERROU (`SELECT … FOR UPDATE`) dans la transaction de l'appelant, ce qui la sérialise avec le
// moteur de fusion — soit l'écriture passe avant la fusion et le moteur la repointe, soit elle
// attend la fusion et voit le contact absorbé. Une lecture nue suivie d'un INSERT laisserait la
// course ouverte.
//
// Elle ne suit JAMAIS `fusionne_dans_contact_id` : un writer qui vise B et découvre B absorbé est
// refusé, pas réécrit vers A. Réécrire masquerait un appelant qui travaille sur un état périmé, et
// ne suivrait qu'un maillon. L'appelant qui veut A le nomme.
//
// `workspaceId` optionnel : donné, un contact d'un autre workspace est INTROUVABLE (indistinguable
// d'un id inconnu) ; absent, le workspace du contact est rendu à l'appelant pour ses propres
// comparaisons. Un seul verrou de ligne, donc aucun interblocage avec le moteur (deux lignes par id
// croissant).
export type EtatContactActif =
  | { statut: "actif"; contact: Contact; workspaceId: string }
  | { statut: "introuvable" }
  | { statut: "fusionne" };

export async function verrouillerContactActif(
  contactId: string,
  executeur: Executeur,
  workspaceId?: string
): Promise<EtatContactActif> {
  if (!UUID_REGEX.test(contactId)) return { statut: "introuvable" };
  const [ligne] = await executeur.select().from(contactsTable).where(eq(contactsTable.id, contactId)).for("update");
  if (!ligne || (workspaceId !== undefined && ligne.workspaceId !== workspaceId)) return { statut: "introuvable" };
  const contact = contactDepuisLigne(ligne);
  if (estContactFusionne(contact)) return { statut: "fusionne" };
  return { statut: "actif", contact, workspaceId: ligne.workspaceId };
}

// Erreur MÉTIER distincte : un appelant peut la reconnaître (la finalisation Gmail en fait un état
// explicite) là où « introuvable » reste l'erreur ordinaire des writers à exception.
export class ErreurContactFusionne extends Error {
  constructor(contactId: string) {
    super(`Contact fusionné, plus aucune écriture possible : ${contactId}`);
    this.name = "ErreurContactFusionne";
  }
}

// Variante pour les writers à exception : rend le contact actif, ou lève.
export async function exigerContactActif(
  contactId: string,
  executeur: Executeur,
  workspaceId?: string
): Promise<{ contact: Contact; workspaceId: string }> {
  const etat = await verrouillerContactActif(contactId, executeur, workspaceId);
  if (etat.statut === "introuvable") throw new Error(`Contact introuvable : ${contactId}`);
  if (etat.statut === "fusionne") throw new ErreurContactFusionne(contactId);
  return { contact: etat.contact, workspaceId: etat.workspaceId };
}
