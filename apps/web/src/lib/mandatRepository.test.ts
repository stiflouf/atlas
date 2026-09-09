import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

// ADR-055 §F — test d'intégration Postgres : les FK réelles, les CHECK de cohérence et l'absence
// d'unicité sur `bien_id` n'existent qu'en base.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  mandats: mandatsTable,
  projetsVendeur: projetsVendeurTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerBien } = await import("./bienRepository");
const { creerProjetVendeur } = await import("./projetVendeurRepository");
const {
  creerMandat,
  creerMandatSuccesseur,
  getMandatById,
  listerMandatsDuBien,
  listerMandatsDuProjetVendeur,
} = await import("./mandatRepository");

const biensCrees: string[] = [];
const projetsCrees: string[] = [];
const workspacesCrees: string[] = [];
let compteur = 0;

async function unBien(workspaceId: string = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] MANDAT-${compteur}-${Date.now()}`,
      titre: "Bien de test mandat",
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

async function unProjetVendeur(workspaceId: string = WORKSPACE_TEST) {
  const projet = await creerProjetVendeur({ origineLead: "recommandation" }, workspaceId);
  projetsCrees.push(projet.id);
  return projet;
}

afterAll(async () => {
  // Les mandats d'abord : ils référencent biens et projets sans CASCADE (un fait contractuel ne
  // disparaît jamais par effet de bord).
  if (biensCrees.length > 0) {
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, biensCrees));
    await getDb().delete(biensTable).where(inArray(biensTable.id, biensCrees));
  }
  if (projetsCrees.length > 0) {
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, projetsCrees));
  }
  if (workspacesCrees.length > 0) {
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
  }
});

describe("mandatRepository — le mandat (intégration Postgres)", () => {
  it("crée un mandat rattaché à un bien et à un projet, et le relit", async () => {
    const bien = await unBien();
    const projet = await unProjetVendeur();

    const mandat = await creerMandat({
      bienId: bien.id,
      projetVendeurId: projet.id,
      dateDebut: "2026-03-01",
      dateFin: "2026-06-01",
    });

    const relu = await getMandatById(mandat.id);
    expect(relu).toBeDefined();
    expect(relu!.bienId).toBe(bien.id);
    expect(relu!.projetVendeurId).toBe(projet.id);
    expect(relu!.dateDebut).toBe("2026-03-01");
    expect(relu!.dateFin).toBe("2026-06-01");
    // Un mandat en cours n'a pas une résiliation nulle : il n'en a pas.
    expect(relu!.resilieLe).toBeUndefined();
    expect(relu!.remplaceMandatId).toBeUndefined();
  });

  it("crée un mandat SANS projet vendeur — le fait contractuel existe quand même", async () => {
    // C'est le cas de toute signature venant d'une opportunité antérieure au modèle canonique.
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-03-01" });
    expect(mandat.projetVendeurId).toBeUndefined();
  });

  it("retourne undefined pour un identifiant inconnu ou non-UUID, sans erreur de cast", async () => {
    expect(await getMandatById("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    expect(await getMandatById("mandat-001")).toBeUndefined();
  });

  it("refuse un bien ou un projet inexistant plutôt qu'un mandat orphelin", async () => {
    const bien = await unBien();
    const inexistant = "00000000-0000-0000-0000-000000000000";
    await expect(creerMandat({ bienId: inexistant, dateDebut: "2026-03-01" })).rejects.toThrow(/Bien introuvable/);
    await expect(
      creerMandat({ bienId: bien.id, projetVendeurId: inexistant, dateDebut: "2026-03-01" })
    ).rejects.toThrow(/Projet vendeur introuvable/);
  });

  it("refuse un mandat reliant un bien et un projet de workspaces différents", async () => {
    // `mandats` est une feuille sans `workspace_id` : la base ne peut pas refuser cette relation.
    // Même garde et même raison que `ajouterPartieProjet`.
    const [autreWorkspace] = await getDb()
      .insert(workspacesTable)
      .values({ id: "workspace-test-mandat", nom: "[test réel] autre workspace" })
      .returning();
    workspacesCrees.push(autreWorkspace.id);

    const bienIci = await unBien();
    const projetAilleurs = await unProjetVendeur(autreWorkspace.id);

    await expect(
      creerMandat({ bienId: bienIci.id, projetVendeurId: projetAilleurs.id, dateDebut: "2026-03-01" })
    ).rejects.toThrow(/workspaces différents/);
    expect(await listerMandatsDuBien(bienIci.id)).toEqual([]);
  });

  it("refuse une période ou une résiliation incohérente — le CHECK, pas une convention", async () => {
    const bien = await unBien();
    await expect(
      getDb().insert(mandatsTable).values({ bienId: bien.id, dateDebut: "2026-06-01", dateFin: "2026-03-01" })
    ).rejects.toThrow();
    await expect(
      getDb().insert(mandatsTable).values({ bienId: bien.id, dateDebut: "2026-06-01", resilieLe: "2026-03-01" })
    ).rejects.toThrow();
  });
});

describe("ADR-055 CAS 7 — l'historique contractuel n'est jamais écrasé", () => {
  it("un même bien porte PLUSIEURS mandats successifs", async () => {
    // Un bien remandaté deux ans plus tard a deux mandats. Le premier reste, tel quel.
    const bien = await unBien();
    const premier = await creerMandat({ bienId: bien.id, dateDebut: "2024-01-01", dateFin: "2024-04-01" });
    const second = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01" });

    const mandats = await listerMandatsDuBien(bien.id);
    expect(mandats).toHaveLength(2);
    // Ordre chronologique de prise d'effet : l'historique se lit dans le sens où il s'est produit.
    expect(mandats.map((mandat) => mandat.id)).toEqual([premier.id, second.id]);
    // Le premier est intact, expiration comprise.
    expect(mandats[0].dateFin).toBe("2024-04-01");
  });

  it("un même projet vendeur porte PLUSIEURS mandats successifs", async () => {
    const bien = await unBien();
    const projet = await unProjetVendeur();
    await creerMandat({ bienId: bien.id, projetVendeurId: projet.id, dateDebut: "2026-01-01", dateFin: "2026-04-01" });
    await creerMandat({ bienId: bien.id, projetVendeurId: projet.id, dateDebut: "2026-04-02" });

    expect(await listerMandatsDuProjetVendeur(projet.id)).toHaveLength(2);
  });

  it("un renouvellement crée une ligne et laisse le mandat remplacé strictement intact", async () => {
    const bien = await unBien();
    const projet = await unProjetVendeur();
    const initial = await creerMandat({
      bienId: bien.id,
      projetVendeurId: projet.id,
      dateDebut: "2026-01-01",
      dateFin: "2026-04-01",
    });

    const successeur = await creerMandatSuccesseur(initial.id, {
      projetVendeurId: projet.id,
      dateDebut: "2026-04-02",
      dateFin: "2026-07-02",
    });

    expect(successeur.remplaceMandatId).toBe(initial.id);
    // Le successeur hérite du bien : un renouvellement porte sur le même actif.
    expect(successeur.bienId).toBe(bien.id);

    // Le mandat remplacé n'a PAS été modifié — ni clôturé d'autorité, ni marqué « remplacé ».
    const relu = await getMandatById(initial.id);
    expect(relu).toEqual(initial);
  });

  it("refuse de renouveler un mandat inexistant", async () => {
    await expect(
      creerMandatSuccesseur("00000000-0000-0000-0000-000000000000", { dateDebut: "2026-04-02" })
    ).rejects.toThrow(/Mandat introuvable/);
    await expect(creerMandatSuccesseur("pas-un-uuid", { dateDebut: "2026-04-02" })).rejects.toThrow(
      /Mandat introuvable/
    );
  });

  it("refuse qu'un mandat se remplace lui-même", async () => {
    // Écriture directe : le repository ne peut pas produire ce cas (l'id n'existe pas encore au
    // moment de l'insertion), mais un UPDATE futur le pourrait — le CHECK le refuse.
    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01" });
    await expect(
      getDb().update(mandatsTable).set({ remplaceMandatId: mandat.id }).where(inArray(mandatsTable.id, [mandat.id]))
    ).rejects.toThrow();
  });
});
