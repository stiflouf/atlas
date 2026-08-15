import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";

// Test d'intégration réel (ADR-036) — symétrique de archivageBien.test.ts.
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
const { synchroniserCompatibilitesPourAcquereur } = await import("@/lib/compatibilite/synchronisation");
const { archiverAcquereurAction, desarchiverAcquereurAction } = await import("./archivageAcquereur");

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
    reference: `[test réel] ARCHIVAGE-ACQ-${suffixe}`,
    titre: "Bien de test archivage acquéreur",
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
    nom: `[test réel] ArchivageAcq ${suffixe}`,
    email: `test-réel-archivage-acq-${suffixe}@example.com`,
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

describe("archiverAcquereurAction — hors périmètre, sans détourner le statut ADR-034", () => {
  it("bascule dans_perimetre_actif=false, conserve dernier_statut, aucun nouvel événement", async () => {
    const acquereur = await creerAcquereurDeTest("B1", 400000);
    const bien = await creerBienDeTest("B1", 300000);
    await synchroniserCompatibilitesPourAcquereur(acquereur.id);
    expect((await lireEtat(bien.id, acquereur.id))?.dernierStatut).toBe("compatible");
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);

    await archiverAcquereurAction(formData({ id: acquereur.id })).catch(() => {});

    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.dansPerimetreActif).toBe(false);
    expect(etat?.dernierStatut).toBe("compatible");
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);
  });
});

describe("desarchiverAcquereurAction — retour dans le périmètre, nouveau cycle si toujours compatible", () => {
  it("un acquéreur désarchivé toujours compatible produit un nouveau cycle et un nouvel événement", async () => {
    const acquereur = await creerAcquereurDeTest("B2", 400000);
    const bien = await creerBienDeTest("B2", 300000);
    await synchroniserCompatibilitesPourAcquereur(acquereur.id);
    expect((await lireEtat(bien.id, acquereur.id))?.cycleCompatibilite).toBe(1);

    await archiverAcquereurAction(formData({ id: acquereur.id })).catch(() => {});
    expect((await lireEtat(bien.id, acquereur.id))?.dansPerimetreActif).toBe(false);

    await desarchiverAcquereurAction(formData({ id: acquereur.id })).catch(() => {});

    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.dansPerimetreActif).toBe(true);
    expect(etat?.cycleCompatibilite).toBe(2);
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(2);
  });
});
