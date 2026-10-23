import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CAUSES_LEVEE_QUARANTAINE,
  ETATS_QUARANTAINE,
  POLITIQUES_QUARANTAINE,
  TYPES_CIBLE_QUARANTAINE,
  VERDICTS_REVALIDATION_QUARANTAINE,
} from "./statutsQuarantaine";

// RETENTION_QUARANTINE_FOUNDATION_V1 (ADR-069) — gardes STRUCTURELLES, sur le modèle de
// retention.structurel.test.ts et legalHold.structurel.test.ts : elles ne prouvent pas que le
// domaine est correct, elles empêchent une régression silencieuse de ce que ce lot a délibérément
// NE PAS fait.
//
// L'invariant gardé est celui du LOT, jamais l'immobilité du dépôt.

const SRC = join(__dirname, "..", "..");
const QUARANTAINE = __dirname;
const MIGRATION = join(SRC, "db", "migrations", "0062_retention_quarantine_foundation_v1.sql");

const lire = (chemin: string) => readFileSync(chemin, "utf8");
// Commentaires retirés : ces fichiers DÉCRIVENT longuement ce qu'ils ne font pas, et une garde qui
// chercherait le mot dans la prose serait inutilisable.
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

const SOURCES_PRODUCTION = listerFichiers(
  QUARANTAINE,
  (chemin) => chemin.endsWith(".ts") && !chemin.endsWith(".test.ts")
);

describe("le domaine quarantaine ne supprime rien", () => {
  it("les trois fichiers du domaine sont bien ceux inspectés", () => {
    expect(SOURCES_PRODUCTION.length).toBeGreaterThanOrEqual(3);
    for (const attendu of ["statutsQuarantaine.ts", "quarantaine.ts", "quarantaineRepository.ts"]) {
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

  it("aucune suppression de fichier, aucun accès au système de fichiers, aucun déplacement", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/\bunlink\b|\brmdir\b|\brm\s*\(|\brimraf\b|\brename\s*\(|\bcopyFile\b/);
      expect(code, chemin).not.toMatch(/node:fs|from\s+"fs"/);
      // Mettre en quarantaine ne DÉPLACE aucun fichier : la quarantaine est un état de rétention,
      // pas un répertoire. Et la primitive d'ADR-067 reste sans appelant métier.
      expect(code, chemin).not.toMatch(/supprimerFichierStocke|stockage\/suppressionFichier|stockageDocuments/);
    }
  });

  it("aucun verbe de purge, d'anonymisation ou d'archivage", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/purge\s*\(|purger|anonymis|pseudonymis|archiver\s*\(/i);
    }
  });

  it("la seule table écrite est `retention_quarantines` elle-même", () => {
    const ecritures: { chemin: string; cible: string }[] = [];
    for (const chemin of SOURCES_PRODUCTION) {
      for (const occurrence of codeSeul(chemin).matchAll(/\.(insert|update)\(\s*([A-Za-z0-9_]*)/g)) {
        ecritures.push({ chemin, cible: occurrence[2] });
      }
    }
    expect(ecritures.length).toBeGreaterThan(0);
    for (const ecriture of ecritures) {
      expect(ecriture.cible, `${ecriture.chemin} écrit dans ${ecriture.cible}`).toBe("retentionQuarantines");
    }
  });

  it("aucune table métier n'est écrite : les cibles sont LUES, jamais modifiées ni masquées", () => {
    const repository = codeSeul(join(QUARANTAINE, "quarantaineRepository.ts"));
    expect(repository).toMatch(/\.from\(bonsVisite\)/);
    expect(repository).not.toMatch(/\.(insert|update)\(\s*(bonsVisite|visites|biens|documentsBien)/);
    // Pas d'archivage, pas de masquage : aucune colonne de visibilité d'une ressource métier n'est
    // touchée. Mettre en quarantaine ne cache rien à l'utilisateur.
    expect(repository).not.toMatch(/archiveLe|archive_le|masque|cache[A-Z]|visible\s*:/);
  });

  it("le registre des legal holds n'est jamais écrit depuis la quarantaine", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      // La quarantaine ne peut JAMAIS lever un legal hold : elle n'importe que la lecture.
      expect(code, chemin).not.toMatch(/creerLegalHold|leverLegalHold/);
      expect(code, chemin).not.toMatch(/\.(insert|update|delete)\(\s*legalHolds/);
      const importsHold = [...code.matchAll(/from\s+"@\/lib\/legalHold\/[A-Za-z]+"/g)];
      if (importsHold.length > 0) {
        expect(code, chemin).toMatch(/listerCiblesSousLegalHoldActif/);
      }
    }
  });

  it("le journal de rétention n'est jamais écrit depuis la quarantaine", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/runsRetention|runs_retention|actionsRetention|actions_retention/);
    }
  });
});

describe("AUCUN vocabulaire ne peut exprimer une autorisation de purge", () => {
  it("aucune valeur d'aucune liste ne nomme une suppression", () => {
    // L'invariant central du lot, verrouillé sur les listes réelles. Un vocabulaire qui contiendrait
    // `PURGE_ALLOWED` rendrait la purge exprimable avant qu'aucun mécanisme sûr n'existe.
    const toutes = [
      ...ETATS_QUARANTAINE,
      ...VERDICTS_REVALIDATION_QUARANTAINE,
      ...CAUSES_LEVEE_QUARANTAINE,
      ...TYPES_CIBLE_QUARANTAINE,
      ...POLITIQUES_QUARANTAINE,
    ];
    for (const valeur of toutes) {
      expect(valeur, valeur).not.toMatch(/PURGE|DELETABLE|ALLOWED|AUTORIS/i);
    }
  });

  it("le code du domaine ne contient aucun identifiant qui promettrait une suppression", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/PURGE_ALLOWED|DELETABLE|peutSupprimer|autoriserSuppression/i);
    }
  });

  it("l'échéance ne peut pas être comparée pour produire une autorisation", () => {
    // `etatQuarantaine` est la SEULE fonction qui lit `revalidationDueLe` pour conclure, et elle
    // rend un `EtatQuarantaine` — un type dont aucune valeur n'autorise quoi que ce soit.
    const pur = codeSeul(join(QUARANTAINE, "quarantaine.ts"));
    expect(pur).toMatch(/return "REVALIDATION_REQUISE"/);
    expect(pur).not.toMatch(/return\s+"[A-Z_]*(DELET|PURGE|ALLOW)[A-Z_]*"/i);
  });
});

describe("la revalidation est obligatoire et ne peut pas être court-circuitée", () => {
  const PUR = join(QUARANTAINE, "quarantaine.ts");

  it("le legal hold est évalué AVANT l'échéance dans la revalidation", () => {
    const code = codeSeul(PUR);
    const positionHold = code.indexOf('return "BLOCKED_BY_LEGAL_HOLD"');
    const positionEcheance = code.indexOf('return "ECHEANCE_NON_ATTEINTE"');
    expect(positionHold).toBeGreaterThan(-1);
    expect(positionEcheance).toBeGreaterThan(-1);
    // L'ordre porte la garantie : aucun écoulement du temps ne peut passer devant une protection
    // juridique.
    expect(positionHold).toBeLessThan(positionEcheance);
  });

  it("les trois champs du contexte de revalidation sont OBLIGATOIRES", () => {
    const code = lire(PUR);
    // Un `?` sur l'un d'eux ferait d'un oubli de câblage une levée de protection.
    expect(code).toMatch(/readonly cibleExiste: boolean;/);
    expect(code).toMatch(/readonly sousLegalHoldActif: boolean;/);
    expect(code).toMatch(/readonly politiqueToujoursApplicable: boolean;/);
    expect(code).not.toMatch(/readonly (cibleExiste|sousLegalHoldActif|politiqueToujoursApplicable)\?:/);
  });

  it("la lecture des legal holds n'est jamais rattrapée dans le repository", () => {
    // Son échec doit remonter : ouvrir une quarantaine ou conclure « aucun blocage » parce qu'on
    // n'a pas su lire les protections serait exactement la panne que ce domaine doit empêcher.
    const repository = codeSeul(join(QUARANTAINE, "quarantaineRepository.ts"));
    expect(repository).not.toMatch(/listerCiblesSousLegalHoldActif[\s\S]{0,160}(\?\?|\|\||\.catch\()/);
    const catchs = [...repository.matchAll(/catch\s*\(/g)];
    // Un seul `catch` est toléré : celui de la violation d'unicité à l'INSERT, qui traduit une
    // course gagnée par la base en résultat `deja_active`.
    expect(catchs).toHaveLength(1);
    expect(repository).toMatch(/estViolationQuarantaineActiveUnique/);
  });

  it("la revalidation N'ÉCRIT RIEN", () => {
    const repository = lire(join(QUARANTAINE, "quarantaineRepository.ts"));
    const debut = repository.indexOf("export async function revaliderQuarantaineEnBase");
    expect(debut).toBeGreaterThan(-1);
    const corps = repository.slice(debut);
    expect(corps).not.toMatch(/\.insert\(|\.update\(|\.set\(|\.delete\(/);
  });
});

describe("la sortie de quarantaine est une transition, jamais une suppression", () => {
  const REPOSITORY = join(QUARANTAINE, "quarantaineRepository.ts");

  it("lever passe par un UPDATE, et son WHERE porte la condition d'idempotence", () => {
    const code = codeSeul(REPOSITORY);
    expect(code).toMatch(/\.update\(retentionQuarantines\)/);
    expect(code).toMatch(/\.update\(retentionQuarantines\)[\s\S]{0,900}isNull\(retentionQuarantines\.leveeLe\)/);
  });

  it("aucune fonction ne réécrit le motif, l'échéance, la date ou l'auteur de l'ENTRÉE", () => {
    const code = codeSeul(REPOSITORY);
    // Rallonger une échéance en silence reviendrait à réécrire la chronologie d'une décision de
    // rétention.
    const sets = [...code.matchAll(/\.set\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(sets.length).toBe(1);
    for (const contenu of sets) {
      expect(contenu).not.toMatch(/\bmotif\s*:/);
      expect(contenu).not.toMatch(/\bentreLe\s*:|\bentreParIdentiteSub\s*:|\brevalidationDueLe\s*:/);
      expect(contenu).toMatch(/leveeLe\s*:/);
    }
  });

  it("l'état est DÉRIVÉ : aucune colonne de statut n'existe en base", () => {
    const sql = lire(MIGRATION);
    expect(sql).not.toMatch(/"statut"|"etat"|"actif"|"est_actif"|"state"/);
    expect(sql).toMatch(/"levee_le" timestamp with time zone/);
    expect(sql).toMatch(/"revalidation_due_le" timestamp with time zone NOT NULL/);
  });
});

describe("aucun déclenchement automatique, aucune surface publique", () => {
  it("ni cron, ni setInterval, ni planificateur", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/setInterval|setTimeout|node-cron|cron\.schedule|scheduler|CronJob/);
    }
  });

  it("aucun fichier de configuration de cron n'a été ajouté pour la quarantaine", () => {
    const racine = join(SRC, "..", "..", "..");
    for (const candidat of ["railway.json", "railway.toml", "vercel.json", "crontab", ".github/workflows"]) {
      const chemin = join(racine, candidat);
      if (!existsSync(chemin)) continue;
      const contenu = statSync(chemin).isDirectory()
        ? listerFichiers(chemin, () => true)
            .map((fichier) => lire(fichier))
            .join("\n")
        : lire(chemin);
      expect(contenu, candidat).not.toMatch(/quarantain|quarantine/i);
    }
  });

  it("aucune route HTTP n'expose la quarantaine", () => {
    const routes = listerFichiers(join(SRC, "app"), (chemin) => chemin.endsWith("route.ts"));
    expect(routes.filter((chemin) => /quarantain|quarantine/i.test(chemin))).toEqual([]);
    for (const chemin of routes) {
      expect(codeSeul(chemin), chemin).not.toMatch(/@\/lib\/quarantaine/);
    }
  });

  it("aucune Server Action n'ouvre ni ne lève de quarantaine", () => {
    const actions = listerFichiers(join(SRC, "actions"), (chemin) => chemin.endsWith(".ts") && !chemin.endsWith(".test.ts"));
    for (const chemin of actions) {
      expect(codeSeul(chemin), chemin).not.toMatch(/@\/lib\/quarantaine|creerQuarantaine|leverQuarantaine/);
    }
  });

  it("aucun écran ni composant ne mentionne la quarantaine", () => {
    const interfaces = listerFichiers(join(SRC, "app"), (chemin) => chemin.endsWith(".tsx"));
    for (const chemin of interfaces) {
      expect(lire(chemin), chemin).not.toMatch(/quarantaine|quarantine/i);
    }
  });
});

describe("le domaine pur reste pur", () => {
  it("`quarantaine.ts` n'importe ni base, ni environnement, ni framework, ni horloge", () => {
    const code = codeSeul(join(QUARANTAINE, "quarantaine.ts"));
    expect(code).not.toMatch(/@\/db\/|drizzle-orm|getDb|process\.env|next\/|node:/);
    // L'instant de référence est un PARAMÈTRE : sans quoi la frontière exacte de l'échéance — le
    // seul endroit où le calcul peut se tromper — ne serait pas testable.
    expect(code).not.toMatch(/Date\.now\s*\(|new Date\s*\(\s*\)/);
  });

  it("`statutsQuarantaine.ts` ne contient que des vocabulaires", () => {
    const code = codeSeul(join(QUARANTAINE, "statutsQuarantaine.ts"));
    expect(code).not.toMatch(/@\/db\/|drizzle-orm|getDb|process\.env|next\//);
  });

  it("le périmètre est toujours un PARAMÈTRE, jamais lu depuis la session", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      expect(codeSeul(chemin), chemin).not.toMatch(/exigerWorkspaceCourant|exigerSessionAtlas|lireSessionAtlas/);
    }
  });
});

describe("la durée de quarantaine n'est pas décidée, et aucune valeur n'est inventée", () => {
  it("aucune durée en dur n'apparaît dans le domaine", () => {
    for (const chemin of SOURCES_PRODUCTION) {
      const code = codeSeul(chemin);
      // Ni 30 jours, ni 90 jours, ni une dérivation des cinq ans de conservation.
      expect(code, chemin).not.toMatch(/\b(30|60|90|180|365)\s*\*\s*24\b|\bjours\(\s*\d+\s*\)|\bannees\(\s*\d+\s*\)/);
      expect(code, chemin).not.toMatch(/86400000|2592000000|7776000000/);
    }
  });

  it("aucune échéance n'est calculée depuis la politique de CONSERVATION", () => {
    const repository = codeSeul(join(QUARANTAINE, "quarantaineRepository.ts"));
    // `dureeAnneesPourDeclencheur` est utilisée pour REVALIDER l'applicabilité de la politique,
    // jamais pour fabriquer une échéance de quarantaine. Confondre les deux ferait d'une règle de
    // conservation une autorisation de purge.
    expect(repository).not.toMatch(/revalidationDueLe\s*[:=][\s\S]{0,120}(ajouterAnnees|dureeAnnees)/);
    expect(repository).toMatch(/revalidationDueLe,/);
  });

  it("le moteur de rétention NOMME ce blocage plutôt que d'inventer une durée", () => {
    const eligibilite = lire(join(SRC, "lib", "retention", "eligibilite.ts"));
    expect(eligibilite).toMatch(/QUARANTINE_POLICY_MISSING/);
  });
});

describe("la migration du lot est additive", () => {
  const sqlBrut = lire(MIGRATION);
  const sql = sqlBrut
    .replace(/^--.*$/gm, " ")
    .toUpperCase()
    .replace(/ON (DELETE|UPDATE) NO ACTION/g, " ")
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
    expect(tablesCreees).toEqual(["retention_quarantines"]);
    const alters = [...sql.matchAll(/ALTER TABLE "([A-Z_]+)"/g)].map((m) => m[1].toLowerCase());
    expect([...new Set(alters)]).toEqual(["retention_quarantines"]);
  });

  it("la seule FK pointe vers `workspaces` — ni vers la ressource, ni vers un run", () => {
    // Une FK vers la ressource : `cascade` effacerait l'historique avec elle, `no action`
    // retiendrait pour toujours une ressource dont la quarantaine a été levée. Une FK vers
    // `runs_retention` ferait dériver un état de longue durée d'une ligne de journal.
    const fks = [...sqlBrut.matchAll(/REFERENCES "public"\."([a-z_]+)"/g)].map((m) => m[1]);
    expect(fks).toEqual(["workspaces"]);
    expect(sqlBrut).toMatch(/"workspace_id" text NOT NULL/);
  });

  it("l'unicité des quarantaines actives est portée par un index PARTIEL", () => {
    expect(sqlBrut).toMatch(
      /CREATE UNIQUE INDEX "retention_quarantines_cible_active_unique"[\s\S]*?WHERE "retention_quarantines"\."levee_le" IS NULL/
    );
  });

  it("la motivation, l'auteur et l'échéance sont obligatoires EN BASE", () => {
    expect(sqlBrut).toMatch(/"motif" text NOT NULL/);
    expect(sqlBrut).toMatch(/"entre_par_identite_sub" text NOT NULL/);
    expect(sqlBrut).toMatch(/"revalidation_due_le" timestamp with time zone NOT NULL/);
    expect(sqlBrut).toMatch(/retention_quarantines_motif_non_vide_check/);
    // SANS DEFAULT : aucune durée n'étant décidée, la base ne peut pas en fabriquer une.
    expect(sqlBrut).not.toMatch(/"revalidation_due_le"[^,]*DEFAULT/);
  });

  it("une sortie partielle et une échéance incohérente sont refusées par la base", () => {
    expect(sqlBrut).toMatch(/retention_quarantines_coherence_levee_check/);
    expect(sqlBrut).toMatch(/retention_quarantines_levee_apres_entree_check/);
    expect(sqlBrut).toMatch(/retention_quarantines_echeance_apres_entree_check/);
  });

  it("ne contient aucune donnée personnelle ni colonne de contact", () => {
    expect(sqlBrut).not.toMatch(/"email"|"nom"|"prenom"|"telephone"|"adresse"/);
  });
});

describe("les vocabulaires TypeScript et SQL ne dérivent pas", () => {
  const sqlBrut = lire(MIGRATION);

  it("les types de cible du code sont exactement ceux du CHECK", () => {
    const bloc = sqlBrut.match(/retention_quarantines_entity_type_check" CHECK \([^)]*IN \(([^)]*)\)\)/);
    expect(bloc, "le CHECK entity_type doit être trouvable").not.toBeNull();
    const valeurs = [...bloc![1].matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
    expect(valeurs.sort()).toEqual([...TYPES_CIBLE_QUARANTAINE].sort());
  });

  it("les politiques du code sont exactement celles du CHECK", () => {
    const bloc = sqlBrut.match(/retention_quarantines_policy_code_check" CHECK \([^)]*IN \(([^)]*)\)\)/);
    expect(bloc, "le CHECK policy_code doit être trouvable").not.toBeNull();
    const valeurs = [...bloc![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(valeurs.sort()).toEqual([...POLITIQUES_QUARANTAINE].sort());
  });

  it("les causes de sortie du code sont exactement celles du CHECK", () => {
    const bloc = sqlBrut.match(/retention_quarantines_cause_levee_check" CHECK \([\s\S]*?IN \(([\s\S]*?)\)\)/);
    expect(bloc, "le CHECK cause_levee doit être trouvable").not.toBeNull();
    const valeurs = [...bloc![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(valeurs.sort()).toEqual([...CAUSES_LEVEE_QUARANTAINE].sort());
  });

  it("la politique acceptée est celle que le moteur déclare calculable", async () => {
    const { statutPolitique } = await import("@/lib/retention/eligibilite");
    const { POLITIQUES_CONSERVATION_V1 } = await import("@/lib/privacy/conservation");
    const calculables = POLITIQUES_CONSERVATION_V1.filter(
      (politique) => statutPolitique(politique).status === "COMPUTABLE_DRY_RUN_ONLY"
    ).map((politique) => politique.cle);
    // Une politique bloquée ne peut produire aucun candidat : l'accepter en quarantaine permettrait
    // d'ouvrir un état que rien ne justifie.
    expect(calculables.sort()).toEqual([...POLITIQUES_QUARANTAINE].sort());
  });
});

describe("les fondations précédentes ne sont pas affaiblies", () => {
  it("APPLY_SUPPORTED reste faux, et c'est une constante", async () => {
    const { APPLY_SUPPORTED } = await import("@/lib/retention/statutsRetention");
    expect(APPLY_SUPPORTED).toBe(false);
    expect(lire(join(SRC, "lib", "retention", "statutsRetention.ts"))).toMatch(/APPLY_SUPPORTED\s*=\s*false/);
  });

  it("la primitive de suppression de fichier reste sans appelant hors de son propre domaine", () => {
    const sources = listerFichiers(join(SRC), (chemin) => chemin.endsWith(".ts") && !chemin.endsWith(".test.ts"));
    const appelants = sources.filter(
      (chemin) => !chemin.includes(join("lib", "stockage")) && /supprimerFichierStocke/.test(codeSeul(chemin))
    );
    expect(appelants).toEqual([]);
  });

  it("aucun chemin de ce lot n'a été branché sur une suppression métier", () => {
    const sources = [
      ...SOURCES_PRODUCTION,
      ...listerFichiers(join(SRC, "lib", "retention"), (chemin) => chemin.endsWith(".ts") && !chemin.endsWith(".test.ts")),
    ];
    for (const chemin of sources) {
      expect(codeSeul(chemin), chemin).not.toMatch(/\.delete\s*\(/);
    }
  });
});

describe("l'ADR du lot existe et dit ce que le lot ne fait pas", () => {
  const ADR = join(SRC, "..", "..", "..", "docs", "adr", "069-retention-quarantine-foundation-v1.md");

  it("ADR-069 est présente et nomme le chantier", () => {
    expect(existsSync(ADR)).toBe(true);
    const texte = lire(ADR);
    expect(texte).toMatch(/RETENTION_QUARANTINE_FOUNDATION_V1/);
    expect(texte).toMatch(/ADR-069/);
  });

  it("l'absence de purge, de cron et de durée décidée est écrite noir sur blanc", () => {
    const texte = lire(ADR).toLowerCase();
    expect(texte).toMatch(/aucune purge|aucune suppression/);
    expect(texte).toMatch(/aucun cron/);
    expect(texte).toMatch(/undecided|non décidée|pas décidée/);
  });
});
