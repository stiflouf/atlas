// Configuration d'environnement dédiée E2E (audit V1 Candidate) — jamais partagée avec le dev
// courant ni avec la suite Vitest : port dédié, base Postgres de test dédiée (même garde-fou que
// vitest.setup.ts), répertoire de stockage documentaire temporaire isolé. Importé à la fois par
// playwright.config.ts (pour démarrer le serveur avec ce jeu de variables) et par les fichiers de
// test (pour connaître l'URL cible et l'identité de session à sceller).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resoudreDatabaseUrlTest } from "../src/db/resoudreDatabaseUrlTest";

export const PORT_E2E = 3100;
export const BASE_URL_E2E = `http://localhost:${PORT_E2E}`;

// Identité scellée dans le cookie de session injecté par e2e/session.ts — doit correspondre à
// ATLAS_ALLOWED_EMAIL du serveur E2E démarré ci-dessous pour qu'exigerSessionAtlas()/le Proxy
// acceptent la session (comportement réel, jamais une identité de complaisance).
export const EMAIL_E2E = "conseiller-e2e@example.com";
export const SESSION_PASSWORD_E2E = "e2e-atlas-session-password-au-moins-32-caracteres-000";

export function repertoireStockageE2E(): string {
  return mkdtempSync(path.join(tmpdir(), "atlas-e2e-stockage-"));
}

// Résolue une seule fois au chargement de ce module (importé à la fois par playwright.config.ts et
// par les fichiers de test) — garantit que le process Playwright (utilisé par les tests pour le
// nettoyage direct en base) et le process serveur enfant (webServer) pointent exactement vers la
// même base de test, jamais une DATABASE_URL de production qui traînerait dans le shell.
export const DATABASE_URL_E2E = resoudreDatabaseUrlTest({
  ATLAS_TEST_DATABASE_URL: process.env.ATLAS_TEST_DATABASE_URL,
  DATABASE_URL: process.env.DATABASE_URL,
});
process.env.DATABASE_URL = DATABASE_URL_E2E;

export function envServeurE2E(): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(process.env)) {
    if (valeur !== undefined) base[cle] = valeur;
  }
  return {
    ...base,
    DATABASE_URL: DATABASE_URL_E2E,
    ATLAS_SESSION_PASSWORD: SESSION_PASSWORD_E2E,
    ATLAS_ALLOWED_EMAIL: EMAIL_E2E,
    ATLAS_DOCUMENT_STORAGE_DIR: repertoireStockageE2E(),
    PORT: String(PORT_E2E),
    // Jamais navigué réellement par les smoke (session injectée directement, §21) — juste construit
    // côté serveur par le lien "Se connecter avec Google" de /connexion. Valeur locale non secrète,
    // uniquement pour faire taire le throw fail-closed de googleIdentite.ts au chargement de la page.
    GOOGLE_ATLAS_REDIRECT_URI: `${BASE_URL_E2E}/api/auth/atlas/callback`,
  };
}
