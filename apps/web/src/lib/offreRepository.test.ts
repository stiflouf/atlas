import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : les FK offres -> biens/acquereurs imposent des ids réels, donc un mock ne
// suffit pas ici. Repli sur le même DATABASE_URL par défaut que drizzle.config.ts (Postgres
// local de dev) si non défini par l'environnement — même principe que
// documentBienRepository.test.ts. Bien/acquéreur créés dédiés à ce fichier (pas une ligne réelle
// arbitraire piochée sans tri) pour éviter toute course avec d'autres suites d'intégration.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, offres: offresTable } = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const {
  listerOffresPourBien,
  listerOffresPourAcquereur,
  listerOffresEnCoursPourPaire,
  getOffreById,
  enregistrerOffre,
  changerStatutOffre,
} = await import("./offreRepository");

const idsOffresCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
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
    reference: `[test réel] OFFRE-${suffixe}`,
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
    nom: `[test réel] Offre ${suffixe}`,
    email: `test-réel-offre-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "offre",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return { bien, acquereur };
}

describe("offreRepository (intégration Postgres)", () => {
  it("retourne [] pour un id non-UUID (bien/acquéreur mocké), sans erreur de cast", async () => {
    await expect(listerOffresPourBien("bien-001")).resolves.toEqual([]);
    await expect(listerOffresPourAcquereur("client-001")).resolves.toEqual([]);
  });

  it("getOffreById() retourne undefined pour un id non-UUID ou inexistant", async () => {
    await expect(getOffreById("offre-mock")).resolves.toBeUndefined();
    await expect(getOffreById("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });

  it("enregistrerOffre() persiste avec statut 'en_cours' par défaut, listerOffresPourBien()/listerOffresPourAcquereur() la retrouvent triée DESC", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("001");

    const ancienne = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 400000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(ancienne.id);
    expect(ancienne.statut).toBe("en_cours");
    expect(ancienne.dateValidite).toBeUndefined();

    const recente = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 420000,
      dateOffre: "2026-08-10",
      dateValidite: "2026-08-20",
    });
    idsOffresCrees.push(recente.id);
    expect(recente.dateValidite).toBe("2026-08-20");

    const pourBien = await listerOffresPourBien(bien.id);
    expect(pourBien.map((o) => o.id)).toEqual([recente.id, ancienne.id]);

    const pourAcquereur = await listerOffresPourAcquereur(acquereur.id);
    expect(pourAcquereur.map((o) => o.id)).toEqual([recente.id, ancienne.id]);
  });

  it("changerStatutOffre() met à jour uniquement le statut, montant/acquéreur/bien/dateOffre restent immuables", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("002");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 350000,
      dateOffre: "2026-08-05",
    });
    idsOffresCrees.push(offre.id);

    const acceptee = await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-06" });

    expect(acceptee?.statut).toBe("acceptee");
    expect(acceptee?.montant).toBe(350000);
    expect(acceptee?.acquereurId).toBe(acquereur.id);
    expect(acceptee?.bienId).toBe(bien.id);
    expect(acceptee?.dateOffre).toBe("2026-08-05");
    expect(acceptee?.dateDecision).toBe("2026-08-06");
    expect(acceptee?.motifPerte).toBeUndefined();
  });

  it("changerStatutOffre() retourne undefined pour un id non-UUID ou inexistant", async () => {
    await expect(
      changerStatutOffre("offre-mock", { statut: "acceptee", dateDecision: "2026-08-01" })
    ).resolves.toBeUndefined();
    await expect(
      changerStatutOffre("00000000-0000-0000-0000-000000000000", { statut: "acceptee", dateDecision: "2026-08-01" })
    ).resolves.toBeUndefined();
  });

  it("changerStatutOffre() pose dateDecision et motifPerte atomiquement pour refusee/retiree (ADR-020)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("003");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 360000,
      dateOffre: "2026-08-05",
    });
    idsOffresCrees.push(offre.id);

    const refusee = await changerStatutOffre(offre.id, {
      statut: "refusee",
      dateDecision: "2026-08-12",
      motifPerte: "desaccord_prix",
    });

    expect(refusee?.statut).toBe("refusee");
    expect(refusee?.dateDecision).toBe("2026-08-12");
    expect(refusee?.motifPerte).toBe("desaccord_prix");
  });

  it("listerOffresEnCoursPourPaire() retourne [] pour un id non-UUID, sans erreur de cast", async () => {
    await expect(listerOffresEnCoursPourPaire("bien-mock", "acquereur-mock")).resolves.toEqual([]);
  });

  it("listerOffresEnCoursPourPaire() ne retourne que les offres 'en_cours' de la paire exacte (ADR-044)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("004");
    const { acquereur: autreAcquereur } = await creerBienEtAcquereurDeTest("005");

    const enCours = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre: "2026-08-01" });
    idsOffresCrees.push(enCours.id);
    const refuseeAvant = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 280000, dateOffre: "2026-07-01" });
    idsOffresCrees.push(refuseeAvant.id);
    await changerStatutOffre(refuseeAvant.id, { statut: "refusee", dateDecision: "2026-07-05", motifPerte: "desaccord_prix" });
    const autrePaire = await enregistrerOffre({ bienId: bien.id, acquereurId: autreAcquereur.id, montant: 310000, dateOffre: "2026-08-02" });
    idsOffresCrees.push(autrePaire.id);

    const resultat = await listerOffresEnCoursPourPaire(bien.id, acquereur.id);
    expect(resultat.map((o) => o.id)).toEqual([enCours.id]);
  });
});
