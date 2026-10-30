import { defineConfig } from "@playwright/test";
import { BASE_URL_E2E, PORT_E2E, envServeurE2E } from "./e2e/env";

// Smoke E2E minimal (audit V1 Candidate) — DEUX scénarios maximum, jamais une infrastructure de
// bout en bout complète (matching/Calendar/Gmail/rémunération/automatisations restent couverts par
// les 1189 tests Vitest). Jamais exécuté par `pnpm test` : commandes dédiées test:e2e/test:e2e:ui
// (package.json). `workers: 1` — les deux smoke mutent la même base de test dédiée, jamais en
// parallèle entre eux pour rester déterministes.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Budget par test. Le premier passage sur chaque route est compilé à la volée par
  // `next dev --turbopack` (aucun build de production préalable — voir webServer ci-dessous), donc
  // bien plus lent que le défaut de Playwright.
  //
  // PILOT_VISIT_SIGNATURE_E2E_V1 — porté de 60 s à 180 s, sur mesure et non par confort : les trois
  // specs dépassaient 60 s sur le poste de développement, à des endroits variables (une navigation
  // avortée ici, une attente de téléchargement là), tous imputables à l'horloge et aucun au produit.
  // Durées réellement observées une fois le budget suffisant : 1,5 min / 2,3 min / 1,8 min pour les
  // trois scénarios de signature.
  //
  // Ce budget ne change AUCUNE assertion — seulement le temps accordé. Le vrai correctif de fond
  // serait de servir un build de production au lieu de `next dev` (plus aucune compilation à la
  // volée) : c'est une décision d'infrastructure E2E à part entière, hors périmètre de ce lot.
  timeout: 180_000,
  use: {
    baseURL: BASE_URL_E2E,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx next dev --turbopack -p " + PORT_E2E,
    url: BASE_URL_E2E,
    // PILOT_VISIT_SIGNATURE_E2E_V1 — opt-in STRICT, défaut inchangé (false) : sans la variable,
    // Playwright démarre son propre serveur comme avant. La réutilisation sert à itérer sur un
    // serveur déjà chaud, jamais à masquer un échec de démarrage.
    reuseExistingServer: Boolean(process.env.ATLAS_E2E_REUSE_SERVER),
    // Budget de DÉMARRAGE (pas une assertion de test). Mesuré sur le poste de développement :
    // ~19 s à froid dans de bonnes conditions, mais au-delà de 60 s sous pression mémoire — la
    // valeur précédente produisait un échec « Timed out waiting from config.webServer »
    // intermittent, sans aucun rapport avec le code testé. 180 s laisse de la marge sans rien
    // dissimuler : un serveur qui ne démarre pas échoue toujours.
    timeout: 180_000,
    env: envServeurE2E(),
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
