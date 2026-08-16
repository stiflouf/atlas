import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
import { and, eq, inArray, or } from "drizzle-orm";

// Test d'intégration réel (ADR-036) : vraie base Postgres. Couvre le comportement archivage/
// désarchivage exact retenu dans l'addendum de l'audit (§8) : dans_perimetre_actif comme axe
// technique distinct de dernier_statut, jamais un détournement du vocabulaire ADR-034.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compatibilitesBienAcquereurEtat,
  compatibilitesARessynchroniser,
  evenementsMetier,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { synchroniserCompatibilitesPourBien } = await import("@/lib/compatibilite/synchronisation");
const { archiverBienAction, desarchiverBienAction } = await import("./archivageBien");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  if (idsBiensCrees.length > 0 || idsAcquereursCrees.length > 0) {
    await getDb()
      .delete(evenementsMetier)
      .where(or(inArray(evenementsMetier.bienId, idsBiensCrees), inArray(evenementsMetier.acquereurId, idsAcquereursCrees)));
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(
        or(
          inArray(compatibilitesBienAcquereurEtat.bienId, idsBiensCrees),
          inArray(compatibilitesBienAcquereurEtat.acquereurId, idsAcquereursCrees)
        )
      );
    await getDb()
      .delete(compatibilitesARessynchroniser)
      .where(
        or(
          inArray(compatibilitesARessynchroniser.bienId, idsBiensCrees),
          inArray(compatibilitesARessynchroniser.acquereurId, idsAcquereursCrees)
        )
      );
  }
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string, prix = 300000) {
  const bien = await creerBien({
    reference: `[test réel] ARCHIVAGE-BIEN-${suffixe}`,
    titre: "Bien de test archivage",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 3,
    prix,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerAcquereurDeTest(suffixe: string, budgetMax = 400000) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] ArchivageBien ${suffixe}`,
    email: `test-réel-archivage-bien-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

async function lireEtat(bienId: string, acquereurId: string) {
  const [ligne] = await getDb()
    .select()
    .from(compatibilitesBienAcquereurEtat)
    .where(and(eq(compatibilitesBienAcquereurEtat.bienId, bienId), eq(compatibilitesBienAcquereurEtat.acquereurId, acquereurId)));
  return ligne;
}

async function lireEvenements(bienId: string, acquereurId: string) {
  return getDb()
    .select()
    .from(evenementsMetier)
    .where(
      and(
        eq(evenementsMetier.typeEvenement, "compatibilite_bien_acquereur_devenue_compatible"),
        eq(evenementsMetier.bienId, bienId),
        eq(evenementsMetier.acquereurId, acquereurId)
      )
    );
}

describe("archiverBienAction — hors périmètre, sans détourner le statut ADR-034", () => {
  it("bascule dans_perimetre_actif=false, conserve dernier_statut, aucun nouvel événement", async () => {
    const acquereur = await creerAcquereurDeTest("A1", 400000);
    const bien = await creerBienDeTest("A1", 300000); // compatible
    await synchroniserCompatibilitesPourBien(bien.id);
    expect((await lireEtat(bien.id, acquereur.id))?.dernierStatut).toBe("compatible");
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);

    await archiverBienAction(formData({ id: bien.id })).catch(() => {}); // redirect() avalé

    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.dansPerimetreActif).toBe(false);
    expect(etat?.dernierStatut).toBe("compatible"); // jamais détourné, l'historique reste honnête
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1); // aucun nouveau match à l'archivage
  });
});

describe("desarchiverBienAction — retour dans le périmètre, nouveau cycle si toujours compatible", () => {
  it("un bien désarchivé toujours compatible produit un nouveau cycle et un nouvel événement", async () => {
    const acquereur = await creerAcquereurDeTest("A2", 400000);
    const bien = await creerBienDeTest("A2", 300000); // compatible
    await synchroniserCompatibilitesPourBien(bien.id);
    expect((await lireEtat(bien.id, acquereur.id))?.cycleCompatibilite).toBe(1);

    await archiverBienAction(formData({ id: bien.id })).catch(() => {});
    expect((await lireEtat(bien.id, acquereur.id))?.dansPerimetreActif).toBe(false);

    await desarchiverBienAction(formData({ id: bien.id })).catch(() => {});

    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.dansPerimetreActif).toBe(true);
    expect(etat?.cycleCompatibilite).toBe(2); // nouvelle opportunité après une interruption
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(2);
  });
});
