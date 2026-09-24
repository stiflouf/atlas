import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-061 — OFFER_LIFECYCLE_FOUNDATION_V1, intégration Postgres : cycle de vie irréversible,
// décisions SÉRIALISÉES par le bien (courses réelles), acceptation exclusive (politique A), état
// `caduque`, une seule acceptation active par bien, événements exact-once dans la transaction,
// `offres` source de vérité (fin du dual-write), lectures scoped, imports incohérents lisibles.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { supprimerEvenementsDeTestPourOffres } = await import("@/db/nettoyageEvenementsDeTest");
const {
  acquereurs: acquereursTable,
  biens: biensTable,
  evenementsMetier: evenementsTable,
  offres: offresTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien, getBienById, marquerOffreEnCours } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const {
  accepterOffre,
  chargerEtatOffresBien,
  chargerEtatsOffresParBien,
  creerOffre,
  deciderOffre,
  enregistrerOffre,
  existeOffreCanoniqueDuBien,
  getOffreById,
  listerOffresPourBien,
  refuserOffre,
  rendreOffreCaduque,
  retirerOffre,
} = await import("./offreRepository");
const { listerCompromisParBiens } = await import("./compromisRepository");
const { statutCommercialBienEffectif } = await import("./statutCommercialBien");

const M = `Zlifecycle${Date.now()}`;
const idsOffres: string[] = [];
const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsWorkspaces: string[] = [];
let compteur = 0;

afterAll(async () => {
  const offresDesBiens = idsBiens.length
    ? (await getDb().select({ id: offresTable.id }).from(offresTable).where(inArray(offresTable.bienId, idsBiens))).map((o) => o.id)
    : [];
  const tous = [...new Set([...idsOffres, ...offresDesBiens])];
  await supprimerEvenementsDeTestPourOffres(tous);
  if (tous.length) await getDb().delete(offresTable).where(inArray(offresTable.id, tous));
  if (idsBiens.length) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsWorkspaces.length) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unBien(workspaceId = WORKSPACE_TEST, statutMandat: "actif" | "suspendu" | "expire" = "actif") {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] OFFRE-LIFECYCLE-${compteur}-${Date.now()}`,
      titre: "Bien cycle de vie offre",
      type: "appartement",
      adresse: "1 rue de l'Offre",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat,
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  return bien;
}

async function unAcquereur(workspaceId = WORKSPACE_TEST) {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom: `${M} Acquéreur ${compteur}`,
      email: `${M}.${compteur}@example.test`,
      telephone: "0600000000",
      budgetMin: 200000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "offre",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-offre-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace offre" });
  idsWorkspaces.push(id);
  return id;
}

async function offreEnCours(bienId: string, acquereurId: string, montant = 300000, workspaceId = WORKSPACE_TEST) {
  const r = await creerOffre({ bienId, acquereurId, montant, dateOffre: "2026-08-01" }, [], workspaceId);
  if (r.statut !== "creee") throw new Error(`création attendue, reçu ${r.statut}`);
  idsOffres.push(r.offre.id);
  return r.offre;
}

async function evenements(offreId: string, type?: string) {
  const lignes = await getDb()
    .select()
    .from(evenementsTable)
    .where(type ? and(eq(evenementsTable.offreId, offreId), eq(evenementsTable.typeEvenement, type)) : eq(evenementsTable.offreId, offreId));
  return lignes;
}

async function ligne(offreId: string) {
  const [l] = await getDb().select().from(offresTable).where(eq(offresTable.id, offreId));
  return l!;
}

describe("création (ADR-061 §16)", () => {
  it("A. naît en_cours, un seul offre_recue, biens.offre_en_cours_le JAMAIS écrit", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const offre = await offreEnCours(bien.id, acquereur.id);
    expect(offre.statut).toBe("en_cours");
    expect(await evenements(offre.id, "offre_recue")).toHaveLength(1);
    expect((await getBienById(bien.id))!.offreEnCoursLe).toBeUndefined();
    expect(await existeOffreCanoniqueDuBien(bien.id, WORKSPACE_TEST)).toBe(true);
  });

  it("refus typés : bien/acquéreur d'un autre workspace ou inconnu → introuvable, aucune ligne, aucun événement", async () => {
    const autre = await unAutreWorkspace("creation");
    const bien = await unBien();
    const acquereurAilleurs = await unAcquereur(autre);
    const bienAilleurs = await unBien(autre);
    const acquereur = await unAcquereur();
    expect(await creerOffre({ bienId: bien.id, acquereurId: acquereurAilleurs.id, montant: 1, dateOffre: "2026-08-01" }, [], WORKSPACE_TEST)).toEqual({ statut: "acquereur_introuvable" });
    expect(await creerOffre({ bienId: bienAilleurs.id, acquereurId: acquereur.id, montant: 1, dateOffre: "2026-08-01" }, [], WORKSPACE_TEST)).toEqual({ statut: "bien_introuvable" });
    expect(await creerOffre({ bienId: "pas-un-uuid", acquereurId: acquereur.id, montant: 1, dateOffre: "2026-08-01" }, [], WORKSPACE_TEST)).toEqual({ statut: "bien_introuvable" });
    expect(await listerOffresPourBien(bien.id, WORKSPACE_TEST)).toEqual([]);
  });

  it("doublon de paire (ADR-044) : refusé sans confirmation, accepté avec ; la vérification se fait sous verrou", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    await offreEnCours(bien.id, acquereur.id);
    const refus = await creerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 310000, dateOffre: "2026-08-02" }, [], WORKSPACE_TEST);
    expect(refus.statut).toBe("doublon_paire");
    const ok = await creerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 310000, dateOffre: "2026-08-02" }, [], WORKSPACE_TEST, { confirmerMalgreExistante: true });
    expect(ok.statut).toBe("creee");
    if (ok.statut === "creee") idsOffres.push(ok.offre.id);
  });
});

describe("transitions (ADR-061 §2-§6)", () => {
  it("acceptation : statut, dateDecision, un seul offre_acceptee ; refus et retrait : motif humain, événement exact once ; second geste → deja_finalisee", async () => {
    const bien = await unBien();
    const [a, b, c] = await Promise.all([unAcquereur(), unAcquereur(), unAcquereur()]);
    const oA = await offreEnCours(bien.id, a.id);
    const oB = await offreEnCours(bien.id, b.id);
    const oC = await offreEnCours(bien.id, c.id);

    const refus = await refuserOffre(oB.id, "2026-08-05", "desaccord_prix", WORKSPACE_TEST);
    expect(refus.statut).toBe("decidee");
    expect(await ligne(oB.id)).toMatchObject({ statut: "refusee", dateDecision: "2026-08-05", motifPerte: "desaccord_prix" });
    expect(await evenements(oB.id, "offre_refusee")).toHaveLength(1);
    expect(await refuserOffre(oB.id, "2026-08-06", "autre", WORKSPACE_TEST)).toEqual({ statut: "deja_finalisee", statutActuel: "refusee" });
    expect(await evenements(oB.id, "offre_refusee")).toHaveLength(1);

    const retrait = await retirerOffre(oC.id, "2026-08-05", "acquereur_se_retire", WORKSPACE_TEST);
    expect(retrait.statut).toBe("decidee");
    expect(await evenements(oC.id, "offre_retiree")).toHaveLength(1);
    expect(await retirerOffre(oC.id, "2026-08-06", "autre", WORKSPACE_TEST)).toEqual({ statut: "deja_finalisee", statutActuel: "retiree" });

    const acceptation = await accepterOffre(oA.id, "2026-08-07", WORKSPACE_TEST);
    expect(acceptation.statut).toBe("decidee");
    if (acceptation.statut !== "decidee") return;
    expect(acceptation.offre).toMatchObject({ statut: "acceptee", dateDecision: "2026-08-07" });
    expect(acceptation.offresRefuseesAutomatiquement).toEqual([]);
    expect(await evenements(oA.id, "offre_acceptee")).toHaveLength(1);
  });

  it("matrice interdite : aucune résurrection, aucun changement entre états finaux", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const refusee = await offreEnCours(bien.id, acquereur.id);
    await refuserOffre(refusee.id, "2026-08-05", "autre", WORKSPACE_TEST);
    const retiree = await offreEnCours(bien.id, acquereur.id, 1, WORKSPACE_TEST).catch(() => undefined);
    const bien2 = await unBien();
    const retiree2 = await offreEnCours(bien2.id, acquereur.id);
    await retirerOffre(retiree2.id, "2026-08-05", "autre", WORKSPACE_TEST);
    const bien3 = await unBien();
    const acceptee = await offreEnCours(bien3.id, acquereur.id);
    await accepterOffre(acceptee.id, "2026-08-05", WORKSPACE_TEST);
    const bien4 = await unBien();
    const caduque = await offreEnCours(bien4.id, acquereur.id);
    await accepterOffre(caduque.id, "2026-08-05", WORKSPACE_TEST);
    await rendreOffreCaduque(caduque.id, "acquereur_se_retire", WORKSPACE_TEST);
    void retiree;

    const cas: [string, Parameters<typeof deciderOffre>[1], string][] = [
      [refusee.id, { statut: "acceptee", dateDecision: "2026-09-01" }, "refusee"],
      [retiree2.id, { statut: "acceptee", dateDecision: "2026-09-01" }, "retiree"],
      [caduque.id, { statut: "acceptee", dateDecision: "2026-09-01" }, "caduque"],
      [acceptee.id, { statut: "retiree", dateDecision: "2026-09-01", motifPerte: "autre" }, "acceptee"],
      [acceptee.id, { statut: "refusee", dateDecision: "2026-09-01", motifPerte: "autre" }, "acceptee"],
      [refusee.id, { statut: "caduque", motifPerte: "autre" }, "refusee"],
    ];
    for (const [id, transition, statutActuel] of cas) {
      const r = await deciderOffre(id, transition, WORKSPACE_TEST);
      expect(r.statut, `${statutActuel} → ${transition.statut}`).toBe("deja_finalisee");
      expect((await ligne(id)).statut).toBe(statutActuel);
    }
    // Une offre en_cours ne peut pas devenir caduque (transition interdite, pas finalisée).
    const bien5 = await unBien();
    const ouverte = await offreEnCours(bien5.id, acquereur.id);
    expect(await deciderOffre(ouverte.id, { statut: "caduque", motifPerte: "autre" }, WORKSPACE_TEST)).toEqual({ statut: "transition_interdite", statutActuel: "en_cours" });
  });

  it("3 offres : accepter A refuse B et C avec le motif système, même date, un offre_refusee chacune, un offre_acceptee", async () => {
    const bien = await unBien();
    const [a, b, c] = await Promise.all([unAcquereur(), unAcquereur(), unAcquereur()]);
    const oA = await offreEnCours(bien.id, a.id);
    const oB = await offreEnCours(bien.id, b.id);
    const oC = await offreEnCours(bien.id, c.id);
    const r = await accepterOffre(oA.id, "2026-08-10", WORKSPACE_TEST);
    if (r.statut !== "decidee") throw new Error(r.statut);
    expect(r.offresRefuseesAutomatiquement.map((o) => o.id).sort()).toEqual([oB.id, oC.id].sort());
    for (const id of [oB.id, oC.id]) {
      expect(await ligne(id)).toMatchObject({ statut: "refusee", motifPerte: "autre_offre_acceptee", dateDecision: "2026-08-10" });
      expect(await evenements(id, "offre_refusee")).toHaveLength(1);
      expect(await evenements(id)).toHaveLength(2); // recue + refusee
    }
    expect(await evenements(oA.id, "offre_acceptee")).toHaveLength(1);
  });

  it("acceptation active existante → refus typé ; après caducité (dateDecision de l'acceptation conservée), une autre offre s'accepte", async () => {
    const bien = await unBien();
    const [a, b] = await Promise.all([unAcquereur(), unAcquereur()]);
    const oA = await offreEnCours(bien.id, a.id);
    await accepterOffre(oA.id, "2026-08-10", WORKSPACE_TEST);
    const oB = await offreEnCours(bien.id, b.id);
    expect(await accepterOffre(oB.id, "2026-08-12", WORKSPACE_TEST)).toEqual({ statut: "acceptation_active_existante", offreAccepteeId: oA.id });
    expect((await ligne(oB.id)).statut).toBe("en_cours");

    const caducite = await rendreOffreCaduque(oA.id, "acquereur_se_retire", WORKSPACE_TEST);
    expect(caducite.statut).toBe("decidee");
    expect(await ligne(oA.id)).toMatchObject({ statut: "caduque", motifPerte: "acquereur_se_retire", dateDecision: "2026-08-10" });
    expect(await evenements(oA.id, "offre_caduque")).toHaveLength(1);
    expect(await rendreOffreCaduque(oA.id, "autre", WORKSPACE_TEST)).toEqual({ statut: "deja_finalisee", statutActuel: "caduque" });
    expect(await evenements(oA.id, "offre_caduque")).toHaveLength(1);

    const acceptationB = await accepterOffre(oB.id, "2026-08-15", WORKSPACE_TEST);
    expect(acceptationB.statut).toBe("decidee");
    expect((await listerOffresPourBien(bien.id, WORKSPACE_TEST)).map((o) => [o.id, o.statut])).toEqual([[oB.id, "acceptee"], [oA.id, "caduque"]]);
  });

  it("bien archivé → refus typé sans écriture", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const offre = await offreEnCours(bien.id, acquereur.id);
    await getDb().update(biensTable).set({ archiveLe: new Date() }).where(eq(biensTable.id, bien.id));
    expect(await accepterOffre(offre.id, "2026-08-10", WORKSPACE_TEST)).toEqual({ statut: "bien_archive" });
    expect((await ligne(offre.id)).statut).toBe("en_cours");
  });
});

describe("concurrence — sérialisation par le bien (ADR-061 §15)", () => {
  it("B. double acceptation de la même offre : une transition, un événement, la seconde deja_finalisee", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const offre = await offreEnCours(bien.id, acquereur.id);
    const [r1, r2] = await Promise.all([accepterOffre(offre.id, "2026-08-10", WORKSPACE_TEST), accepterOffre(offre.id, "2026-08-10", WORKSPACE_TEST)]);
    expect([r1.statut, r2.statut].sort()).toEqual(["decidee", "deja_finalisee"]);
    expect(await evenements(offre.id, "offre_acceptee")).toHaveLength(1);
    expect((await ligne(offre.id)).statut).toBe("acceptee");
  });

  it("C. acceptation A vs B concurrentes sur le même bien : une acceptee, l'autre refusee/autre_offre_acceptee, perdante typée", async () => {
    const bien = await unBien();
    const [a, b] = await Promise.all([unAcquereur(), unAcquereur()]);
    const oA = await offreEnCours(bien.id, a.id);
    const oB = await offreEnCours(bien.id, b.id);
    const [rA, rB] = await Promise.all([accepterOffre(oA.id, "2026-08-10", WORKSPACE_TEST), accepterOffre(oB.id, "2026-08-10", WORKSPACE_TEST)]);
    const statuts = [rA.statut, rB.statut].sort();
    expect(statuts).toEqual(["decidee", "deja_finalisee"]);
    const finalA = await ligne(oA.id);
    const finalB = await ligne(oB.id);
    expect([finalA.statut, finalB.statut].sort()).toEqual(["acceptee", "refusee"]);
    const refusee = finalA.statut === "refusee" ? finalA : finalB;
    expect(refusee.motifPerte).toBe("autre_offre_acceptee");
    const acceptee = finalA.statut === "acceptee" ? finalA : finalB;
    expect(await evenements(acceptee.id, "offre_acceptee")).toHaveLength(1);
    expect(await evenements(refusee.id, "offre_refusee")).toHaveLength(1);
    expect(await evenements(refusee.id, "offre_acceptee")).toHaveLength(0);
  });

  it("D/E. refus vs acceptation, retrait vs acceptation : un seul gagnant, un seul événement terminal", async () => {
    for (const geste of ["refusee", "retiree"] as const) {
      const bien = await unBien();
      const acquereur = await unAcquereur();
      const offre = await offreEnCours(bien.id, acquereur.id);
      const humain =
        geste === "refusee"
          ? refuserOffre(offre.id, "2026-08-10", "desaccord_prix", WORKSPACE_TEST)
          : retirerOffre(offre.id, "2026-08-10", "acquereur_se_retire", WORKSPACE_TEST);
      const [r1, r2] = await Promise.all([accepterOffre(offre.id, "2026-08-10", WORKSPACE_TEST), humain]);
      expect([r1.statut, r2.statut].sort()).toEqual(["decidee", "deja_finalisee"]);
      const finale = await ligne(offre.id);
      expect(["acceptee", geste]).toContain(finale.statut);
      const terminaux = (await evenements(offre.id)).filter((e) => e.typeEvenement !== "offre_recue");
      expect(terminaux).toHaveLength(1);
      expect(terminaux[0].typeEvenement).toBe(finale.statut === "acceptee" ? "offre_acceptee" : `offre_${geste}`);
    }
  });
});

describe("lectures scoped, précédence et imports incohérents", () => {
  it("H/I. autre workspace : reads vides / undefined, writes introuvable ; aucune fuite", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const offre = await offreEnCours(bien.id, acquereur.id);
    const autre = await unAutreWorkspace("lecture");
    expect(await getOffreById(offre.id, autre)).toBeUndefined();
    expect(await listerOffresPourBien(bien.id, autre)).toEqual([]);
    expect(await existeOffreCanoniqueDuBien(bien.id, autre)).toBe(false);
    expect(await chargerEtatOffresBien(bien, autre)).toEqual({ mode: "aucun" });
    expect(await accepterOffre(offre.id, "2026-08-10", autre)).toEqual({ statut: "introuvable" });
    expect(await refuserOffre(offre.id, "2026-08-10", "autre", autre)).toEqual({ statut: "introuvable" });
    expect((await ligne(offre.id)).statut).toBe("en_cours");
    expect(await evenements(offre.id)).toHaveLength(1);
  });

  it("G. canonique finale + legacy offre_en_cours_le : mode canonique, jamais offre_en_cours (refusee / retiree / caduque)", async () => {
    for (const finale of ["refusee", "retiree", "caduque"] as const) {
      const bien = await unBien();
      const acquereur = await unAcquereur();
      await marquerOffreEnCours(bien.id, WORKSPACE_TEST);
      const offre = await offreEnCours(bien.id, acquereur.id);
      if (finale === "caduque") {
        await accepterOffre(offre.id, "2026-08-05", WORKSPACE_TEST);
        await rendreOffreCaduque(offre.id, "autre", WORKSPACE_TEST);
      } else if (finale === "refusee") {
        await refuserOffre(offre.id, "2026-08-05", "autre", WORKSPACE_TEST);
      } else {
        await retirerOffre(offre.id, "2026-08-05", "autre", WORKSPACE_TEST);
      }
      const bienRelu = (await getBienById(bien.id))!;
      expect(bienRelu.offreEnCoursLe, "le jalon legacy reste stocké").toBeDefined();
      const etat = await chargerEtatOffresBien(bienRelu, WORKSPACE_TEST);
      expect(etat.mode, finale).toBe("canonique");
      if (etat.mode !== "canonique") return;
      expect(etat.offresEnCours).toEqual([]);
      expect(etat.offreAcceptee).toBeUndefined();
      expect(statutCommercialBienEffectif(bienRelu, etat.offres, []), finale).toBe("en_commercialisation");
    }
  });

  it("legacy-only : aucune offre canonique → mode legacy sur offre_en_cours_le ; ni jalon ni offre → aucun", async () => {
    const bien = await unBien();
    expect(await chargerEtatOffresBien(bien, WORKSPACE_TEST)).toEqual({ mode: "aucun" });
    await marquerOffreEnCours(bien.id, WORKSPACE_TEST);
    const relu = (await getBienById(bien.id))!;
    expect(await chargerEtatOffresBien(relu, WORKSPACE_TEST)).toMatchObject({ mode: "legacy" });
    expect(statutCommercialBienEffectif(relu, [], [])).toBe("offre_en_cours");
  });

  it("L. import incohérent (deux acceptee historiques) : lisible et déterministe, jamais réparé ; une troisième acceptation refusée", async () => {
    const bien = await unBien();
    const [a, b, c] = await Promise.all([unAcquereur(), unAcquereur(), unAcquereur()]);
    const o1 = await enregistrerOffre({ bienId: bien.id, acquereurId: a.id, montant: 100, dateOffre: "2025-01-01" });
    const o2 = await enregistrerOffre({ bienId: bien.id, acquereurId: b.id, montant: 200, dateOffre: "2025-02-01" });
    idsOffres.push(o1.id, o2.id);
    await getDb().update(offresTable).set({ statut: "acceptee", dateDecision: "2025-01-10" }).where(inArray(offresTable.id, [o1.id, o2.id]));
    const etat = await chargerEtatOffresBien(bien, WORKSPACE_TEST);
    if (etat.mode !== "canonique") throw new Error(etat.mode);
    expect(etat.offres.map((o) => o.statut)).toEqual(["acceptee", "acceptee"]);
    expect(etat.offreAcceptee?.id, "la plus récente par dateOffre, déterministe").toBe(o2.id);
    const o3 = await offreEnCours(bien.id, c.id);
    expect((await accepterOffre(o3.id, "2026-08-10", WORKSPACE_TEST)).statut).toBe("acceptation_active_existante");
    expect((await ligne(o1.id)).statut).toBe("acceptee");
    expect((await ligne(o2.id)).statut).toBe("acceptee");
  });

  it("query bounds : état de N biens en lot = 1 requête offres + 1 requête compromis", async () => {
    const biens = await Promise.all([unBien(), unBien(), unBien()]);
    const acquereur = await unAcquereur();
    for (const bien of biens) await offreEnCours(bien.id, acquereur.id);
    const db = getDb();
    const espion = vi.spyOn(db, "select");
    const etats = await chargerEtatsOffresParBien(biens, WORKSPACE_TEST, db);
    const compromis = await listerCompromisParBiens(biens.map((b) => b.id), WORKSPACE_TEST, db);
    const n = espion.mock.calls.length;
    espion.mockRestore();
    expect(n).toBe(2);
    expect([...etats.values()].every((e) => e.mode === "canonique")).toBe(true);
    expect(compromis.size).toBe(3);
  });
});
