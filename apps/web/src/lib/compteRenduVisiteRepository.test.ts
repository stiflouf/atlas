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
const { listerComptesRendusPourBien, enregistrerCompteRenduVisite } = await import(
  "./compteRenduVisiteRepository"
);

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.id, id));
  }
});

describe("compteRenduVisiteRepository (intégration Postgres)", () => {
  it("retourne [] pour un id non-UUID (bien mocké), sans erreur de cast", async () => {
    await expect(listerComptesRendusPourBien("bien-001")).resolves.toEqual([]);
  });

  it("enregistrerCompteRenduVisite() persiste, listerComptesRendusPourBien() les retrouve triés DESC", async () => {
    const [bien] = await getDb().select({ id: biensTable.id }).from(biensTable).limit(1);
    const [acquereur] = await getDb().select({ id: acquereursTable.id }).from(acquereursTable).limit(1);
    if (!bien || !acquereur) throw new Error("Aucun bien/acquéreur réel en base pour ce test d'intégration.");

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
