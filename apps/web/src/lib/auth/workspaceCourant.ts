import { estEmailAutorise } from "@/lib/auth/allowlist";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { bootstrapperAppartenanceOwner, listerWorkspaceIdsPourIdentite } from "@/lib/workspaceRepository";

// ADR-054 — résolution du WORKSPACE COURANT pour une requête authentifiée.
//
// IDENTITY ≠ OWNERSHIP : `exigerSessionAtlas()` (ADR-047) répond "qui est entré" et reste la garde
// d'authentification, inchangée et toujours appelée en première instruction de chaque Server Action
// (invariant verrouillé par gardeSessionAtlas.structurel.test.ts). Cette fonction-ci répond à une
// question différente — "dans quel périmètre cette personne écrit-elle" — et n'est jamais un
// substitut de la garde.
//
// Elle relit la session plutôt que de recevoir l'identité en paramètre : c'est le même idiome que
// `transmissionDossierNotaire.ts` (garde nue en première ligne, puis relecture quand la valeur est
// nécessaire). Le coût est un déchiffrement de cookie, jamais un appel réseau.
//
// AUCUNE SÉLECTION DE WORKSPACE n'existe : le produit reste mono-conseiller. Une identité valide
// correspond à exactement un workspace, ou la fonction échoue.
export async function exigerWorkspaceCourant(): Promise<string> {
  const identite = await exigerSessionAtlas();

  const workspaceIds = await listerWorkspaceIdsPourIdentite(identite.sub);

  if (workspaceIds.length === 1) return workspaceIds[0];

  // FAIL CLOSED (ADR-054, étape 4 du lot) : tant qu'aucun mécanisme de sélection n'existe, choisir
  // arbitrairement le premier workspace écrirait des données dans un périmètre que personne n'a
  // désigné. Mieux vaut un échec explicite qu'une donnée mal rangée.
  if (workspaceIds.length > 1) {
    throw new Error(
      "Plusieurs appartenances trouvées pour cette identité : aucun mécanisme de sélection de workspace n'existe (voir ADR-054)."
    );
  }

  // Aucune appartenance : cas normal pour une session ouverte AVANT l'introduction du bootstrap
  // (le cookie reste valide 7 jours, ADR-047). On rattrape sans exiger une reconnexion — mais
  // jamais sans revérifier l'autorisation : le cookie prouve qu'une identité est entrée un jour,
  // pas qu'elle est toujours autorisée aujourd'hui. `estEmailAutorise` est fail-closed et lève si
  // la configuration est absente.
  if (!estEmailAutorise(identite.email)) {
    throw new Error("Identité non autorisée : aucune appartenance ne peut être établie.");
  }

  return bootstrapperAppartenanceOwner(identite);
}
