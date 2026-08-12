import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration + garde-fou : vérifie qu'un appel direct à enregistrerCompteRenduVisiteAction
// (contournant le formulaire, remplacé par un message sur une fiche archivée — voir
// visites/[id]/preparer/page.tsx) n'insère jamais de compte rendu si le bien OU l'acquéreur est
// archivé. Même principe que ajouterNoteBien.test.ts pour redirect().
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable } = await import("@/db/schema");
const { creerBien, archiverBien, desarchiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { listerComptesRendusPourBien } = await import("@/lib/compteRenduVisiteRepository");
const { enregistrerCompteRenduVisiteAction } = await import("./enregistrerCompteRenduVisite");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
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

async function creerBienTest(reference: string) {
  const bien = await creerBien({
    reference,
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
  return bien;
}

async function creerAcquereurTest(nom: string) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom,
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
  return acquereur;
}

describe("enregistrerCompteRenduVisiteAction — garde-fou entité archivée", () => {
  it("n'insère aucun compte rendu si le bien est archivé, même en appelant l'action directement", async () => {
    const bien = await creerBienTest("[test réel] CR-BIEN-ARCHIVE");
    const acquereur = await creerAcquereurTest("[test réel] CR-ACQ-1");
    await archiverBien(bien.id);

    await enregistrerCompteRenduVisiteAction(
      formData({
        bienId: bien.id,
        acquereurId: acquereur.id,
        dateVisite: "2026-08-01",
        retour: "Tentative sur bien archivé",
        interet: "interesse",
      })
    ).catch(() => {});

    expect(await listerComptesRendusPourBien(bien.id)).toEqual([]);
  });

  it("n'insère aucun compte rendu si l'acquéreur est archivé, même en appelant l'action directement", async () => {
    const bien = await creerBienTest("[test réel] CR-BIEN-2");
    const acquereur = await creerAcquereurTest("[test réel] CR-ACQ-ARCHIVE");
    await archiverAcquereur(acquereur.id);
    // S'assurer que seul l'acquéreur est archivé pour ce cas (le bien précédent avait été
    // archivé dans le test ci-dessus, celui-ci est un nouveau bien actif).
    await desarchiverBien(bien.id);

    await enregistrerCompteRenduVisiteAction(
      formData({
        bienId: bien.id,
        acquereurId: acquereur.id,
        dateVisite: "2026-08-01",
        retour: "Tentative sur acquéreur archivé",
        interet: "interesse",
      })
    ).catch(() => {});

    expect(await listerComptesRendusPourBien(bien.id)).toEqual([]);
  });
});
