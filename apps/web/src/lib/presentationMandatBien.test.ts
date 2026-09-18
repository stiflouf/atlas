import { afterAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";

// ADR-060 §1 — LA précédence canonique > legacy, décidée par entité et testée sur les cas qui
// piègent (canonique résilié ou expiré + legacy « actif ») ; lectures Mandat SCOPED (lot
// MANDATE_CANONICAL_UI_V1, P3-2) : un autre workspace ne voit rien, sans distinguer absent
// d'ailleurs ; nombre de requêtes borné.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { biens: biensTable, contacts: contactsTable, mandats: mandatsTable, partiesMandat: partiesMandatTable, projetsVendeur: projetsVendeurTable, workspaces: workspacesTable } = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerBien } = await import("./bienRepository");
const { creerContact } = await import("./contactRepository");
const { creerProjetVendeur } = await import("./projetVendeurRepository");
const { creerMandat, existeMandatCanoniqueDuBien, getMandatById, listerMandatsDuBien, listerMandatsDuProjetVendeur, resilierMandat } = await import("./mandatRepository");
const { ajouterPartieMandat } = await import("./partieMandatRepository");
const { chargerPresentationMandatBien, dateMandatEffective, statutMandatEffectif } = await import("./presentationMandatBien");

const AUJOURDHUI = "2026-06-15";
const M = `Zpresentation${Date.now()}`;
const biensCrees: string[] = [];
const contactsCrees: string[] = [];
const projetsCrees: string[] = [];
const workspacesCrees: string[] = [];
let compteur = 0;

async function unBien(surcharge: { statutMandat?: "actif" | "suspendu" | "expire"; dateMandat?: string } = {}, workspaceId = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] PRESENTATION-MANDAT-${compteur}-${Date.now()}`,
      titre: "Bien présentation mandat",
      type: "appartement",
      adresse: "1 rue de la Précédence",
      ville: "Testville",
      codePostal: "00000",
      surface: 40,
      pieces: 2,
      prix: 200000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
      ...surcharge,
    },
    workspaceId
  );
  biensCrees.push(bien.id);
  return bien;
}

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-presentation-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace présentation" });
  workspacesCrees.push(id);
  return id;
}

afterAll(async () => {
  if (biensCrees.length > 0) {
    const mandats = (await getDb().select({ id: mandatsTable.id }).from(mandatsTable).where(inArray(mandatsTable.bienId, biensCrees))).map((m) => m.id);
    if (mandats.length > 0) await getDb().delete(partiesMandatTable).where(inArray(partiesMandatTable.mandatId, mandats));
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, biensCrees));
    await getDb().delete(biensTable).where(inArray(biensTable.id, biensCrees));
  }
  if (contactsCrees.length > 0) await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  if (projetsCrees.length > 0) await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, projetsCrees));
  if (workspacesCrees.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
});

describe("chargerPresentationMandatBien — précédence canonique > legacy (ADR-060 §1)", () => {
  it("A. 0 canonique + legacy actif → mode legacy, Actif", async () => {
    const bien = await unBien({ statutMandat: "actif" });
    const p = await chargerPresentationMandatBien(bien, WORKSPACE_TEST, AUJOURDHUI);
    expect(p).toEqual({ mode: "legacy", statutMandat: "actif", dateMandat: "2026-01-01" });
    expect(statutMandatEffectif(p)).toEqual({ actif: true, libelle: "Actif", variante: "success" });
    expect(dateMandatEffective(p)).toBe("2026-01-01");
  });

  it("B. canonique actif + legacy suspendu → canonique Actif, jamais Suspendu", async () => {
    const bien = await unBien({ statutMandat: "suspendu" });
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-02-01", type: "exclusif", numero: "EX-1" });
    const p = await chargerPresentationMandatBien(bien, WORKSPACE_TEST, AUJOURDHUI);
    expect(p.mode).toBe("canonique");
    if (p.mode !== "canonique") return;
    expect(p.mandatCourant?.id).toBe(mandat.id);
    expect(p.historique.map((m) => [m.id, m.statut])).toEqual([[mandat.id, "actif"]]);
    expect(statutMandatEffectif(p)).toEqual({ actif: true, libelle: "Actif", variante: "success" });
    expect(dateMandatEffective(p)).toBe("2026-02-01");
  });

  it("C. canonique résilié + legacy actif → canonique, aucun courant, historique Résilié, jamais legacy", async () => {
    const bien = await unBien({ statutMandat: "actif" });
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-10", type: "simple" });
    expect((await resilierMandat(mandat.id, { resilieLe: "2026-03-01", motifResiliation: "Vente annulée" }, WORKSPACE_TEST)).statut).toBe("resilie");
    const p = await chargerPresentationMandatBien(bien, WORKSPACE_TEST, AUJOURDHUI);
    expect(p.mode).toBe("canonique");
    if (p.mode !== "canonique") return;
    expect(p.mandatCourant).toBeUndefined();
    expect(p.historique.map((m) => m.statut)).toEqual(["resilie"]);
    expect(p.parties).toEqual([]);
    expect(statutMandatEffectif(p)).toEqual({ actif: false, libelle: "Aucun mandat en cours", variante: "muted" });
    expect(dateMandatEffective(p)).toBeUndefined();
  });

  it("D. canonique expiré + legacy actif → canonique, aucun courant, historique Expiré", async () => {
    const bien = await unBien({ statutMandat: "actif" });
    await creerMandat({ bienId: bien.id, dateDebut: "2025-01-01", dateFin: "2025-12-31", type: "simple" });
    const p = await chargerPresentationMandatBien(bien, WORKSPACE_TEST, AUJOURDHUI);
    expect(p.mode).toBe("canonique");
    if (p.mode !== "canonique") return;
    expect(p.mandatCourant).toBeUndefined();
    expect(p.historique.map((m) => m.statut)).toEqual(["expire"]);
    expect(statutMandatEffectif(p).actif).toBe(false);
  });

  it("E. canonique à type NULL + legacy → canonique, type absent (jamais « simple », jamais le legacy)", async () => {
    const bien = await unBien({ statutMandat: "actif" });
    const [ligne] = await getDb().insert(mandatsTable).values({ bienId: bien.id, dateDebut: "2026-01-01" }).returning();
    const p = await chargerPresentationMandatBien(bien, WORKSPACE_TEST, AUJOURDHUI);
    expect(p.mode).toBe("canonique");
    if (p.mode !== "canonique") return;
    expect(p.mandatCourant?.id).toBe(ligne.id);
    expect(p.mandatCourant?.type).toBeUndefined();
    expect(p.historique[0].type).toBeUndefined();
  });

  it("F. 0 canonique + legacy expire → legacy Expiré", async () => {
    const bien = await unBien({ statutMandat: "expire" });
    const p = await chargerPresentationMandatBien(bien, WORKSPACE_TEST, AUJOURDHUI);
    expect(p).toMatchObject({ mode: "legacy", statutMandat: "expire" });
    expect(statutMandatEffectif(p)).toEqual({ actif: false, libelle: "Expiré", variante: "danger" });
  });

  it("G. 0 canonique + legacy inexploitable → mode aucun", async () => {
    const p = await chargerPresentationMandatBien({ id: "bien-mock-001", statutMandat: "" as never, dateMandat: "" }, WORKSPACE_TEST, AUJOURDHUI);
    expect(p).toEqual({ mode: "aucun" });
    expect(statutMandatEffectif(p)).toEqual({ actif: false, libelle: "Aucun mandat", variante: "muted" });
    expect(dateMandatEffective(p)).toBeUndefined();
  });

  it("à venir : le courant est le mandat à venir, statut effectif non actif mais libellé « À venir »", async () => {
    const bien = await unBien({ statutMandat: "actif" });
    await creerMandat({ bienId: bien.id, dateDebut: "2026-09-01", type: "simple" });
    const p = await chargerPresentationMandatBien(bien, WORKSPACE_TEST, AUJOURDHUI);
    expect(statutMandatEffectif(p)).toEqual({ actif: false, libelle: "À venir", variante: "warning" });
  });

  it("parties du courant chargées avec l'identité des contacts ; 3 requêtes Mandat, quel que soit le volume", async () => {
    const bien = await unBien();
    const ancien = await creerMandat({ bienId: bien.id, dateDebut: "2024-01-01", dateFin: "2024-12-31", type: "simple" });
    const courant = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "exclusif", remplaceMandatId: ancien.id });
    for (let i = 0; i < 4; i++) {
      const c = await creerContact({ nom: `${M} Partie ${i}` }, WORKSPACE_TEST);
      contactsCrees.push(c.id);
      await ajouterPartieMandat(courant.id, { contactId: c.id, role: i === 3 ? "representant" : "mandant" }, WORKSPACE_TEST);
    }
    const db = getDb();
    const espion = vi.spyOn(db, "select");
    const p = await chargerPresentationMandatBien(bien, WORKSPACE_TEST, AUJOURDHUI, db);
    const n = espion.mock.calls.length;
    espion.mockRestore();
    // 3 requêtes exécutées : historique, courant, parties. Le 4e `.select()` observé est le
    // constructeur de la sous-requête `NOT EXISTS` de `mandatCourantDuBien` (aucun aller-retour).
    expect(n).toBe(4);
    if (p.mode !== "canonique") throw new Error(p.mode);
    expect(p.mandatCourant?.id).toBe(courant.id);
    expect(p.parties).toHaveLength(4);
    expect(p.parties.map((x) => x.contact.nom)).toEqual([0, 1, 2, 3].map((i) => `${M} Partie ${i}`));
    expect(p.historique.map((m) => [m.id, m.remplaceParId])).toEqual([[ancien.id, courant.id], [courant.id, undefined]]);
  });

  it("autre workspace : mode legacy du bien (rien du canonique n'est exposé), aucune partie", async () => {
    const bien = await unBien({ statutMandat: "suspendu" });
    await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    const autre = await unAutreWorkspace("presentation");
    // Le bien lui-même appartient à WORKSPACE_TEST : depuis `autre`, aucun mandat canonique n'est
    // visible — la présentation retombe sur ce que le bien porte, sans jamais révéler le canonique.
    const p = await chargerPresentationMandatBien(bien, autre, AUJOURDHUI);
    expect(p.mode).toBe("legacy");
  });
});

describe("lectures Mandat scoped (P3-2) — un autre workspace ne voit rien", () => {
  it("getMandatById : A lit A ; B ne lit pas A ; inconnu et invalide indistinguables", async () => {
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    const autre = await unAutreWorkspace("get");
    expect((await getMandatById(mandat.id, WORKSPACE_TEST))?.id).toBe(mandat.id);
    expect(await getMandatById(mandat.id, autre)).toBeUndefined();
    expect(await getMandatById("00000000-0000-4000-8000-000000000000", WORKSPACE_TEST)).toBeUndefined();
    expect(await getMandatById("pas-un-uuid", WORKSPACE_TEST)).toBeUndefined();
  });

  it("listerMandatsDuBien et existeMandatCanoniqueDuBien : B ne voit rien", async () => {
    const bien = await unBien();
    await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    const autre = await unAutreWorkspace("liste");
    expect(await listerMandatsDuBien(bien.id, WORKSPACE_TEST, AUJOURDHUI)).toHaveLength(1);
    expect(await listerMandatsDuBien(bien.id, autre, AUJOURDHUI)).toEqual([]);
    expect(await existeMandatCanoniqueDuBien(bien.id, WORKSPACE_TEST)).toBe(true);
    expect(await existeMandatCanoniqueDuBien(bien.id, autre)).toBe(false);
    expect(await existeMandatCanoniqueDuBien("pas-un-uuid", WORKSPACE_TEST)).toBe(false);
  });

  it("listerMandatsDuProjetVendeur : B ne voit rien", async () => {
    const bien = await unBien();
    const projet = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
    projetsCrees.push(projet.id);
    await creerMandat({ bienId: bien.id, projetVendeurId: projet.id, dateDebut: "2026-01-01", type: "simple" });
    const autre = await unAutreWorkspace("projet");
    expect(await listerMandatsDuProjetVendeur(projet.id, WORKSPACE_TEST)).toHaveLength(1);
    expect(await listerMandatsDuProjetVendeur(projet.id, autre)).toEqual([]);
  });
});
