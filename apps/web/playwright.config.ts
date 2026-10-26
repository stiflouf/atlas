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
  // 60s (pas 30s) : premier passage sur chaque route compilé à la volée par `next dev --turbopack`
  // (aucun build de production préalable pour un smoke — voir webServer ci-dessous), plus lent que
  // le budget par défaut de Playwright.
  timeout: 60_000,
  use: {
    baseURL: BASE_URL_E2E,
    trace: "retain-on-failure",
    // Sessions Claude Code Cloud : le CDN Playwright est inaccessible, le hook SessionStart désigne
    // le Chromium préinstallé du conteneur (.claude/hooks/session-start.sh). Variable absente :
    // comportement standard inchangé (navigateur téléchargé par `playwright install`).
    ...(process.env.ATLAS_E2E_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.ATLAS_E2E_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    command: "npx next dev --turbopack -p " + PORT_E2E,
    url: BASE_URL_E2E,
    reuseExistingServer: false,
    timeout: 60_000,
    env: envServeurE2E(),
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
