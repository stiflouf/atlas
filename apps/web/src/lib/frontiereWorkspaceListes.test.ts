import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2B1 (ADR-054) — les LISTES. Le lot V1 avait fermé les mutations et les
// téléchargements, le V2A les mutations restantes ; ici, ce sont les lectures de liste qui
// portaient la fuite la plus large : un `SELECT` sans `WHERE` rend inutile tout scoping en aval,
// puisque la ligne d'un autre périmètre est déjà à l'écran.
//
// Deux workspaces réels, des données volontairement DIFFÉRENTES de part et d'autre : un test qui
// se contente de compter ne détecte pas un mélange si les deux côtés se ressemblent.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  biens: biensTable,
  prospectsVendeurs: prospectsTable,
  taches: tachesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien, rechercherBiensPage, archiverBien } = await import("./bienRepository");
const { creerAcquereur, rechercherAcquereursPage } = await import("./clientRepository");
const {
  creerProspectVendeur,
  rechercherProspectsVendeurs,
  listerProspectsVendeursDuWorkspace,
  listerProspectsVendeursPourMachine,
} = await import("./prospectVendeurRepository");
const { creerTache, listerTachesParProspectVendeurDuWorkspace } = await import("./tacheRepository");

const M = `Zlistes${Date.now()}`;
const WORKSPACE_B = `ws-listes-b-${Date.now()}`;
// Un troisième workspace, volontairement VIDE : c'est lui qui prouve « vide veut dire vide ».
const WORKSPACE_VIDE = `ws-listes-vide-${Date.now()}`;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsTaches: string[] = [];

// Termes de recherche présents d'UN SEUL côté de la frontière.
const VILLE_A = `${M}VilleA`;
const VILLE_B = `${M}VilleB`;
const NOM_A = `${M}NomA`;
const NOM_B = `${M}NomB`;
const LIBELLE_TACHE_B = `${M} tâche confidentielle de B`;

beforeAll(async () => {
  await getDb()
    .insert(workspacesTable)
    .values([
      { id: WORKSPACE_B, nom: "[test réel] listes B" },
      { id: WORKSPACE_VIDE, nom: "[test réel] listes vide" },
    ]);
});

afterAll(async () => {
  if (idsTaches.length > 0) await getDb().delete(tachesTable).where(inArray(tachesTable.id, idsTaches));
  if (idsProspects.length > 0) await getDb().delete(prospectsTable).where(inArray(prospectsTable.id, idsProspects));
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, [WORKSPACE_B, WORKSPACE_VIDE]));
});

let compteur = 0;

async function unBien(workspaceId: string, ville: string) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `${M}-REF-${compteur}`,
      titre: `Bien ${compteur}`,
      type: "appartement" as const,
      adresse: "1 rue de la Frontière",
      ville,
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat: "actif" as const,
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  return bien;
}

async function unAcquereur(workspaceId: string, nom: string) {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: "Frontière",
      nom: `${nom}-${compteur}`,
      email: `${M}.${compteur}@example.test`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "recherche_active" as const,
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

async function unProspect(workspaceId: string, nom: string) {
  compteur += 1;
  const prospect = await creerProspectVendeur({ nom: `${nom}-${compteur}` }, workspaceId);
  idsProspects.push(prospect.id);
  return prospect;
}

const pageA = { workspaceId: WORKSPACE_TEST, archives: false, page: 1, parPage: 50 };

describe("Frontière workspace — liste des biens", () => {
  it("ne rend que les biens du workspace, total et recherche compris", async () => {
    const a1 = await unBien(WORKSPACE_TEST, VILLE_A);
    const a2 = await unBien(WORKSPACE_TEST, VILLE_A);
    const b1 = await unBien(WORKSPACE_B, VILLE_B);

    const vueA = await rechercherBiensPage({ ...pageA, q: M });
    const idsVus = vueA.lignes.map((l) => l.id);
    expect(idsVus).toContain(a1.id);
    expect(idsVus).toContain(a2.id);
    expect(idsVus).not.toContain(b1.id);
    expect(vueA.total).toBe(2);

    // Un terme qui n'existe QUE dans B : la recherche de A ne doit rien trouver, et surtout pas
    // compter la ligne de B dans son total (une page vide avec un total non nul serait le symptôme
    // d'un filtre appliqué après la pagination).
    const rechercheB = await rechercherBiensPage({ ...pageA, q: VILLE_B });
    expect(rechercheB.lignes).toEqual([]);
    expect(rechercheB.total).toBe(0);

    // Et le même terme, depuis B, remonte bien la ligne : le refus vient du périmètre, pas du filtre.
    const vueB = await rechercherBiensPage({ ...pageA, workspaceId: WORKSPACE_B, q: VILLE_B });
    expect(vueB.lignes.map((l) => l.id)).toEqual([b1.id]);
  });

  it("les archives sont scopées elles aussi", async () => {
    const archiveA = await unBien(WORKSPACE_TEST, VILLE_A);
    const archiveB = await unBien(WORKSPACE_B, VILLE_B);
    await archiverBien(archiveA.id, WORKSPACE_TEST);
    await archiverBien(archiveB.id, WORKSPACE_B);

    const archivesA = await rechercherBiensPage({ ...pageA, archives: true, q: M });
    const ids = archivesA.lignes.map((l) => l.id);
    expect(ids).toContain(archiveA.id);
    expect(ids).not.toContain(archiveB.id);
  });
});

describe("Frontière workspace — liste des acquéreurs", () => {
  it("ne rend que les acquéreurs du workspace, total et recherche compris", async () => {
    const a1 = await unAcquereur(WORKSPACE_TEST, NOM_A);
    const b1 = await unAcquereur(WORKSPACE_B, NOM_B);

    const vueA = await rechercherAcquereursPage({ ...pageA, q: NOM_A });
    expect(vueA.lignes.map((l) => l.id)).toContain(a1.id);
    expect(vueA.lignes.map((l) => l.id)).not.toContain(b1.id);

    const rechercheB = await rechercherAcquereursPage({ ...pageA, q: NOM_B });
    expect(rechercheB.lignes).toEqual([]);
    expect(rechercheB.total).toBe(0);

    const vueB = await rechercherAcquereursPage({ ...pageA, workspaceId: WORKSPACE_B, q: NOM_B });
    expect(vueB.lignes.map((l) => l.id)).toEqual([b1.id]);
  });
});

describe("Frontière workspace — liste des prospects vendeurs", () => {
  it("sans terme de recherche, ne rend que les prospects du workspace", async () => {
    const a1 = await unProspect(WORKSPACE_TEST, NOM_A);
    const b1 = await unProspect(WORKSPACE_B, NOM_B);

    // Le cas qui fuyait le plus : sans `q`, le `where` était vide, donc la table entière.
    const sansRecherche = await rechercherProspectsVendeurs({ workspaceId: WORKSPACE_TEST, vue: "en_cours" });
    const ids = sansRecherche.map((p) => p.id);
    expect(ids).toContain(a1.id);
    expect(ids).not.toContain(b1.id);

    const rechercheB = await rechercherProspectsVendeurs({ workspaceId: WORKSPACE_TEST, q: NOM_B, vue: "en_cours" });
    expect(rechercheB).toEqual([]);
  });

  it("l'enrichissement des tâches est scopé : un libellé de B n'apparaît jamais côté A", async () => {
    const prospectB = await unProspect(WORKSPACE_B, NOM_B);
    const tacheB = await creerTache(
      { titre: LIBELLE_TACHE_B, type: "autre", priorite: "normale", origine: "manuelle", cible: { type: "prospectVendeur", id: prospectB.id } },
      WORKSPACE_B
    );
    idsTaches.push(tacheB.id);

    // Même en demandant explicitement l'id de B, une session de A ne récupère rien.
    const depuisA = await listerTachesParProspectVendeurDuWorkspace([prospectB.id], WORKSPACE_TEST);
    expect(depuisA.size).toBe(0);

    const depuisB = await listerTachesParProspectVendeurDuWorkspace([prospectB.id], WORKSPACE_B);
    expect(depuisB.get(prospectB.id)?.map((t) => t.titre)).toEqual([LIBELLE_TACHE_B]);
  });
});

describe("Frontière workspace — lecteur prospects user vs machine", () => {
  it("le lecteur scopé ne voit que son workspace, le lecteur machine voit les deux", async () => {
    const a1 = await unProspect(WORKSPACE_TEST, NOM_A);
    const b1 = await unProspect(WORKSPACE_B, NOM_B);

    const vueA = await listerProspectsVendeursDuWorkspace(WORKSPACE_TEST);
    expect(vueA.map((p) => p.id)).toContain(a1.id);
    expect(vueA.map((p) => p.id)).not.toContain(b1.id);

    // Contrat MACHINE explicitement préservé : le scanner d'inactivité doit continuer à balayer le
    // parc entier. Réduire cette fonction au workspace de session casserait son contrat (ADR-062).
    const vueMachine = await listerProspectsVendeursPourMachine();
    const idsMachine = vueMachine.map((p) => p.id);
    expect(idsMachine).toContain(a1.id);
    expect(idsMachine).toContain(b1.id);
  });
});

// NO_GLOBAL_DEMO_FALLBACK_IN_WORKSPACE_CONTEXT — avant ce lot, les lecteurs globaux basculaient sur
// les fixtures de `@/data` dès que leur table était vide. Sur un chemin scopé, ce repli est pire
// qu'inutile : il fait apparaître, dans un workspace neuf, des données qui n'appartiennent à aucun
// périmètre et que tout le monde verrait à l'identique. « Vide veut dire vide ».
describe("NO_GLOBAL_DEMO_FALLBACK_IN_WORKSPACE_CONTEXT", () => {
  it("un workspace sans aucune donnée rend des listes vides et des totaux à zéro", async () => {
    // Des fixtures existent bel et bien côté @/data, et d'autres workspaces ont des lignes réelles :
    // ce test échouerait si l'un ou l'autre repli se réactivait.
    const { biens: biensDemo } = await import("@/data/biens");
    const { clients: clientsDemo } = await import("@/data/clients");
    expect(biensDemo.length).toBeGreaterThan(0);
    expect(clientsDemo.length).toBeGreaterThan(0);

    const biens = await rechercherBiensPage({ workspaceId: WORKSPACE_VIDE, archives: false, page: 1, parPage: 50 });
    expect(biens.lignes).toEqual([]);
    expect(biens.total).toBe(0);

    const acquereurs = await rechercherAcquereursPage({ workspaceId: WORKSPACE_VIDE, archives: false, page: 1, parPage: 50 });
    expect(acquereurs.lignes).toEqual([]);
    expect(acquereurs.total).toBe(0);

    expect(await rechercherProspectsVendeurs({ workspaceId: WORKSPACE_VIDE, vue: "en_cours" })).toEqual([]);
    expect(await listerProspectsVendeursDuWorkspace(WORKSPACE_VIDE)).toEqual([]);
  });
});
