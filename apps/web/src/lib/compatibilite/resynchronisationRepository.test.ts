import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Test d'intégration réel (ADR-036) : vraie base Postgres. Couvre le handoff durable lui-même —
// coalescing, complétion par identité (jamais par source), et le scénario de concurrence explicité
// dans l'addendum de l'audit (§11) : une demande créée pendant qu'un traitement est en cours ne
// doit jamais être perdue par le coalescing.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, compatibilitesARessynchroniser } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const {
  enqueuerResynchronisationBien,
  verrouillerDemande,
  marquerDemandeTraitee,
  marquerDemandeEnEchec,
  listerDemandesEnAttente,
} = await import("./resynchronisationRepository");

const idsBiensCrees: string[] = [];

afterAll(async () => {
  if (idsBiensCrees.length > 0) {
    await getDb().delete(compatibilitesARessynchroniser).where(inArray(compatibilitesARessynchroniser.bienId, idsBiensCrees));
  }
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] RESYNC-${suffixe}`,
    titre: "Bien de test resynchronisation",
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
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function lignesPourBien(bienId: string) {
  return getDb().select().from(compatibilitesARessynchroniser).where(eq(compatibilitesARessynchroniser.bienId, bienId));
}

describe("enqueuerResynchronisationBien — coalescing", () => {
  it("deux demandes successives non traitées pour la même source coalescent en une seule ligne", async () => {
    const bien = await creerBienDeTest("COAL1");
    const premier = await getDb().transaction((tx) => enqueuerResynchronisationBien(bien.id, tx));
    const second = await getDb().transaction((tx) => enqueuerResynchronisationBien(bien.id, tx));

    expect(second).toBe(premier); // même ligne, rafraîchie (ON CONFLICT ... DO UPDATE)
    expect(await lignesPourBien(bien.id)).toHaveLength(1);
  });

  it("une nouvelle demande après complétion de la précédente crée une NOUVELLE ligne, jamais une réutilisation", async () => {
    const bien = await creerBienDeTest("COAL2");
    const premier = await getDb().transaction((tx) => enqueuerResynchronisationBien(bien.id, tx));
    await getDb().transaction((tx) => marquerDemandeTraitee(premier, tx));

    const second = await getDb().transaction((tx) => enqueuerResynchronisationBien(bien.id, tx));
    expect(second).not.toBe(premier);

    const lignes = await lignesPourBien(bien.id);
    expect(lignes).toHaveLength(2);
  });
});

describe("verrouillerDemande / marquerDemandeTraitee — complétion par identité", () => {
  it("une ligne déjà traitée n'est plus verrouillable", async () => {
    const bien = await creerBienDeTest("LOCK1");
    const id = await getDb().transaction((tx) => enqueuerResynchronisationBien(bien.id, tx));
    await getDb().transaction((tx) => marquerDemandeTraitee(id, tx));

    const relue = await getDb().transaction((tx) => verrouillerDemande(id, tx));
    expect(relue).toBeUndefined();
  });

  it("un échec n'est jamais terminal : la ligne reste verrouillable pour un nouveau traitement", async () => {
    const bien = await creerBienDeTest("LOCK2");
    const id = await getDb().transaction((tx) => enqueuerResynchronisationBien(bien.id, tx));
    await marquerDemandeEnEchec(id, "erreur simulée pour ce test");

    const relue = await getDb().transaction((tx) => verrouillerDemande(id, tx));
    expect(relue).toBeDefined();
    expect(relue?.id).toBe(id);
  });

  it("listerDemandesEnAttente ne retourne jamais une ligne déjà traitée", async () => {
    const bien = await creerBienDeTest("LOCK3");
    const id = await getDb().transaction((tx) => enqueuerResynchronisationBien(bien.id, tx));
    await getDb().transaction((tx) => marquerDemandeTraitee(id, tx));

    const enAttente = await listerDemandesEnAttente(1000);
    expect(enAttente.some((d) => d.id === id)).toBe(false);
  });
});

describe("concurrence (ADR-036, addendum §11) — une demande créée pendant un traitement en cours n'est jamais perdue", () => {
  it("le coalescing ne peut jamais absorber silencieusement une demande arrivée pendant un traitement verrouillé", async () => {
    const bien = await creerBienDeTest("CONC1");
    const idPremiere = await getDb().transaction((tx) => enqueuerResynchronisationBien(bien.id, tx));

    // "Worker A" : verrouille la ligne et la garde verrouillée un court instant avant de la marquer
    // traitée — simule un traitement en cours.
    const traitementLent = getDb().transaction(async (tx) => {
      const verrouillee = await verrouillerDemande(idPremiere, tx);
      expect(verrouillee).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await marquerDemandeTraitee(idPremiere, tx);
    });

    // Laisse le traitement lent prendre le verrou en premier, puis déclenche une "nouvelle
    // mutation" concurrente sur la MÊME source pendant que la ligne est encore verrouillée.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const mutationConcurrente = getDb().transaction((tx) => enqueuerResynchronisationBien(bien.id, tx));

    const [, idSeconde] = await Promise.all([traitementLent, mutationConcurrente]);

    // La nouvelle demande n'a JAMAIS pu être absorbée par la ligne en cours de traitement (le
    // prédicat de l'index partiel — traitee_le IS NULL — ne matchait plus une fois celle-ci
    // marquée traitée) : elle crée une ligne distincte, jamais perdue.
    expect(idSeconde).not.toBe(idPremiere);
    const lignes = await lignesPourBien(bien.id);
    expect(lignes.length).toBeGreaterThanOrEqual(2);
    const ligneSeconde = lignes.find((l) => l.id === idSeconde);
    expect(ligneSeconde?.traiteeLe).toBeNull(); // reste bien à traiter, pas perdue
    const lignePremiere = lignes.find((l) => l.id === idPremiere);
    expect(lignePremiere?.traiteeLe).not.toBeNull();
  });
});
