// Smoke E2E 3/3 — PILOT_VISIT_SIGNATURE_E2E_V1.
//
// Ce que ce test prouve, et qu'aucun test Vitest ne pouvait prouver : que le parcours
// visite → bon de visite → SIGNATURE MANUSCRITE → validation serveur → PDF → stockage → hash →
// téléchargement fonctionne dans un vrai navigateur, avec de vrais événements de pointeur et de
// TOUCHER. Le geste le plus critique du produit reposait sur un canvas client (`setPointerCapture`,
// `toDataURL`) qui n'avait jamais été exercé ailleurs que dans jsdom et sur des buffers serveur :
// l'audit commercial classait donc `SIGNED_VISIT_FORM = PARTIAL` pour cette seule raison.
//
// Règles tenues ici :
//   - aucun repository appelé pour FAIRE avancer le parcours ; la base n'est lue que pour VÉRIFIER
//     ce que le navigateur a produit (et pour le nettoyage) ;
//   - la navigation suit les vrais liens de l'interface (onglet Visites du bien → « Planifier une
//     visite » → fiche visite → « Créer le bon de visite » → « Ouvrir / faire signer »), jamais une
//     URL devinée : c'est ce qui prouve l'ACCESSIBILITÉ du parcours, pas seulement son câblage ;
//   - aucune data URL de signature n'est injectée dans le formulaire — le canvas est réellement
//     tracé, et c'est lui qui remplit le champ caché ;
//   - aucune donnée personnelle ni contenu de document n'est journalisé.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { injecterSessionAtlasValide } from "./session";
import { nettoyerDonneesE2E } from "./nettoyage";
import { getDb } from "../src/db/client";
import { acquereurs, bonsVisite, documentsBien, signaturesBonVisite, visites } from "../src/db/schema";

type Cibles = { bienId?: string; acquereurId?: string };

const cibles: Cibles[] = [];

test.afterAll(async () => {
  for (const cible of cibles) {
    await nettoyerDonneesE2E(cible);
  }
});

// ─────────────────────────── Tracé réel de la signature ───────────────────────────

// Trois points suffisent : le canvas n'enregistre un trait que si au moins un `pointermove`
// survient entre `pointerdown` et `pointerup` (SignatureCanvas.aDessineRef), et le champ caché
// n'est rempli qu'au relâchement. Un tracé en diagonale garantit des pixels opaques, donc une image
// que la validation serveur (canal alpha, sharp) acceptera.
function pointsDuTrace(boite: { x: number; y: number; width: number; height: number }) {
  return [
    { x: boite.x + boite.width * 0.2, y: boite.y + boite.height * 0.7 },
    { x: boite.x + boite.width * 0.45, y: boite.y + boite.height * 0.3 },
    { x: boite.x + boite.width * 0.7, y: boite.y + boite.height * 0.65 },
    { x: boite.x + boite.width * 0.85, y: boite.y + boite.height * 0.35 },
  ];
}

// Souris : `page.mouse` émet de vrais événements d'entrée au niveau du navigateur, que Chromium
// traduit en `pointerdown/pointermove/pointerup` avec `pointerType: "mouse"` — jamais un
// `dispatchEvent` DOM fabriqué côté test.
async function signerALaSouris(page: Page, boite: { x: number; y: number; width: number; height: number }) {
  const points = pointsDuTrace(boite);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 8 });
  }
  await page.mouse.up();
}

// TOUCHER : `page.touchscreen` ne sait que taper, pas glisser. On passe donc par CDP
// `Input.dispatchTouchEvent`, qui injecte l'événement au niveau de l'entrée du navigateur — et dont
// Chromium dérive des `pointer*` avec `pointerType: "touch"`. C'est le seul moyen d'exercer
// réellement le chemin tactile, celui qu'un conseiller utilisera sur tablette.
async function signerAuDoigt(
  context: BrowserContext,
  page: Page,
  boite: { x: number; y: number; width: number; height: number }
) {
  const cdp = await context.newCDPSession(page);
  const points = pointsDuTrace(boite);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: points[0].x, y: points[0].y }],
  });
  for (const point of points.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x, y: point.y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

// ─────────────────────────── Parcours commun ───────────────────────────

async function deroulerParcours(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  modeSignature: "souris" | "doigt"
) {
  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const prefixe = `[E2E:${runId}]`;
  const cible: Cibles = {};
  cibles.push(cible);

  // 1. Le parcours est réellement privé : sans session, la fiche visite est inatteignable.
  await page.goto("/");
  await expect(page).toHaveURL(/\/connexion$/);

  await injecterSessionAtlasValide(context, baseURL);

  // 2. Bien de test, via le vrai formulaire.
  await page.goto("/biens/nouveau");
  await page.locator('[name="reference"]').fill(`${prefixe} REF-SIG`);
  await page.locator('[name="titre"]').fill(`${prefixe} Bien signature`);
  await page.locator('[name="adresse"]').fill("8 rue de la Signature");
  await page.locator('[name="ville"]').fill("Testville");
  await page.locator('[name="codePostal"]').fill("75000");
  await page.locator('[name="surface"]').fill("62");
  await page.locator('[name="pieces"]').fill("3");
  await page.locator('[name="prix"]').fill("295000");
  await page.locator('[name="dateMandat"]').fill("2026-01-01");
  // `typeMandat` est obligatoire depuis ADR-060 : sans lui l'action refuse proprement et aucune
  // navigation n'a lieu. C'est précisément ce qui faisait échouer les deux smoke existants, écrits
  // avant cette exigence et jamais rejoués (aucune CI).
  await page.locator('select[name="typeMandat"]').selectOption("simple");
  await page.getByRole("button", { name: "Créer le bien" }).click();
  await page.waitForURL(/\/biens\/[0-9a-f-]{36}(\?.*)?$/);
  const bienId = page.url().split("/biens/")[1].split("?")[0];
  cible.bienId = bienId;

  // 3. Acquéreur de test, via le vrai formulaire.
  const nomAcquereur = `${prefixe} Acquereur signature`;
  await page.goto("/clients/nouveau");
  await page.locator('[name="prenom"]').fill("Tactile");
  await page.locator('[name="nom"]').fill(nomAcquereur);
  await page.locator('[name="email"]').fill(`e2e-sig-${runId}@example.com`);
  await page.locator('[name="telephone"]').fill("0600000000");
  await page.locator('[name="budgetMin"]').fill("200000");
  await page.locator('[name="budgetMax"]').fill("400000");
  await page.locator('[name="datePremiereContact"]').fill("2026-01-01");
  await page.getByRole("button", { name: "Créer l'acquéreur" }).click();
  await page.waitForURL(/\/clients$/);
  const db = getDb();
  const [ligneAcquereur] = await db
    .select({ id: acquereurs.id })
    .from(acquereurs)
    .where(eq(acquereurs.nom, nomAcquereur));
  expect(ligneAcquereur?.id).toBeTruthy();
  cible.acquereurId = ligneAcquereur.id;

  // 4. ACCESSIBILITÉ : on atteint la planification en CLIQUANT les liens réels de la fiche bien,
  // jamais en tapant /visites/nouvelle. Si un futur lot cassait ce chemin, ce test échouerait ici.
  await page.goto(`/biens/${bienId}`);
  await page.getByRole("tab", { name: "Visites", exact: true }).click();
  // `exact: true` : l'onglet Visites porte TROIS liens dont le nom commence ainsi (le CTA
  // principal, celui de l'état vide « Planifier une visite → », et celui de la carte des acquéreurs
  // compatibles). Sans exactitude, Playwright refuse en mode strict — et c'est tant mieux : viser
  // le CTA principal doit être explicite.
  await page.getByRole("link", { name: "Planifier une visite", exact: true }).click();
  await page.waitForURL(/\/visites\/nouvelle\?/);

  // 5. Planifier la visite : le bien est figé (on vient de sa fiche), l'acquéreur se choisit.
  // Sélection par VALEUR (l'id de l'acquéreur) et non par libellé : le libellé des options est
  // construit par l'identité effective (ADR-057), le reconstruire côté test en dupliquerait la
  // règle et casserait au premier changement de présentation. C'est la même opération DOM que
  // celle d'un utilisateur qui choisit dans la liste.
  await page.locator('select[name="acquereurId"]').selectOption(cible.acquereurId!);
  await page.getByRole("button", { name: "Planifier la visite" }).click();
  await page.waitForURL(/\/visites\/[0-9a-f-]{36}(\?.*)?$/);
  const visiteId = page.url().split("/visites/")[1].split("?")[0];

  // 6. Créer le bon de visite depuis la fiche visite (brouillon, ADR-063).
  await page.getByRole("button", { name: "Créer le bon de visite" }).click();
  await page.waitForURL(new RegExp(`/visites/${visiteId}/bon-de-visite/[0-9a-f-]{36}$`));
  const bonVisiteId = page.url().split("/bon-de-visite/")[1];

  // 7. Le canvas est réellement rendu, et le bouton est verrouillé AVANT tout tracé : les deux
  // gardes clientes (signature vide, consentement non coché) sont observées, pas supposées.
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const boutonSigner = page.getByRole("button", { name: "Signer le bon de visite" });
  await expect(boutonSigner).toBeDisabled();

  await page.locator('[name="nomSignataire"]').fill("Acquereur Test");
  const consentement = page.locator('input[name="consentement"]');
  await consentement.check();
  // Consentement coché mais signature encore vide → toujours refusé côté client.
  await expect(boutonSigner).toBeDisabled();

  // 8. SIGNATURE RÉELLE sur le canvas.
  const boite = await canvas.boundingBox();
  expect(boite).toBeTruthy();
  if (modeSignature === "doigt") {
    await signerAuDoigt(context, page, boite!);
  } else {
    await signerALaSouris(page, boite!);
  }

  // Le champ caché est rempli par le canvas lui-même — jamais par le test. On vérifie seulement
  // qu'il porte bien un PNG encodé (le préfixe, jamais la valeur, qui est une donnée personnelle).
  const prefixeImage = await page
    .locator('input[name="signatureImage"]')
    .evaluate((element) => (element as HTMLInputElement).value.slice(0, 22));
  expect(prefixeImage).toBe("data:image/png;base64,");

  // Le tracé a bien levé la garde cliente.
  await expect(boutonSigner).toBeEnabled();

  // 9. Soumission → validation serveur → PDF → stockage → retour sur la fiche visite.
  await boutonSigner.click();
  await page.waitForURL(new RegExp(`/visites/${visiteId}(\\?.*)?$`));
  // Un refus serveur reviendrait sur la page de signature avec ?erreur=… : être ici prouve que la
  // validation (préfixe, décodage sharp, canal alpha non vide) a réellement accepté l'image.
  await expect(page).not.toHaveURL(/erreur=/);
  await expect(page.getByText("Signé", { exact: true })).toBeVisible();

  return { bienId, visiteId, bonVisiteId, db };
}

// ─────────────────────────── Vérifications d'état ───────────────────────────

async function verifierPersistance(bonVisiteId: string) {
  const db = getDb();

  const [bon] = await db.select().from(bonsVisite).where(eq(bonsVisite.id, bonVisiteId));
  expect(bon).toBeTruthy();
  expect(bon.statut).toBe("signe");
  expect(bon.signeLe).toBeTruthy();
  expect(bon.documentId).toBeTruthy();
  expect(bon.hashDocument).toMatch(/^[0-9a-f]{64}$/);

  // Exactement UNE signature et UN document : c'est l'invariant qu'une double soumission
  // violerait. La course réellement concurrente est couverte par un test dédié
  // (bonVisiteRepository.test.ts) ; ici on vérifie le résultat observable du parcours.
  const signatures = await db
    .select({ id: signaturesBonVisite.id, provider: signaturesBonVisite.provider })
    .from(signaturesBonVisite)
    .where(eq(signaturesBonVisite.bonVisiteId, bonVisiteId));
  expect(signatures).toHaveLength(1);
  expect(signatures[0].provider).toBe("domiora");

  const [document] = await db
    .select({ typeMime: documentsBien.typeMime, tailleOctets: documentsBien.tailleOctets })
    .from(documentsBien)
    .where(eq(documentsBien.id, bon.documentId!));
  expect(document).toBeTruthy();
  expect(document.typeMime).toBe("application/pdf");
  expect(document.tailleOctets).toBeGreaterThan(0);

  return { hashDocument: bon.hashDocument!, tailleOctets: document.tailleOctets };
}

// ─────────────────────────── Scénarios ───────────────────────────

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("visite → bon → signature souris → PDF → hash → téléchargement", async ({ page, context, baseURL }) => {
    const { visiteId, bonVisiteId } = await deroulerParcours(page, context, baseURL!, "souris");
    const { hashDocument, tailleOctets } = await verifierPersistance(bonVisiteId);

    // 10. Téléchargement par le vrai lien de l'interface (route dédiée workspace-safe).
    const [telechargement] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Télécharger le document signé" }).click(),
    ]);
    expect(telechargement.suggestedFilename()).toMatch(/^bon-visite-.*\.pdf$/);
    const chemin = await telechargement.path();
    expect(chemin).toBeTruthy();
    const octets = await readFile(chemin!);

    // PDF réel : signature de fichier, taille cohérente avec la ligne en base.
    expect(octets.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(octets.byteLength).toBe(tailleOctets);

    // 11. LE point du lot : le fichier réellement servi est bit pour bit celui dont l'empreinte a
    // été scellée en base au moment de la signature.
    const sha = createHash("sha256").update(octets).digest("hex");
    expect(sha).toBe(hashDocument);

    // 12. Relecture : second téléchargement par la même route protégée, octets identiques. Le 200
    // prouve aussi la persistance PHYSIQUE — la route lit le fichier sur disque via
    // `lireDocument(cleStockage)`, un 404 serait renvoyé si le fichier manquait.
    const relecture = await page.request.get(`/api/bons-visite/${bonVisiteId}/document`);
    expect(relecture.status()).toBe(200);
    expect(relecture.headers()["content-type"]).toBe("application/pdf");
    const shaRelecture = createHash("sha256").update(await relecture.body()).digest("hex");
    expect(shaRelecture).toBe(hashDocument);

    // 13. La garde d'autorisation tient : un contexte SANS session n'obtient aucun octet, et un id
    // de bon inexistant est indiscernable d'un bon hors périmètre (404, jamais 403).
    const anonyme = await context.browser()!.newContext();
    const reponseAnonyme = await anonyme.request.get(`${baseURL}/api/bons-visite/${bonVisiteId}/document`);
    expect(reponseAnonyme.status()).toBe(401);
    await anonyme.close();

    const inexistant = await page.request.get("/api/bons-visite/00000000-0000-0000-0000-000000000000/document");
    expect(inexistant.status()).toBe(404);

    // 14. Immuabilité observable : la page de signature n'offre plus de formulaire, et la visite
    // reste cohérente (le bon ne dépend ni du statut de la visite ni d'un compte rendu).
    await page.goto(`/visites/${visiteId}/bon-de-visite/${bonVisiteId}`);
    await expect(page.getByRole("button", { name: "Signer le bon de visite" })).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Télécharger le document signé" })).toBeVisible();

    const [visite] = await getDb().select({ statut: visites.statut }).from(visites).where(eq(visites.id, visiteId));
    expect(visite.statut).toBe("planifiee");
  });
});

test.describe("tablette tactile", () => {
  // Viewport et entrée d'une tablette réelle : c'est le contexte d'usage du bon de visite — un
  // conseiller fait signer sur place, au doigt, jamais à la souris.
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  test("visite → bon → signature au doigt → PDF → hash", async ({ page, context, baseURL }) => {
    const { bonVisiteId } = await deroulerParcours(page, context, baseURL!, "doigt");
    const { hashDocument, tailleOctets } = await verifierPersistance(bonVisiteId);

    const [telechargement] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Télécharger le document signé" }).click(),
    ]);
    const octets = await readFile((await telechargement.path())!);
    expect(octets.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(octets.byteLength).toBe(tailleOctets);
    expect(createHash("sha256").update(octets).digest("hex")).toBe(hashDocument);
  });
});

// ─────────────────────────── Refus propres ───────────────────────────

test.describe("refus", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("un brouillon annulé ne peut plus être signé, et la session reste exigée", async ({
    page,
    context,
    baseURL,
  }) => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const prefixe = `[E2E:${runId}]`;
    const cible: Cibles = {};
    cibles.push(cible);

    await injecterSessionAtlasValide(context, baseURL!);

    await page.goto("/biens/nouveau");
    await page.locator('[name="reference"]').fill(`${prefixe} REF-REFUS`);
    await page.locator('[name="titre"]').fill(`${prefixe} Bien refus`);
    await page.locator('[name="adresse"]').fill("1 rue du Refus");
    await page.locator('[name="ville"]').fill("Testville");
    await page.locator('[name="codePostal"]').fill("75000");
    await page.locator('[name="surface"]').fill("40");
    await page.locator('[name="pieces"]').fill("2");
    await page.locator('[name="prix"]').fill("150000");
    await page.locator('[name="dateMandat"]').fill("2026-01-01");
    await page.locator('select[name="typeMandat"]').selectOption("simple");
    await page.getByRole("button", { name: "Créer le bien" }).click();
    await page.waitForURL(/\/biens\/[0-9a-f-]{36}(\?.*)?$/);
    cible.bienId = page.url().split("/biens/")[1].split("?")[0];

    const nomAcquereur = `${prefixe} Acquereur refus`;
    await page.goto("/clients/nouveau");
    await page.locator('[name="prenom"]').fill("Refus");
    await page.locator('[name="nom"]').fill(nomAcquereur);
    await page.locator('[name="email"]').fill(`e2e-refus-${runId}@example.com`);
    await page.locator('[name="telephone"]').fill("0600000000");
    await page.locator('[name="budgetMin"]').fill("100000");
    await page.locator('[name="budgetMax"]').fill("200000");
    await page.locator('[name="datePremiereContact"]').fill("2026-01-01");
    await page.getByRole("button", { name: "Créer l'acquéreur" }).click();
    await page.waitForURL(/\/clients$/);
    const [ligneAcquereur] = await getDb()
      .select({ id: acquereurs.id })
      .from(acquereurs)
      .where(eq(acquereurs.nom, nomAcquereur));
    cible.acquereurId = ligneAcquereur.id;

    await page.goto(`/visites/nouvelle?bienId=${cible.bienId}&retour=bien`);
    await page.locator('select[name="acquereurId"]').selectOption(cible.acquereurId!);
    await page.getByRole("button", { name: "Planifier la visite" }).click();
    await page.waitForURL(/\/visites\/[0-9a-f-]{36}(\?.*)?$/);
    const visiteId = page.url().split("/visites/")[1].split("?")[0];

    await page.getByRole("button", { name: "Créer le bon de visite" }).click();
    await page.waitForURL(new RegExp(`/visites/${visiteId}/bon-de-visite/[0-9a-f-]{36}$`));
    const bonVisiteId = page.url().split("/bon-de-visite/")[1];

    // Annulation du brouillon par le vrai geste de l'interface.
    await page.getByRole("button", { name: "Annuler ce brouillon" }).click();
    await page.waitForURL(new RegExp(`/visites/${visiteId}$`));

    // La page de signature n'offre plus ni canvas ni bouton : un bon annulé est définitivement
    // non signable, et aucun document n'a été produit.
    await page.goto(`/visites/${visiteId}/bon-de-visite/${bonVisiteId}`);
    await expect(page.getByText("Ce brouillon a été annulé.")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Signer le bon de visite" })).toHaveCount(0);

    const [bon] = await getDb()
      .select({ statut: bonsVisite.statut, documentId: bonsVisite.documentId, hash: bonsVisite.hashDocument })
      .from(bonsVisite)
      .where(and(eq(bonsVisite.id, bonVisiteId), eq(bonsVisite.visiteId, visiteId)));
    expect(bon.statut).toBe("annule");
    expect(bon.documentId).toBeNull();
    expect(bon.hash).toBeNull();

    // Aucun document téléchargeable pour un bon non signé.
    const reponse = await page.request.get(`/api/bons-visite/${bonVisiteId}/document`);
    expect(reponse.status()).toBe(404);
  });
});
