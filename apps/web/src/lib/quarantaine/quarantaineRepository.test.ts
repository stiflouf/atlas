import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

// RETENTION_QUARANTINE_FOUNDATION_V1 (ADR-069) — ce que seule une vraie base peut prouver : unicité
// des quarantaines actives, immutabilité du registre, idempotence de la levée sous concurrence
// réelle, isolation workspace, et revalidation sur données fraîches.
//
// Le pendant hors base (états dérivés, ordre des verdicts, durée non décidée) vit dans
// quarantaine.test.ts ; l'interaction avec les legal holds dans quarantaineLegalHold.test.ts.
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
  retentionQuarantines: quarantinesTable,
} = await import("@/db/schema");
const {
  creerQuarantaine,
  leverQuarantaine,
  obtenirQuarantaine,
  obtenirQuarantaineActive,
  listerQuarantainesActives,
  listerQuarantainesDeLaCible,
  listerCiblesEnQuarantaineActive,
  revaliderQuarantaineEnBase,
} = await import("./quarantaineRepository");
const { ErreurQuarantaineInvalide, etatQuarantaine } = await import("./quarantaine");

// DEUX workspaces réels, chacun avec SA cible : seul montage qui éprouve l'isolation. Un test à un
// seul workspace ne distingue pas « correctement filtré » de « il n'y avait rien d'autre ».
const SUFFIXE = Date.now();
const WORKSPACE_A = `ws-quarantaine-a-${SUFFIXE}`;
const WORKSPACE_B = `ws-quarantaine-b-${SUFFIXE}`;

const AUTEUR = "sub-quarantaine-auteur";
const LEVEUR = "sub-quarantaine-leveur";
const MOTIF = "Echu depuis 2020, revue de rétention annuelle";
const MOTIF_LEVEE = "Revue annuelle : maintien decide, sortie du chemin";

// Échéances EXPLICITES : aucune durée de quarantaine n'est décidée dans le produit, donc aucun test
// ne peut la dériver — il la fournit, comme le fera tout appelant réel.
//
// Elles sont relatives à l'instant du test et non littérales, parce que `entre_le` vaut `now()` en
// base et que le domaine REFUSE une échéance antérieure à l'entrée (elle produirait un état né
// expiré). Une date littérale passée rendrait donc ce fichier infalsifiable le jour où elle est
// dépassée. L'instant de REVALIDATION, lui, reste injecté : c'est ce qui permet d'éprouver
// « échéance dépassée » sans attendre.
const ECHEANCE_LOINTAINE = new Date("2099-01-01T00:00:00.000Z");
const ECHEANCE_PROCHE = new Date(Date.now() + 60_000);
const APRES_ECHEANCE_PROCHE = new Date(Date.now() + 3_600_000);

const ids = {
  bienA: "",
  bienB: "",
  acquereurA: "",
  acquereurB: "",
  visiteA: "",
  visiteB: "",
  documentA: "",
  documentB: "",
  bonA: "",
  bonB: "",
};

const quarantinesDuFichier = new Set<string>();

function memoriser<T extends { statut: string }>(resultat: T): T {
  const ligne = (resultat as { quarantaine?: { id: string } }).quarantaine;
  if (ligne) quarantinesDuFichier.add(ligne.id);
  return resultat;
}

async function creerDecor(workspaceId: string, reference: string) {
  const [bien] = await getDb()
    .insert(biensTable)
    .values({
      reference,
      titre: "[fixture quarantaine] bien",
      type: "maison",
      adresse: "1 rue de la Fixture",
      ville: "Fixtureville",
      codePostal: "00000",
      surface: 100,
      pieces: 4,
      prix: 100000,
      dateMandat: "2015-01-01",
      workspaceId,
    })
    .returning({ id: biensTable.id });

  const [acquereur] = await getDb()
    .insert(acquereursTable)
    .values({
      prenom: "Fixture",
      nom: "Quarantaine",
      email: `fixture-quarantaine-${reference}@example.invalid`,
      telephone: "0000000000",
      budgetMin: 1,
      budgetMax: 2,
      datePremiereContact: "2015-01-01",
      workspaceId,
    })
    .returning({ id: acquereursTable.id });

  const [visite] = await getDb()
    .insert(visitesTable)
    .values({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2015-02-01" })
    .returning({ id: visitesTable.id });

  // `bons_visite_coherence_statut_check` exige `document_id` NOT NULL dès `statut = 'signe'`.
  const [document] = await getDb()
    .insert(documentsBienTable)
    .values({
      bienId: bien.id,
      nom: "[fixture quarantaine] bon de visite",
      nomFichierOriginal: "fixture.pdf",
      cleStockage: `fixture/quarantaine/${reference}.pdf`,
      tailleOctets: 1,
      typeMime: "application/pdf",
      categorie: "commercial",
      typeDocument: "bon_visite",
    })
    .returning({ id: documentsBienTable.id });

  // Signé en 2015 : échéance de CONSERVATION (cinq ans) largement dépassée, donc `ELIGIBLE` au sens
  // de la politique — la condition d'entrée en quarantaine.
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
          reference,
          titre: "[fixture quarantaine] bien",
          adresse: "1 rue de la Fixture",
          ville: "Fixtureville",
          codePostal: "00000",
        },
        conseiller: { nom: "[fixture quarantaine]" },
        template: { version: "v2", texte: "[fixture quarantaine] aucun contenu personnel" },
      },
      statut: "signe",
      signeLe: new Date("2015-03-01T10:00:00.000Z"),
      documentId: document.id,
      hashDocument: `fixture-quarantaine-${reference}`,
    })
    .returning({ id: bonsVisiteTable.id });

  return { bien: bien.id, acquereur: acquereur.id, visite: visite.id, document: document.id, bon: bon.id };
}

beforeAll(async () => {
  await getDb()
    .insert(workspacesTable)
    .values([
      { id: WORKSPACE_A, nom: "[test réel] quarantaine A" },
      { id: WORKSPACE_B, nom: "[test réel] quarantaine B" },
    ]);

  const a = await creerDecor(WORKSPACE_A, `QA-${SUFFIXE}`);
  const b = await creerDecor(WORKSPACE_B, `QB-${SUFFIXE}`);
  ids.bienA = a.bien;
  ids.acquereurA = a.acquereur;
  ids.visiteA = a.visite;
  ids.documentA = a.document;
  ids.bonA = a.bon;
  ids.bienB = b.bien;
  ids.acquereurB = b.acquereur;
  ids.visiteB = b.visite;
  ids.documentB = b.document;
  ids.bonB = b.bon;
});

afterAll(async () => {
  const quarantines = [...quarantinesDuFichier];
  if (quarantines.length) await getDb().delete(quarantinesTable).where(inArray(quarantinesTable.id, quarantines));
  const bons = [ids.bonA, ids.bonB].filter(Boolean);
  if (bons.length) await getDb().delete(bonsVisiteTable).where(inArray(bonsVisiteTable.id, bons));
  const visites = [ids.visiteA, ids.visiteB].filter(Boolean);
  if (visites.length) await getDb().delete(visitesTable).where(inArray(visitesTable.id, visites));
  const documents = [ids.documentA, ids.documentB].filter(Boolean);
  if (documents.length) await getDb().delete(documentsBienTable).where(inArray(documentsBienTable.id, documents));
  const biens = [ids.bienA, ids.bienB].filter(Boolean);
  if (biens.length) await getDb().delete(biensTable).where(inArray(biensTable.id, biens));
  const acquereurs = [ids.acquereurA, ids.acquereurB].filter(Boolean);
  if (acquereurs.length) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, acquereurs));
  await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, [WORKSPACE_A, WORKSPACE_B]));
});

async function entrer(options: { workspaceId: string; entityId: string; echeance?: Date }) {
  return memoriser(
    await creerQuarantaine(
      {
        policyCode: "SIGNED_VISIT_FORM",
        entityType: "bons_visite",
        entityId: options.entityId,
        motif: MOTIF,
        entreParIdentiteSub: AUTEUR,
        revalidationDueLe: options.echeance ?? ECHEANCE_LOINTAINE,
      },
      options.workspaceId
    )
  );
}

describe("entrée en quarantaine", () => {
  it("crée un état actif, motivé, attribué, horodaté par la base, avec une échéance explicite", async () => {
    const avant = new Date();
    const resultat = await entrer({ workspaceId: WORKSPACE_A, entityId: ids.bonA });

    expect(resultat.statut).toBe("creee");
    if (resultat.statut !== "creee") return;
    const q = resultat.quarantaine;

    expect(q.workspaceId).toBe(WORKSPACE_A);
    expect(q.policyCode).toBe("SIGNED_VISIT_FORM");
    expect(q.entityType).toBe("bons_visite");
    expect(q.entityId).toBe(ids.bonA);
    expect(q.motif).toBe(MOTIF);
    expect(q.entreParIdentiteSub).toBe(AUTEUR);
    expect(q.revalidationDueLe.toISOString()).toBe(ECHEANCE_LOINTAINE.toISOString());
    // `entre_le` vient du DEFAULT `now()` de la base, pas du JS.
    expect(q.entreLe.getTime()).toBeGreaterThan(avant.getTime() - 5000);
    expect(q.entreLe.getTime()).toBeLessThan(Date.now() + 5000);
    // Les quatre colonnes de sortie sont vides : le CHECK de cohérence garantit « toutes ou aucune ».
    expect(q.leveeLe).toBeUndefined();
    expect(q.leveeParIdentiteSub).toBeUndefined();
    expect(q.causeLevee).toBeUndefined();
    expect(q.motifLevee).toBeUndefined();
    // Et l'état dérivé est bien EN_QUARANTAINE, jamais quelque chose de permissif.
    expect(etatQuarantaine(q, new Date())).toBe("EN_QUARANTAINE");
  });

  it("une cible inexistante ou non-uuid est refusée, et aucune ligne n'est écrite", async () => {
    const avant = await compter(WORKSPACE_A);
    expect((await entrer({ workspaceId: WORKSPACE_A, entityId: "00000000-0000-4000-8000-000000000000" })).statut).toBe(
      "cible_introuvable"
    );
    expect((await entrer({ workspaceId: WORKSPACE_A, entityId: "pas-un-uuid" })).statut).toBe("cible_introuvable");
    expect(await compter(WORKSPACE_A)).toBe(avant);
  });

  it("une cible d'un AUTRE workspace est introuvable — jamais « refusée »", async () => {
    // Indistinguable d'une cible absente : un message différent renseignerait sur l'existence d'une
    // ligne hors périmètre.
    const avant = await compter(WORKSPACE_A);
    expect((await entrer({ workspaceId: WORKSPACE_A, entityId: ids.bonB })).statut).toBe("cible_introuvable");
    expect(await compter(WORKSPACE_A)).toBe(avant);
  });

  it("une échéance absente, invalide ou antérieure à maintenant est refusée sans écriture", async () => {
    const avant = await compter(WORKSPACE_A);
    const base = {
      policyCode: "SIGNED_VISIT_FORM" as const,
      entityType: "bons_visite" as const,
      entityId: ids.bonA,
      motif: MOTIF,
      entreParIdentiteSub: AUTEUR,
    };
    await expect(
      creerQuarantaine({ ...base, revalidationDueLe: undefined as unknown as Date }, WORKSPACE_A)
    ).rejects.toThrow(ErreurQuarantaineInvalide);
    await expect(
      creerQuarantaine({ ...base, revalidationDueLe: new Date("2000-01-01T00:00:00.000Z") }, WORKSPACE_A)
    ).rejects.toThrow(ErreurQuarantaineInvalide);
    expect(await compter(WORKSPACE_A)).toBe(avant);
  });

  it("un motif, un auteur ou une politique invalides sont refusés sans écriture", async () => {
    const avant = await compter(WORKSPACE_A);
    const base = {
      entityType: "bons_visite" as const,
      entityId: ids.bonA,
      entreParIdentiteSub: AUTEUR,
      revalidationDueLe: ECHEANCE_LOINTAINE,
    };
    await expect(
      creerQuarantaine({ ...base, policyCode: "SIGNED_VISIT_FORM", motif: "court" }, WORKSPACE_A)
    ).rejects.toThrow(ErreurQuarantaineInvalide);
    await expect(
      creerQuarantaine({ ...base, policyCode: "SIGNED_VISIT_FORM", motif: MOTIF, entreParIdentiteSub: "" }, WORKSPACE_A)
    ).rejects.toThrow(ErreurQuarantaineInvalide);
    // Une politique bloquée ne peut produire aucun candidat.
    await expect(
      creerQuarantaine(
        { ...base, policyCode: "PROSPECT_MARKETING" as unknown as "SIGNED_VISIT_FORM", motif: MOTIF },
        WORKSPACE_A
      )
    ).rejects.toThrow(ErreurQuarantaineInvalide);
    expect(await compter(WORKSPACE_A)).toBe(avant);
  });
});

// Remet une cible à l'état « aucune quarantaine active », pour que chaque scénario parte d'un état
// connu : les tests de ce fichier partagent deux cibles, et un scénario qui héritait d'une
// quarantaine ouverte par le précédent n'éprouverait pas ce qu'il annonce.
async function reinitialiser(workspaceId: string, entityId: string) {
  const active = await obtenirQuarantaineActive("bons_visite", entityId, "SIGNED_VISIT_FORM", workspaceId);
  if (!active) return;
  await leverQuarantaine(
    active.id,
    { causeLevee: "DECISION_MANUELLE", motifLevee: "Reinitialisation de fixture de test", leveeParIdentiteSub: LEVEUR },
    workspaceId
  );
}

describe("unicité et concurrence", () => {
  it("une seconde entrée pour la même cible et la même politique rend `deja_active`", async () => {
    await reinitialiser(WORKSPACE_B, ids.bonB);
    const premier = await entrer({ workspaceId: WORKSPACE_B, entityId: ids.bonB });
    expect(premier.statut).toBe("creee");

    const second = await entrer({ workspaceId: WORKSPACE_B, entityId: ids.bonB });
    expect(second.statut).toBe("deja_active");
    if (second.statut !== "deja_active" || premier.statut !== "creee") return;
    // LA MÊME ligne, pas une seconde : l'état n'est pas dupliqué.
    expect(second.quarantaine.id).toBe(premier.quarantaine.id);
  });

  it("deux entrées SIMULTANÉES : exactement une crée, l'autre constate", async () => {
    // La course est tranchée par l'index partiel `retention_quarantines_cible_active_unique`, pas
    // par le code applicatif : un `SELECT puis INSERT si absent` aurait laissé passer les deux.
    await reinitialiser(WORKSPACE_A, ids.bonA);
    const [a, b] = await Promise.all([
      entrer({ workspaceId: WORKSPACE_A, entityId: ids.bonA }),
      entrer({ workspaceId: WORKSPACE_A, entityId: ids.bonA }),
    ]);
    expect([a.statut, b.statut].sort()).toEqual(["creee", "deja_active"]);
    expect(await compterActives(WORKSPACE_A, ids.bonA)).toBe(1);
  });
});

describe("sortie non destructive", () => {
  it("lève la quarantaine, et l'historique d'entrée est INTACT", async () => {
    await reinitialiser(WORKSPACE_B, ids.bonB);
    const entree = await entrer({ workspaceId: WORKSPACE_B, entityId: ids.bonB });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";
    const avant = await obtenirQuarantaine(id, WORKSPACE_B);

    const levee = await leverQuarantaine(
      id,
      { causeLevee: "DECISION_MANUELLE", motifLevee: MOTIF_LEVEE, leveeParIdentiteSub: LEVEUR },
      WORKSPACE_B
    );
    expect(levee.statut).toBe("levee");
    if (levee.statut !== "levee") return;

    // LEVER N'EST PAS SUPPRIMER : la ligne existe toujours, et rien de l'entrée n'a été écrasé.
    expect(levee.quarantaine.id).toBe(id);
    expect(levee.quarantaine.motif).toBe(MOTIF);
    expect(levee.quarantaine.entreParIdentiteSub).toBe(AUTEUR);
    expect(levee.quarantaine.entreLe.getTime()).toBe(avant!.entreLe.getTime());
    expect(levee.quarantaine.revalidationDueLe.getTime()).toBe(avant!.revalidationDueLe.getTime());
    // Et la sortie est complète : datée, attribuée, causée, motivée.
    expect(levee.quarantaine.causeLevee).toBe("DECISION_MANUELLE");
    expect(levee.quarantaine.motifLevee).toBe(MOTIF_LEVEE);
    expect(levee.quarantaine.leveeParIdentiteSub).toBe(LEVEUR);
    expect(levee.quarantaine.leveeLe).toBeDefined();
    expect(etatQuarantaine(levee.quarantaine, new Date())).toBe("LEVEE");
  });

  it("la quarantaine levée reste LISIBLE dans l'historique de la cible", async () => {
    const historique = await listerQuarantainesDeLaCible("bons_visite", ids.bonB, WORKSPACE_B);
    const levees = historique.filter((q) => q.leveeLe !== undefined);
    expect(levees.length).toBeGreaterThanOrEqual(1);
    // Toute sortie du registre est COMPLÈTE : datée, attribuée, causée, motivée — et son motif
    // d'ENTRÉE est intact. C'est l'invariant, quel que soit le motif de sortie employé.
    for (const q of levees) {
      expect(q.motif).toBe(MOTIF);
      expect(q.causeLevee).toBeDefined();
      expect(q.leveeParIdentiteSub).toBeDefined();
      expect(q.motifLevee!.length).toBeGreaterThanOrEqual(10);
    }
    // Et la sortie du scénario précédent est bien celle qu'il a écrite, mot pour mot.
    expect(levees.some((q) => q.motifLevee === MOTIF_LEVEE && q.causeLevee === "DECISION_MANUELLE")).toBe(true);
  });

  it("une cible dont la quarantaine est levée peut en recevoir une NOUVELLE", async () => {
    // C'est ce que rend possible l'index unique PARTIEL : un index total aurait interdit pour
    // toujours de remettre en quarantaine une cible déjà sortie une fois.
    expect(await obtenirQuarantaineActive("bons_visite", ids.bonB, "SIGNED_VISIT_FORM", WORKSPACE_B)).toBeUndefined();
    const nouvelle = await entrer({ workspaceId: WORKSPACE_B, entityId: ids.bonB });
    expect(nouvelle.statut).toBe("creee");
    const historique = await listerQuarantainesDeLaCible("bons_visite", ids.bonB, WORKSPACE_B);
    expect(historique.length).toBeGreaterThanOrEqual(2);
  });

  it("une seconde levée rend `deja_levee` sans écraser la première", async () => {
    const entree = await entrer({ workspaceId: WORKSPACE_B, entityId: ids.bonB });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";

    const premiere = await leverQuarantaine(
      id,
      { causeLevee: "DECISION_MANUELLE", motifLevee: MOTIF_LEVEE, leveeParIdentiteSub: LEVEUR },
      WORKSPACE_B
    );
    expect(premiere.statut).toBe("levee");

    const seconde = await leverQuarantaine(
      id,
      { causeLevee: "CIBLE_DISPARUE", motifLevee: "Seconde levee qui ne doit rien ecraser", leveeParIdentiteSub: "sub-autre" },
      WORKSPACE_B
    );
    expect(seconde.statut).toBe("deja_levee");
    if (seconde.statut !== "deja_levee" || premiere.statut !== "levee") return;
    // L'idempotence est portée par le `WHERE levee_le IS NULL` de l'UPDATE, pas par une
    // vérification applicative qui aurait laissé la seconde écrire.
    expect(seconde.quarantaine.causeLevee).toBe("DECISION_MANUELLE");
    expect(seconde.quarantaine.motifLevee).toBe(MOTIF_LEVEE);
    expect(seconde.quarantaine.leveeParIdentiteSub).toBe(LEVEUR);
    expect(seconde.quarantaine.leveeLe!.getTime()).toBe(premiere.quarantaine.leveeLe!.getTime());
  });

  it("deux levées SIMULTANÉES : exactement une lève, l'autre constate", async () => {
    const entree = await entrer({ workspaceId: WORKSPACE_A, entityId: ids.bonA });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";
    const [a, b] = await Promise.all([
      leverQuarantaine(
        id,
        { causeLevee: "DECISION_MANUELLE", motifLevee: "Levee concurrente numero un", leveeParIdentiteSub: LEVEUR },
        WORKSPACE_A
      ),
      leverQuarantaine(
        id,
        { causeLevee: "DECISION_MANUELLE", motifLevee: "Levee concurrente numero deux", leveeParIdentiteSub: LEVEUR },
        WORKSPACE_A
      ),
    ]);
    expect([a.statut, b.statut].sort()).toEqual(["deja_levee", "levee"]);
  });

  it("une quarantaine inexistante ou un id non-uuid est introuvable", async () => {
    const levee = { causeLevee: "DECISION_MANUELLE" as const, motifLevee: MOTIF_LEVEE, leveeParIdentiteSub: LEVEUR };
    expect((await leverQuarantaine("00000000-0000-4000-8000-000000000000", levee, WORKSPACE_A)).statut).toBe(
      "introuvable"
    );
    expect((await leverQuarantaine("pas-un-uuid", levee, WORKSPACE_A)).statut).toBe("introuvable");
  });

  it("une levée sans motif, sans auteur ou sans cause valide lève, et ne modifie rien", async () => {
    const entree = await entrer({ workspaceId: WORKSPACE_A, entityId: ids.bonA });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";

    await expect(
      leverQuarantaine(id, { causeLevee: "DECISION_MANUELLE", motifLevee: "court", leveeParIdentiteSub: LEVEUR }, WORKSPACE_A)
    ).rejects.toThrow(ErreurQuarantaineInvalide);
    await expect(
      leverQuarantaine(id, { causeLevee: "DECISION_MANUELLE", motifLevee: MOTIF_LEVEE, leveeParIdentiteSub: "" }, WORKSPACE_A)
    ).rejects.toThrow(ErreurQuarantaineInvalide);
    await expect(
      leverQuarantaine(
        id,
        { causeLevee: "AUTRE" as unknown as "DECISION_MANUELLE", motifLevee: MOTIF_LEVEE, leveeParIdentiteSub: LEVEUR },
        WORKSPACE_A
      )
    ).rejects.toThrow(ErreurQuarantaineInvalide);

    const apres = await obtenirQuarantaine(id, WORKSPACE_A);
    expect(apres?.leveeLe).toBeUndefined();
  });
});

describe("isolation workspace", () => {
  it("un workspace ne LIT pas les quarantaines d'un autre", async () => {
    const activesA = await listerQuarantainesActives(WORKSPACE_A);
    const activesB = await listerQuarantainesActives(WORKSPACE_B);
    expect(activesA.every((q) => q.workspaceId === WORKSPACE_A)).toBe(true);
    expect(activesB.every((q) => q.workspaceId === WORKSPACE_B)).toBe(true);
    expect(activesA.some((q) => q.entityId === ids.bonB)).toBe(false);
    expect(activesB.some((q) => q.entityId === ids.bonA)).toBe(false);
  });

  it("une quarantaine d'un autre workspace est INTROUVABLE à la lecture unitaire", async () => {
    const entree = await entrer({ workspaceId: WORKSPACE_B, entityId: ids.bonB });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";
    expect(await obtenirQuarantaine(id, WORKSPACE_B)).toBeDefined();
    expect(await obtenirQuarantaine(id, WORKSPACE_A)).toBeUndefined();
  });

  it("un workspace ne peut pas LEVER la quarantaine d'un autre", async () => {
    const entree = await entrer({ workspaceId: WORKSPACE_B, entityId: ids.bonB });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";

    const tentative = await leverQuarantaine(
      id,
      { causeLevee: "DECISION_MANUELLE", motifLevee: "Levee depuis un autre workspace", leveeParIdentiteSub: LEVEUR },
      WORKSPACE_A
    );
    expect(tentative.statut).toBe("introuvable");
    expect((await obtenirQuarantaine(id, WORKSPACE_B))?.leveeLe).toBeUndefined();
  });

  it("un workspace ne peut pas REVALIDER la quarantaine d'un autre", async () => {
    const entree = await entrer({ workspaceId: WORKSPACE_B, entityId: ids.bonB });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";
    expect(await revaliderQuarantaineEnBase(id, WORKSPACE_A, new Date())).toBeUndefined();
    expect(await revaliderQuarantaineEnBase(id, WORKSPACE_B, new Date())).toBeDefined();
  });

  it("l'ensemble des cibles en quarantaine est scopé, et un workspace sans état rend un ensemble vide", async () => {
    expect((await listerCiblesEnQuarantaineActive("bons_visite", WORKSPACE_A)).has(ids.bonB)).toBe(false);

    // Un troisième workspace, volontairement sans aucune quarantaine : c'est lui qui prouve que
    // « vide » veut dire vide, et non « filtre inopérant ».
    const VIDE = `ws-quarantaine-vide-${SUFFIXE}`;
    await getDb().insert(workspacesTable).values({ id: VIDE, nom: "[test réel] quarantaine vide" });
    try {
      expect((await listerCiblesEnQuarantaineActive("bons_visite", VIDE)).size).toBe(0);
      expect(await listerQuarantainesActives(VIDE)).toEqual([]);
    } finally {
      await getDb().delete(workspacesTable).where(eq(workspacesTable.id, VIDE));
    }
  });
});

describe("revalidation sur données fraîches", () => {
  it("avant l'échéance : ECHEANCE_NON_ATTEINTE, et rien n'est écrit", async () => {
    await reinitialiser(WORKSPACE_A, ids.bonA);
    const entree = await entrer({ workspaceId: WORKSPACE_A, entityId: ids.bonA, echeance: ECHEANCE_LOINTAINE });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";
    const avant = await obtenirQuarantaine(id, WORKSPACE_A);

    const resultat = await revaliderQuarantaineEnBase(id, WORKSPACE_A, APRES_ECHEANCE_PROCHE);
    expect(resultat?.verdict).toBe("ECHEANCE_NON_ATTEINTE");

    // La revalidation est une LECTURE : la ligne est inchangée, et elle peut être rejouée.
    const apres = await obtenirQuarantaine(id, WORKSPACE_A);
    expect(apres?.leveeLe).toBeUndefined();
    expect(apres?.revalidationDueLe.getTime()).toBe(avant!.revalidationDueLe.getTime());
    expect(apres?.entreLe.getTime()).toBe(avant!.entreLe.getTime());
  });

  it("échéance atteinte, rien d'autre ne bloque : AUCUN_BLOCAGE_CONNU — et aucune suppression", async () => {
    await reinitialiser(WORKSPACE_A, ids.bonA);
    const entree = await entrer({ workspaceId: WORKSPACE_A, entityId: ids.bonA, echeance: ECHEANCE_PROCHE });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";

    const resultat = await revaliderQuarantaineEnBase(id, WORKSPACE_A, APRES_ECHEANCE_PROCHE);
    expect(resultat?.verdict).toBe("AUCUN_BLOCAGE_CONNU");

    // LE POINT DU LOT : l'échéance atteinte et le verdict le plus permissif n'ont rien supprimé. Le
    // bon, son document et sa visite sont tous là, et la quarantaine est toujours active.
    expect(await existe(bonsVisiteTable, ids.bonA)).toBe(true);
    expect(await existe(documentsBienTable, ids.documentA)).toBe(true);
    expect(await existe(visitesTable, ids.visiteA)).toBe(true);
    expect((await obtenirQuarantaine(id, WORKSPACE_A))?.leveeLe).toBeUndefined();
  });

  it("la politique devenue inapplicable est détectée sur les données FRAÎCHES", async () => {
    // Le bon passe de `signe` à `annule` APRÈS l'entrée en quarantaine : la ligne ne relève plus de
    // SIGNED_VISIT_FORM. La revalidation doit le voir, et ne pas se fier à l'évaluation d'entrée.
    await reinitialiser(WORKSPACE_B, ids.bonB);
    const entree = await entrer({ workspaceId: WORKSPACE_B, entityId: ids.bonB, echeance: ECHEANCE_PROCHE });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";

    const avant = await getDb()
      .select({ statut: bonsVisiteTable.statut, signeLe: bonsVisiteTable.signeLe, documentId: bonsVisiteTable.documentId, hash: bonsVisiteTable.hashDocument })
      .from(bonsVisiteTable)
      .where(eq(bonsVisiteTable.id, ids.bonB));
    try {
      // `bons_visite_coherence_statut_check` impose la forme complète d'un bon annulé.
      await getDb()
        .update(bonsVisiteTable)
        .set({ statut: "annule", signeLe: null, documentId: null, hashDocument: null, annuleLe: new Date() })
        .where(eq(bonsVisiteTable.id, ids.bonB));

      const resultat = await revaliderQuarantaineEnBase(id, WORKSPACE_B, APRES_ECHEANCE_PROCHE);
      expect(resultat?.verdict).toBe("POLITIQUE_NON_APPLICABLE");
    } finally {
      await getDb()
        .update(bonsVisiteTable)
        .set({ statut: avant[0].statut, signeLe: avant[0].signeLe, documentId: avant[0].documentId, hashDocument: avant[0].hash, annuleLe: null })
        .where(eq(bonsVisiteTable.id, ids.bonB));
    }
  });

  it("une quarantaine levée n'a rien à revalider", async () => {
    await reinitialiser(WORKSPACE_B, ids.bonB);
    const entree = await entrer({ workspaceId: WORKSPACE_B, entityId: ids.bonB, echeance: ECHEANCE_PROCHE });
    const id = entree.statut === "creee" || entree.statut === "deja_active" ? entree.quarantaine.id : "";
    await leverQuarantaine(
      id,
      { causeLevee: "DECISION_MANUELLE", motifLevee: MOTIF_LEVEE, leveeParIdentiteSub: LEVEUR },
      WORKSPACE_B
    );
    expect((await revaliderQuarantaineEnBase(id, WORKSPACE_B, new Date("2099-01-01T00:00:00.000Z")))?.verdict).toBe(
      "QUARANTAINE_LEVEE"
    );
  });
});

describe("le registre ne perd jamais rien", () => {
  it("aucune quarantaine de ce fichier n'a disparu, et aucune ligne métier n'a été supprimée", async () => {
    const lignes = await getDb()
      .select({ id: quarantinesTable.id })
      .from(quarantinesTable)
      .where(inArray(quarantinesTable.id, [...quarantinesDuFichier]));
    expect(lignes.length).toBe(quarantinesDuFichier.size);

    const bons = await getDb()
      .select({ id: bonsVisiteTable.id })
      .from(bonsVisiteTable)
      .where(inArray(bonsVisiteTable.id, [ids.bonA, ids.bonB]));
    expect(bons).toHaveLength(2);
  });

  it("les cibles en quarantaine se déduisent uniquement de l'absence de date de levée", async () => {
    const actives = await listerQuarantainesActives(WORKSPACE_A);
    const cibles = await listerCiblesEnQuarantaineActive("bons_visite", WORKSPACE_A);
    expect([...cibles].sort()).toEqual([...new Set(actives.map((q) => q.entityId))].sort());
    for (const q of actives) expect(q.leveeLe).toBeUndefined();
  });
});

async function compter(workspaceId: string): Promise<number> {
  const [ligne] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(quarantinesTable)
    .where(eq(quarantinesTable.workspaceId, workspaceId));
  return ligne.n;
}

async function compterActives(workspaceId: string, entityId: string): Promise<number> {
  const [ligne] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(quarantinesTable)
    .where(
      sql`${quarantinesTable.workspaceId} = ${workspaceId} AND ${quarantinesTable.entityId} = ${entityId}
        AND ${quarantinesTable.leveeLe} IS NULL`
    );
  return ligne.n;
}

async function existe(table: typeof bonsVisiteTable | typeof documentsBienTable | typeof visitesTable, id: string) {
  const lignes = await getDb().select({ id: table.id }).from(table).where(eq(table.id, id));
  return lignes.length === 1;
}
