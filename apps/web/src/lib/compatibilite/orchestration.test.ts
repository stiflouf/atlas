import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : exerce la vraie base Postgres locale — vérifie que les deux sens de
// l'orchestration (bien -> acquéreurs, acquéreur -> biens) appellent bien la même
// evaluerCompatibilite() (ADR-034, section 13) et respectent les conventions d'archivage
// existantes (ADR-012), sans réintroduire silencieusement une entité archivée comme candidate.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable } = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { evaluerCompatibiliteBien, evaluerCompatibiliteAcquereur } = await import("./orchestration");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string, surcharge: Partial<Parameters<typeof creerBien>[0]> = {}) {
  const bien = await creerBien({
    reference: `[test réel] COMPAT-${suffixe}`,
    titre: "Bien de test compatibilité",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 3,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...surcharge,
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerAcquereurDeTest(suffixe: string, surcharge: Partial<Parameters<typeof creerAcquereur>[0]> = {}) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Compat ${suffixe}`,
    email: `test-réel-compat-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
    ...surcharge,
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

describe("orchestration compatibilite (intégration Postgres)", () => {
  it("évaluerCompatibiliteBien() et évaluerCompatibiliteAcquereur() produisent le même résultat pour le même couple", async () => {
    const bien = await creerBienDeTest("001", { prix: 350000, pieces: 3, surface: 50 });
    const acquereur = await creerAcquereurDeTest("001", { budgetMax: 400000, piecesMin: 2 });

    const depuisBien = await evaluerCompatibiliteBien(bien.id);
    const depuisAcquereur = await evaluerCompatibiliteAcquereur(acquereur.id);

    const resultatDepuisBien = depuisBien.find((r) => r.acquereurId === acquereur.id);
    const resultatDepuisAcquereur = depuisAcquereur.find((r) => r.bienId === bien.id);

    expect(resultatDepuisBien).toBeDefined();
    expect(resultatDepuisAcquereur).toBeDefined();
    expect(resultatDepuisBien).toEqual(resultatDepuisAcquereur);
  });

  it("évaluerCompatibiliteBien() retourne un tableau vide pour un id inconnu", async () => {
    await expect(evaluerCompatibiliteBien("00000000-0000-0000-0000-000000000000")).resolves.toEqual([]);
  });

  it("évaluerCompatibiliteAcquereur() retourne un tableau vide pour un id inconnu", async () => {
    await expect(evaluerCompatibiliteAcquereur("00000000-0000-0000-0000-000000000000")).resolves.toEqual([]);
  });

  it("un acquéreur archivé n'apparaît jamais comme candidat dans évaluerCompatibiliteBien()", async () => {
    const bien = await creerBienDeTest("002");
    const acquereur = await creerAcquereurDeTest("002");
    await archiverAcquereur(acquereur.id);

    const resultats = await evaluerCompatibiliteBien(bien.id);
    expect(resultats.some((r) => r.acquereurId === acquereur.id)).toBe(false);
  });

  it("un bien archivé n'apparaît jamais comme candidat dans évaluerCompatibiliteAcquereur()", async () => {
    const bien = await creerBienDeTest("003");
    const acquereur = await creerAcquereurDeTest("003");
    await archiverBien(bien.id);

    const resultats = await evaluerCompatibiliteAcquereur(acquereur.id);
    expect(resultats.some((r) => r.bienId === bien.id)).toBe(false);
  });

  it("un bien archivé reste consultable comme source (fiche déjà archivée) — évalue quand même ses candidats actifs", async () => {
    const bien = await creerBienDeTest("004");
    const acquereur = await creerAcquereurDeTest("004");
    await archiverBien(bien.id);

    const resultats = await evaluerCompatibiliteBien(bien.id);
    expect(resultats.some((r) => r.acquereurId === acquereur.id)).toBe(true);
  });
});
