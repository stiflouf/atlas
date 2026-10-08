import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { roleDansWorkspace } from "@/lib/workspaceRepository";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — garde de RÔLE, troisième question après les deux
// qu'ADR-047 et ADR-054 avaient déjà séparées :
//
//   exigerSessionAtlas()      qui est entré                        (IDENTITY,  ADR-047)
//   exigerWorkspaceCourant()  dans quel périmètre cette personne écrit (OWNERSHIP, ADR-054)
//   celle-ci                  cette personne peut-elle écrire CECI     (ROLE)
//
// Elle ne remplace ni l'une ni l'autre : elle les appelle, et s'ajoute. Elle n'est posée QUE sur
// l'identité juridique du responsable du traitement — une donnée qui engage la structure entière
// face aux personnes concernées, et non un enregistrement métier parmi d'autres.
//
// Pourquoi une garde séparée alors que `workspace_membres.role` n'accepte aujourd'hui que 'owner'
// (CHECK `workspace_membres_role_check`) : précisément parce que ce vocabulaire s'ouvrira. ADR-054
// §5 réserve 'member'/'manager'/'admin' sans les implémenter. Le jour où l'un d'eux existe, cette
// fonction refuse déjà, au lieu d'avoir laissé un écran sans contrôle de rôle qu'il faudrait
// retrouver.
//
// FAIL CLOSED : une appartenance absente, un rôle inconnu ou un rôle non 'owner' lèvent. Aucun
// repli, aucune valeur par défaut.
export class AccesReserveAuProprietaireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccesReserveAuProprietaireError";
  }
}

export async function exigerOwnerWorkspaceCourant(): Promise<string> {
  const identite = await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();

  // Le rôle est relu EN BASE pour ce couple (workspace, identité), jamais dérivé de la session : un
  // cookie prouve qu'une identité est entrée, pas ce qu'elle a le droit d'écrire aujourd'hui. Même
  // raisonnement que `exigerWorkspaceCourant`, qui revérifie l'autorisation plutôt que de faire
  // confiance à un cookie valide sept jours.
  const role = await roleDansWorkspace(workspaceId, identite.sub);

  if (role !== "owner") {
    throw new AccesReserveAuProprietaireError(
      "Cette configuration est réservée au propriétaire du workspace."
    );
  }

  return workspaceId;
}
