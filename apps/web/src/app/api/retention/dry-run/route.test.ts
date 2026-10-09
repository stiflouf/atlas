import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";

// RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — route MACHINE de dry-run.
//
// Test d'intégration réel, même patron que src/app/api/compatibilite/baseline/route.test.ts
// (ADR-036) et src/app/api/automatisations/scan/route.test.ts (ADR-033) : secret DÉDIÉ, distinct de
// ceux des quatre routes machine existantes.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";
const SECRET = "secret-retention-dry-run-de-test-tres-long-et-suffisant";
process.env.RETENTION_DRY_RUN_SECRET = SECRET;
// Secrets des autres routes machine, fixés ici pour prouver qu'aucun d'eux n'ouvre CETTE route.
process.env.AUTOMATISATIONS_SCAN_SECRET = "secret-de-test-tres-long-et-suffisant";
process.env.COMPATIBILITE_BASELINE_SECRET = "secret-baseline-de-test-tres-long-et-suffisant";

const { POST } = await import("./route");
const { getDb } = await import("@/db/client");
const { runsRetention: runsRetentionTable, actionsRetention: actionsRetentionTable } = await import("@/db/schema");

const AUTORISATION = `Bearer ${SECRET}`;

// ISOLATION — un appel autorisé déclenche un balayage GLOBAL, donc une ligne de journal par
// workspace, dont le workspace historique partagé avec toute la suite. Chaque réponse 200 porte ces
// identifiants : ce fichier les mémorise et ne nettoie que ceux-là. Purger la table entière, ou
// purger par workspace, effacerait des lignes écrites par un autre fichier et ferait dépendre la
// propreté de la base de l'ordre d'exécution.
const runsDuFichier = new Set<string>();

// Toujours passer par ce helper plutôt que par POST directement : c'est le seul endroit où les
// identifiants de run sont relevés, et un appel qui lui échapperait laisserait un résidu. Le corps
// est lu sur un CLONE, pour que l'appelant reçoive une réponse dont le flux est intact.
async function appeler(corps?: unknown, autorisation?: string): Promise<Response> {
  const reponse = await POST(requete(corps, autorisation));
  if (reponse.status === 200) {
    const lu = await reponse
      .clone()
      .json()
      .catch(() => null);
    for (const workspace of lu?.workspaces ?? []) if (workspace?.runId) runsDuFichier.add(workspace.runId);
  }
  return reponse;
}

function requete(corps?: unknown, autorisation?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (autorisation !== undefined) headers.set("authorization", autorisation);
  return new Request("http://localhost/api/retention/dry-run", {
    method: "POST",
    headers,
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
}

// Lectures globales, jamais des suppressions globales : mesurer tout le journal est ce qui permet
// de prouver qu'un refus n'écrit AUCUN run, y compris un run qui aurait échappé au relevé des
// identifiants. Effacer globalement, en revanche, détruirait le travail d'un autre fichier.
async function compterRuns(): Promise<number> {
  return (await getDb().select({ id: runsRetentionTable.id }).from(runsRetentionTable)).length;
}

async function compterActionsTotal(): Promise<number> {
  return (await getDb().select({ id: actionsRetentionTable.id }).from(actionsRetentionTable)).length;
}

// Relevé AVANT tout appel autorisé.
let actionsAuDepart = 0;
beforeAll(async () => {
  actionsAuDepart = await compterActionsTotal();
});

afterAll(async () => {
  // SEULS les runs déclenchés par ce fichier, identifiés un par un. Les actions d'abord (FK vers le
  // run), les runs ensuite. Le nettoyage est donc complet même si un test a échoué après un appel
  // autorisé, et il ne touche aucune ligne d'un autre fichier — y compris sur le workspace
  // historique, que ce fichier partage avec le reste de la suite.
  const runs = [...runsDuFichier];
  if (runs.length) {
    await getDb().delete(actionsRetentionTable).where(inArray(actionsRetentionTable.runId, runs));
    await getDb().delete(runsRetentionTable).where(inArray(runsRetentionTable.id, runs));
  }
});

describe("T24 — secret absent de la configuration", () => {
  afterEach(() => {
    process.env.RETENTION_DRY_RUN_SECRET = SECRET;
  });

  it("503, et surtout AUCUN balayage anonyme", async () => {
    delete process.env.RETENTION_DRY_RUN_SECRET;
    const avant = await compterRuns();
    const reponse = await appeler({}, AUTORISATION);
    expect(reponse.status).toBe(503);
    // Un secret non configuré ne doit jamais dégrader en « route ouverte » : rien n'a été balayé.
    expect(await compterRuns()).toBe(avant);
  });
});

describe("T25 / T26 — refus d'authentification", () => {
  it("T25 — Authorization absent → 401", async () => {
    const reponse = await appeler({});
    expect(reponse.status).toBe(401);
  });

  it("T26 — Bearer invalide → 401", async () => {
    expect((await appeler({}, "Bearer mauvais-secret")).status).toBe(401);
  });

  it("schéma d'authentification autre que Bearer → 401", async () => {
    expect((await appeler({}, `Basic ${SECRET}`)).status).toBe(401);
    expect((await appeler({}, SECRET)).status).toBe(401);
    expect((await appeler({}, "Bearer")).status).toBe(401);
    expect((await appeler({}, "")).status).toBe(401);
  });

  it("un secret de la bonne longueur mais différent → 401 (comparaison en temps constant)", async () => {
    const faux = "x".repeat(SECRET.length);
    expect(faux.length).toBe(SECRET.length);
    expect((await appeler({}, `Bearer ${faux}`)).status).toBe(401);
  });

  it("un préfixe du bon secret → 401 (longueur vérifiée avant timingSafeEqual)", async () => {
    expect((await appeler({}, `Bearer ${SECRET.slice(0, -1)}`)).status).toBe(401);
    expect((await appeler({}, `Bearer ${SECRET}x`)).status).toBe(401);
  });

  it("les secrets des autres routes machine ne suffisent jamais ici — endpoints distincts", async () => {
    for (const autre of [process.env.AUTOMATISATIONS_SCAN_SECRET, process.env.COMPATIBILITE_BASELINE_SECRET]) {
      expect((await appeler({}, `Bearer ${autre}`)).status).toBe(401);
    }
  });

  it("un refus n'écrit aucun run : rien n'est balayé avant d'être autorisé", async () => {
    const avant = await compterRuns();
    await appeler({}, "Bearer mauvais-secret");
    await appeler({});
    expect(await compterRuns()).toBe(avant);
  });
});

describe("T27 — Bearer valide → dry-run", () => {
  it("200, mode dry-run, applySupported false, un résultat par workspace", async () => {
    const avant = await compterRuns();
    const reponse = await appeler({}, AUTORISATION);
    expect(reponse.status).toBe(200);

    const corps = await reponse.json();
    expect(corps.mode).toBe("dry-run");
    expect(corps.applySupported).toBe(false);
    expect(Array.isArray(corps.workspaces)).toBe(true);
    expect(corps.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(await compterRuns()).toBe(avant + corps.workspaces.length);

    for (const workspace of corps.workspaces) {
      expect(workspace.mode).toBe("dry-run");
      expect(workspace.politiques).toHaveLength(9);
      for (const p of workspace.politiques) {
        expect(typeof p.policyCode).toBe("string");
        expect(typeof p.status).toBe("string");
        expect(typeof p.eligibleCount).toBe("number");
      }
    }
  });

  it("corps absent ou illisible → dry-run par défaut, jamais une erreur ni autre chose qu'un dry-run", async () => {
    expect((await appeler(undefined, AUTORISATION)).status).toBe(200);
    const reponse = await appeler("pas-un-objet", AUTORISATION);
    expect(reponse.status).toBe(200);
    expect((await reponse.json()).mode).toBe("dry-run");
  });

  it("mode dry-run explicite accepté", async () => {
    const reponse = await appeler({ mode: "dry-run" }, AUTORISATION);
    expect(reponse.status).toBe(200);
    expect((await reponse.json()).mode).toBe("dry-run");
  });

  it("aucune action de rétention n'est écrite par un appel autorisé", async () => {
    await appeler({}, AUTORISATION);
    expect(await compterActionsTotal()).toBe(actionsAuDepart);
  });
});

describe("T28 — le secret ne fuit ni dans la réponse ni dans les logs", () => {
  it("aucune réponse ne contient la valeur du secret", async () => {
    const cas: [unknown, string | undefined][] = [[{}, AUTORISATION], [{}, "Bearer mauvais-secret"], [{}, undefined]];
    for (const [corpsEnvoye, autorisation] of cas) {
      const corps = await (await appeler(corpsEnvoye, autorisation)).text();
      expect(corps).not.toContain(SECRET);
      expect(corps).not.toContain("mauvais-secret");
      expect(corps).not.toContain("RETENTION_DRY_RUN_SECRET");
    }
  });

  it("aucune console n'écrit le secret, ni sur succès ni sur refus", async () => {
    const espions = (["log", "info", "warn", "error", "debug"] as const).map((niveau) =>
      vi.spyOn(console, niveau).mockImplementation(() => {})
    );
    try {
      await appeler({}, AUTORISATION);
      await appeler({}, "Bearer mauvais-secret");
      await appeler({ mode: "apply" }, AUTORISATION);
      for (const espion of espions) {
        for (const appel of espion.mock.calls) {
          const serialise = JSON.stringify(appel);
          expect(serialise).not.toContain(SECRET);
          expect(serialise).not.toContain("mauvais-secret");
        }
      }
    } finally {
      for (const espion of espions) espion.mockRestore();
    }
  });
});

describe("T29 — mode apply refusé", () => {
  it("400, applySupported false, et aucun run écrit", async () => {
    const avant = await compterRuns();
    const reponse = await appeler({ mode: "apply" }, AUTORISATION);
    expect(reponse.status).toBe(400);

    const corps = await reponse.json();
    expect(corps.applySupported).toBe(false);
    expect(corps.erreur).toMatch(/non supporté/i);
    // Le refus précède l'ouverture du journal : « apply » ne laisse aucune trace d'un balayage.
    expect(await compterRuns()).toBe(avant);
  });

  it("aucun mode autre que dry-run ne passe (fail-closed, pas une liste noire)", async () => {
    for (const mode of ["apply", "APPLY", "Apply", "purge", "delete", "", "dry_run", "dryrun"]) {
      const reponse = await appeler({ mode }, AUTORISATION);
      expect(reponse.status, mode).toBe(400);
    }
  });

  it("un mode non textuel retombe sur dry-run plutôt que d'ouvrir un chemin inattendu", async () => {
    for (const mode of [null, 42, { apply: true }, ["apply"]]) {
      const reponse = await appeler({ mode }, AUTORISATION);
      expect(reponse.status).toBe(200);
      expect((await reponse.json()).mode).toBe("dry-run");
    }
  });
});

describe("T30 / T31 — classification et absence de session", () => {
  it("T30 — la route est déclarée dans ROUTES_MACHINE", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const garde = readFileSync(join(__dirname, "..", "..", "..", "..", "db", "frontiereWorkspace.structurel.test.ts"), "utf8");
    expect(garde).toContain('"api/retention/dry-run/route.ts"');
  });

  it("T31 — aucune session n'est nécessaire : la route n'importe aucune garde de session", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // Commentaires retirés avant la recherche : la route EXPLIQUE en commentaire pourquoi elle
    // n'appelle pas `exigerWorkspaceCourant()`, et ce test porte sur le code, pas sur la prose.
    const source = readFileSync(join(__dirname, "route.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    expect(source).not.toMatch(/exigerWorkspaceCourant|exigerSession|getSession|ownerWorkspaceCourant|cookies\(/);
    // Et elle répond 200 sans aucun cookie, ce que les appels ci-dessus font déjà : aucune des
    // requêtes de ce fichier ne porte de session.
    expect((await appeler({}, AUTORISATION)).status).toBe(200);
  });
});
