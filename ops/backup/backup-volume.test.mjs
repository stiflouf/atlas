// Tests ciblés de `backup-volume.sh` — en particulier le cas du VOLUME VIDE, qui faisait échouer
// la sauvegarde alors que le script prévoyait explicitement de le tolérer (défaut constaté lors du
// provisionnement de la première instance pilote).
//
// Runner natif Node (`node --test`), zéro dépendance ajoutée : même choix que
// `ops/railway/functions/wrappers.test.mjs`. Le script est lancé comme un VRAI sous-processus, avec
// un stub `railway` placé en tête de PATH — c'est le seul moyen d'exercer le script réel, son
// transfert base64 et sa vérification d'empreinte de bout en bout, sans toucher à une instance.
//
// Ce que le stub reproduit fidèlement :
//   - `railway status --json` rend le nom du projet attendu, pour que `prouver_cible` passe ;
//   - `railway ssh … -- sh -c <script>` exécute le script localement, avec
//     ATLAS_DOCUMENT_STORAGE_DIR pointant vers un faux volume. Les deux canaux du script réel sont
//     donc respectés : empreinte sur stderr, charge base64 sur stdout.
//
// Aucun fichier de ce test ne ressemble à une donnée métier : des octets quelconques sous des noms
// opaques, exactement comme les clés de stockage UUID produites par l'application.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(ICI, "backup-volume.sh");
const PROJET = "domiora-essai-sauvegarde";

// Le stub est écrit en Node plutôt qu'en shell : il doit distinguer `status` de `ssh` et retrouver
// le script après `--`, ce qu'un wrapper shell ferait moins lisiblement.
const STUB = `#!/usr/bin/env node
// CommonJS volontairement : un fichier sans extension est chargé comme CJS par Node, et un
// \`import\` y échouerait avant même d'avoir simulé quoi que ce soit.
"use strict";
const { execFileSync } = require("node:child_process");
const argv = process.argv.slice(2);
if (argv[0] === "status") {
  process.stdout.write(JSON.stringify({ name: process.env.STUB_PROJET }));
  process.exit(0);
}
if (argv[0] === "ssh") {
  const i = argv.indexOf("--");
  if (i === -1 || argv[i + 1] !== "sh" || argv[i + 2] !== "-c") {
    process.stderr.write("stub: forme de commande distante inattendue\\n");
    process.exit(1);
  }
  try {
    // stderr en "inherit" : l'empreinte que le script distant y écrit doit parvenir au script
    // appelant, qui la lit pour vérifier l'intégrité du transfert.
    const sortie = execFileSync("sh", ["-c", argv[i + 3]], {
      env: Object.assign({}, process.env, { ATLAS_DOCUMENT_STORAGE_DIR: process.env.STUB_VOLUME }),
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    });
    process.stdout.write(sortie);
    process.exit(0);
  } catch (erreur) {
    process.exit(typeof erreur.status === "number" ? erreur.status : 1);
  }
}
process.stderr.write("stub: sous-commande non simulee: " + argv[0] + "\\n");
process.exit(1);
`;

function preparerEnvironnement(fichiers) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "domiora-test-backup-"));
  const volume = path.join(racine, "volume");
  const destination = path.join(racine, "sauvegardes");
  const binaires = path.join(racine, "bin");
  fs.mkdirSync(volume, { recursive: true });
  fs.mkdirSync(binaires, { recursive: true });

  // `lost+found` existe sur un volume ext4 réel et le script l'exclut : le reproduire évite de
  // tester une arborescence plus simple que la vraie.
  fs.mkdirSync(path.join(volume, "lost+found"), { recursive: true });

  for (const [chemin, contenu] of Object.entries(fichiers)) {
    const cible = path.join(volume, chemin);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, contenu);
  }

  const stub = path.join(binaires, "railway");
  fs.writeFileSync(stub, STUB, { mode: 0o755 });

  return { racine, volume, destination, binaires, stub };
}

function lancer(env) {
  return execFileSync("bash", [SCRIPT], {
    env: {
      ...process.env,
      PATH: `${env.binaires}:${process.env.PATH}`,
      STUB_PROJET: PROJET,
      STUB_VOLUME: env.volume,
      DOMIORA_BACKUP_PROJET: PROJET,
      DOMIORA_BACKUP_DIR: env.destination,
      DOMIORA_BACKUP_SERVICE_WEB: "service-essai",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function artefacts(destination) {
  const noms = fs.readdirSync(destination);
  const trouver = (suffixe) => {
    const nom = noms.find((n) => n.endsWith(suffixe));
    return nom ? path.join(destination, nom) : undefined;
  };
  return {
    archive: trouver(".tar.gz"),
    empreinte: trouver(".tar.gz.sha256"),
    manifeste: trouver(".manifeste.sha256"),
  };
}

function inventaire(volume) {
  const vus = [];
  const parcourir = (repertoire, prefixe) => {
    for (const entree of fs.readdirSync(repertoire, { withFileTypes: true })) {
      const relatif = prefixe ? `${prefixe}/${entree.name}` : entree.name;
      if (entree.isDirectory()) parcourir(path.join(repertoire, entree.name), relatif);
      else vus.push(relatif);
    }
  };
  parcourir(volume, "");
  return vus.sort();
}

// Le `-r` de `xargs` et le `grep` du manifeste n'ont de sens qu'ensemble : ces trois volumes
// couvrent le pluriel, le singulier et le vide, et le vide est le seul qui régressait.
const SCENARIOS = [
  {
    nom: "volume peuplé — plusieurs fichiers, dont un sous-répertoire",
    fichiers: {
      "0f8c1a2b3c4d5e6f": "contenu quelconque A",
      "1a2b3c4d5e6f7a8b": "contenu quelconque B",
      "photos/originaux/2b3c4d5e6f7a8b9c": "contenu quelconque C",
    },
    attendus: 3,
  },
  {
    nom: "volume avec exactement un fichier",
    fichiers: { "3c4d5e6f7a8b9c0d": "contenu quelconque unique" },
    attendus: 1,
  },
  {
    nom: "volume totalement vide — aucun fichier, pas même un fichier d'essai",
    fichiers: {},
    attendus: 0,
  },
];

for (const scenario of SCENARIOS) {
  test(scenario.nom, () => {
    const env = preparerEnvironnement(scenario.fichiers);
    const avant = inventaire(env.volume);

    // Le script ne doit jamais sortir en erreur : c'est précisément ce qui régressait sur un
    // volume vide. `execFileSync` lève si le code de sortie est non nul.
    const sortie = lancer(env);

    const { archive, empreinte, manifeste } = artefacts(env.destination);
    assert.ok(archive, "une archive doit être produite");
    assert.ok(empreinte, "un fichier d'empreinte doit être produit");
    assert.ok(manifeste, "un manifeste doit être produit, même vide");

    // Une archive de volume vide n'est pas un fichier de zéro octet : c'est un tar.gz valide qui
    // ne contient rien. Distinguer les deux sépare « rien à sauvegarder » de « rien n'a été
    // sauvegardé ».
    assert.ok(fs.statSync(archive).size > 0, "l'archive ne doit jamais être de taille nulle");

    // SHA-256 : recalculé ici, jamais relu depuis le script qui l'a écrit.
    const attendu = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    const declare = fs.readFileSync(empreinte, "utf8").trim().split(/\s+/)[0];
    assert.equal(declare, attendu, "l'empreinte déclarée doit correspondre à l'archive produite");
    assert.ok(
      fs.readFileSync(empreinte, "utf8").includes(path.basename(archive)),
      "l'empreinte doit nommer son archive"
    );

    // Le manifeste décrit l'état du volume : une ligne par fichier, et aucune pour un volume vide.
    const lignes = fs.readFileSync(manifeste, "utf8").split("\n").filter((l) => l !== "");
    assert.equal(lignes.length, scenario.attendus, "le manifeste doit porter une ligne par fichier");
    for (const ligne of lignes) {
      assert.match(ligne, /^[0-9a-f]{64} {2}\.\//, "chaque ligne doit être une empreinte et un chemin");
    }

    // L'avertissement n'est pas décoratif : sur un volume vide il est la seule trace indiquant
    // qu'il n'y aura rien à restaurer. Il était inatteignable avant le correctif.
    if (scenario.attendus === 0) {
      assert.match(sortie, /AVERTISSEMENT : volume vide/, "un volume vide doit être signalé explicitement");
    } else {
      assert.doesNotMatch(sortie, /AVERTISSEMENT : volume vide/, "un volume peuplé ne doit pas être signalé vide");
    }

    // Garde contre la tentation qui a servi de contournement manuel pendant le provisionnement :
    // faire passer le script en déposant un fichier dans le volume. Le script ne doit RIEN y
    // ajouter, retirer ni modifier.
    assert.deepEqual(inventaire(env.volume), avant, "le volume source doit rester inchangé");

    fs.rmSync(env.racine, { recursive: true, force: true });
  });
}

test("une commande distante en échec reste une erreur franche", () => {
  const env = preparerEnvironnement({ "4d5e6f7a8b9c0d1e": "contenu quelconque" });
  // Stub qui réussit `status` puis échoue sur `ssh` : le correctif ne doit pas avoir rendu le
  // script tolérant aux vraies pannes en le rendant tolérant au volume vide.
  fs.writeFileSync(
    env.stub,
    `#!/bin/sh
if [ "$1" = "status" ]; then printf '{"name":"%s"}' "$STUB_PROJET"; exit 0; fi
exit 7
`,
    { mode: 0o755 }
  );

  assert.throws(() => lancer(env), /./, "l'échec de la commande distante doit faire échouer le script");

  // Et aucun artefact trompeur ne doit rester derrière.
  const restants = fs.existsSync(env.destination) ? fs.readdirSync(env.destination) : [];
  assert.deepEqual(restants, [], "aucun artefact ne doit subsister après un échec");

  fs.rmSync(env.racine, { recursive: true, force: true });
});
