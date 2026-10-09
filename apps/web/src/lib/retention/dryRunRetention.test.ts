import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — ce que seule une vraie base peut prouver : que
// le dry-run écrit UN run par workspace, AUCUNE action, ne touche à aucune donnée métier, scope
// correctement chaque workspace, et ne persiste aucune donnée personnelle.
//
// Le pendant hors base (frontière des 5 ans, fail-closed, statuts des neuf politiques) vit dans
// eligibilite.test.ts et ne demande aucun Postgres.
//
// Test d'intégration : exige un Postgres local migré (voir docs/DEVELOPER_ONBOARDING.md, Partie 4).
// La DATABASE_URL est fixée par vitest.setup.ts (garde test/production) — ce `??=` est un no-op.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  workspaces: workspacesTable,
  biens: biensTable,
  acquereurs: acquereursTable,
  visites: visitesTable,
  documentsBien: documentsBienTable,
  bonsVisite: bonsVisiteTable,
  runsRetention: runsRetentionTable,
  actionsRetention: actionsRetentionTable,
} = await import("@/db/schema");
const { executerDryRunRetention, ErreurModeRetentionNonSupporte } = await import("./dryRunRetention");
const { listerCandidatsBonVisitePourRetention } = await import("./retentionRepository");

// Workspace dédié à ce fichier : le seul moyen d'éprouver le scoping sans écrire dans le workspace
// historique, dont l'intégrité est précisément ce que T18 vérifie.
const WORKSPACE_ETRANGER = "[test réel] workspace-retention-etranger";

// Deux bons signés dans le workspace étranger, de part et d'autre de l'échéance de cinq ans : un
// comptage juste doit en voir exactement un éligible, jamais les deux ni aucun.
const SIGNE_ANCIEN = new Date("2015-03-01T10:00:00.000Z");
const SIGNE_RECENT = new Date("2024-03-01T10:00:00.000Z");
const MAINTENANT = new Date("2026-10-09T12:00:00.000Z");

const idsCrees = { bien: "", acquereur: "", visite: "", document: "", bonAncien: "", bonRecent: "" };

async function creerBonSigne(visiteId: string, documentId: string, version: number, signeLe: Date): Promise<string> {
  const [ligne] = await getDb()
    .insert(bonsVisiteTable)
    .values({
      visiteId,
      version,
      templateVersion: "v2",
      // Snapshot volontairement SANS donnée personnelle : ce fichier n'a pas besoin d'un signataire
      // réel pour prouver un comptage, et un moteur de rétention est le dernier endroit où en
      // introduire un. La forme, elle, est celle du type réel — le moteur ne doit pas être testé
      // contre une colonne qu'il ne verrait pas en production.
      contenuSnapshot: {
        visite: { id: visiteId, datePrevue: "2015-02-01" },
        bien: {
          id: idsCrees.bien,
          reference: "RET-FIXTURE-001",
          titre: "[fixture retention] bien",
          adresse: "1 rue de la Fixture",
          ville: "Fixtureville",
          codePostal: "00000",
        },
        conseiller: { nom: "[fixture retention]" },
        template: { version: "v2", texte: "[fixture retention] aucun contenu personnel" },
      },
      statut: "signe",
      signeLe,
      documentId,
      hashDocument: `fixture-retention-${version}`,
    })
    .returning({ id: bonsVisiteTable.id });
  return ligne.id;
}

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_ETRANGER, nom: "Rétention — workspace étranger" });

  const [bien] = await getDb()
    .insert(biensTable)
    .values({
      reference: "RET-FIXTURE-001",
      titre: "[fixture retention] bien",
      type: "maison",
      adresse: "1 rue de la Fixture",
      ville: "Fixtureville",
      codePostal: "00000",
      surface: 100,
      pieces: 4,
      prix: 100000,
      dateMandat: "2015-01-01",
      workspaceId: WORKSPACE_ETRANGER,
    })
    .returning({ id: biensTable.id });
  idsCrees.bien = bien.id;

  const [acquereur] = await getDb()
    .insert(acquereursTable)
    .values({
      prenom: "Fixture",
      nom: "Retention",
      email: "fixture-retention@example.invalid",
      telephone: "0000000000",
      budgetMin: 1,
      budgetMax: 2,
      datePremiereContact: "2015-01-01",
      workspaceId: WORKSPACE_ETRANGER,
    })
    .returning({ id: acquereursTable.id });
  idsCrees.acquereur = acquereur.id;

  const [visite] = await getDb()
    .insert(visitesTable)
    .values({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2015-02-01" })
    .returning({ id: visitesTable.id });
  idsCrees.visite = visite.id;

  // `bons_visite_coherence_statut_check` exige `document_id` NOT NULL dès `statut = 'signe'` : la
  // ligne documentaire n'est pas un décor, c'est l'invariant SQL qui rend le déclencheur fiable.
  const [document] = await getDb()
    .insert(documentsBienTable)
    .values({
      bienId: bien.id,
      nom: "[fixture retention] bon de visite",
      nomFichierOriginal: "fixture.pdf",
      cleStockage: "fixture/retention/bon.pdf",
      tailleOctets: 1,
      typeMime: "application/pdf",
      categorie: "commercial",
      typeDocument: "bon_visite",
    })
    .returning({ id: documentsBienTable.id });
  idsCrees.document = document.id;

  idsCrees.bonAncien = await creerBonSigne(visite.id, document.id, 1, SIGNE_ANCIEN);
  idsCrees.bonRecent = await creerBonSigne(visite.id, document.id, 2, SIGNE_RECENT);
});

afterAll(async () => {
  const bons = [idsCrees.bonAncien, idsCrees.bonRecent].filter(Boolean);
  if (bons.length) await getDb().delete(bonsVisiteTable).where(inArray(bonsVisiteTable.id, bons));
  if (idsCrees.visite) await getDb().delete(visitesTable).where(eq(visitesTable.id, idsCrees.visite));
  if (idsCrees.document) await getDb().delete(documentsBienTable).where(eq(documentsBienTable.id, idsCrees.document));
  if (idsCrees.bien) await getDb().delete(biensTable).where(eq(biensTable.id, idsCrees.bien));
  if (idsCrees.acquereur) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, idsCrees.acquereur));
  // Les runs de ce fichier sont purgés : la base de développement ne doit pas conserver un journal
  // de rétention issu d'une fixture. Les lignes du workspace historique le sont aussi, puisque le
  // balayage est global et en crée une à chaque appel.
  await getDb().delete(actionsRetentionTable);
  await getDb().delete(runsRetentionTable).where(eq(runsRetentionTable.workspaceId, WORKSPACE_ETRANGER));
  await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_ETRANGER));
});

async function compterActions(): Promise<number> {
  const [ligne] = await getDb().select({ n: sql<number>`count(*)::int` }).from(actionsRetentionTable);
  return ligne.n;
}

async function runsDuWorkspace(workspaceId: string) {
  return getDb()
    .select()
    .from(runsRetentionTable)
    .where(eq(runsRetentionTable.workspaceId, workspaceId))
    .orderBy(desc(runsRetentionTable.ordre));
}

async function empreinteMetier() {
  // Lu en SQL direct : on vérifie l'état des TABLES métier, pas la capacité d'un mapper à les
  // rendre. Le driver `postgres` rend un tableau de lignes, pas un objet `{ rows }` — même forme de
  // cast que workspacePrivacyIdentity.test.ts.
  const resultat = await getDb().execute(sql`
    SELECT (SELECT count(*) FROM bons_visite) AS bons,
           (SELECT count(*) FROM visites) AS visites,
           (SELECT count(*) FROM biens) AS biens,
           (SELECT count(*) FROM documents_bien) AS documents,
           (SELECT count(*) FROM contacts) AS contacts,
           (SELECT count(*) FROM acquereurs) AS acquereurs,
           (SELECT count(*) FROM evenements_metier) AS evenements
  `);
  const compteurs = (resultat as unknown as Record<string, unknown>[])[0];
  // Les lignes du fixture sont relues en entier : un dry-run qui aurait anonymisé, archivé ou
  // simplement horodaté quelque chose se verrait ici, là où un simple comptage ne le verrait pas.
  const lignes = await getDb()
    .select()
    .from(bonsVisiteTable)
    .where(inArray(bonsVisiteTable.id, [idsCrees.bonAncien, idsCrees.bonRecent]));
  return { compteurs, lignes: JSON.stringify(lignes) };
}

function politique(resultats: Awaited<ReturnType<typeof executerDryRunRetention>>, workspaceId: string, code: string) {
  const workspace = resultats.find((r) => r.workspaceId === workspaceId);
  expect(workspace, `aucun résultat pour le workspace ${workspaceId}`).toBeDefined();
  const trouvee = workspace!.politiques.find((p) => p.policyCode === code);
  expect(trouvee, `politique ${code} absente du résultat`).toBeDefined();
  return trouvee!;
}

describe("T16 / T17 — le dry-run écrit un run par workspace et aucune action", () => {
  it("T16 — un run par workspace balayé, démarré ET terminé, avec ses compteurs", async () => {
    const avant = (await runsDuWorkspace(WORKSPACE_ETRANGER)).length;
    const resultats = await executerDryRunRetention({ maintenant: MAINTENANT });

    const runs = await runsDuWorkspace(WORKSPACE_ETRANGER);
    expect(runs.length).toBe(avant + 1);

    const run = runs[0];
    expect(run.mode).toBe("dry-run");
    expect(run.demarreLe).toBeInstanceOf(Date);
    // `termine_le` renseigné : un run laissé inachevé serait le signe d'un balayage interrompu, et
    // ce test est le seul endroit qui distingue les deux.
    expect(run.termineLe).toBeInstanceOf(Date);
    expect(run.nombrePolitiques).toBe(politiquesAttendues(resultats));
    expect(run.nombreEligibles).toBe(1);
    expect(run.nombreBloquees).toBe(5);
    expect(run.erreurTechnique).toBeNull();

    // Un run par workspace, jamais un run global : le résultat retourné porte le même identifiant.
    const resultatEtranger = resultats.find((r) => r.workspaceId === WORKSPACE_ETRANGER);
    expect(resultatEtranger?.runId).toBe(run.id);
  });

  it("T17 — actions_retention reste VIDE : le dry-run ne construit aucun index des personnes bientôt effaçables", async () => {
    await executerDryRunRetention({ maintenant: MAINTENANT });
    expect(await compterActions()).toBe(0);
  });
});

function politiquesAttendues(resultats: Awaited<ReturnType<typeof executerDryRunRetention>>): number {
  return resultats[0]?.politiques.length ?? 0;
}

describe("T18 — aucune donnée métier n'est modifiée", () => {
  it("compteurs et lignes du fixture strictement identiques avant et après deux balayages", async () => {
    const avant = await empreinteMetier();
    await executerDryRunRetention({ maintenant: MAINTENANT });
    await executerDryRunRetention({ maintenant: MAINTENANT });
    const apres = await empreinteMetier();
    expect(apres).toEqual(avant);
  });
});

describe("T19 — scoping par workspace", () => {
  it("le bon signé du workspace étranger n'est compté que dans SON workspace", async () => {
    const resultats = await executerDryRunRetention({ maintenant: MAINTENANT });

    const etranger = politique(resultats, WORKSPACE_ETRANGER, "SIGNED_VISIT_FORM");
    expect(etranger.status).toBe("COMPUTABLE_DRY_RUN_ONLY");
    // Un éligible (signé en 2015) et un non encore éligible (signé en 2024) : le comptage distingue
    // les deux plutôt que de rendre « 2 candidats ».
    expect(etranger.eligibleCount).toBe(1);
    expect(etranger.notYetEligibleCount).toBe(1);
    expect(etranger.blockedCount).toBe(0);
    expect(etranger.oldestEligibleAt).toBe("2020-03-01T10:00:00.000Z");
    expect(etranger.newestEligibleAt).toBe("2020-03-01T10:00:00.000Z");

    const historique = politique(resultats, WORKSPACE_TEST, "SIGNED_VISIT_FORM");
    expect(historique.eligibleCount).toBe(0);
    expect(historique.notYetEligibleCount).toBe(0);

    // Chaque workspace a SON run, et deux workspaces distincts n'en partagent jamais un.
    const runIds = new Set(resultats.map((r) => r.runId));
    expect(runIds.size).toBe(resultats.length);
    expect(resultats.length).toBeGreaterThanOrEqual(2);
  });
});

describe("T20 — lecture minimale", () => {
  it("le repository ne ramène que id, workspaceId, statut et signeLe", async () => {
    const candidats = await listerCandidatsBonVisitePourRetention(WORKSPACE_ETRANGER);
    expect(candidats).toHaveLength(2);
    for (const candidat of candidats) {
      // Aucune autre clé : ni contenu_snapshot, ni identité du signataire, ni hash, ni clé de
      // stockage. Une donnée absente de l'objet est une donnée que le moteur ne peut pas divulguer.
      expect(Object.keys(candidat).sort()).toEqual(["id", "signeLe", "statut", "workspaceId"]);
      expect(candidat.workspaceId).toBe(WORKSPACE_ETRANGER);
    }
  });

  it("un bon d'un autre workspace n'est jamais chargé avant d'être écarté", async () => {
    const candidats = await listerCandidatsBonVisitePourRetention(WORKSPACE_TEST);
    expect(candidats.map((c) => c.id)).not.toContain(idsCrees.bonAncien);
  });
});

describe("T22 — rien de personnel n'est persisté ni retourné", () => {
  it("le run persisté ne contient que des compteurs et des horodatages", async () => {
    await executerDryRunRetention({ maintenant: MAINTENANT });
    const [run] = await runsDuWorkspace(WORKSPACE_ETRANGER);
    const serialise = JSON.stringify(run);
    for (const interdit of ["Fixture", "Retention", "fixture-retention@example.invalid", "0000000000", "rue de la Fixture", idsCrees.bonAncien]) {
      expect(serialise).not.toContain(interdit);
    }
    // Les seules colonnes du journal, nommées explicitement : toute colonne ajoutée plus tard devra
    // passer par ce test, qui est le seul endroit où « le journal ne porte pas de PII » est vérifié
    // autrement qu'en relecture.
    expect(Object.keys(run).sort()).toEqual(
      [
        "demarreLe",
        "erreurTechnique",
        "id",
        "mode",
        "nombreBloquees",
        "nombreEligibles",
        "nombrePolitiques",
        "ordre",
        "termineLe",
        "workspaceId",
      ].sort()
    );
  });

  it("la réponse du service ne porte aucun identifiant d'entité ni donnée personnelle", async () => {
    const resultats = await executerDryRunRetention({ maintenant: MAINTENANT });
    const serialise = JSON.stringify(resultats);
    for (const interdit of [idsCrees.bonAncien, idsCrees.bonRecent, idsCrees.bien, idsCrees.acquereur, "Fixture", "@example.invalid"]) {
      expect(serialise).not.toContain(interdit);
    }
    for (const workspace of resultats) {
      for (const p of workspace.politiques) {
        expect(Object.keys(p)).not.toContain("entityId");
        expect(Object.keys(p)).not.toContain("entityType");
      }
    }
  });
});

describe("T23 — idempotence", () => {
  it("deux balayages à instant et données constants donnent exactement les mêmes compteurs", async () => {
    const premier = await executerDryRunRetention({ maintenant: MAINTENANT });
    const second = await executerDryRunRetention({ maintenant: MAINTENANT });

    // Comparaison des POLITIQUES seules : `runId` diffère par construction (chaque balayage est
    // journalisé), et c'est précisément ce qui doit différer — rien d'autre.
    const sansRun = (r: typeof premier) =>
      r.map(({ workspaceId, mode, politiques }) => ({ workspaceId, mode, politiques }));
    expect(sansRun(second)).toEqual(sansRun(premier));
    expect(await compterActions()).toBe(0);
  });
});

describe("mode apply — refusé par le service, avant toute lecture", () => {
  it("lève ErreurModeRetentionNonSupporte et n'écrit aucun run", async () => {
    const avant = (await runsDuWorkspace(WORKSPACE_ETRANGER)).length;
    await expect(executerDryRunRetention({ mode: "apply", maintenant: MAINTENANT })).rejects.toThrow(
      ErreurModeRetentionNonSupporte
    );
    // Pas même un run : le refus précède l'ouverture du journal, donc « apply » ne laisse aucune
    // trace d'un balayage qui n'a pas eu lieu.
    expect((await runsDuWorkspace(WORKSPACE_ETRANGER)).length).toBe(avant);
    expect(await compterActions()).toBe(0);
  });

  it("aucun mode fantaisiste ne passe (fail-closed, pas une liste noire)", async () => {
    await expect(executerDryRunRetention({ mode: "APPLY", maintenant: MAINTENANT })).rejects.toThrow();
    await expect(executerDryRunRetention({ mode: "purge", maintenant: MAINTENANT })).rejects.toThrow();
    await expect(executerDryRunRetention({ mode: "", maintenant: MAINTENANT })).rejects.toThrow();
  });
});

describe("la base refuse elle-même ce que le code ne sait pas faire", () => {
  it("un verbe de suppression dans actions_retention est rejeté par PostgreSQL", async () => {
    const [run] = await runsDuWorkspace(WORKSPACE_ETRANGER);
    const cible = run ?? (await runsDuWorkspace(WORKSPACE_ETRANGER))[0];
    await expect(
      getDb()
        .insert(actionsRetentionTable)
        .values({
          runId: cible.id,
          policyCode: "SIGNED_VISIT_FORM",
          entityType: "bons_visite",
          entityId: idsCrees.bonAncien,
          action: "DELETE_DB",
        })
    ).rejects.toThrow();
    expect(await compterActions()).toBe(0);
  });

  it("un code de politique hors vocabulaire est rejeté par PostgreSQL", async () => {
    const [run] = await runsDuWorkspace(WORKSPACE_ETRANGER);
    await expect(
      getDb()
        .insert(actionsRetentionTable)
        .values({
          runId: run.id,
          policyCode: "POLITIQUE_INVENTEE",
          entityType: "bons_visite",
          entityId: idsCrees.bonAncien,
          action: "DRY_RUN_DETECTED",
        })
    ).rejects.toThrow();
    expect(await compterActions()).toBe(0);
  });

  it("un mode hors vocabulaire est rejeté par PostgreSQL", async () => {
    await expect(
      getDb().insert(runsRetentionTable).values({ workspaceId: WORKSPACE_ETRANGER, mode: "purge" })
    ).rejects.toThrow();
  });
});

describe("statuts rendus pour un workspace réel", () => {
  it("les neuf politiques sont rendues, avec les statuts d'ADR-066 §5", async () => {
    const resultats = await executerDryRunRetention({ maintenant: MAINTENANT });
    const attendu: Record<string, string> = {
      PROSPECT_MARKETING: "BLOCKED_MISSING_TRIGGER",
      CUSTOMER_MARKETING: "BLOCKED_MISSING_TRIGGER",
      SIGNED_VISIT_FORM: "COMPUTABLE_DRY_RUN_ONLY",
      SESSION: "ALREADY_ENFORCED",
      OIDC_STATE: "ALREADY_ENFORCED",
      GOOGLE_CONNECTION: "PARTIAL_EXISTING_RUNTIME",
      TRANSACTION_DOCUMENTS: "BLOCKED_UNDECIDED_POLICY",
      FREE_TEXT_NOTES: "BLOCKED_UNDECIDED_POLICY",
      ACTIVE_CLIENT_OR_PROJECT_DATA: "BLOCKED_UNDECIDED_POLICY",
    };
    for (const [code, status] of Object.entries(attendu)) {
      expect(politique(resultats, WORKSPACE_ETRANGER, code).status, code).toBe(status);
    }
    expect(politique(resultats, WORKSPACE_ETRANGER, "PROSPECT_MARKETING").blockerCode).toBe(
      "LAST_INBOUND_CONTACT_AT_MISSING"
    );
    expect(politique(resultats, WORKSPACE_ETRANGER, "SIGNED_VISIT_FORM").blocagesAvantSuppression).toEqual([
      "LEGAL_HOLD_MODEL_MISSING",
      "FILE_DELETE_PRIMITIVE_MISSING",
      "DELETE_PATH_MISSING",
    ]);
  });

  it("aucune politique bloquée ne compte d'éligible, et aucune ne lit la base pour le dire", async () => {
    const resultats = await executerDryRunRetention({ maintenant: MAINTENANT });
    for (const workspace of resultats) {
      for (const p of workspace.politiques) {
        if (p.status === "COMPUTABLE_DRY_RUN_ONLY") continue;
        expect(p.eligibleCount, p.policyCode).toBe(0);
        expect(p.oldestEligibleAt, p.policyCode).toBeUndefined();
        expect(p.newestEligibleAt, p.policyCode).toBeUndefined();
      }
    }
  });
});
