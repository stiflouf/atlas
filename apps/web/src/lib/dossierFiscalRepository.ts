import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dossierFiscal as dossierFiscalTable } from "@/db/schema";

export const DOSSIER_FISCAL_ID_DEFAUT = "default";

// Mono-dossier aujourd'hui (ADR-023, même patron que connexions_google/ADR-006) : crée la ligne
// racine à la demande si elle n'existe pas encore, jamais en migration/seed pour ne pas dépendre
// de l'ordre de déploiement. onConflictDoNothing rend l'appel idempotent en cas d'appels
// concurrents.
export async function obtenirDossierFiscalDefaut(): Promise<string> {
  const [existant] = await getDb()
    .select({ id: dossierFiscalTable.id })
    .from(dossierFiscalTable)
    .where(eq(dossierFiscalTable.id, DOSSIER_FISCAL_ID_DEFAUT));
  if (existant) return existant.id;

  await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_FISCAL_ID_DEFAUT }).onConflictDoNothing();
  return DOSSIER_FISCAL_ID_DEFAUT;
}
