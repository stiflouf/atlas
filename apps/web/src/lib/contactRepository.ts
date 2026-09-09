import { eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { contacts as contactsTable } from "@/db/schema";
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
  };
}

export type NouveauContact = Omit<Contact, "id" | "creeLe">;

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
