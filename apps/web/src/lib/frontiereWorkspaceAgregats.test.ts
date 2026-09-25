import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2B2 (ADR-054) — les AGRÉGATS et CONTEXTES de l'écran Aujourd'hui. Un agrégat
// mélangé ne se voit pas : il ne montre pas une ligne étrangère, il affiche un NOMBRE faux. D'où
// des volumétries volontairement différentes de part et d'autre de la frontière — si A et B
// avaient le même nombre d'éléments, un total mélangé passerait inaperçu.
//
// Le cas le plus grave est celui des opportunités : le moteur croise biens × acquéreurs. Si l'une
// des collections franchit la frontière, il ne se contente pas de laisser fuiter une donnée — il
// FABRIQUE une recommandation nominative reliant deux workspaces. Les jeux ci-dessous sont donc
// construits pour être hautement compatibles EN CROISÉ : sans filtre, les paires apparaîtraient.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  biens: biensTable,
  prospectsVendeurs: prospectsTable,
  taches: tachesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien, listerBiensActifsDuWorkspace } = await import("./bienRepository");
const { creerAcquereur, listerAcquereursActifsDuWorkspace } = await import("./clientRepository");
const { creerTache, listerTachesDuWorkspace } = await import("./tacheRepository");
const { creerProspectVendeur } = await import("./prospectVendeurRepository");
const { chargerContexteOpportunites } = await import("./opportunites/contexte");
const { evaluerCompatibiliteBien, evaluerCompatibiliteAcquereur } = await import("./compatibilite/orchestration");

const M = `Zagregats${Date.now()}`;
const WORKSPACE_B = `ws-agregats-${Date.now()}`;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsTaches: string[] = [];

// Volumétries DIFFÉRENTES : 2 côté A, 5 côté B. Un compteur mélangé donnerait 7.
const NB_BIENS_A = 2;
const NB_BIENS_B = 5;
const NB_TACHES_A = 3;
const NB_TACHES_B = 6;

let bienA: { id: string } | undefined;
let bienB: { id: string } | undefined;
let acquereurA: { id: string } | undefined;
let acquereurB: { id: string } | undefined;

let compteur = 0;

// Prix et budgets choisis pour que le croisement A×B soit PARFAITEMENT compatible : le bien de A
// tombe pile dans le budget de l'acquéreur de B, et réciproquement.
async function unBien(workspaceId: string, prix: number) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `${M}-REF-${compteur}`,
      titre: `Bien ${compteur}`,
      type: "appartement" as const,
      adresse: "1 rue des Agrégats",
      ville: "Testville",
      codePostal: "00000",
      surface: 80,
      pieces: 4,
      prix,
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

async function unAcquereur(workspaceId: string, budgetMin: number, budgetMax: number) {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: "Agrégat",
      nom: `${M}-${compteur}`,
      email: `${M}.${compteur}@example.test`,
      telephone: "0600000000",
      budgetMin,
      budgetMax,
      criteres: [],
      stadeProjet: "recherche_active" as const,
      notes: "",
      datePremiereContact: "2026-01-01",
      piecesMin: 2,
      surfaceMin: 40,
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

async function uneTache(workspaceId: string, titre: string) {
  compteur += 1;
  const tache = await creerTache(
    { titre: `${titre}-${compteur}`, type: "autre", priorite: "normale", origine: "manuelle" },
    workspaceId
  );
  idsTaches.push(tache.id);
  return tache;
}

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] agrégats B" });

  // A : biens à 300 000, acquéreurs au budget 500 000-700 000 (donc PAS compatibles entre eux).
  // B : biens à 600 000, acquéreurs au budget 250 000-350 000 (idem).
  // Le croisement, lui, est parfait : bien A (300k) ↔ acquéreur B (250-350k),
  // bien B (600k) ↔ acquéreur A (500-700k). Sans filtre, les opportunités croisées sortiraient.
  for (let i = 0; i < NB_BIENS_A; i += 1) bienA = await unBien(WORKSPACE_TEST, 300000);
  for (let i = 0; i < NB_BIENS_B; i += 1) bienB = await unBien(WORKSPACE_B, 600000);
  acquereurA = await unAcquereur(WORKSPACE_TEST, 500000, 700000);
  acquereurB = await unAcquereur(WORKSPACE_B, 250000, 350000);
  for (let i = 0; i < NB_TACHES_A; i += 1) await uneTache(WORKSPACE_TEST, `${M} tâche A`);
  for (let i = 0; i < NB_TACHES_B; i += 1) await uneTache(WORKSPACE_B, `${M} tâche B`);

  const prospectB = await creerProspectVendeur({ nom: `${M} Prospect B` }, WORKSPACE_B);
  idsProspects.push(prospectB.id);
});

afterAll(async () => {
  if (idsTaches.length > 0) await getDb().delete(tachesTable).where(inArray(tachesTable.id, idsTaches));
  if (idsProspects.length > 0) await getDb().delete(prospectsTable).where(inArray(prospectsTable.id, idsProspects));
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, [WORKSPACE_B]));
});

describe("Frontière workspace — collections de l'écran Aujourd'hui", () => {
  it("les tâches lues sont exactement celles du workspace, jamais la somme des deux", async () => {
    const tachesA = (await listerTachesDuWorkspace(WORKSPACE_TEST)).filter((t) => t.titre.startsWith(`${M} tâche`));
    const tachesB = (await listerTachesDuWorkspace(WORKSPACE_B)).filter((t) => t.titre.startsWith(`${M} tâche`));

    expect(tachesA).toHaveLength(NB_TACHES_A);
    expect(tachesB).toHaveLength(NB_TACHES_B);
    // Le test qui compte vraiment : jamais 3 + 6.
    expect(tachesA.length).not.toBe(NB_TACHES_A + NB_TACHES_B);
    expect(tachesA.every((t) => t.titre.includes("tâche A"))).toBe(true);
  });

  it("les biens et acquéreurs des compteurs sont ceux du workspace", async () => {
    const biens = (await listerBiensActifsDuWorkspace(WORKSPACE_TEST)).filter((b) => b.reference.startsWith(M));
    const acquereurs = (await listerAcquereursActifsDuWorkspace(WORKSPACE_TEST)).filter((a) => a.nom.startsWith(M));

    expect(biens).toHaveLength(NB_BIENS_A);
    expect(biens.length).not.toBe(NB_BIENS_A + NB_BIENS_B);
    expect(acquereurs).toHaveLength(1);
  });
});

describe("Frontière workspace — opportunités", () => {
  it("aucune paire bien A × acquéreur B, alors que le croisement serait parfaitement compatible", async () => {
    const biens = (await listerBiensActifsDuWorkspace(WORKSPACE_TEST)).filter((b) => b.reference.startsWith(M));
    const acquereurs = (await listerAcquereursActifsDuWorkspace(WORKSPACE_TEST)).filter((a) => a.nom.startsWith(M));

    const contexte = await chargerContexteOpportunites(
      { biens, acquereurs, tachesActives: [] },
      WORKSPACE_TEST
    );

    // Aucune compatibilité ne doit désigner une entité de B, dans un sens comme dans l'autre.
    const idsB = new Set([bienB!.id, acquereurB!.id]);
    const fuites = contexte.compatibilites.filter((c) => idsB.has(c.bienId) || idsB.has(c.acquereurId));
    expect(fuites).toEqual([]);

    // Et les entités de B n'entrent pas non plus par les lectures internes du contexte.
    expect(contexte.prospectsVendeurs.some((p) => p.nom.includes("Prospect B"))).toBe(false);

    // Contre-épreuve : le même croisement, vu depuis B, produit bien des paires — donc le moteur
    // fonctionne et c'est le périmètre, et non un jeu de données inerte, qui explique le vide.
    const biensB = (await listerBiensActifsDuWorkspace(WORKSPACE_B)).filter((b) => b.reference.startsWith(M));
    const acquereursB = (await listerAcquereursActifsDuWorkspace(WORKSPACE_B)).filter((a) => a.nom.startsWith(M));
    const contexteB = await chargerContexteOpportunites(
      { biens: biensB, acquereurs: acquereursB, tachesActives: [] },
      WORKSPACE_B
    );
    expect(contexteB.compatibilites.length).toBeGreaterThan(0);
  });
});

describe("Frontière workspace — compatibilité affichée", () => {
  it("le panneau d'un bien de A ne propose que des acquéreurs de A", async () => {
    const resultats = await evaluerCompatibiliteBien(bienA!.id, WORKSPACE_TEST);
    expect(resultats.some((r) => r.acquereurId === acquereurB!.id)).toBe(false);
    expect(resultats.some((r) => r.acquereurId === acquereurA!.id)).toBe(true);
  });

  it("un bien d'un autre workspace n'est pas évaluable du tout", async () => {
    expect(await evaluerCompatibiliteBien(bienB!.id, WORKSPACE_TEST)).toEqual([]);
  });

  it("le panneau d'un acquéreur de A ne propose que des biens de A", async () => {
    const resultats = await evaluerCompatibiliteAcquereur(acquereurA!.id, WORKSPACE_TEST);
    expect(resultats.some((r) => r.bienId === bienB!.id)).toBe(false);
    expect(resultats.some((r) => r.bienId === bienA!.id)).toBe(true);
  });

  it("un acquéreur d'un autre workspace n'est pas évaluable du tout", async () => {
    expect(await evaluerCompatibiliteAcquereur(acquereurB!.id, WORKSPACE_TEST)).toEqual([]);
  });
});
