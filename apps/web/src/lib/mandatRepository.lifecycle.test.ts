import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// ADR-060 — MANDATE_LIFECYCLE_FOUNDATION_V1, intégration Postgres : le mandat canonique devient
// VIVANT. Création à l'image des faits saisis (type exigé), modification et résiliation sous verrou
// dans le workspace de session, mandat courant déterministe, amorçage humain d'un bien legacy.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { biens: biensTable, mandats: mandatsTable, workspaces: workspacesTable } = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerBien } = await import("./bienRepository");
const {
  creerMandat,
  creerMandatSuccesseur,
  enregistrerMandatExistant,
  existeMandatCanonique,
  getMandatById,
  listerMandatsDuBien,
  mandatCourantDuBien,
  mandatsCourantsExpirantBientot,
  modifierMandat,
  resilierMandat,
} = await import("./mandatRepository");

const AUJOURDHUI = "2026-06-15";
const biensCrees: string[] = [];
const workspacesCrees: string[] = [];
let compteur = 0;

async function unBien(workspaceId: string = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] MANDAT-LIFECYCLE-${compteur}-${Date.now()}`,
      titre: "Bien de test lifecycle",
      type: "appartement",
      adresse: "1 rue du Mandat",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  biensCrees.push(bien.id);
  return bien;
}

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-lifecycle-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace lifecycle" });
  workspacesCrees.push(id);
  return id;
}

afterAll(async () => {
  if (biensCrees.length > 0) {
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, biensCrees));
    await getDb().delete(biensTable).where(inArray(biensTable.id, biensCrees));
  }
  if (workspacesCrees.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
});

describe("creerMandat — les faits saisis, rien d'inventé", () => {
  it("simple / exclusif / semi_exclusif sont acceptés et relus tels quels", async () => {
    const bien = await unBien();
    for (const type of ["simple", "exclusif", "semi_exclusif"] as const) {
      const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type });
      expect((await getMandatById(mandat.id, WORKSPACE_TEST))!.type).toBe(type);
    }
  });

  it("numéro : trim, chaîne vide → absent, aucune unicité", async () => {
    const bien = await unBien();
    const avec = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple", numero: "  M-42  " });
    const sans = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple", numero: "   " });
    const doublon = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple", numero: "M-42" });
    expect(avec.numero).toBe("M-42");
    expect(sans.numero).toBeUndefined();
    expect(doublon.numero).toBe("M-42");
  });

  it("exclusivité dans la période : acceptée ; avant la prise d'effet ou après le terme : refusée", async () => {
    const bien = await unBien();
    const ok = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-12-31", exclusiviteJusquAu: "2026-04-01", type: "semi_exclusif" });
    expect(ok.exclusiviteJusquAu).toBe("2026-04-01");
    await expect(
      creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", exclusiviteJusquAu: "2025-12-31", type: "semi_exclusif" })
    ).rejects.toThrow(/incohérentes/);
    await expect(
      creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-03-01", exclusiviteJusquAu: "2026-04-01", type: "semi_exclusif" })
    ).rejects.toThrow(/incohérentes/);
    await expect(creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2025-01-01", type: "simple" })).rejects.toThrow(
      /incohérentes/
    );
  });

  it("le CHECK SQL reste le dernier filet : un type hors vocabulaire est refusé par la base", async () => {
    const bien = await unBien();
    await expect(
      getDb().insert(mandatsTable).values({ bienId: bien.id, dateDebut: "2026-01-01", type: "co_exclusif" })
    ).rejects.toThrow();
    await expect(
      getDb().insert(mandatsTable).values({ bienId: bien.id, dateDebut: "2026-01-01", exclusiviteJusquAu: "2025-01-01" })
    ).rejects.toThrow();
  });

  it("une ligne antérieure sans type reste lisible, jamais traduite en « simple »", async () => {
    const bien = await unBien();
    const [ligne] = await getDb().insert(mandatsTable).values({ bienId: bien.id, dateDebut: "2026-01-01" }).returning();
    const relu = await getMandatById(ligne.id, WORKSPACE_TEST);
    expect(relu!.type).toBeUndefined();
    const historique = await listerMandatsDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI);
    expect(historique[0].statut).toBe("actif");
  });
});

describe("modifierMandat — sous verrou, dans le workspace, sur un mandat vivant", () => {
  it("modifie type, numéro, terme et exclusivité ; jamais la prise d'effet", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    const resultat = await modifierMandat(
      mandat.id,
      { type: "semi_exclusif", numero: " N-1 ", dateFin: "2026-12-31", exclusiviteJusquAu: "2026-06-30" },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("modifie");
    if (resultat.statut !== "modifie") return;
    expect(resultat.mandat).toMatchObject({ type: "semi_exclusif", numero: "N-1", dateFin: "2026-12-31", exclusiviteJusquAu: "2026-06-30", dateDebut: "2026-01-01" });
    // No-op : rejouer les mêmes valeurs ne change rien et reste un succès.
    const rejoue = await modifierMandat(mandat.id, { type: "semi_exclusif", numero: "N-1", dateFin: "2026-12-31", exclusiviteJusquAu: "2026-06-30" }, WORKSPACE_TEST);
    expect(rejoue.statut).toBe("modifie");
    // Effacer le terme : un fait retiré, pas une valeur inventée.
    const sansTerme = await modifierMandat(mandat.id, { type: "exclusif" }, WORKSPACE_TEST);
    expect(sansTerme.statut === "modifie" && sansTerme.mandat.dateFin).toBeUndefined();
  });

  it("dates incohérentes → refus typé, rien n'est écrit", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    expect(await modifierMandat(mandat.id, { type: "simple", dateFin: "2025-12-31" }, WORKSPACE_TEST)).toEqual({ statut: "dates_incoherentes" });
    expect((await getMandatById(mandat.id, WORKSPACE_TEST))!.dateFin).toBeUndefined();
  });

  it("résilié → refusé ; remplacé → refusé", async () => {
    const bien = await unBien();
    const resilie = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    await resilierMandat(resilie.id, { resilieLe: "2026-02-01" }, WORKSPACE_TEST);
    expect(await modifierMandat(resilie.id, { type: "exclusif" }, WORKSPACE_TEST)).toEqual({ statut: "resilie" });

    const remplace = await creerMandat({ bienId: bien.id, dateDebut: "2026-03-01", type: "simple" });
    await creerMandatSuccesseur(remplace.id, { dateDebut: "2026-09-01", type: "simple" });
    expect(await modifierMandat(remplace.id, { type: "exclusif" }, WORKSPACE_TEST)).toEqual({ statut: "remplace" });
    expect((await getMandatById(remplace.id, WORKSPACE_TEST))!.type).toBe("simple");
  });

  it("autre workspace ou id inconnu → introuvable, indistinguables", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    const ailleurs = await unAutreWorkspace("modif");
    expect(await modifierMandat(mandat.id, { type: "exclusif" }, ailleurs)).toEqual({ statut: "introuvable" });
    expect(await modifierMandat("00000000-0000-4000-8000-000000000000", { type: "exclusif" }, WORKSPACE_TEST)).toEqual({ statut: "introuvable" });
    expect(await modifierMandat("pas-un-uuid", { type: "exclusif" }, WORKSPACE_TEST)).toEqual({ statut: "introuvable" });
    expect((await getMandatById(mandat.id, WORKSPACE_TEST))!.type).toBe("simple");
  });
});

describe("resilierMandat — un fait unique qui ne touche pas au terme", () => {
  it("succès avec motif, `date_fin` intacte ; motif vide → absent", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-12-31", type: "simple" });
    const resultat = await resilierMandat(mandat.id, { resilieLe: "2026-05-01", motifResiliation: " Vendeur retire le bien " }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("resilie");
    const relu = (await getMandatById(mandat.id, WORKSPACE_TEST))!;
    expect(relu.resilieLe).toBe("2026-05-01");
    expect(relu.motifResiliation).toBe("Vendeur retire le bien");
    expect(relu.dateFin, "le terme prévu reste un fait distinct").toBe("2026-12-31");
    expect((await listerMandatsDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI))[0].statut).toBe("resilie");

    const autre = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    const sansMotif = await resilierMandat(autre.id, { resilieLe: "2026-05-01", motifResiliation: "  " }, WORKSPACE_TEST);
    expect(sansMotif.statut === "resilie" && sansMotif.mandat.motifResiliation).toBeUndefined();
  });

  it("date antérieure à la prise d'effet, déjà résilié, remplacé, autre workspace → refus typés", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-03-01", type: "simple" });
    expect(await resilierMandat(mandat.id, { resilieLe: "2026-02-28" }, WORKSPACE_TEST)).toEqual({ statut: "date_incoherente" });
    const ailleurs = await unAutreWorkspace("resil");
    expect(await resilierMandat(mandat.id, { resilieLe: "2026-04-01" }, ailleurs)).toEqual({ statut: "introuvable" });
    expect((await resilierMandat(mandat.id, { resilieLe: "2026-04-01" }, WORKSPACE_TEST)).statut).toBe("resilie");
    expect(await resilierMandat(mandat.id, { resilieLe: "2026-05-01" }, WORKSPACE_TEST)).toEqual({ statut: "deja_resilie" });
    expect((await getMandatById(mandat.id, WORKSPACE_TEST))!.resilieLe, "la première résiliation reste").toBe("2026-04-01");

    const remplace = await creerMandat({ bienId: bien.id, dateDebut: "2026-03-01", type: "simple" });
    await creerMandatSuccesseur(remplace.id, { dateDebut: "2026-09-01", type: "simple" });
    expect(await resilierMandat(remplace.id, { resilieLe: "2026-04-01" }, WORKSPACE_TEST)).toEqual({ statut: "remplace" });
  });
});

describe("mandatCourantDuBien — ADR-060 §10, une requête, une réponse déterministe", () => {
  it("aucun mandat → aucun ; actif → lui ; a_venir → lui", async () => {
    const bien = await unBien();
    expect(await mandatCourantDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI)).toBeUndefined();
    const actif = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    expect((await mandatCourantDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI))!.id).toBe(actif.id);

    const bien2 = await unBien();
    const aVenir = await creerMandat({ bienId: bien2.id, dateDebut: "2026-09-01", type: "simple" });
    expect((await mandatCourantDuBien(bien2.id, WORKSPACE_TEST, AUJOURDHUI))!.id).toBe(aVenir.id);
  });

  it("expiré seul, résilié seul, remplacé seul → aucun", async () => {
    const expire = await unBien();
    await creerMandat({ bienId: expire.id, dateDebut: "2025-01-01", dateFin: "2025-12-31", type: "simple" });
    expect(await mandatCourantDuBien(expire.id, WORKSPACE_TEST, AUJOURDHUI)).toBeUndefined();

    const resilie = await unBien();
    const m = await creerMandat({ bienId: resilie.id, dateDebut: "2026-01-01", type: "simple" });
    await resilierMandat(m.id, { resilieLe: "2026-02-01" }, WORKSPACE_TEST);
    expect(await mandatCourantDuBien(resilie.id, WORKSPACE_TEST, AUJOURDHUI)).toBeUndefined();

    const remplace = await unBien();
    const ancien = await creerMandat({ bienId: remplace.id, dateDebut: "2026-01-01", type: "simple" });
    const successeur = await creerMandatSuccesseur(ancien.id, { dateDebut: "2026-07-01", type: "exclusif" });
    // L'ancien reste « actif » au sens de sa ligne (aucune date fabriquée), mais la relation l'exclut.
    expect((await getMandatById(ancien.id, WORKSPACE_TEST))!.dateFin).toBeUndefined();
    expect((await mandatCourantDuBien(remplace.id, WORKSPACE_TEST, AUJOURDHUI))!.id).toBe(successeur.id);
    const historique = await listerMandatsDuBien(remplace.id, WORKSPACE_TEST, AUJOURDHUI);
    expect(historique.map((h) => [h.id, h.statut, h.remplaceParId])).toEqual([
      [ancien.id, "actif", successeur.id],
      [successeur.id, "a_venir", undefined],
    ]);
  });

  it("terme aujourd'hui → encore courant ; résiliation future → encore courant", async () => {
    const bien = await unBien();
    const m = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: AUJOURDHUI, type: "simple" });
    expect((await mandatCourantDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI))!.id).toBe(m.id);
    await resilierMandat(m.id, { resilieLe: "2026-06-15" }, WORKSPACE_TEST);
    expect(await mandatCourantDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI)).toBeUndefined();
    expect((await mandatCourantDuBien(bien.id, WORKSPACE_TEST, "2026-06-14"))!.id).toBe(m.id);
  });

  it("données incohérentes (deux mandats vivants) : ordre date_debut DESC, puis cree_le DESC, puis id DESC — toujours la même réponse", async () => {
    const bien = await unBien();
    const ancien = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    const recent = await creerMandat({ bienId: bien.id, dateDebut: "2026-03-01", type: "simple" });
    expect((await mandatCourantDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI))!.id).toBe(recent.id);

    // Égalité de date_debut : le plus récemment créé gagne.
    const [a] = await getDb().insert(mandatsTable).values({ bienId: bien.id, dateDebut: "2026-04-01", type: "simple", creeLe: new Date("2026-04-01T10:00:00Z") }).returning();
    const [b] = await getDb().insert(mandatsTable).values({ bienId: bien.id, dateDebut: "2026-04-01", type: "simple", creeLe: new Date("2026-04-01T11:00:00Z") }).returning();
    expect((await mandatCourantDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI))!.id).toBe(b.id);

    // Égalité complète de dates : l'id le plus grand gagne, et la réponse est stable.
    const memeInstant = new Date("2026-05-01T10:00:00Z");
    const [c] = await getDb().insert(mandatsTable).values({ bienId: bien.id, dateDebut: "2026-05-01", type: "simple", creeLe: memeInstant }).returning();
    const [d] = await getDb().insert(mandatsTable).values({ bienId: bien.id, dateDebut: "2026-05-01", type: "simple", creeLe: memeInstant }).returning();
    const attendu = [c.id, d.id].sort().at(-1);
    for (let i = 0; i < 3; i += 1) expect((await mandatCourantDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI))!.id).toBe(attendu);
    expect([ancien.id, a.id].includes((await mandatCourantDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI))!.id)).toBe(false);
    // Tout reste lisible : rien n'a été réparé.
    expect(await listerMandatsDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI)).toHaveLength(6);
  });

  it("bien d'un autre workspace → aucun mandat courant", async () => {
    const ailleurs = await unAutreWorkspace("courant");
    const bien = await unBien(ailleurs);
    await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    expect(await mandatCourantDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI)).toBeUndefined();
    expect(await mandatCourantDuBien(bien.id, ailleurs, AUJOURDHUI)).toBeDefined();
  });
});

// AUTOMATION_ENGINE_GENERALIZATION_V1 — variante EN LOT de mandatCourantDuBien pour le scanner
// mandat_expire_bientot : même WHERE (non résilié, non remplacé), plus la fenêtre [aujourd'hui,
// finFenetre] sur date_fin, réduit au premier par bien selon le même ordre déterministe.
describe("mandatsCourantsExpirantBientot — set-based, même déterminisme que mandatCourantDuBien", () => {
  it("dans la fenêtre → trouvé ; hors fenêtre (trop tôt ou trop tard) → absent", async () => {
    const bien = await unBien();
    const m = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-07-05", type: "simple" });
    const candidats = await mandatsCourantsExpirantBientot(WORKSPACE_TEST, AUJOURDHUI, "2026-07-15");
    expect(candidats.map((c) => c.id)).toContain(m.id);

    const bienLoin = await unBien();
    await creerMandat({ bienId: bienLoin.id, dateDebut: "2026-01-01", dateFin: "2026-12-31", type: "simple" });
    const candidatsCourts = await mandatsCourantsExpirantBientot(WORKSPACE_TEST, AUJOURDHUI, "2026-07-15");
    expect(candidatsCourts.map((c) => c.bienId)).not.toContain(bienLoin.id);
  });

  it("résilié → exclu", async () => {
    const bien = await unBien();
    const m = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-07-05", type: "simple" });
    await resilierMandat(m.id, { resilieLe: "2026-06-01" }, WORKSPACE_TEST);
    const candidats = await mandatsCourantsExpirantBientot(WORKSPACE_TEST, AUJOURDHUI, "2026-07-15");
    expect(candidats.map((c) => c.id)).not.toContain(m.id);
  });

  it("remplacé → exclu, le successeur prend sa place si sa propre échéance est dans la fenêtre", async () => {
    const bien = await unBien();
    const ancien = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-07-05", type: "simple" });
    const successeur = await creerMandatSuccesseur(ancien.id, { dateDebut: "2026-07-05", dateFin: "2026-07-10", type: "simple" });
    const candidats = await mandatsCourantsExpirantBientot(WORKSPACE_TEST, AUJOURDHUI, "2026-07-15");
    expect(candidats.map((c) => c.id)).not.toContain(ancien.id);
    expect(candidats.map((c) => c.id)).toContain(successeur.id);
  });

  it("deux mandats vivants sur le même bien (import incohérent) : un seul candidat, même tie-break déterministe", async () => {
    const bien = await unBien();
    const ancien = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-07-05", type: "simple" });
    const recent = await creerMandat({ bienId: bien.id, dateDebut: "2026-03-01", dateFin: "2026-07-08", type: "simple" });
    const candidats = await mandatsCourantsExpirantBientot(WORKSPACE_TEST, AUJOURDHUI, "2026-07-15");
    const pourCeBien = candidats.filter((c) => c.bienId === bien.id);
    expect(pourCeBien).toHaveLength(1);
    expect(pourCeBien[0].id).toBe(recent.id);
    expect(pourCeBien[0].id).not.toBe(ancien.id);
  });

  it("autre workspace → invisible", async () => {
    const ailleurs = await unAutreWorkspace("expirant-bientot");
    const bien = await unBien(ailleurs);
    const m = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-07-05", type: "simple" });
    const candidats = await mandatsCourantsExpirantBientot(WORKSPACE_TEST, AUJOURDHUI, "2026-07-15");
    expect(candidats.map((c) => c.id)).not.toContain(m.id);
    const candidatsAilleurs = await mandatsCourantsExpirantBientot(ailleurs, AUJOURDHUI, "2026-07-15");
    expect(candidatsAilleurs.map((c) => c.id)).toContain(m.id);
  });
});

describe("enregistrerMandatExistant — amorçage humain, jamais un backfill", () => {
  it("bien legacy sans canonique → crée le mandat à partir des faits saisis", async () => {
    const bien = await unBien();
    expect(await existeMandatCanonique(bien.id)).toBe(false);
    const resultat = await enregistrerMandatExistant(
      bien.id,
      { type: "exclusif", numero: "L-1", dateDebut: "2025-11-15", dateFin: "2026-11-14" },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("enregistre");
    if (resultat.statut !== "enregistre") return;
    // La prise d'effet est celle que l'humain a saisie, pas `biens.date_mandat` (2026-01-01).
    expect(resultat.mandat.dateDebut).toBe("2025-11-15");
    expect(resultat.mandat.type).toBe("exclusif");
    expect(await existeMandatCanonique(bien.id)).toBe(true);
  });

  it("canonique déjà présent → refusé ; dates incohérentes → refusé sans écriture", async () => {
    const bien = await unBien();
    await creerMandat({ bienId: bien.id, dateDebut: "2025-01-01", dateFin: "2025-12-31", type: "simple" });
    // Même un mandat expiré compte : le geste amorce un bien SANS histoire canonique.
    expect(await enregistrerMandatExistant(bien.id, { type: "simple", dateDebut: "2026-01-01" }, WORKSPACE_TEST)).toEqual({ statut: "mandat_canonique_existant" });
    const vierge = await unBien();
    expect(await enregistrerMandatExistant(vierge.id, { type: "simple", dateDebut: "2026-01-01", dateFin: "2025-01-01" }, WORKSPACE_TEST)).toEqual({ statut: "dates_incoherentes" });
    expect(await existeMandatCanonique(vierge.id)).toBe(false);
  });

  it("autre workspace ou id inconnu → bien_introuvable, rien créé", async () => {
    const ailleurs = await unAutreWorkspace("enreg");
    const bien = await unBien(ailleurs);
    expect(await enregistrerMandatExistant(bien.id, { type: "simple", dateDebut: "2026-01-01" }, WORKSPACE_TEST)).toEqual({ statut: "bien_introuvable" });
    expect(await enregistrerMandatExistant("00000000-0000-4000-8000-000000000000", { type: "simple", dateDebut: "2026-01-01" }, WORKSPACE_TEST)).toEqual({ statut: "bien_introuvable" });
    expect(await existeMandatCanonique(bien.id)).toBe(false);
  });

  it("double submit concurrent → exactement un mandat, l'autre refusé", async () => {
    const bien = await unBien();
    const [a, b] = await Promise.all([
      enregistrerMandatExistant(bien.id, { type: "simple", dateDebut: "2026-01-01" }, WORKSPACE_TEST),
      enregistrerMandatExistant(bien.id, { type: "simple", dateDebut: "2026-01-01" }, WORKSPACE_TEST),
    ]);
    expect([a.statut, b.statut].sort()).toEqual(["enregistre", "mandat_canonique_existant"]);
    expect(await getDb().select().from(mandatsTable).where(eq(mandatsTable.bienId, bien.id))).toHaveLength(1);
  });
});

describe("renouvellement (primitif) — l'ancien n'est jamais mutilé", () => {
  it("créer un successeur ne pose ni date_fin ni resilie_le sur le remplacé", async () => {
    const bien = await unBien();
    const ancien = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple", numero: "A" });
    const avant = await getMandatById(ancien.id, WORKSPACE_TEST);
    await creerMandatSuccesseur(ancien.id, { dateDebut: "2026-07-01", type: "exclusif", numero: "B" });
    expect(await getMandatById(ancien.id, WORKSPACE_TEST)).toEqual(avant);
  });
});
