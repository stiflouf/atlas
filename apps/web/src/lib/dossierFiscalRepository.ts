import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dossierFiscal as dossierFiscalTable } from "@/db/schema";

// FISCAL_IDENTITY_OWNERSHIP_V1 (ADR-054 §6 bis) — le dossier fiscal appartient à une PERSONNE.
//
// Avant ce lot, ce module exposait `obtenirDossierFiscalDefaut()` : aucun paramètre, une ligne
// `id = 'default'`, la même pour tout le monde. Ce n'était pas un défaut de filtre mais une absence
// de notion d'appartenance — deux conseillers partageaient un régime micro-BNC, une option TVA et
// un revenu fiscal de référence de FOYER, et la saisie de l'un écrasait celle de l'autre.
//
// `identiteSub` est le `sub` OIDC de la session Atlas (`DonneesSessionAtlas`, ADR-047) : stable,
// personnel, indépendant du workspace. Un même conseiller exerçant dans plusieurs workspaces garde
// un seul dossier fiscal — sa situation fiscale ne se duplique pas par périmètre d'exercice.
//
// Aucun repli global : le paramètre est obligatoire, et il n'existe plus aucun chemin permettant
// d'atteindre « le » dossier fiscal sans dire de qui.
export async function obtenirDossierFiscalDeLIdentite(identiteSub: string): Promise<string> {
  const [existant] = await getDb()
    .select({ id: dossierFiscalTable.id })
    .from(dossierFiscalTable)
    .where(eq(dossierFiscalTable.identiteSub, identiteSub));
  if (existant) return existant.id;

  // L'identifiant est généré ici : la colonne a perdu son DEFAULT `'default'` (migration 0057),
  // qui rendait toute deuxième création impossible par collision de clé primaire. `onConflictDoNothing`
  // sur l'unicité de l'identité rend l'appel idempotent en cas d'appels concurrents — la relecture
  // qui suit rend alors la ligne gagnante, jamais une seconde ligne pour la même personne.
  const id = randomUUID();
  const [cree] = await getDb()
    .insert(dossierFiscalTable)
    .values({ id, identiteSub })
    .onConflictDoNothing({ target: dossierFiscalTable.identiteSub })
    .returning({ id: dossierFiscalTable.id });
  if (cree) return cree.id;

  const [gagnant] = await getDb()
    .select({ id: dossierFiscalTable.id })
    .from(dossierFiscalTable)
    .where(eq(dossierFiscalTable.identiteSub, identiteSub));
  if (!gagnant) throw new Error("Dossier fiscal introuvable après création concurrente.");
  return gagnant.id;
}
