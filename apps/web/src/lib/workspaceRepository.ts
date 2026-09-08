import { eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { workspaces, workspaceMembres } from "@/db/schema";

// ADR-054 — I/O du modèle d'appartenance. Seul endroit du code qui lit/écrit `workspaces` et
// `workspace_membres` (convention ADR-007 : seuls les `*Repository.ts` parlent à Postgres).
//
// Ce module ne décide JAMAIS d'un droit d'accès : il répond à "quel est le périmètre propriétaire"
// (OWNERSHIP), jamais à "cette personne a-t-elle le droit d'entrer" (l'allowlist mono-conseiller
// d'ADR-047 reste seule maîtresse de cette question).

// Résolution du workspace pour un contexte MACHINE (cron, scan temporel, balayage de
// resynchronisation, baseline) : ces chemins n'ont ni session ni identité humaine, et ne doivent
// surtout pas en simuler une.
//
// La valeur n'est PAS une constante codée en dur : elle est LUE en base. C'est délibéré et c'est le
// point important — le jour où un second workspace existera, cette fonction échouera bruyamment au
// lieu d'attribuer silencieusement le travail de tout le monde au premier venu. Un scan
// multi-workspace est un vrai changement de conception (une passe par workspace), pas un détail
// d'implémentation : il doit être forcé, pas contourné.
export async function resoudreWorkspaceExecutionMachine(executeur: Executeur = getDb()): Promise<string> {
  // `limit(2)` et non `limit(1)` : il faut pouvoir DÉTECTER la pluralité, pas seulement lire le
  // premier — lire le premier serait exactement le choix arbitraire que cette fonction interdit.
  const lignes = await executeur.select({ id: workspaces.id }).from(workspaces).limit(2);

  if (lignes.length === 0) {
    throw new Error(
      "Aucun workspace en base : la migration 0032 n'a pas été appliquée, ou le workspace historique a été supprimé."
    );
  }
  if (lignes.length > 1) {
    throw new Error(
      "Plusieurs workspaces existent : un traitement machine ne peut plus s'exécuter sans périmètre explicite (voir ADR-054)."
    );
  }
  return lignes[0].id;
}

export async function listerWorkspaceIdsPourIdentite(
  identiteSub: string,
  executeur: Executeur = getDb()
): Promise<string[]> {
  const lignes = await executeur
    .select({ workspaceId: workspaceMembres.workspaceId })
    .from(workspaceMembres)
    .where(eq(workspaceMembres.identiteSub, identiteSub));
  return lignes.map((ligne) => ligne.workspaceId);
}

// Bootstrap de l'appartenance `owner`, idempotent par construction (`ON CONFLICT DO NOTHING` sur la
// PK composite) : rejouable à chaque connexion sans jamais créer de doublon ni écraser une ligne
// existante (un rôle déjà posé n'est jamais rétrogradé ni modifié ici).
//
// L'appelant est responsable d'avoir vérifié l'autorisation AVANT (allowlist ADR-047) : cette
// fonction ne fait qu'enregistrer une décision déjà prise, elle n'en prend aucune.
//
// Ne crée jamais de workspace : il n'en existe qu'un, posé par la migration 0032. Créer un second
// workspace est une fonctionnalité produit qui n'existe pas.
export async function bootstrapperAppartenanceOwner(
  identite: { sub: string; email: string },
  executeur: Executeur = getDb()
): Promise<string> {
  const workspaceId = await resoudreWorkspaceExecutionMachine(executeur);

  await executeur
    .insert(workspaceMembres)
    .values({ workspaceId, identiteSub: identite.sub, email: identite.email, role: "owner" })
    .onConflictDoNothing({ target: [workspaceMembres.workspaceId, workspaceMembres.identiteSub] });

  return workspaceId;
}
