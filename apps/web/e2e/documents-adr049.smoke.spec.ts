// Smoke E2E 2/2 (audit V1 Candidate) — ferme la validation navigateur ADR-049 jamais faite jusqu'ici
// (upload document → Pack Notaire → téléchargement ZIP → enregistrement de transmission →
// historique → manifeste). Bien/Acquéreur/Compromis préalables créés directement via les
// repositories (déjà prouvés par coeur.smoke.spec.ts) — ce smoke ne re-teste que le périmètre
// documentaire, jamais Railway ni Google (stockage temporaire local, voir e2e/env.ts).
import { test, expect } from "@playwright/test";
import { injecterSessionAtlasValide } from "./session";
import { nettoyerDonneesE2E } from "./nettoyage";
import { creerBien } from "../src/lib/bienRepository";
import { creerAcquereur } from "../src/lib/clientRepository";
import { enregistrerCompromis } from "../src/lib/compromisRepository";

const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const prefixe = `[E2E:${runId}]`;
const nomDocument = `${prefixe} Diagnostic smoke`;

let bienId: string;
let acquereurId: string;

test.beforeAll(async () => {
  const bien = await creerBien({
    reference: `${prefixe} REF-DOC`,
    titre: `${prefixe} Bien documents`,
    type: "appartement",
    adresse: "1 rue du Manifeste",
    ville: "Testville",
    codePostal: "75000",
    surface: 40,
    pieces: 2,
    prix: 250000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  bienId = bien.id;

  const acquereur = await creerAcquereur({
    prenom: "E2E",
    nom: `${prefixe} Acquéreur documents`,
    email: `e2e-doc-${runId}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 300000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  acquereurId = acquereur.id;

  await enregistrerCompromis({
    bienId,
    acquereurId,
    prixConvenu: 245000,
    dateSignature: "2026-06-01",
  });
});

test.afterAll(async () => {
  await nettoyerDonneesE2E({ bienId, acquereurId });
});

test("Pack Notaire ADR-049 : upload, téléchargement ZIP, transmission, historique, manifeste", async ({ page, context, baseURL }) => {
  await injecterSessionAtlasValide(context, baseURL!);

  // 1. Upload d'un document réel via le vrai formulaire (multipart, Server Action réelle).
  await page.goto(`/biens/${bienId}`);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  const champFichier = page.locator('[name="fichier"]');
  await page.locator('[name="nom"]').fill(nomDocument);
  await champFichier.setInputFiles({
    name: "diagnostic-smoke.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 contenu de test E2E, jamais un vrai diagnostic.", "utf-8"),
  });
  await page.getByRole("button", { name: "Ajouter le document" }).click();
  // ajouterDocumentBienAction se termine par redirect() vers la MÊME URL (/biens/{bienId}) :
  // waitForURL serait un no-op (déjà vraie avant le submit). On attend la disparition réelle du
  // champ fichier (démontage du formulaire par le rechargement) plutôt qu'une correspondance
  // d'URL non discriminante — l'onglet actif (useState client, sans état d'URL) retombe alors sur
  // "Contexte" par défaut, d'où le reclic.
  await champFichier.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(page.getByText(nomDocument)).toBeVisible();

  // 2. Pack Notaire : téléchargement ZIP réel (form POST natif → événement download navigateur).
  // Document non classé (aucun typeDocument) : proposé dans "disponibles pour ajout manuel", pas
  // pré-coché automatiquement — sélection explicite requise (jamais 0 document envoyé au ZIP).
  await page.goto(`/biens/${bienId}/pack-notaire`);
  // Le même document apparaît dans DEUX listes de cases à cocher distinctes sur cette page (le
  // formulaire de téléchargement ZIP, rendu en premier dans le DOM, puis la sélection propre au
  // formulaire de transmission ci-dessous) — .first()/.last() plutôt qu'un sélecteur ambigu.
  const casesDocument = page.locator("label", { hasText: nomDocument }).locator('input[type="checkbox"]');
  await casesDocument.first().check();
  const [telechargement] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Télécharger le pack (ZIP)" }).click(),
  ]);
  expect(telechargement.suggestedFilename()).toMatch(/\.zip$/i);

  // 3. Enregistrement d'une transmission (déclaration, ADR-049 — jamais un envoi de fichier).
  // Document non proposé automatiquement (non classé) : sélection explicite requise ici aussi,
  // sinon "Enregistrer la transmission" reste desactivé (0 document sélectionné).
  await casesDocument.last().check();
  const etude1 = `${prefixe} Étude Un`;
  await page.getByLabel("Étude notariale").fill(etude1);
  await page.getByLabel("Interlocuteur (optionnel)").fill("Maître Test");
  await page.getByRole("button", { name: "Enregistrer la transmission" }).click();
  await expect(page.getByText("Confirmer l'enregistrement de cette transmission ?")).toBeVisible();
  await page.getByRole("button", { name: "Je confirme avoir transmis cette sélection à l'étude indiquée" }).click();
  await expect(page.getByText("Transmission enregistrée dans le suivi du dossier.")).toBeVisible();

  // 4. Historique + manifeste (sur la fiche Bien, onglet Compromis — ADR-049).
  await page.goto(`/biens/${bienId}`);
  await page.getByRole("button", { name: "Compromis", exact: true }).click();
  await expect(page.getByText("Transmissions notariales")).toBeVisible();
  await expect(page.getByText(etude1)).toBeVisible();
  await page.getByText("Voir le manifeste transmis").first().click();
  await expect(page.getByText(`Acquéreur enregistré : E2E ${prefixe} Acquéreur documents`)).toBeVisible();

  // 5. Deuxième transmission — T1 et T2 coexistent séparément (jamais un remplacement). Un rechar-
  // gement de la page est nécessaire : après succès, EcranConfirmationTransmission reste affiché
  // (pas de retour au formulaire dans l'UI), le composant ne se remonte que par une navigation
  // fraîche — même contrainte que le reclic d'onglet plus haut (état client, jamais d'état d'URL).
  const etude2 = `${prefixe} Étude Deux`;
  await page.goto(`/biens/${bienId}/pack-notaire`);
  await page.locator("label", { hasText: nomDocument }).locator('input[type="checkbox"]').last().check();
  await page.getByLabel("Étude notariale").fill(etude2);
  await page.getByRole("button", { name: "Enregistrer la transmission" }).click();
  await page.getByRole("button", { name: "Je confirme avoir transmis cette sélection à l'étude indiquée" }).click();
  await expect(page.getByText("Transmission enregistrée dans le suivi du dossier.")).toBeVisible();

  await page.goto(`/biens/${bienId}`);
  await page.getByRole("button", { name: "Compromis", exact: true }).click();
  await expect(page.getByText(etude1)).toBeVisible();
  await expect(page.getByText(etude2)).toBeVisible();
});
