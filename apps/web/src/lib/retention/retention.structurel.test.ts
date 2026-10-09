import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — gardes STRUCTURELLES, même modèle que
// privacyGouvernance.structurel.test.ts : elles ne prouvent pas que le moteur est correct, elles
// empêchent une régression silencieuse de ce que ce lot a délibérément NE PAS fait.
//
// L'invariant gardé est celui du LOT, jamais l'immobilité du dépôt : aucun test ici ne compte les
// fichiers ni les migrations, parce qu'un tel test casserait au premier chantier suivant sans rien
// avoir protégé.

const SRC = join(__dirname, "..", "..");
const RETENTION = join(SRC, "lib", "retention");
const ROUTE = join(SRC, "app", "api", "retention", "dry-run", "route.ts");

const lire = (chemin: string) => readFileSync(chemin, "utf8");
// Commentaires retirés : ces fichiers DÉCRIVENT longuement ce qu'ils ne font pas (« aucune purge »,
// « ne supprime rien »), et une garde qui chercherait le mot dans la prose serait inutilisable.
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
// supprimer ses propres lignes de fixture — et le fait (dryRunRetention.test.ts).
const SOURCES_PRODUCTION = [
  ...listerFichiers(RETENTION, (chemin) => chemin.endsWith(".ts") && !chemin.endsWith(".test.ts")),
  ROUTE,
];

describe("aucune suppression métier n'existe dans le moteur de rétention", () => {
  it("les quatre fichiers du moteur et la route sont bien ceux inspectés", () => {
    // Si un fichier est ajouté au chantier, il entre automatiquement dans toutes les gardes de ce
    // fichier — c'est le sens de la découverte par parcours plutôt que par liste figée.
    expect(SOURCES_PRODUCTION.length).toBeGreaterThanOrEqual(5);
    expect(SOURCES_PRODUCTION.some((chemin) => chemin.endsWith("eligibilite.ts"))).toBe(true);
    expect(SOURCES_PRODUCTION).toContain(ROUTE);
  });

  it("aucun DELETE, TRUNCATE ni DROP, en SQL comme en Drizzle", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/\.delete\s*\(/);
      expect(code, chemin).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(code, chemin).not.toMatch(/\bTRUNCATE\b/i);
      expect(code, chemin).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
      expect(code, chemin).not.toMatch(/\bON\s+DELETE\s+CASCADE\b/i);
    }
  });

  it("aucune suppression ni écriture de fichier, et aucun accès au système de fichiers", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/\bunlink\b|\brmdir\b|\brm\s*\(|\brimraf\b/);
      expect(code, chemin).not.toMatch(/node:fs|from\s+"fs"/);
      expect(code, chemin).not.toMatch(/supprimerDocument|supprimerFichier|stockageDocuments/);
    }
  });

  it("aucun verbe de purge, d'anonymisation ou d'archivage", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/purge\s*\(|purger|anonymis|pseudonymis|archiver\s*\(/i);
    }
  });

  it("la seule table écrite est le journal de rétention lui-même", () => {
    // Les écritures AUTORISÉES sont l'INSERT et l'UPDATE de `runs_retention`, et elles seules. Un
    // `insert(` ou `update(` portant une autre table doit faire échouer ce test.
    const ecritures: { chemin: string; cible: string }[] = [];
    for (const chemin of SOURCES_PRODUCTION) {
      for (const occurrence of codeSeul(chemin).matchAll(/\.(insert|update)\(\s*([A-Za-z0-9_]*)/g)) {
        ecritures.push({ chemin, cible: occurrence[2] });
      }
    }
    expect(ecritures.length).toBeGreaterThan(0);
    for (const ecriture of ecritures) {
      expect(ecriture.cible, `${ecriture.chemin} écrit dans ${ecriture.cible}`).toBe("runsRetention");
    }
  });

  it("actions_retention n'est jamais écrite par ce lot", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/actionsRetention|actions_retention/);
    }
  });

  it("aucun legal hold n'est posé, levé ni modélisé", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      // Les CODES du vocabulaire le NOMMENT (`LEGAL_HOLD_MODEL_MISSING`,
      // `BLOCKED_MISSING_LEGAL_HOLD`) — nommer ce qui manque est précisément l'inverse d'en poser
      // un. Toute autre forme (colonne, champ, fonction) est interdite.
      const sansCodeDeBlocage = code.replace(/[A-Z_]*LEGAL_HOLD[A-Z_]*/g, " ");
      expect(sansCodeDeBlocage, chemin).not.toMatch(/legal_?hold/i);
      expect(sansCodeDeBlocage, chemin).not.toMatch(/suspensionContentieux|sousScelle/i);
    }
  });
});

describe("aucun déclenchement automatique", () => {
  it("ni cron, ni setInterval, ni planificateur, ni déclenchement différé", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/setInterval|setTimeout|node-cron|cron\.schedule|scheduler|CronJob/);
    }
  });

  it("aucun fichier de configuration de cron n'a été ajouté pour la rétention", () => {
    const racine = join(SRC, "..", "..", "..");
    const candidats = ["railway.json", "railway.toml", "vercel.json", "crontab", ".github/workflows"];
    for (const candidat of candidats) {
      let contenu = "";
      try {
        contenu = statSync(join(racine, candidat)).isDirectory()
          ? listerFichiers(join(racine, candidat), () => true)
              .map((f) => lire(f))
              .join("\n")
          : lire(join(racine, candidat));
      } catch {
        continue; // Le fichier n'existe pas : rien à garder.
      }
      expect(contenu, candidat).not.toMatch(/retention/i);
    }
  });
});

describe("`dernier_contact_le` ne peut pas devenir LAST_INBOUND_CONTACT_AT", () => {
  it("le champ n'est mentionné nulle part dans le code du moteur, sous aucune forme", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/dernier_?[Cc]ontact/);
      expect(code, chemin).not.toMatch(/dernierContactLe|lastContactAt/);
    }
  });

  it("aucune table de prospection n'est lue par le moteur", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/prospectsVendeurs|prospects_vendeurs|projetsVendeur|projets_vendeur/);
    }
  });

  it("PROSPECT_MARKETING reste bloquée par un code nommé, jamais par un calcul", () => {
    const moteur = codeSeul(join(RETENTION, "eligibilite.ts"));
    expect(moteur).toMatch(/PROSPECT_MARKETING[\s\S]{0,200}LAST_INBOUND_CONTACT_AT_MISSING/);
  });
});

describe("le moteur d'éligibilité reste PUR", () => {
  const PUR = join(RETENTION, "eligibilite.ts");

  it("aucun import de base, d'environnement, de framework ni d'horloge", () => {
    const code = codeSeul(PUR);
    expect(code).not.toMatch(/@\/db\/|drizzle-orm|getDb|process\.env|next\/|node:/);
    // `Date.now()` et `new Date()` sans argument : l'instant de référence est un PARAMÈTRE, sans
    // quoi la frontière exacte des cinq ans — le seul endroit où le calcul peut se tromper — ne
    // serait pas testable.
    expect(code).not.toMatch(/Date\.now\s*\(/);
    expect(code).not.toMatch(/new Date\s*\(\s*\)/);
  });

  it("aucune durée de conservation n'est écrite en dur dans le moteur", () => {
    const code = codeSeul(PUR);
    // Les « 5 ans » viennent de conservation.ts (ADR-065), source canonique des décisions.
    expect(code).not.toMatch(/\b5\s*\*\s*365\b|31536000000|157680000000/);
    expect(code).toMatch(/dureeAnnees/);
  });

  it("le vocabulaire des politiques n'est pas redéclaré côté rétention", () => {
    const statuts = lire(join(RETENTION, "statutsRetention.ts"));
    // Réexport depuis la source canonique, jamais une seconde liste littérale : deux listes
    // dériveraient, et la plus fausse des deux serait celle qui pilote la purge.
    expect(statuts).toMatch(/from "@\/lib\/privacy\/conservation"/);
    expect(codeSeul(join(RETENTION, "statutsRetention.ts"))).not.toMatch(
      /CLES_POLITIQUES_CONSERVATION\s*=\s*\[/
    );
  });
});

describe("la garde de `lib/privacy` n'est pas affaiblie", () => {
  it("aucun fichier de rétention n'a été déposé dans lib/privacy", () => {
    const fichiers = listerFichiers(join(SRC, "lib", "privacy"), (chemin) => chemin.endsWith(".ts"));
    expect(fichiers.some((chemin) => /retention|purge/i.test(chemin))).toBe(false);
  });

  it("conservation.ts ne lit toujours pas la base et ne supprime rien", () => {
    const fichiers = listerFichiers(join(SRC, "lib", "privacy"), (chemin) => chemin.endsWith(".ts") && !chemin.endsWith(".test.ts"));
    for (const chemin of fichiers) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/\.delete\s*\(|getDb|drizzle-orm/);
    }
  });

  it("les décisions d'ADR-065 sont inchangées : trois catégories restent UNDECIDED", async () => {
    const { POLITIQUES_CONSERVATION_V1 } = await import("@/lib/privacy/conservation");
    const indecises = POLITIQUES_CONSERVATION_V1.filter((p) => p.statut === "UNDECIDED").map((p) => p.cle);
    expect(indecises.sort()).toEqual(
      ["ACTIVE_CLIENT_OR_PROJECT_DATA", "FREE_TEXT_NOTES", "TRANSACTION_DOCUMENTS"].sort()
    );
  });
});

describe("la publication Privacy reste bloquée — ce lot ne débloque aucune notice", () => {
  it("aucun chemin public n'a été ajouté au proxy", () => {
    const proxy = codeSeul(join(SRC, "proxy.ts"));
    expect(proxy).toContain('CHEMINS_PUBLICS = new Set(["/connexion", "/api/auth/atlas/login", "/api/auth/atlas/callback"])');
    expect(proxy).not.toMatch(/retention|confidentialite|privacy/i);
  });

  it("aucune page publique de confidentialité ni de mentions légales n'existe", () => {
    const pages = listerFichiers(join(SRC, "app"), (chemin) => chemin.endsWith("page.tsx"));
    expect(pages.filter((chemin) => /\/(privacy|mentions-legales|politique-confidentialite)\//.test(chemin))).toEqual([]);
  });

  it("le parcours du bon de visite n'est pas modifié par ce lot", () => {
    // Aucune notice courte n'est introduite à la signature : le texte signé reste celui des
    // templates versionnés (ADR-063/065), et le moteur de rétention ne le touche pas.
    const bonVisite = listerFichiers(join(SRC, "lib", "bonVisite"), (chemin) => chemin.endsWith(".ts") && !chemin.endsWith(".test.ts"));
    for (const chemin of bonVisite) {
      expect(codeSeul(chemin), chemin).not.toMatch(/retention|conservation/i);
    }
  });

  it("aucun écran ni composant n'expose le dry-run à un utilisateur", () => {
    const interfaces = listerFichiers(join(SRC, "app"), (chemin) => chemin.endsWith(".tsx"));
    for (const chemin of interfaces) {
      expect(lire(chemin), chemin).not.toMatch(/retention\/dry-run/);
    }
  });
});

describe("apply n'existe nulle part comme chemin exécutable", () => {
  it("aucune branche `mode === \"apply\"` ne mène à une mutation", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/===\s*["']apply["']/);
      expect(code, chemin).not.toMatch(/mode\s*==\s*["']apply["']/);
    }
  });

  it("APPLY_SUPPORTED est faux, et c'est une constante et non un calcul", () => {
    expect(codeSeul(join(RETENTION, "statutsRetention.ts"))).toMatch(/APPLY_SUPPORTED\s*=\s*false/);
  });

  it("le refus de mode est applicatif ET routier : un appelant interne ne peut pas le contourner", () => {
    expect(codeSeul(join(RETENTION, "dryRunRetention.ts"))).toMatch(/throw new ErreurModeRetentionNonSupporte/);
    expect(codeSeul(ROUTE)).toMatch(/ErreurModeRetentionNonSupporte/);
  });
});

describe("la migration du lot est additive", () => {
  const SQL = join(SRC, "db", "migrations", "0060_retention_engine_foundation_v1.sql");

  it("ne contient que des CREATE TABLE, des contraintes et des index", () => {
    const sql = lire(SQL)
      .replace(/^--.*$/gm, " ")
      .toUpperCase()
      // `ON DELETE no action` / `ON UPDATE no action` sont la DÉCLARATION d'une FK, pas une
      // opération : retirées avant de chercher les verbes destructifs, sans quoi la garde ne
      // pourrait pas distinguer une contrainte d'un DELETE.
      .replace(/ON (DELETE|UPDATE) NO ACTION/g, " ");
    expect(sql).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b/);
    expect(sql).not.toMatch(/\bCREATE\s+TRIGGER\b|\bCREATE\s+FUNCTION\b/);
    // Les deux seules tables créées, et aucune colonne ajoutée à une table métier.
    const tablesCreees = [...sql.matchAll(/CREATE TABLE "([A-Z_]+)"/g)].map((m) => m[1].toLowerCase());
    expect(tablesCreees.sort()).toEqual(["actions_retention", "runs_retention"]);
    const altersNonRetention = [...sql.matchAll(/ALTER TABLE "([A-Z_]+)"/g)]
      .map((m) => m[1].toLowerCase())
      .filter((table) => !table.endsWith("_retention"));
    expect(altersNonRetention).toEqual([]);
    expect(sql).not.toMatch(/LEGAL_HOLD/);
  });

  it("`actions_retention.action` n'accepte aucun verbe de suppression", () => {
    const sql = lire(SQL);
    expect(sql).toMatch(/actions_retention_action_check[\s\S]*?IN \('DRY_RUN_DETECTED'\)/);
    // Hors commentaires : l'en-tête de la migration EXPLIQUE qu'un `'DELETE_DB'` prématuré serait
    // refusé par PostgreSQL, et cette phrase ne doit pas faire échouer la garde qu'elle décrit.
    expect(sql.replace(/^--.*$/gm, " ")).not.toMatch(/'DELETE_DB'|'DELETE_FILE'|'ANONYMIZE'/);
  });
});
