import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047, passe de fermeture (correction n°1/n°2) : la garde applicative (listerCompromisPourBien
// / getCompromisParOffreId) protège le cas séquentiel normal, mais une écriture concurrente peut
// passer les deux gardes avant que cette transaction ne s'exécute. Ce fichier simule cette course
// en mockant SEULEMENT les fonctions de lecture utilisées par la garde (elles renvoient toujours
// "aucun conflit"), tout en laissant enregistrerCompromis() réel frapper la vraie base — la
// contrainte DB doit alors intercepter, et la Server Action doit traduire cette violation en le
// même message métier que la garde. Fichier séparé de compromis.test.ts (mock de
// compromisRepository différent) pour ne jamais mélanger deux stratégies de mock dans un seul
// fichier (même convention que creerAcquereur.securite.test.ts).
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
vi.mock("@/lib/compromisRepository", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/compromisRepository")>();
  return {
    ...reel,
    listerCompromisPourBien: vi.fn().mockResolvedValue([]),
    getCompromisParOffreId: vi.fn().mockResolvedValue(undefined),
  };
});

import { eq, inArray } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  offres: offresTable,
  compromis: compromisTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerOffre, changerStatutOffre } = await import("@/lib/offreRepository");
const { enregistrerCompromis, marquerCompromisRealise } = await import("@/lib/compromisRepository");
const { ajouterCompromisAction } = await import("./compromis");

const idsCompromisCrees: string[] = [];
const idsOffresCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  if (idsCompromisCrees.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetierTable.id })
      .from(evenementsMetierTable)
      .where(inArray(evenementsMetierTable.compromisId, idsCompromisCrees));
    const idsEvenements = evenements.map((e) => e.id);
    if (idsEvenements.length > 0) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvenements));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvenements));
    }
  }
  for (const id of idsCompromisCrees) {
    await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  }
  for (const id of idsOffresCrees) {
    await getDb().delete(offresTable).where(eq(offresTable.id, id));
  }
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

async function creerBienEtAcquereurDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] COMPROMIS-CONCURRENCE-${suffixe}`,
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Compromis Concurrence ${suffixe}`,
    email: `test-réel-compromis-concurrence-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return { bien, acquereur };
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("ajouterCompromisAction — défense en profondeur DB (ADR-047, garde applicative contournée)", () => {
  it("offre déjà utilisée : la contrainte DB intercepte quand la garde applicative (mockée) ne voit aucun conflit", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("OFFRE-RACE");
    const offre = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre: "2026-08-01" });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-02" });

    const premierCompromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      offreId: offre.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-05",
    });
    idsCompromisCrees.push(premierCompromis.id);
    // Isole précisément la contrainte offre_id de la contrainte "en_cours par bien" (les deux
    // seraient sinon violées simultanément par le second INSERT) — même isolation que le test
    // équivalent des gardes applicatives dans compromis.test.ts.
    await marquerCompromisRealise(premierCompromis.id, "2026-09-01");

    // getCompromisParOffreId (mockée) renvoie undefined — simule une lecture qui aurait raté ce
    // premier compromis à cause d'une course. compromis_offre_id_unique doit malgré tout empêcher
    // le second INSERT, et la Server Action doit traduire la violation en le même message métier
    // que la garde applicative normale.
    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          offreId: offre.id,
          prixConvenu: "300000",
          dateSignature: "2026-08-06",
        })
      )
    ).rejects.toThrow(/déjà associée à un compromis/);

    const restants = await getDb().select().from(compromisTable).where(eq(compromisTable.offreId, offre.id));
    expect(restants).toHaveLength(1);
  });

  it("compromis déjà en cours : la contrainte DB intercepte quand la garde applicative (mockée) ne voit aucun conflit", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("EN-COURS-RACE");

    const premierCompromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(premierCompromis.id);

    // listerCompromisPourBien (mockée) renvoie [] — simule une lecture qui aurait raté ce premier
    // compromis en_cours à cause d'une course. compromis_bien_id_en_cours_unique doit malgré tout
    // empêcher le second INSERT.
    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          prixConvenu: "310000",
          dateSignature: "2026-08-02",
        })
      )
    ).rejects.toThrow(/déjà en cours/);

    const restants = await getDb().select().from(compromisTable).where(eq(compromisTable.bienId, bien.id));
    expect(restants).toHaveLength(1);
  });
});
