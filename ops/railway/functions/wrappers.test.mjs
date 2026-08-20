// Tests ciblés des wrappers Railway Functions (bugfix pilote — configuration des crons).
// Runner natif Node (node --test), zéro dépendance ajoutée : chaque wrapper est lancé comme un
// VRAI sous-processus (via tsx, déjà présent dans apps/web/node_modules) contre un petit serveur
// HTTP local — le seul moyen sûr de vérifier `process.exit()` sans jamais tuer ce runner de test
// (les wrappers sont des scripts top-level, pas des fonctions exportées : les importer directement
// exécuterait process.exit() dans CE process).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSX = path.join(__dirname, "..", "..", "..", "apps", "web", "node_modules", ".bin", "tsx");

function demarrerServeurMock(gestionnaire) {
  return new Promise((resolve) => {
    const serveur = createServer((req, res) => {
      let corps = "";
      req.on("data", (c) => (corps += c));
      req.on("end", () => {
        const { status, body } = gestionnaire(req, corps);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    serveur.listen(0, "127.0.0.1", () => resolve(serveur));
  });
}

// `child_process.spawnSync` reste bloqué indéfiniment dès que l'enfant utilise `fetch` dans cet
// environnement (constaté empiriquement — reproductible même sans tsx, avec un script Node natif
// minimal) : la variante asynchrone `spawn` n'a pas ce problème et est utilisée ici à la place.
function lancerWrapper(fichier, env) {
  return new Promise((resolve) => {
    const enfant = spawn(TSX, [path.join(__dirname, fichier)], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    enfant.stdout.on("data", (d) => (stdout += d));
    enfant.stderr.on("data", (d) => (stderr += d));
    const minuteur = setTimeout(() => enfant.kill("SIGKILL"), 10_000);
    enfant.on("close", (code) => {
      clearTimeout(minuteur);
      resolve({ status: code, stdout, stderr });
    });
  });
}

const WRAPPERS = [
  { fichier: "automatisations-scan.ts", endpoint: "/api/automatisations/scan" },
  { fichier: "automatisations-reprise.ts", endpoint: "/api/automatisations/reprise" },
  { fichier: "compatibilite-scan.ts", endpoint: "/api/compatibilite/scan" },
];

for (const { fichier, endpoint } of WRAPPERS) {
  test(`${fichier} : succès HTTP 200 -> exit 0, POST vers ${endpoint}, Bearer correct, secret jamais loggé`, async () => {
    let requeteRecue;
    const serveur = await demarrerServeurMock((req) => {
      requeteRecue = { path: req.url, methode: req.method, auth: req.headers.authorization };
      return { status: 200, body: { ok: true } };
    });
    const port = serveur.address().port;
    const secret = `secret-test-${fichier}-ne-doit-jamais-apparaitre`;
    const resultat = await lancerWrapper(fichier, {
      DOMIORA_BASE_URL: `http://127.0.0.1:${port}`,
      JOB_SECRET: secret,
    });
    serveur.close();

    assert.equal(resultat.status, 0, `stderr: ${resultat.stderr}`);
    assert.equal(requeteRecue.path, endpoint);
    assert.equal(requeteRecue.methode, "POST");
    assert.equal(requeteRecue.auth, `Bearer ${secret}`);
    assert.ok(!resultat.stdout.includes(secret), "le secret ne doit jamais apparaître dans stdout");
    assert.ok(!resultat.stderr.includes(secret), "le secret ne doit jamais apparaître dans stderr");
    assert.match(resultat.stdout, /status=200/);
  });

  test(`${fichier} : échec HTTP 401 -> exit non-zéro, secret jamais loggé`, async () => {
    const serveur = await demarrerServeurMock(() => ({ status: 401, body: { erreur: "Non autorisé." } }));
    const port = serveur.address().port;
    const secret = `secret-test-401-${fichier}`;
    const resultat = await lancerWrapper(fichier, {
      DOMIORA_BASE_URL: `http://127.0.0.1:${port}`,
      JOB_SECRET: secret,
    });
    serveur.close();

    assert.notEqual(resultat.status, 0);
    assert.ok(!resultat.stdout.includes(secret));
    assert.ok(!resultat.stderr.includes(secret));
  });

  test(`${fichier} : échec HTTP 500 -> exit non-zéro`, async () => {
    const serveur = await demarrerServeurMock(() => ({ status: 500, body: { erreur: "boom" } }));
    const port = serveur.address().port;
    const resultat = await lancerWrapper(fichier, {
      DOMIORA_BASE_URL: `http://127.0.0.1:${port}`,
      JOB_SECRET: "secret-test-500",
    });
    serveur.close();

    assert.notEqual(resultat.status, 0);
  });

  test(`${fichier} : DOMIORA_BASE_URL absent -> exit non-zéro, aucun appel réseau`, async () => {
    const resultat = await lancerWrapper(fichier, { DOMIORA_BASE_URL: "", JOB_SECRET: "peu-importe" });
    assert.notEqual(resultat.status, 0);
    assert.match(resultat.stderr, /DOMIORA_BASE_URL/);
  });

  test(`${fichier} : JOB_SECRET absent -> exit non-zéro, aucun appel réseau`, async () => {
    const resultat = await lancerWrapper(fichier, { DOMIORA_BASE_URL: "http://127.0.0.1:1", JOB_SECRET: "" });
    assert.notEqual(resultat.status, 0);
    assert.match(resultat.stderr, /JOB_SECRET/);
  });
}
