import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : les FK comptes_rendus_visite -> biens/acquereurs imposent des ids réels,
// donc un mock ne suffit pas ici. Repli sur le même DATABASE_URL par défaut que
// drizzle.config.ts (Postgres local de dev) si non défini par l'environnement — même principe
// que actionRepository.test.ts / noteBienRepository.test.ts.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, comptesRendusVisite: comptesRendusVisiteTable } =
  await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { listerComptesRendusPourBien, enregistrerCompteRenduVisite } = await import(
  "./compteRenduVisiteRepository"
);

const idsCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.id, id));
  }
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

describe("compteRenduVisiteRepository (intégration Postgres)", () => {
  it("retourne [] pour un id non-UUID (bien mocké), sans erreur de cast", async () => {
    await expect(listerComptesRendusPourBien("bien-001")).resolves.toEqual([]);
  });

  it("enregistrerCompteRenduVisite() persiste, listerComptesRendusPourBien() les retrouve triés DESC", async () => {
    // Bien/acquéreur créés dédiés à ce test (plutôt qu'une ligne réelle arbitraire piochée sans
    // tri) : évite une course avec d'autres suites d'intégration qui créent/suppriment leurs
    // propres biens/acquéreurs réels en parallèle.
    const bien = await creerBien({
      reference: "[test réel] CR-VISITE-001",
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
      nom: "[test réel] CR Visite",
      email: "test-réel-cr@example.com",
      telephone: "0600000000",
      budgetMin: 200000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "decouverte",
      notes: "",
      datePremiereContact: "2026-01-01",
    });
    idsAcquereursCrees.push(acquereur.id);

    const ancien = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "Ancien compte rendu.",
      interet: "a_reflechir",
    });
    idsCrees.push(ancien.id);
    const recent = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-10",
      retour: "Compte rendu plus récent.",
      interet: "interesse",
      prochaineEtape: "Envoyer une contre-proposition.",
    });
    idsCrees.push(recent.id);

    const comptesRendus = await listerComptesRendusPourBien(bien.id);
    const pertinents = comptesRendus.filter((cr) => cr.id === ancien.id || cr.id === recent.id);

    expect(pertinents.map((cr) => cr.id)).toEqual([recent.id, ancien.id]);
    expect(pertinents[0].prochaineEtape).toBe("Envoyer une contre-proposition.");
    expect(pertinents[1].prochaineEtape).toBeUndefined();
  });
});
