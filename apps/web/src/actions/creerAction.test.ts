import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration + garde-fou : creerActionAction doit refuser explicitement (throw) toute
// association à un bien ou un acquéreur archivé, contrairement aux refus silencieux de
// ajouterNoteBienAction/enregistrerCompteRenduVisiteAction (voir commentaire de creerAction.ts).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, actions: actionsTable } = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { creerActionAction } = await import("./creerAction");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  await getDb().delete(actionsTable).where(eq(actionsTable.titre, "[test réel] Action sur entité archivée"));
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("creerActionAction — garde-fou entité archivée", () => {
  it("refuse explicitement (throw) une action associée à un bien archivé", async () => {
    const bien = await creerBien({
      reference: "[test réel] ACTION-BIEN-ARCHIVE",
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
    await archiverBien(bien.id);

    await expect(
      creerActionAction(
        formData({
          titre: "[test réel] Action sur entité archivée",
          type: "autre",
          priorite: "normale",
          bienId: bien.id,
        })
      )
    ).rejects.toThrow(/bien archivé/);
  });

  it("refuse explicitement (throw) une action associée à un acquéreur archivé", async () => {
    const acquereur = await creerAcquereur({
      prenom: "Test",
      nom: "[test réel] Action Archive",
      email: "test-réel@example.com",
      telephone: "0600000000",
      budgetMin: 200000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "decouverte",
      notes: "",
      datePremiereContact: "2026-01-01",
    });
    idsAcquereursCrees.push(acquereur.id);
    await archiverAcquereur(acquereur.id);

    await expect(
      creerActionAction(
        formData({
          titre: "[test réel] Action sur entité archivée",
          type: "autre",
          priorite: "normale",
          acquereurId: acquereur.id,
        })
      )
    ).rejects.toThrow(/acquéreur archivé/);
  });
});
