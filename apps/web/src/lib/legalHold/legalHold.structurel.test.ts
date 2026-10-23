import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MOTIFS_LEGAL_HOLD, TYPES_CIBLE_LEGAL_HOLD } from "./statutsLegalHold";

// LEGAL_HOLD_FOUNDATION_V1 (ADR-068) — gardes STRUCTURELLES, sur le modèle de
// retention.structurel.test.ts : elles ne prouvent pas que le domaine est correct, elles empêchent
// une régression silencieuse de ce que ce lot a délibérément NE PAS fait.
//
// L'invariant gardé est celui du LOT, jamais l'immobilité du dépôt : aucun test ici ne compte les
// fichiers ni les migrations.

const SRC = join(__dirname, "..", "..");
const LEGAL_HOLD = __dirname;
const MIGRATION = join(SRC, "db", "migrations", "0061_legal_hold_foundation_v1.sql");

const lire = (chemin: string) => readFileSync(chemin, "utf8");
// Commentaires retirés : ces fichiers DÉCRIVENT longuement ce qu'ils ne font pas (« ne supprime
// rien », « aucune purge »), et une garde qui chercherait le mot dans la prose serait inutilisable.
const codeSeul = (chemin: string) =>
  lire(chemin)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

function listerFichiers(racine: string, filtre: (chemin: string) => boolean): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(racine)) {
    const chemin = join(racine, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...listerFichiers(chemin, filtre));
    else if (filtre(chemin)) trouves.push(chemin);
  }
  return trouves;
}

// Code de PRODUCTION du lot : les fichiers de test sont exclus, puisqu'un test a le droit de
// supprimer ses propres lignes de fixture — et le fait.
const SOURCES_PRODUCTION = listerFichiers(
  LEGAL_HOLD,
  (chemin) => chemin.endsWith(".ts") && !chemin.endsWith(".test.ts")
);

describe("le domaine legal hold ne supprime rien", () => {
  it("les trois fichiers du domaine sont bien ceux inspectés", () => {
    // Découverte par parcours : un fichier ajouté au chantier entre automatiquement dans toutes les
    // gardes de ce fichier.
    expect(SOURCES_PRODUCTION.length).toBeGreaterThanOrEqual(3);
    for (const attendu of ["statutsLegalHold.ts", "legalHold.ts", "legalHoldRepository.ts"]) {
      expect(SOURCES_PRODUCTION.some((chemin) => chemin.endsWith(attendu)), attendu).toBe(true);
    }
  });

  it("aucun DELETE, TRUNCATE ni DROP, en SQL comme en Drizzle", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/\.delete\s*\(/);
      expect(code, chemin).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(code, chemin).not.toMatch(/\bTRUNCATE\b/i);
      expect(code, chemin).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    }
  });

  it("aucune suppression de fichier, et aucun accès au système de fichiers", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/\bunlink\b|\brmdir\b|\brm\s*\(|\brimraf\b/);
      expect(code, chemin).not.toMatch(/node:fs|from\s+"fs"/);
      // La primitive d'ADR-067 existe ; elle n'est branchée sur AUCUN chemin métier, et un legal
      // hold — dont la raison d'être est d'INTERDIRE une suppression — est le dernier endroit où
      // elle devrait apparaître.
      expect(code, chemin).not.toMatch(/supprimerFichierStocke|stockage\/suppressionFichier|stockageDocuments/);
    }
  });

  it("aucun verbe de purge, d'anonymisation ou d'archivage", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/purge\s*\(|purger|anonymis|pseudonymis|archiver\s*\(/i);
    }
  });

  it("la seule table écrite est `legal_holds` elle-même", () => {
    const ecritures: { chemin: string; cible: string }[] = [];
    for (const chemin of SOURCES_PRODUCTION) {
      for (const occurrence of codeSeul(chemin).matchAll(/\.(insert|update)\(\s*([A-Za-z0-9_]*)/g)) {
        ecritures.push({ chemin, cible: occurrence[2] });
      }
    }
    expect(ecritures.length).toBeGreaterThan(0);
    for (const ecriture of ecritures) {
      expect(ecriture.cible, `${ecriture.chemin} écrit dans ${ecriture.cible}`).toBe("legalHolds");
    }
  });

  it("aucune table métier n'est écrite : les cibles sont LUES, jamais modifiées", () => {
    // `bons_visite`, `visites` et `biens` n'apparaissent que dans la jointure qui PROUVE
    // l'appartenance de la cible. Poser un hold ne touche pas la ressource protégée — une primitive
    // qui modifierait ce qu'elle protège serait une contradiction.
    const repository = codeSeul(join(LEGAL_HOLD, "legalHoldRepository.ts"));
    expect(repository).toMatch(/\.from\(bonsVisite\)/);
    expect(repository).not.toMatch(/\.(insert|update)\(\s*(bonsVisite|visites|biens|documentsBien)/);
  });

  it("aucune écriture dans le journal de rétention depuis ce domaine", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/runsRetention|runs_retention|actionsRetention|actions_retention/);
    }
  });
});

describe("la levée est une transition, jamais une suppression", () => {
  const REPOSITORY = join(LEGAL_HOLD, "legalHoldRepository.ts");

  it("lever passe par un UPDATE, et son WHERE porte la condition d'idempotence", () => {
    const code = codeSeul(REPOSITORY);
    expect(code).toMatch(/\.update\(legalHolds\)/);
    // `isNull(legalHolds.leveLe)` DANS le where de l'update : c'est la base qui tranche deux levées
    // concurrentes, pas une vérification applicative préalable.
    expect(code).toMatch(/\.update\(legalHolds\)[\s\S]{0,600}isNull\(legalHolds\.leveLe\)/);
  });

  it("aucune fonction ne réécrit le motif, la date ou l'auteur de la POSE", () => {
    const code = codeSeul(REPOSITORY);
    // Le seul `.set(` du fichier est celui de la levée : il ne porte que les trois colonnes de
    // levée. Un `.set(` touchant `motif:`, `poseLe:` ou `poseParIdentiteSub:` ferait du registre un
    // document réécrivable, donc sans valeur probatoire.
    const sets = [...code.matchAll(/\.set\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(sets.length).toBe(1);
    for (const contenu of sets) {
      expect(contenu).not.toMatch(/\bmotif\s*:/);
      expect(contenu).not.toMatch(/\bposeLe\s*:|\bposeParIdentiteSub\s*:/);
      expect(contenu).toMatch(/leveLe\s*:/);
    }
  });

  it("l'état actif est DÉRIVÉ : aucune colonne de statut n'existe", () => {
    const sql = lire(MIGRATION);
    // Une colonne `statut`/`actif` en plus des dates serait une seconde vérité, et la plus
    // permissive des deux finirait par décider d'une suppression.
    expect(sql).not.toMatch(/"statut"|"actif"|"est_actif"|"is_held"/);
    expect(sql).toMatch(/"leve_le" timestamp with time zone/);
  });
});

describe("aucun déclenchement automatique, aucune surface publique", () => {
  it("ni cron, ni setInterval, ni planificateur", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/setInterval|setTimeout|node-cron|cron\.schedule|scheduler|CronJob/);
    }
  });

  it("aucun fichier de configuration de cron n'a été ajouté pour les legal holds", () => {
    const racine = join(SRC, "..", "..", "..");
    for (const candidat of ["railway.json", "railway.toml", "vercel.json", "crontab", ".github/workflows"]) {
      const chemin = join(racine, candidat);
      if (!existsSync(chemin)) continue;
      const contenu = statSync(chemin).isDirectory()
        ? listerFichiers(chemin, () => true)
            .map((fichier) => lire(fichier))
            .join("\n")
        : lire(chemin);
      expect(contenu, candidat).not.toMatch(/legal.?hold/i);
    }
  });

  it("aucune route HTTP n'expose les legal holds", () => {
    // Ce lot livre le DOMAINE et le repository, pas une surface. Une route destructive est hors de
    // question, et même une route de lecture exposerait des motifs — des textes qui décrivent des
    // affaires — sans qu'aucun écran n'en ait besoin aujourd'hui.
    const routes = listerFichiers(join(SRC, "app"), (chemin) => chemin.endsWith("route.ts"));
    expect(routes.filter((chemin) => /legal.?hold/i.test(chemin))).toEqual([]);
    for (const chemin of routes) {
      expect(codeSeul(chemin), chemin).not.toMatch(/@\/lib\/legalHold/);
    }
  });

  it("aucune Server Action ne pose ni ne lève de hold", () => {
    const actions = listerFichiers(join(SRC, "actions"), (chemin) => chemin.endsWith(".ts") && !chemin.endsWith(".test.ts"));
    for (const chemin of actions) {
      expect(codeSeul(chemin), chemin).not.toMatch(/@\/lib\/legalHold|creerLegalHold|leverLegalHold/);
    }
  });

  it("aucun écran ni composant ne mentionne les legal holds", () => {
    const interfaces = listerFichiers(join(SRC, "app"), (chemin) => chemin.endsWith(".tsx"));
    for (const chemin of interfaces) {
      expect(lire(chemin), chemin).not.toMatch(/legalHold|legal_hold/);
    }
  });
});

describe("le domaine pur reste pur", () => {
  it("`legalHold.ts` n'importe ni base, ni environnement, ni framework, ni horloge", () => {
    const code = codeSeul(join(LEGAL_HOLD, "legalHold.ts"));
    expect(code).not.toMatch(/@\/db\/|drizzle-orm|getDb|process\.env|next\/|node:/);
    expect(code).not.toMatch(/Date\.now\s*\(|new Date\s*\(\s*\)/);
  });

  it("`statutsLegalHold.ts` ne contient que des vocabulaires, aucune logique d'accès", () => {
    const code = codeSeul(join(LEGAL_HOLD, "statutsLegalHold.ts"));
    expect(code).not.toMatch(/@\/db\/|drizzle-orm|getDb|process\.env|next\//);
  });

  it("le périmètre est toujours un PARAMÈTRE, jamais lu depuis la session", () => {
    // Convention ADR-007 : un repository reçoit son `workspaceId`. L'y lire depuis la session
    // rendrait le module inutilisable depuis un contexte machine et masquerait l'oubli d'un filtre.
    for (const chemin of SOURCES_PRODUCTION) {
      expect(codeSeul(chemin), chemin).not.toMatch(/exigerWorkspaceCourant|exigerSessionAtlas|lireSessionAtlas/);
    }
  });
});

describe("la migration du lot est additive", () => {
  const sqlBrut = lire(MIGRATION);
  const sql = sqlBrut
    .replace(/^--.*$/gm, " ")
    .toUpperCase()
    // `ON DELETE no action` / `ON UPDATE no action` sont la DÉCLARATION d'une FK, pas une opération :
    // retirées avant de chercher les verbes destructifs, sans quoi la garde ne pourrait pas
    // distinguer une contrainte d'un DELETE.
    .replace(/ON (DELETE|UPDATE) NO ACTION/g, " ")
    // Même raison pour les CHECK de cohérence, qui NOMMENT la colonne `leve_le` : ce sont des
    // contraintes, pas des mises à jour.
    .replace(/IS (NOT )?NULL/g, " ");

  it("ne contient que des CREATE TABLE, des contraintes et des index", () => {
    expect(sql).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"/);
    expect(sql).not.toMatch(/\bINSERT\b/);
    expect(sql).not.toMatch(/\bCREATE\s+TRIGGER\b|\bCREATE\s+FUNCTION\b/);
    expect(sql).not.toMatch(/\bON\s+DELETE\s+CASCADE\b/);
    expect(sql).not.toMatch(/\bON\s+DELETE\s+SET\s+NULL\b/);
  });

  it("crée exactement une table, et n'altère aucune table métier", () => {
    const tablesCreees = [...sql.matchAll(/CREATE TABLE "([A-Z_]+)"/g)].map((m) => m[1].toLowerCase());
    expect(tablesCreees).toEqual(["legal_holds"]);
    const alters = [...sql.matchAll(/ALTER TABLE "([A-Z_]+)"/g)].map((m) => m[1].toLowerCase());
    // Le seul ALTER est celui qui pose la FK de `legal_holds` vers `workspaces` : aucune table
    // métier n'est touchée, aucune colonne n'est ajoutée ailleurs.
    expect([...new Set(alters)]).toEqual(["legal_holds"]);
  });

  it("aucune FK ne pointe vers la ressource protégée", () => {
    // Décision centrale de la migration : une FK `cascade` ferait disparaître l'historique du hold
    // avec sa ressource ; une FK `no action` protégerait pour toujours une ressource dont le hold a
    // été LEVÉ, rendant la levée sans effet. L'appartenance de la cible est prouvée à la pose, par
    // une lecture scopée.
    const fks = [...sqlBrut.matchAll(/REFERENCES "public"\."([a-z_]+)"/g)].map((m) => m[1]);
    expect(fks).toEqual(["workspaces"]);
  });

  it("l'unicité des holds actifs est portée par un index PARTIEL", () => {
    // Partiel, et c'est ce qui rend le modèle praticable : une cible dont le hold a été levé peut
    // en recevoir un nouveau, ce qu'un index unique total aurait interdit pour toujours.
    expect(sqlBrut).toMatch(
      /CREATE UNIQUE INDEX "legal_holds_cible_actif_unique"[\s\S]*?WHERE "legal_holds"\."leve_le" IS NULL/
    );
  });

  it("la motivation est obligatoire EN BASE, pas seulement dans le code applicatif", () => {
    expect(sqlBrut).toMatch(/"motif" text NOT NULL/);
    expect(sqlBrut).toMatch(/legal_holds_motif_non_vide_check/);
    expect(sqlBrut).toMatch(/"pose_par_identite_sub" text NOT NULL/);
  });

  it("une levée partielle est refusée par la base", () => {
    // Datée, attribuée ET motivée, ou rien : sans ce CHECK, un UPDATE partiel produirait un hold
    // « levé » sans auteur ni raison — la disparition silencieuse d'une protection.
    expect(sqlBrut).toMatch(/legal_holds_coherence_levee_check/);
    expect(sqlBrut).toMatch(/legal_holds_levee_apres_pose_check/);
  });

  it("ne contient aucune donnée personnelle ni colonne de contact", () => {
    // `pose_par_identite_sub` est un `sub` OIDC, identifiant stable et non une coordonnée.
    expect(sqlBrut).not.toMatch(/"email"|"nom"|"prenom"|"telephone"|"adresse"/);
  });
});

describe("les vocabulaires TypeScript et SQL ne dérivent pas", () => {
  const sqlBrut = lire(MIGRATION);

  it("les types de cible du code sont exactement ceux du CHECK", () => {
    // De ces deux listes, la plus permissive serait celle qui compte : c'est la base qui tranche,
    // donc c'est elle qu'il faut comparer au code, et pas l'inverse.
    const bloc = sqlBrut.match(/legal_holds_entity_type_check" CHECK \([^)]*IN \(([^)]*)\)\)/);
    expect(bloc, "le CHECK entity_type doit être trouvable").not.toBeNull();
    const valeursSql = [...bloc![1].matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
    expect(valeursSql.sort()).toEqual([...TYPES_CIBLE_LEGAL_HOLD].sort());
  });

  it("les motifs du code sont exactement ceux du CHECK", () => {
    const bloc = sqlBrut.match(/legal_holds_motif_code_check" CHECK \([\s\S]*?IN \(([\s\S]*?)\)\)/);
    expect(bloc, "le CHECK motif_code doit être trouvable").not.toBeNull();
    const valeursSql = [...bloc![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(valeursSql.sort()).toEqual([...MOTIFS_LEGAL_HOLD].sort());
  });

  it("le seul type de cible supporté est celui dont une politique déclare `legalHoldApplicable`", async () => {
    const { POLITIQUES_CONSERVATION_V1 } = await import("@/lib/privacy/conservation");
    const avecHold = POLITIQUES_CONSERVATION_V1.filter(
      (politique) => politique.statut === "DECIDEE" && politique.legalHoldApplicable
    ).map((politique) => politique.cle);
    // Une seule politique déclare un legal hold applicable (SIGNED_VISIT_FORM, ADR-065), et elle
    // porte sur `bons_visite` : élargir `TYPES_CIBLE_LEGAL_HOLD` sans élargir cette déclaration
    // produirait des holds qu'aucune politique ne justifie.
    expect(avecHold).toEqual(["SIGNED_VISIT_FORM"]);
    expect([...TYPES_CIBLE_LEGAL_HOLD]).toEqual(["bons_visite"]);
  });
});

describe("l'ADR du lot existe et dit ce que le lot ne fait pas", () => {
  const ADR = join(SRC, "..", "..", "..", "docs", "adr", "068-legal-hold-foundation-v1.md");

  it("ADR-068 est présente et nomme le chantier", () => {
    expect(existsSync(ADR)).toBe(true);
    const texte = lire(ADR);
    expect(texte).toMatch(/LEGAL_HOLD_FOUNDATION_V1/);
    expect(texte).toMatch(/ADR-068/);
  });

  it("l'absence de purge, de cron et de route est écrite noir sur blanc", () => {
    const texte = lire(ADR).toLowerCase();
    expect(texte).toMatch(/aucune purge|aucune suppression/);
    expect(texte).toMatch(/aucun cron/);
  });
});
