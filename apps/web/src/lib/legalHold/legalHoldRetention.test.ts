import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

// LEGAL_HOLD_FOUNDATION_V1 (ADR-068) — LE scénario prioritaire du chantier, bout en bout, sur une
// vraie base :
//
//   un bon de visite signé, échu depuis longtemps (signe_le + 5 ans dépassés)
//   + un legal hold actif
//   => NON SUPPRIMABLE : verdict BLOCKED_BY_LEGAL_HOLD, jamais ELIGIBLE
//   puis levée du hold
//   => le calcul normal reprend : ELIGIBLE
//   et dans les DEUX cas : zéro suppression, en base comme sur disque.
//
// Test d'intégration : exige un Postgres local migré (voir docs/DEVELOPER_ONBOARDING.md, Partie 4).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  workspaces: workspacesTable,
  biens: biensTable,
  acquereurs: acquereursTable,
  visites: visitesTable,
  documentsBien: documentsBienTable,
  bonsVisite: bonsVisiteTable,
  legalHolds: legalHoldsTable,
  runsRetention: runsRetentionTable,
  actionsRetention: actionsRetentionTable,
} = await import("@/db/schema");
const { executerDryRunRetention, APPLY_SUPPORTED } = await import("@/lib/retention/dryRunRetention");
const { listerCandidatsBonVisitePourRetention } = await import("@/lib/retention/retentionRepository");
const { creerLegalHold, leverLegalHold } = await import("./legalHoldRepository");

const SUFFIXE = Date.now();
const WORKSPACE = `ws-lh-retention-${SUFFIXE}`;
// Signé en 2015, échéance 2020 : largement dépassée à l'instant de référence ci-dessous. La date de
// référence est FIXE et injectée — jamais `new Date()` — pour que ce test ne devienne pas faux avec
// le temps.
const SIGNE_LE = new Date("2015-03-01T10:00:00.000Z");
const MAINTENANT = new Date("2026-10-23T12:00:00.000Z");

const ids = { bien: "", acquereur: "", visite: "", document: "", bon: "", hold: "" };
const runsDuFichier = new Set<string>();
let actionsAuDepart = 0;

async function dryRun() {
  const resultats = await executerDryRunRetention({ maintenant: MAINTENANT });
  for (const resultat of resultats) runsDuFichier.add(resultat.runId);
  const mien = resultats.find((resultat) => resultat.workspaceId === WORKSPACE);
  expect(mien, "le dry-run doit couvrir le workspace de ce fichier").toBeDefined();
  const politique = mien!.politiques.find((p) => p.policyCode === "SIGNED_VISIT_FORM");
  expect(politique).toBeDefined();
  return politique!;
}

beforeAll(async () => {
  const [ligne] = await getDb().select({ n: sql<number>`count(*)::int` }).from(actionsRetentionTable);
  actionsAuDepart = ligne.n;

  await getDb().insert(workspacesTable).values({ id: WORKSPACE, nom: "[test réel] legal hold / rétention" });

  const [bien] = await getDb()
    .insert(biensTable)
    .values({
      reference: `LHR-${SUFFIXE}`,
      titre: "[fixture lh-retention] bien",
      type: "maison",
      adresse: "1 rue de la Fixture",
      ville: "Fixtureville",
      codePostal: "00000",
      surface: 100,
      pieces: 4,
      prix: 100000,
      dateMandat: "2015-01-01",
      workspaceId: WORKSPACE,
    })
    .returning({ id: biensTable.id });
  ids.bien = bien.id;

  const [acquereur] = await getDb()
    .insert(acquereursTable)
    .values({
      prenom: "Fixture",
      nom: "LhRetention",
      email: `fixture-lh-retention-${SUFFIXE}@example.invalid`,
      telephone: "0000000000",
      budgetMin: 1,
      budgetMax: 2,
      datePremiereContact: "2015-01-01",
      workspaceId: WORKSPACE,
    })
    .returning({ id: acquereursTable.id });
  ids.acquereur = acquereur.id;

  const [visite] = await getDb()
    .insert(visitesTable)
    .values({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2015-02-01" })
    .returning({ id: visitesTable.id });
  ids.visite = visite.id;

  const [document] = await getDb()
    .insert(documentsBienTable)
    .values({
      bienId: bien.id,
      nom: "[fixture lh-retention] bon de visite",
      nomFichierOriginal: "fixture.pdf",
      cleStockage: `fixture/lh-retention/${SUFFIXE}.pdf`,
      tailleOctets: 1,
      typeMime: "application/pdf",
      categorie: "commercial",
      typeDocument: "bon_visite",
    })
    .returning({ id: documentsBienTable.id });
  ids.document = document.id;

  const [bon] = await getDb()
    .insert(bonsVisiteTable)
    .values({
      visiteId: visite.id,
      version: 1,
      templateVersion: "v2",
      contenuSnapshot: {
        visite: { id: visite.id, datePrevue: "2015-02-01" },
        bien: {
          id: bien.id,
          reference: `LHR-${SUFFIXE}`,
          titre: "[fixture lh-retention] bien",
          adresse: "1 rue de la Fixture",
          ville: "Fixtureville",
          codePostal: "00000",
        },
        conseiller: { nom: "[fixture lh-retention]" },
        template: { version: "v2", texte: "[fixture lh-retention] aucun contenu personnel" },
      },
      statut: "signe",
      signeLe: SIGNE_LE,
      documentId: document.id,
      hashDocument: `fixture-lh-retention-${SUFFIXE}`,
    })
    .returning({ id: bonsVisiteTable.id });
  ids.bon = bon.id;
});

afterAll(async () => {
  if (ids.hold) await getDb().delete(legalHoldsTable).where(eq(legalHoldsTable.id, ids.hold));
  if (ids.bon) await getDb().delete(bonsVisiteTable).where(eq(bonsVisiteTable.id, ids.bon));
  if (ids.visite) await getDb().delete(visitesTable).where(eq(visitesTable.id, ids.visite));
  if (ids.document) await getDb().delete(documentsBienTable).where(eq(documentsBienTable.id, ids.document));
  if (ids.bien) await getDb().delete(biensTable).where(eq(biensTable.id, ids.bien));
  if (ids.acquereur) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, ids.acquereur));
  // Le dry-run est GLOBAL : il écrit un run par workspace, donc aussi pour les autres. Seuls les
  // runs déclenchés par ce fichier sont effacés, un par un.
  const runs = [...runsDuFichier];
  if (runs.length) {
    await getDb().delete(actionsRetentionTable).where(inArray(actionsRetentionTable.runId, runs));
    await getDb().delete(runsRetentionTable).where(inArray(runsRetentionTable.id, runs));
  }
  await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE));
});

describe("SIGNED_VISIT_FORM — sans legal hold, l'échéance est atteinte", () => {
  it("le bon échu est ÉLIGIBLE au calcul, et rien de plus", async () => {
    const politique = await dryRun();
    expect(politique.status).toBe("COMPUTABLE_DRY_RUN_ONLY");
    expect(politique.eligibleCount).toBe(1);
    expect(politique.legalHoldCount).toBe(0);
    // ÉLIGIBLE ne veut pas dire supprimable : les blocages avant suppression subsistent et
    // `APPLY_SUPPORTED` reste false.
    expect(politique.blocagesAvantSuppression).toContain("DELETE_PATH_MISSING");
    expect(APPLY_SUPPORTED).toBe(false);
  });

  it("le candidat lu par le repository n'est pas marqué protégé", async () => {
    const candidats = await listerCandidatsBonVisitePourRetention(WORKSPACE);
    expect(candidats).toHaveLength(1);
    expect(candidats[0].sousLegalHoldActif).toBe(false);
  });
});

describe("SIGNED_VISIT_FORM — avec un legal hold actif, la pièce est NON SUPPRIMABLE", () => {
  it("la pose du hold déplace le verdict d'ÉLIGIBLE vers BLOCKED_BY_LEGAL_HOLD", async () => {
    const pose = await creerLegalHold(
      {
        entityType: "bons_visite",
        entityId: ids.bon,
        motifCode: "CONTENTIEUX",
        motif: "Assignation au fond, dossier 2026/0042",
        poseParIdentiteSub: "sub-legalhold-poseur",
      },
      WORKSPACE
    );
    expect(pose.statut).toBe("cree");
    if (pose.statut !== "cree") return;
    ids.hold = pose.hold.id;

    const candidats = await listerCandidatsBonVisitePourRetention(WORKSPACE);
    expect(candidats[0].sousLegalHoldActif).toBe(true);

    const politique = await dryRun();
    // LE POINT DU CHANTIER : la ligne échue n'est plus comptée comme éligible. Elle n'a pas non plus
    // disparu des compteurs — elle est comptée AILLEURS, sous un nom qui dit pourquoi.
    expect(politique.eligibleCount).toBe(0);
    expect(politique.legalHoldCount).toBe(1);
    // Et pas dans `blockedCount` : une protection documentée ne se confond pas avec une incohérence
    // de données.
    expect(politique.blockedCount).toBe(0);
    // La politique reste parfaitement CALCULABLE : c'est la ligne qui est protégée, pas le calcul
    // qui est cassé.
    expect(politique.status).toBe("COMPUTABLE_DRY_RUN_ONLY");
  });

  it("l'échéance reste connue malgré le hold", async () => {
    // Le hold interdit d'agir ; il n'annule pas le fait que la pièce est échue depuis 2020. Effacer
    // l'échéance rendrait impossible de savoir, à la levée, depuis quand elle l'était.
    const candidats = await listerCandidatsBonVisitePourRetention(WORKSPACE);
    const { evaluerBonVisiteSigne } = await import("@/lib/retention/eligibilite");
    const evaluation = evaluerBonVisiteSigne(candidats[0], MAINTENANT, 5);
    expect(evaluation.statut).toBe("BLOCKED_BY_LEGAL_HOLD");
    expect(evaluation.blockerCode).toBe("ACTIVE_LEGAL_HOLD");
    expect(evaluation.eligibleAt?.toISOString()).toBe("2020-03-01T10:00:00.000Z");
  });

  it("aucune suppression n'a eu lieu : le bon, son document et le hold sont tous là", async () => {
    const bons = await getDb().select({ id: bonsVisiteTable.id }).from(bonsVisiteTable).where(eq(bonsVisiteTable.id, ids.bon));
    expect(bons).toHaveLength(1);
    const documents = await getDb()
      .select({ id: documentsBienTable.id })
      .from(documentsBienTable)
      .where(eq(documentsBienTable.id, ids.document));
    expect(documents).toHaveLength(1);
    const holds = await getDb().select({ id: legalHoldsTable.id }).from(legalHoldsTable).where(eq(legalHoldsTable.id, ids.hold));
    expect(holds).toHaveLength(1);
  });
});

describe("après levée du hold, le calcul normal reprend — et ne supprime toujours rien", () => {
  it("le bon redevient ÉLIGIBLE au calcul", async () => {
    const levee = await leverLegalHold(
      ids.hold,
      { motifLevee: "Jugement definitif, affaire close", leveParIdentiteSub: "sub-legalhold-leveur" },
      WORKSPACE
    );
    expect(levee.statut).toBe("leve");

    const candidats = await listerCandidatsBonVisitePourRetention(WORKSPACE);
    expect(candidats[0].sousLegalHoldActif).toBe(false);

    const politique = await dryRun();
    expect(politique.eligibleCount).toBe(1);
    expect(politique.legalHoldCount).toBe(0);
  });

  it("le hold levé reste en base — lever n'est pas supprimer", async () => {
    const [hold] = await getDb().select().from(legalHoldsTable).where(eq(legalHoldsTable.id, ids.hold));
    expect(hold).toBeDefined();
    expect(hold.leveLe).not.toBeNull();
    expect(hold.motif).toBe("Assignation au fond, dossier 2026/0042");
    expect(hold.motifLevee).toBe("Jugement definitif, affaire close");
  });

  it("ET SURTOUT : la levée n'a déclenché AUCUNE suppression", async () => {
    // Redevenir éligible au CALCUL n'est pas devenir supprimé. C'est l'invariant le plus important
    // de ce lot : il n'existe aucun chemin, dans aucun module, qui transforme une levée en purge.
    const bons = await getDb().select({ id: bonsVisiteTable.id }).from(bonsVisiteTable).where(eq(bonsVisiteTable.id, ids.bon));
    expect(bons).toHaveLength(1);
    const documents = await getDb()
      .select({ id: documentsBienTable.id })
      .from(documentsBienTable)
      .where(eq(documentsBienTable.id, ids.document));
    expect(documents).toHaveLength(1);
    const visites = await getDb().select({ id: visitesTable.id }).from(visitesTable).where(eq(visitesTable.id, ids.visite));
    expect(visites).toHaveLength(1);
  });

  it("aucune action de rétention n'a été écrite, par aucun des dry-runs de ce fichier", async () => {
    // `actions_retention` reste vide : le dry-run compte, il ne journalise aucune action, et un hold
    // n'en crée pas non plus. Comparé au relevé de départ plutôt qu'à zéro, pour rester juste même
    // si la base en contenait déjà.
    const [ligne] = await getDb().select({ n: sql<number>`count(*)::int` }).from(actionsRetentionTable);
    expect(ligne.n).toBe(actionsAuDepart);
  });
});
