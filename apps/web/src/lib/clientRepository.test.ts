import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : exerce la vraie base Postgres locale (pas de mock), même principe que
// actionRepository.test.ts. Repli sur le même DATABASE_URL par défaut que drizzle.config.ts si
// non défini par l'environnement.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable } = await import("@/db/schema");
const {
  creerAcquereur,
  modifierAcquereur,
  listerClients,
  listerClientsArchives,
  getClientById,
  archiverAcquereur,
  desarchiverAcquereur,
} = await import("./clientRepository");

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

function acquereurTest(surcharge: Partial<Parameters<typeof creerAcquereur>[0]> = {}) {
  return {
    prenom: "Test",
    nom: "[test réel] Acquéreur",
    email: "test-réel@example.com",
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte" as const,
    notes: "",
    datePremiereContact: "2026-01-01",
    ...surcharge,
  };
}

describe("clientRepository (intégration Postgres)", () => {
  it("modifierAcquereur() retourne undefined pour un id non-UUID (acquéreur mocké)", async () => {
    await expect(modifierAcquereur("client-001", acquereurTest())).resolves.toBeUndefined();
  });

  it("modifierAcquereur() retourne undefined pour un UUID inexistant", async () => {
    await expect(
      modifierAcquereur("00000000-0000-0000-0000-000000000000", acquereurTest())
    ).resolves.toBeUndefined();
  });

  it("modifierAcquereur() met à jour les champs et rafraîchit modifieLe", async () => {
    const cree = await creerAcquereur(acquereurTest());
    idsCrees.push(cree.id);

    const [ligneAvant] = await getDb()
      .select()
      .from(acquereursTable)
      .where(eq(acquereursTable.id, cree.id));
    const modifieLeAvant = ligneAvant.modifieLe.getTime();

    // Horloge contrôlée plutôt qu'une attente réelle arbitraire (fragile sous charge, audit V1
    // Candidate) : seul `Date` est simulé (toFake: ["Date"]) — les timers réels du client Postgres
    // (setTimeout/setImmediate internes au pool de connexions) continuent de fonctionner normalement.
    // `modifieLe` de la ligne créée provient de l'horloge Postgres (defaultNow()), pas de Node — on
    // pousse donc l'horloge Node explicitement au-delà de cette valeur avant l'UPDATE JS.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(modifieLeAvant + 1000));

    const modifie = await modifierAcquereur(
      cree.id,
      acquereurTest({ prenom: "Prénom modifié", necessiteParking: true })
    );

    vi.useRealTimers();

    expect(modifie).toBeDefined();
    expect(modifie?.prenom).toBe("Prénom modifié");
    expect(modifie?.necessiteParking).toBe(true);

    const [ligneApres] = await getDb()
      .select()
      .from(acquereursTable)
      .where(eq(acquereursTable.id, cree.id));
    expect(ligneApres.modifieLe.getTime()).toBeGreaterThan(modifieLeAvant);
  });

  it("modifierAcquereur() préserve NULL (jamais false) pour un champ tri-état laissé inconnu", async () => {
    const cree = await creerAcquereur(acquereurTest());
    idsCrees.push(cree.id);

    const modifie = await modifierAcquereur(cree.id, acquereurTest());

    expect(modifie?.accessibiliteRequise).toBeUndefined();
    expect(modifie?.necessiteParking).toBeUndefined();
    expect(modifie?.necessiteExterieur).toBeUndefined();
  });

  it("archiverAcquereur()/desarchiverAcquereur() retournent undefined pour un id non-UUID ou inexistant", async () => {
    await expect(archiverAcquereur("client-001")).resolves.toBeUndefined();
    await expect(archiverAcquereur("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
    await expect(desarchiverAcquereur("client-001")).resolves.toBeUndefined();
  });

  it("archiver un acquéreur : posé archiveLe, exclu de listerClients(), présent dans listerClientsArchives(), toujours résolu par getClientById()", async () => {
    const cree = await creerAcquereur(acquereurTest({ nom: "[test réel] Archive1" }));
    idsCrees.push(cree.id);
    expect(cree.archiveLe).toBeUndefined();

    const archive = await archiverAcquereur(cree.id);
    expect(archive?.archiveLe).toBeDefined();

    const actifs = await listerClients();
    expect(actifs.some((c) => c.id === cree.id)).toBe(false);

    const archives = await listerClientsArchives();
    expect(archives.some((c) => c.id === cree.id)).toBe(true);

    const parId = await getClientById(cree.id);
    expect(parId).toBeDefined();
    expect(parId?.archiveLe).toBeDefined();
  });

  it("désarchiver un acquéreur : archiveLe redevient undefined, réapparaît dans listerClients()", async () => {
    const cree = await creerAcquereur(acquereurTest({ nom: "[test réel] Archive2" }));
    idsCrees.push(cree.id);
    await archiverAcquereur(cree.id);

    const desarchive = await desarchiverAcquereur(cree.id);
    expect(desarchive?.archiveLe).toBeUndefined();

    const actifs = await listerClients();
    expect(actifs.some((c) => c.id === cree.id)).toBe(true);
  });

  it("le comptage de bascule démo->réel inclut les acquéreurs archivés (pas de repli mock)", async () => {
    const cree = await creerAcquereur(acquereurTest({ nom: "[test réel] Archive3" }));
    idsCrees.push(cree.id);
    await archiverAcquereur(cree.id);

    const actifs = await listerClients();
    expect(actifs.some((c) => c.id === "client-001")).toBe(false);
  });
});
