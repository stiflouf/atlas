// Smoke E2E 1/2 (audit V1 Candidate) — prouve le câblage réel : Navigateur → Proxy → session →
// SSR → formulaire → Server Action → Postgres → navigation → rendu. Ne recouvre PAS le matching,
// Calendar, Gmail, la rémunération ni les automatisations — déjà largement couverts par les 1189
// tests Vitest (voir vitest.config.ts). Données préfixées [E2E:<runId>], jamais un nom générique.
import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { injecterSessionAtlasValide } from "./session";
import { nettoyerDonneesE2E } from "./nettoyage";
import { getDb } from "../src/db/client";
import { acquereurs } from "../src/db/schema";

const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const prefixe = `[E2E:${runId}]`;

let bienId: string | undefined;
let acquereurId: string | undefined;

test.afterAll(async () => {
  await nettoyerDonneesE2E({ bienId, acquereurId });
});

test("tunnel cœur Atlas : session, Bien, Acquéreur, Compromis, déconnexion", async ({ page, context, baseURL }) => {
  // 1. Page privée sans session → redirection /connexion (le Proxy protège réellement, jamais un
  // simple contournement côté test).
  await page.goto("/");
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByText("Se connecter avec Google")).toBeVisible();

  // 2. Session Atlas réellement scellée (iron-session, mêmes primitives que sessionAtlas.ts),
  // jamais NODE_ENV=test ni route de contournement.
  await injecterSessionAtlasValide(context, baseURL!);

  // 3. Cockpit accessible avec la session injectée. `exact: true` — sans lui, ce nom correspond
  // aussi (sous-chaîne) au titre de section "Aucun rendez-vous restant aujourd'hui", visible dès
  // que les rendez-vous mockés du jour sont vides (dérive naturelle de la date courante face aux
  // données de démonstration statiques) : ambiguïté déjà latente, sans lien avec cette passe.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Aujourd'hui", exact: true })).toBeVisible();

  // 4. Créer un Bien via le vrai formulaire (Server Action réelle).
  await page.goto("/biens/nouveau");
  await page.locator('[name="reference"]').fill(`${prefixe} REF`);
  await page.locator('[name="titre"]').fill(`${prefixe} Bien smoke`);
  await page.locator('[name="adresse"]').fill("12 rue de la Preuve");
  await page.locator('[name="ville"]').fill("Testville");
  await page.locator('[name="codePostal"]').fill("75000");
  await page.locator('[name="surface"]').fill("55");
  await page.locator('[name="pieces"]').fill("3");
  await page.locator('[name="prix"]').fill("333333");
  await page.locator('[name="dateMandat"]').fill("2026-01-01");
  await page.getByRole("button", { name: "Créer le bien" }).click();
  await page.waitForURL(/\/biens\/[0-9a-f-]{36}$/);
  bienId = page.url().split("/biens/")[1];
  await expect(page.getByText(`Réf. ${prefixe} REF`)).toBeVisible();

  // 5. Créer un Acquéreur via le vrai formulaire.
  const nomAcquereur = `${prefixe} Acquéreur smoke`;
  await page.goto("/clients/nouveau");
  await page.locator('[name="prenom"]').fill("E2E");
  await page.locator('[name="nom"]').fill(nomAcquereur);
  await page.locator('[name="email"]').fill(`e2e-${runId}@example.com`);
  await page.locator('[name="telephone"]').fill("0600000000");
  await page.locator('[name="budgetMin"]').fill("200000");
  await page.locator('[name="budgetMax"]').fill("400000");
  await page.locator('[name="datePremiereContact"]').fill("2026-01-01");
  await page.getByRole("button", { name: "Créer l'acquéreur" }).click();
  await page.waitForURL(/\/clients$/);
  await expect(page.getByText(nomAcquereur)).toBeVisible();
  const db = getDb();
  const [ligneAcquereur] = await db.select({ id: acquereurs.id }).from(acquereurs).where(eq(acquereurs.nom, nomAcquereur));
  acquereurId = ligneAcquereur?.id;
  expect(acquereurId).toBeTruthy();

  // 6. Créer un Compromis reliant Bien et Acquéreur (parcours libre, verrouille=false — ADR-045).
  await page.goto(`/compromis/nouveau?bienId=${bienId}`);
  await page.locator('select[name="acquereurId"]').selectOption({ label: `E2E ${nomAcquereur}` });
  await page.locator('[name="prixConvenu"]').fill("330000");
  await page.locator('[name="dateSignature"]').fill("2026-06-01");
  await page.getByRole("button", { name: "Ajouter le compromis" }).click();
  await page.waitForURL(new RegExp(`/biens/${bienId}$`));

  // 7. Le Compromis apparaît bien sur la fiche du Bien (onglet Compromis).
  await page.getByRole("tab", { name: "Compromis", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Compromis" }).getByText(nomAcquereur)).toBeVisible();

  // 8. Déconnexion réelle (route POST existante, jamais un simple oubli du cookie côté test) →
  // une page privée redemande /connexion, prouvant que la session est bien vérifiée à chaque
  // requête, pas seulement mémorisée côté client.
  await page.request.post("/api/auth/atlas/logout");
  await page.goto("/");
  await expect(page).toHaveURL(/\/connexion$/);
});
