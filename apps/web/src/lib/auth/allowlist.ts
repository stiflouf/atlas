// Allowlist mono-conseiller (ADR-047) — UNE seule adresse autorisée, jamais une liste. Plusieurs
// identités autorisées sur la même base sans ownership par ligne donneraient l'illusion d'un
// produit multi-utilisateur alors que toutes verraient/modifieraient les mêmes données : le
// multi-utilisateur reste explicitement hors périmètre (voir docs/adr/047-securisation-pilote-mono-conseiller.md).
export function normaliserEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Fail-closed : une configuration absente refuse tout le monde, jamais n'autorise tout le monde.
export function estEmailAutorise(email: string): boolean {
  const emailAutorise = process.env.ATLAS_ALLOWED_EMAIL;
  if (!emailAutorise) {
    throw new Error("Configuration d'authentification absente : ATLAS_ALLOWED_EMAIL doit être défini.");
  }
  return normaliserEmail(email) === normaliserEmail(emailAutorise);
}
