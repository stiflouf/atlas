import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

// LEGAL_HOLD_FOUNDATION_V1 (ADR-068) — ce que seule une vraie base peut prouver : l'unicité des
// holds actifs, l'immutabilité du registre, l'idempotence de la levée sous concurrence réelle, et
// l'isolation workspace.
//
// Le pendant hors base (vocabulaires, motivation obligatoire, état dérivé) vit dans legalHold.test.ts
// et ne demande aucun Postgres.
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
  legalHolds: legalHoldsTable,
} = await import("@/db/schema");
const {
  creerLegalHold,
  leverLegalHold,
  obtenirLegalHold,
  listerLegalHoldsActifs,
  listerLegalHoldsDeLaCible,
  listerCiblesSousLegalHoldActif,
} = await import("./legalHoldRepository");
const { ErreurLegalHoldInvalide } = await import("./legalHold");

// DEUX workspaces réels, chacun avec SA cible : c'est le seul montage qui éprouve l'isolation. Un
// test à un seul workspace ne peut pas distinguer « correctement filtré » de « il n'y avait rien
// d'autre ».
const SUFFIXE = Date.now();
const WORKSPACE_A = `ws-legalhold-a-${SUFFIXE}`;
const WORKSPACE_B = `ws-legalhold-b-${SUFFIXE}`;

const POSEUR = "sub-legalhold-poseur";
const LEVEUR = "sub-legalhold-leveur";
const MOTIF = "Assignation au fond, dossier 2026/0042";
const MOTIF_LEVEE = "Jugement definitif, affaire close";

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

// Tout hold créé par ce fichier est mémorisé pour que le nettoyage n'efface QUE ses propres lignes :
// un fichier de test nettoie ce qu'il a créé, ni plus ni moins (même doctrine que
// dryRunRetention.test.ts).
const holdsDuFichier = new Set<string>();

function memoriser<T extends { statut: string }>(resultat: T): T {
  const hold = (resultat as { hold?: { id: string } }).hold;
  if (hold) holdsDuFichier.add(hold.id);
  return resultat;
}

async function creerDecor(workspaceId: string, reference: string) {
  const [bien] = await getDb()
    .insert(biensTable)
    .values({
      reference,
      titre: "[fixture legalhold] bien",
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
      nom: "LegalHold",
      email: `fixture-legalhold-${reference}@example.invalid`,
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
      nom: "[fixture legalhold] bon de visite",
      nomFichierOriginal: "fixture.pdf",
      cleStockage: `fixture/legalhold/${reference}.pdf`,
      tailleOctets: 1,
      typeMime: "application/pdf",
      categorie: "commercial",
      typeDocument: "bon_visite",
    })
    .returning({ id: documentsBienTable.id });

  const [bon] = await getDb()
    .insert(bonsVisiteTable)
    .values({
      visiteId: visite.id,
      version: 1,
      templateVersion: "v2",
      // Snapshot volontairement SANS donnée personnelle : un registre de suspension n'a pas besoin
      // d'un signataire réel pour être éprouvé.
      contenuSnapshot: {
        visite: { id: visite.id, datePrevue: "2015-02-01" },
        bien: {
          id: bien.id,
          reference,
          titre: "[fixture legalhold] bien",
          adresse: "1 rue de la Fixture",
          ville: "Fixtureville",
          codePostal: "00000",
        },
        conseiller: { nom: "[fixture legalhold]" },
        template: { version: "v2", texte: "[fixture legalhold] aucun contenu personnel" },
      },
      statut: "signe",
      signeLe: new Date("2015-03-01T10:00:00.000Z"),
      documentId: document.id,
      hashDocument: `fixture-legalhold-${reference}`,
    })
    .returning({ id: bonsVisiteTable.id });

  return { bien: bien.id, acquereur: acquereur.id, visite: visite.id, document: document.id, bon: bon.id };
}

beforeAll(async () => {
  await getDb()
    .insert(workspacesTable)
    .values([
      { id: WORKSPACE_A, nom: "[test réel] legal hold A" },
      { id: WORKSPACE_B, nom: "[test réel] legal hold B" },
    ]);

  const a = await creerDecor(WORKSPACE_A, `LH-A-${SUFFIXE}`);
  const b = await creerDecor(WORKSPACE_B, `LH-B-${SUFFIXE}`);
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
  const holds = [...holdsDuFichier];
  if (holds.length) await getDb().delete(legalHoldsTable).where(inArray(legalHoldsTable.id, holds));
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

async function poser(options: {
  workspaceId: string;
  entityId: string;
  motifCode?: "CONTENTIEUX" | "CONTROLE_OU_AUDIT";
}) {
  return memoriser(
    await creerLegalHold(
      {
        entityType: "bons_visite",
        entityId: options.entityId,
        motifCode: options.motifCode ?? "CONTENTIEUX",
        motif: MOTIF,
        poseParIdentiteSub: POSEUR,
      },
      options.workspaceId
    )
  );
}

describe("pose d'un legal hold", () => {
  it("crée un hold actif, motivé, attribué et horodaté par la base", async () => {
    const avant = new Date();
    const resultat = await poser({ workspaceId: WORKSPACE_A, entityId: ids.bonA });

    expect(resultat.statut).toBe("cree");
    if (resultat.statut !== "cree") return;
    const hold = resultat.hold;

    expect(hold.workspaceId).toBe(WORKSPACE_A);
    expect(hold.entityType).toBe("bons_visite");
    expect(hold.entityId).toBe(ids.bonA);
    expect(hold.motifCode).toBe("CONTENTIEUX");
    expect(hold.motif).toBe(MOTIF);
    expect(hold.poseParIdentiteSub).toBe(POSEUR);
    // `pose_le` vient du DEFAULT `now()` de la base, pas du JS : la borne basse est l'instant relevé
    // juste avant l'appel, à la seconde près pour absorber une horloge de serveur légèrement décalée.
    expect(hold.poseLe.getTime()).toBeGreaterThan(avant.getTime() - 5000);
    expect(hold.poseLe.getTime()).toBeLessThan(Date.now() + 5000);
    // Un hold neuf est ACTIF : les trois colonnes de levée sont vides, et le CHECK de cohérence
    // garantit qu'elles le sont toutes les trois ou aucune.
    expect(hold.leveLe).toBeUndefined();
    expect(hold.leveParIdentiteSub).toBeUndefined();
    expect(hold.motifLevee).toBeUndefined();
  });

  it("une cible inexistante est refusée, et aucune ligne n'est écrite", async () => {
    const avant = await compterHolds(WORKSPACE_A);
    const resultat = await poser({ workspaceId: WORKSPACE_A, entityId: "00000000-0000-4000-8000-000000000000" });
    expect(resultat.statut).toBe("cible_introuvable");
    expect(await compterHolds(WORKSPACE_A)).toBe(avant);
  });

  it("un identifiant de cible qui n'est pas un uuid est refusé sans requête métier", async () => {
    const resultat = await poser({ workspaceId: WORKSPACE_A, entityId: "pas-un-uuid" });
    expect(resultat.statut).toBe("cible_introuvable");
  });

  it("une cible d'un AUTRE workspace est introuvable — jamais « refusée »", async () => {
    // Indistinguable d'une cible absente, et c'est voulu : un message différent renseignerait sur
    // l'existence d'une ligne hors périmètre.
    const avant = await compterHolds(WORKSPACE_A);
    const resultat = await poser({ workspaceId: WORKSPACE_A, entityId: ids.bonB });
    expect(resultat.statut).toBe("cible_introuvable");
    expect(await compterHolds(WORKSPACE_A)).toBe(avant);
  });

  it("une motivation absente ou trop courte lève, et n'écrit rien", async () => {
    const avant = await compterHolds(WORKSPACE_A);
    await expect(
      creerLegalHold(
        { entityType: "bons_visite", entityId: ids.bonA, motifCode: "CONTENTIEUX", motif: "court", poseParIdentiteSub: POSEUR },
        WORKSPACE_A
      )
    ).rejects.toThrow(ErreurLegalHoldInvalide);
    expect(await compterHolds(WORKSPACE_A)).toBe(avant);
  });

  it("un auteur absent lève, et n'écrit rien", async () => {
    const avant = await compterHolds(WORKSPACE_A);
    await expect(
      creerLegalHold(
        { entityType: "bons_visite", entityId: ids.bonA, motifCode: "CONTENTIEUX", motif: MOTIF, poseParIdentiteSub: "" },
        WORKSPACE_A
      )
    ).rejects.toThrow(ErreurLegalHoldInvalide);
    expect(await compterHolds(WORKSPACE_A)).toBe(avant);
  });
});

describe("unicité et concurrence", () => {
  it("une seconde pose du même hold rend `deja_actif` avec le hold en place", async () => {
    const premier = await poser({ workspaceId: WORKSPACE_B, entityId: ids.bonB });
    expect(premier.statut).toBe("cree");

    const second = await poser({ workspaceId: WORKSPACE_B, entityId: ids.bonB });
    expect(second.statut).toBe("deja_actif");
    if (second.statut !== "deja_actif" || premier.statut !== "cree") return;
    // LE MÊME hold, pas un second : la protection n'est pas dupliquée, et l'appelant peut montrer
    // celle qui existe.
    expect(second.hold.id).toBe(premier.hold.id);
  });

  it("deux poses SIMULTANÉES du même hold : exactement une crée, l'autre constate", async () => {
    // La course est tranchée par l'index partiel `legal_holds_cible_actif_unique`, pas par le code
    // applicatif : un `SELECT puis INSERT si absent` aurait laissé passer les deux.
    const [a, b] = await Promise.all([
      poser({ workspaceId: WORKSPACE_A, entityId: ids.bonA, motifCode: "CONTROLE_OU_AUDIT" }),
      poser({ workspaceId: WORKSPACE_A, entityId: ids.bonA, motifCode: "CONTROLE_OU_AUDIT" }),
    ]);

    const statuts = [a.statut, b.statut].sort();
    expect(statuts).toEqual(["cree", "deja_actif"]);
    expect(await compterHoldsActifs(WORKSPACE_A, ids.bonA, "CONTROLE_OU_AUDIT")).toBe(1);
  });

  it("deux motifs distincts protègent la même cible EN MÊME TEMPS", async () => {
    // Décision centrale du modèle : collapser à un hold par cible aurait été fail-open — lever le
    // contentieux aurait libéré la pièce alors qu'un contrôle la retenait encore.
    const actifs = await listerLegalHoldsActifs(WORKSPACE_A);
    const surLeBon = actifs.filter((hold) => hold.entityId === ids.bonA);
    expect(surLeBon.map((hold) => hold.motifCode).sort()).toEqual(["CONTENTIEUX", "CONTROLE_OU_AUDIT"]);
  });
});

describe("levée d'un legal hold", () => {
  it("lève le hold, et l'historique de pose est INTACT", async () => {
    const pose = await poser({ workspaceId: WORKSPACE_B, entityId: ids.bonB, motifCode: "CONTROLE_OU_AUDIT" });
    expect(pose.statut).toBe("cree");
    if (pose.statut !== "cree") return;

    const levee = await leverLegalHold(
      pose.hold.id,
      { motifLevee: MOTIF_LEVEE, leveParIdentiteSub: LEVEUR },
      WORKSPACE_B
    );
    expect(levee.statut).toBe("leve");
    if (levee.statut !== "leve") return;

    // LEVER N'EST PAS SUPPRIMER : la ligne existe toujours, et rien de la pose n'a été écrasé.
    expect(levee.hold.id).toBe(pose.hold.id);
    expect(levee.hold.motif).toBe(MOTIF);
    expect(levee.hold.poseParIdentiteSub).toBe(POSEUR);
    expect(levee.hold.poseLe.getTime()).toBe(pose.hold.poseLe.getTime());
    // Et la levée est complète : datée, attribuée, motivée — le CHECK de cohérence refuse un trio
    // partiel.
    expect(levee.hold.leveParIdentiteSub).toBe(LEVEUR);
    expect(levee.hold.motifLevee).toBe(MOTIF_LEVEE);
    expect(levee.hold.leveLe).toBeDefined();
    expect(levee.hold.leveLe!.getTime()).toBeGreaterThanOrEqual(pose.hold.poseLe.getTime());
  });

  it("le hold levé reste LISIBLE dans l'historique de la cible", async () => {
    const historique = await listerLegalHoldsDeLaCible("bons_visite", ids.bonB, WORKSPACE_B);
    const leves = historique.filter((hold) => hold.leveLe !== undefined);
    expect(leves.length).toBeGreaterThanOrEqual(1);
    for (const hold of leves) {
      expect(hold.motif).toBe(MOTIF);
      expect(hold.motifLevee).toBe(MOTIF_LEVEE);
    }
  });

  it("une seconde levée rend `deja_leve` sans écraser la première", async () => {
    const pose = await poser({ workspaceId: WORKSPACE_A, entityId: ids.bonA, motifCode: "CONTENTIEUX" });
    // Le hold CONTENTIEUX de A existe déjà (premier test) : la pose rend `deja_actif`, et c'est lui
    // qu'on lève ici.
    const id = pose.statut === "cree" || pose.statut === "deja_actif" ? pose.hold.id : "";
    expect(id).not.toBe("");

    const premiere = await leverLegalHold(id, { motifLevee: MOTIF_LEVEE, leveParIdentiteSub: LEVEUR }, WORKSPACE_A);
    expect(premiere.statut).toBe("leve");

    const seconde = await leverLegalHold(
      id,
      { motifLevee: "Seconde levee qui ne doit rien ecraser", leveParIdentiteSub: "sub-autre-leveur" },
      WORKSPACE_A
    );
    expect(seconde.statut).toBe("deja_leve");
    if (seconde.statut !== "deja_leve" || premiere.statut !== "leve") return;
    // L'auteur, la date et le motif de la PREMIÈRE levée sont conservés : l'idempotence est portée
    // par le `WHERE leve_le IS NULL` de l'UPDATE, pas par une vérification applicative qui aurait
    // laissé la seconde écrire.
    expect(seconde.hold.leveParIdentiteSub).toBe(LEVEUR);
    expect(seconde.hold.motifLevee).toBe(MOTIF_LEVEE);
    expect(seconde.hold.leveLe!.getTime()).toBe(premiere.hold.leveLe!.getTime());
  });

  it("deux levées SIMULTANÉES : exactement une lève, l'autre constate", async () => {
    const pose = await poser({ workspaceId: WORKSPACE_B, entityId: ids.bonB, motifCode: "CONTENTIEUX" });
    const id = pose.statut === "cree" || pose.statut === "deja_actif" ? pose.hold.id : "";

    const [a, b] = await Promise.all([
      leverLegalHold(id, { motifLevee: "Levee concurrente numero un", leveParIdentiteSub: LEVEUR }, WORKSPACE_B),
      leverLegalHold(id, { motifLevee: "Levee concurrente numero deux", leveParIdentiteSub: LEVEUR }, WORKSPACE_B),
    ]);
    expect([a.statut, b.statut].sort()).toEqual(["deja_leve", "leve"]);
  });

  it("un hold inexistant est introuvable, et un identifiant non-uuid aussi", async () => {
    expect(
      (await leverLegalHold("00000000-0000-4000-8000-000000000000", { motifLevee: MOTIF_LEVEE, leveParIdentiteSub: LEVEUR }, WORKSPACE_A))
        .statut
    ).toBe("introuvable");
    expect(
      (await leverLegalHold("pas-un-uuid", { motifLevee: MOTIF_LEVEE, leveParIdentiteSub: LEVEUR }, WORKSPACE_A)).statut
    ).toBe("introuvable");
  });

  it("une levée sans motif ou sans auteur lève, et ne modifie rien", async () => {
    const pose = await poser({ workspaceId: WORKSPACE_A, entityId: ids.bonA, motifCode: "CONTROLE_OU_AUDIT" });
    const id = pose.statut === "cree" || pose.statut === "deja_actif" ? pose.hold.id : "";

    await expect(leverLegalHold(id, { motifLevee: "court", leveParIdentiteSub: LEVEUR }, WORKSPACE_A)).rejects.toThrow(
      ErreurLegalHoldInvalide
    );
    await expect(leverLegalHold(id, { motifLevee: MOTIF_LEVEE, leveParIdentiteSub: "" }, WORKSPACE_A)).rejects.toThrow(
      ErreurLegalHoldInvalide
    );
    // Toujours actif : aucune des deux tentatives n'a touché la ligne.
    const apres = await obtenirLegalHold(id, WORKSPACE_A);
    expect(apres?.leveLe).toBeUndefined();
  });
});

describe("isolation workspace", () => {
  it("un workspace ne LIT pas les holds d'un autre", async () => {
    const actifsA = await listerLegalHoldsActifs(WORKSPACE_A);
    const actifsB = await listerLegalHoldsActifs(WORKSPACE_B);
    expect(actifsA.every((hold) => hold.workspaceId === WORKSPACE_A)).toBe(true);
    expect(actifsB.every((hold) => hold.workspaceId === WORKSPACE_B)).toBe(true);
    // Les cibles ne se croisent jamais : aucun hold de A ne porte sur le bon de B.
    expect(actifsA.some((hold) => hold.entityId === ids.bonB)).toBe(false);
    expect(actifsB.some((hold) => hold.entityId === ids.bonA)).toBe(false);
  });

  it("un hold d'un autre workspace est INTROUVABLE à la lecture unitaire", async () => {
    const pose = await poser({ workspaceId: WORKSPACE_B, entityId: ids.bonB, motifCode: "CONTENTIEUX" });
    const id = pose.statut === "cree" || pose.statut === "deja_actif" ? pose.hold.id : "";
    expect(await obtenirLegalHold(id, WORKSPACE_B)).toBeDefined();
    expect(await obtenirLegalHold(id, WORKSPACE_A)).toBeUndefined();
  });

  it("un workspace ne peut pas LEVER le hold d'un autre", async () => {
    const pose = await poser({ workspaceId: WORKSPACE_B, entityId: ids.bonB, motifCode: "CONTENTIEUX" });
    const id = pose.statut === "cree" || pose.statut === "deja_actif" ? pose.hold.id : "";
    const avant = await obtenirLegalHold(id, WORKSPACE_B);

    const tentative = await leverLegalHold(
      id,
      { motifLevee: "Levee depuis un autre workspace", leveParIdentiteSub: LEVEUR },
      WORKSPACE_A
    );
    expect(tentative.statut).toBe("introuvable");

    // Et la ligne est intacte, vue depuis son propre workspace.
    const apres = await obtenirLegalHold(id, WORKSPACE_B);
    expect(apres?.leveLe?.getTime()).toBe(avant?.leveLe?.getTime());
  });

  it("l'ensemble des cibles protégées est scopé, et un workspace sans hold rend un ensemble vide", async () => {
    const ciblesA = await listerCiblesSousLegalHoldActif("bons_visite", WORKSPACE_A);
    expect(ciblesA.has(ids.bonB)).toBe(false);

    // Un troisième workspace, volontairement sans aucun hold : c'est lui qui prouve que « vide »
    // veut dire vide, et non « filtre inopérant ».
    const VIDE = `ws-legalhold-vide-${SUFFIXE}`;
    await getDb().insert(workspacesTable).values({ id: VIDE, nom: "[test réel] legal hold vide" });
    try {
      expect((await listerCiblesSousLegalHoldActif("bons_visite", VIDE)).size).toBe(0);
      expect(await listerLegalHoldsActifs(VIDE)).toEqual([]);
    } finally {
      await getDb().delete(workspacesTable).where(eq(workspacesTable.id, VIDE));
    }
  });
});

describe("le registre ne perd jamais rien", () => {
  it("aucun hold de ce fichier n'a disparu, et aucune ligne métier n'a été supprimée", async () => {
    // La pose et la levée sont les deux seules écritures du domaine : le nombre de holds ne peut que
    // croître, et les cibles doivent toutes être encore là.
    const total = await compterHoldsDuFichier();
    expect(total).toBe(holdsDuFichier.size);

    const bons = await getDb()
      .select({ id: bonsVisiteTable.id })
      .from(bonsVisiteTable)
      .where(inArray(bonsVisiteTable.id, [ids.bonA, ids.bonB]));
    expect(bons).toHaveLength(2);
  });

  it("les cibles sous hold actif se déduisent uniquement de l'absence de date de levée", async () => {
    const actifs = await listerLegalHoldsActifs(WORKSPACE_A);
    const cibles = await listerCiblesSousLegalHoldActif("bons_visite", WORKSPACE_A);
    expect([...cibles].sort()).toEqual([...new Set(actifs.map((hold) => hold.entityId))].sort());
    for (const hold of actifs) expect(hold.leveLe).toBeUndefined();
  });
});

async function compterHolds(workspaceId: string): Promise<number> {
  const [ligne] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(legalHoldsTable)
    .where(eq(legalHoldsTable.workspaceId, workspaceId));
  return ligne.n;
}

async function compterHoldsActifs(workspaceId: string, entityId: string, motifCode: string): Promise<number> {
  const [ligne] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(legalHoldsTable)
    .where(
      sql`${legalHoldsTable.workspaceId} = ${workspaceId} AND ${legalHoldsTable.entityId} = ${entityId}
        AND ${legalHoldsTable.motifCode} = ${motifCode} AND ${legalHoldsTable.leveLe} IS NULL`
    );
  return ligne.n;
}

async function compterHoldsDuFichier(): Promise<number> {
  if (holdsDuFichier.size === 0) return 0;
  const lignes = await getDb()
    .select({ id: legalHoldsTable.id })
    .from(legalHoldsTable)
    .where(inArray(legalHoldsTable.id, [...holdsDuFichier]));
  return lignes.length;
}
