import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

// RETENTION_QUARANTINE_FOUNDATION_V1 (ADR-069) — INTERACTION QUARANTAINE / LEGAL HOLD, sur une vraie
// base. C'est le cœur fail-closed du lot, et il se prouve en six garanties :
//
//   1. une cible sous legal hold actif ne peut pas ENTRER en quarantaine ;
//   2. un hold posé APRÈS l'entrée bloque la revalidation ;
//   3. l'expiration de l'échéance ne contourne JAMAIS le hold ;
//   4. hold levé -> la revalidation reprend, et reste une revalidation (jamais une autorisation) ;
//   5. la quarantaine ne peut pas lever un legal hold ;
//   6. aucune suppression, dans aucun de ces cas.
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
  retentionQuarantines: quarantinesTable,
  runsRetention: runsRetentionTable,
  actionsRetention: actionsRetentionTable,
} = await import("@/db/schema");
const { creerQuarantaine, leverQuarantaine, revaliderQuarantaineEnBase, obtenirQuarantaine } = await import(
  "./quarantaineRepository"
);
const { creerLegalHold, leverLegalHold } = await import("@/lib/legalHold/legalHoldRepository");
const { executerDryRunRetention } = await import("@/lib/retention/dryRunRetention");
const { listerCandidatsBonVisitePourRetention } = await import("@/lib/retention/retentionRepository");

const SUFFIXE = Date.now();
const WORKSPACE = `ws-quar-hold-${SUFFIXE}`;
const AUTEUR = "sub-quar-hold-auteur";
const MOTIF_QUARANTAINE = "Echu depuis 2020, entree en quarantaine";
const MOTIF_HOLD = "Assignation au fond, dossier 2026/0099";
const MOTIF_LEVEE_HOLD = "Jugement definitif, affaire close";

// Échéance PROCHE mais future, et instant de revalidation postérieur : c'est la seule combinaison
// qui éprouve « échéance dépassée ET hold actif » — le scénario le plus dangereux du domaine — sans
// enfreindre l'invariant que le domaine fait respecter à l'entrée (une échéance antérieure à
// l'entrée produirait un état né expiré). Relatives à l'instant du test, parce que `entre_le` vaut
// `now()` en base : une date littérale passée rendrait ce fichier infalsifiable.
const ECHEANCE = new Date(Date.now() + 60_000);
const APRES_ECHEANCE = new Date(Date.now() + 3_600_000);

const ids = { bien: "", acquereur: "", visite: "", document: "", bon: "", bonProtege: "", visiteProtege: "", documentProtege: "" };
const quarantinesDuFichier = new Set<string>();
const holdsDuFichier = new Set<string>();
const runsDuFichier = new Set<string>();
let actionsAuDepart = 0;

async function creerBonSigne(reference: string, version: number) {
  const [document] = await getDb()
    .insert(documentsBienTable)
    .values({
      bienId: ids.bien,
      nom: `[fixture quar-hold] ${reference}`,
      nomFichierOriginal: "fixture.pdf",
      cleStockage: `fixture/quar-hold/${reference}.pdf`,
      tailleOctets: 1,
      typeMime: "application/pdf",
      categorie: "commercial",
      typeDocument: "bon_visite",
    })
    .returning({ id: documentsBienTable.id });

  const [bon] = await getDb()
    .insert(bonsVisiteTable)
    .values({
      visiteId: ids.visite,
      version,
      templateVersion: "v2",
      contenuSnapshot: {
        visite: { id: ids.visite, datePrevue: "2015-02-01" },
        bien: {
          id: ids.bien,
          reference,
          titre: "[fixture quar-hold] bien",
          adresse: "1 rue de la Fixture",
          ville: "Fixtureville",
          codePostal: "00000",
        },
        conseiller: { nom: "[fixture quar-hold]" },
        template: { version: "v2", texte: "[fixture quar-hold] aucun contenu personnel" },
      },
      statut: "signe",
      signeLe: new Date("2015-03-01T10:00:00.000Z"),
      documentId: document.id,
      hashDocument: `fixture-quar-hold-${reference}-${version}`,
    })
    .returning({ id: bonsVisiteTable.id });

  return { document: document.id, bon: bon.id };
}

beforeAll(async () => {
  const [compte] = await getDb().select({ n: sql<number>`count(*)::int` }).from(actionsRetentionTable);
  actionsAuDepart = compte.n;

  await getDb().insert(workspacesTable).values({ id: WORKSPACE, nom: "[test réel] quarantaine / legal hold" });

  const [bien] = await getDb()
    .insert(biensTable)
    .values({
      reference: `QH-${SUFFIXE}`,
      titre: "[fixture quar-hold] bien",
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
      nom: "QuarHold",
      email: `fixture-quar-hold-${SUFFIXE}@example.invalid`,
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

  // Deux bons : l'un suivra le parcours « quarantaine puis hold », l'autre sera protégé AVANT toute
  // quarantaine. Deux cibles distinctes, parce que les deux garanties sont distinctes.
  const principal = await creerBonSigne("principal", 1);
  ids.document = principal.document;
  ids.bon = principal.bon;
  const protege = await creerBonSigne("protege", 2);
  ids.documentProtege = protege.document;
  ids.bonProtege = protege.bon;
});

afterAll(async () => {
  const quarantines = [...quarantinesDuFichier];
  if (quarantines.length) await getDb().delete(quarantinesTable).where(inArray(quarantinesTable.id, quarantines));
  const holds = [...holdsDuFichier];
  if (holds.length) await getDb().delete(legalHoldsTable).where(inArray(legalHoldsTable.id, holds));
  const bons = [ids.bon, ids.bonProtege].filter(Boolean);
  if (bons.length) await getDb().delete(bonsVisiteTable).where(inArray(bonsVisiteTable.id, bons));
  if (ids.visite) await getDb().delete(visitesTable).where(eq(visitesTable.id, ids.visite));
  const documents = [ids.document, ids.documentProtege].filter(Boolean);
  if (documents.length) await getDb().delete(documentsBienTable).where(inArray(documentsBienTable.id, documents));
  if (ids.bien) await getDb().delete(biensTable).where(eq(biensTable.id, ids.bien));
  if (ids.acquereur) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, ids.acquereur));
  const runs = [...runsDuFichier];
  if (runs.length) {
    await getDb().delete(actionsRetentionTable).where(inArray(actionsRetentionTable.runId, runs));
    await getDb().delete(runsRetentionTable).where(inArray(runsRetentionTable.id, runs));
  }
  await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE));
});

async function entrer(entityId: string) {
  const resultat = await creerQuarantaine(
    {
      policyCode: "SIGNED_VISIT_FORM",
      entityType: "bons_visite",
      entityId,
      motif: MOTIF_QUARANTAINE,
      entreParIdentiteSub: AUTEUR,
      revalidationDueLe: ECHEANCE,
    },
    WORKSPACE
  );
  const ligne = (resultat as { quarantaine?: { id: string } }).quarantaine;
  if (ligne) quarantinesDuFichier.add(ligne.id);
  return resultat;
}

async function poserHold(entityId: string) {
  const resultat = await creerLegalHold(
    { entityType: "bons_visite", entityId, motifCode: "CONTENTIEUX", motif: MOTIF_HOLD, poseParIdentiteSub: AUTEUR },
    WORKSPACE
  );
  const hold = (resultat as { hold?: { id: string } }).hold;
  if (hold) holdsDuFichier.add(hold.id);
  return resultat;
}

async function dryRun() {
  const resultats = await executerDryRunRetention({ maintenant: APRES_ECHEANCE });
  for (const resultat of resultats) runsDuFichier.add(resultat.runId);
  const mien = resultats.find((resultat) => resultat.workspaceId === WORKSPACE);
  return mien!.politiques.find((p) => p.policyCode === "SIGNED_VISIT_FORM")!;
}

describe("garantie 1 — un legal hold actif EMPÊCHE l'entrée en quarantaine", () => {
  it("la cible protégée est refusée, et aucune quarantaine n'est écrite", async () => {
    const hold = await poserHold(ids.bonProtege);
    expect(hold.statut).toBe("cree");

    const avant = await compterQuarantines();
    const tentative = await entrer(ids.bonProtege);
    // Entrer en quarantaine est un pas délibéré vers une future purge : le faire sur une pièce
    // juridiquement protégée afficherait une progression vers la suppression de ce qui doit être
    // conservé. Le refus est nommé, pas silencieux.
    expect(tentative.statut).toBe("bloquee_par_legal_hold");
    expect(await compterQuarantines()).toBe(avant);
  });
});

describe("garanties 2 et 3 — un hold posé APRÈS l'entrée bloque la revalidation, et l'échéance ne le contourne pas", () => {
  let idQuarantaine = "";

  it("l'entrée est possible tant qu'aucun hold n'existe", async () => {
    const entree = await entrer(ids.bon);
    expect(entree.statut).toBe("creee");
    if (entree.statut !== "creee") return;
    idQuarantaine = entree.quarantaine.id;

    // Échéance DÉJÀ dépassée à l'instant de référence : rien ne bloque encore.
    expect((await revaliderQuarantaineEnBase(idQuarantaine, WORKSPACE, APRES_ECHEANCE))?.verdict).toBe(
      "AUCUN_BLOCAGE_CONNU"
    );
  });

  it("le hold posé ensuite fait basculer la revalidation en BLOCKED_BY_LEGAL_HOLD", async () => {
    const hold = await poserHold(ids.bon);
    expect(hold.statut).toBe("cree");

    const resultat = await revaliderQuarantaineEnBase(idQuarantaine, WORKSPACE, APRES_ECHEANCE);
    // LE scénario que l'étape 8 exige : la protection apparue APRÈS l'entrée bloque la future purge.
    expect(resultat?.verdict).toBe("BLOCKED_BY_LEGAL_HOLD");
  });

  it("une échéance dépassée de plusieurs années ne contourne jamais le hold", async () => {
    // L'expiration temporelle est évaluée APRÈS le hold, délibérément : aucun écoulement du temps ne
    // peut transformer une pièce protégée en pièce actionnable.
    const resultat = await revaliderQuarantaineEnBase(idQuarantaine, WORKSPACE, new Date("2099-01-01T00:00:00.000Z"));
    expect(resultat?.verdict).toBe("BLOCKED_BY_LEGAL_HOLD");
  });

  it("la quarantaine reste ACTIVE : le hold ne la lève pas en silence", async () => {
    // Aucun code ne lève automatiquement une quarantaine quand un hold apparaît. La lever
    // effacerait l'état et donc la trace de ce qui était en cours ; la bloquer le conserve.
    expect((await obtenirQuarantaine(idQuarantaine, WORKSPACE))?.leveeLe).toBeUndefined();
  });

  it("garantie 5 — la quarantaine n'a pas levé le legal hold", async () => {
    const holds = await getDb()
      .select({ id: legalHoldsTable.id, leveLe: legalHoldsTable.leveLe })
      .from(legalHoldsTable)
      .where(eq(legalHoldsTable.entityId, ids.bon));
    expect(holds).toHaveLength(1);
    expect(holds[0].leveLe).toBeNull();
  });

  it("garantie 4 — hold levé : la revalidation reprend, et reste une REVALIDATION", async () => {
    const [hold] = await getDb()
      .select({ id: legalHoldsTable.id })
      .from(legalHoldsTable)
      .where(eq(legalHoldsTable.entityId, ids.bon));
    expect(hold).toBeDefined();

    const levee = await leverLegalHold(
      hold.id,
      { motifLevee: MOTIF_LEVEE_HOLD, leveParIdentiteSub: AUTEUR },
      WORKSPACE
    );
    expect(levee.statut).toBe("leve");

    const resultat = await revaliderQuarantaineEnBase(idQuarantaine, WORKSPACE, APRES_ECHEANCE);
    // De retour au verdict le plus permissif du lot — qui n'autorise toujours RIEN.
    expect(resultat?.verdict).toBe("AUCUN_BLOCAGE_CONNU");
    expect(resultat?.verdict).not.toMatch(/AUTORIS|ALLOWED|DELETABLE/i);
  });

  it("garantie 6 — AUCUNE suppression dans aucun de ces cas", async () => {
    // Ni le bon, ni son document, ni sa visite, ni la quarantaine, ni le hold levé : tout est là.
    expect(await existe(bonsVisiteTable, ids.bon)).toBe(true);
    expect(await existe(documentsBienTable, ids.document)).toBe(true);
    expect(await existe(visitesTable, ids.visite)).toBe(true);
    expect(await obtenirQuarantaine(idQuarantaine, WORKSPACE)).toBeDefined();
    const holds = await getDb().select({ id: legalHoldsTable.id }).from(legalHoldsTable).where(eq(legalHoldsTable.entityId, ids.bon));
    expect(holds).toHaveLength(1);
  });

  it("la sortie de quarantaine reste non destructive, et ne touche pas la ressource", async () => {
    const levee = await leverQuarantaine(
      idQuarantaine,
      { causeLevee: "DECISION_MANUELLE", motifLevee: "Revue terminee, sortie du chemin", leveeParIdentiteSub: AUTEUR },
      WORKSPACE
    );
    expect(levee.statut).toBe("levee");
    expect(await existe(bonsVisiteTable, ids.bon)).toBe(true);
    expect(await existe(documentsBienTable, ids.document)).toBe(true);
    expect(await obtenirQuarantaine(idQuarantaine, WORKSPACE)).toBeDefined();
  });
});

describe("le dry-run est LECTEUR SEUL de la quarantaine", () => {
  it("il compte les cibles en quarantaine sans en créer aucune", async () => {
    const avant = await compterQuarantines();
    const entree = await entrer(ids.bon);
    expect(entree.statut).toBe("creee");

    const candidats = await listerCandidatsBonVisitePourRetention(WORKSPACE);
    expect(candidats.find((c) => c.id === ids.bon)?.enQuarantaineActive).toBe(true);
    expect(candidats.find((c) => c.id === ids.bonProtege)?.enQuarantaineActive).toBe(false);

    const politique = await dryRun();
    expect(politique.quarantineCount).toBe(1);
    // Le nombre de quarantaines n'a pas bougé du fait du dry-run : seule l'entrée explicite
    // ci-dessus en a créé une.
    expect(await compterQuarantines()).toBe(avant + 1);
  });

  it("la quarantaine n'est pas un blocage : la ligne reste comptée selon son verdict de politique", async () => {
    const politique = await dryRun();
    // `ids.bonProtege` est sous hold -> compté dans legalHoldCount. `ids.bon` est éligible et en
    // quarantaine -> compté dans eligibleCount ET dans quarantineCount. Les confondre masquerait
    // les lignes déjà prises en charge dans le même compteur que celles qui ne le sont pas.
    expect(politique.legalHoldCount).toBe(1);
    expect(politique.eligibleCount).toBe(1);
    expect(politique.quarantineCount).toBe(1);
    expect(politique.status).toBe("COMPUTABLE_DRY_RUN_ONLY");
  });

  it("la durée de quarantaine manquante est NOMMÉE dans les blocages avant suppression", async () => {
    const politique = await dryRun();
    expect(politique.blocagesAvantSuppression).toContain("QUARANTINE_POLICY_MISSING");
    // Et les blocages précédents restent : un de plus, jamais un de moins.
    expect(politique.blocagesAvantSuppression).toContain("DELETE_PATH_MISSING");
    expect(politique.blocagesAvantSuppression).toContain("FILE_DELETE_PRIMITIVE_MISSING");
  });

  it("aucune action de rétention n'a été écrite par aucun dry-run de ce fichier", async () => {
    const [ligne] = await getDb().select({ n: sql<number>`count(*)::int` }).from(actionsRetentionTable);
    expect(ligne.n).toBe(actionsAuDepart);
  });
});

async function compterQuarantines(): Promise<number> {
  const [ligne] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(quarantinesTable)
    .where(eq(quarantinesTable.workspaceId, WORKSPACE));
  return ligne.n;
}

async function existe(table: typeof bonsVisiteTable | typeof documentsBienTable | typeof visitesTable, id: string) {
  const lignes = await getDb().select({ id: table.id }).from(table).where(eq(table.id, id));
  return lignes.length === 1;
}
