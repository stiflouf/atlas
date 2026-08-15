import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration réel (ADR-041), même patron que catalogueRegles.nouveauMatch.test.ts.
// Couvre la règle unique `suivi_apres_visite` : politique par `interet` (une seule règle,
// contextuelle), cible acquéreur (jamais visite/compte rendu), garde archivage, robustesse à un
// compte rendu introuvable.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable } = await import("@/db/schema");
const { creerBien, archiverBien, desarchiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { trouverRegle } = await import("./catalogueRegles");

const REGLE = "suivi_apres_visite" as const;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  // comptes_rendus_visite référencés CASCADE depuis biens/acquereurs — nettoyés automatiquement.
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] SUIVI-${suffixe}`,
    titre: "Bien de test suivi post-visite",
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

async function creerAcquereurDeTest(suffixe: string) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Suivi ${suffixe}`,
    email: `test-réel-suivi-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

function evenementDeTest(compteRenduVisiteId: string) {
  return {
    id: "n/a",
    typeEvenement: "visite_realisee" as const,
    compteRenduVisiteId,
    survenuLe: new Date().toISOString(),
  };
}

describe("règle suivi_apres_visite — politique par intérêt (ADR-041)", () => {
  it("interesse : tâche acquéreur orientée vers une éventuelle offre", async () => {
    const bien = await creerBienDeTest("INT1");
    const acquereur = await creerAcquereurDeTest("INT1");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "Très intéressé, a posé beaucoup de questions",
      interet: "interesse",
    });

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeDefined();
    expect(champs?.cible).toEqual({ type: "acquereur", id: acquereur.id });
    expect(champs?.titre).toBe(
      `Faire le point avec ${acquereur.prenom} ${acquereur.nom} sur une éventuelle offre pour ${bien.reference}`
    );
    expect(champs?.type).toBe("relance");
  });

  it("a_reflechir : tâche acquéreur de relance", async () => {
    const bien = await creerBienDeTest("REFL1");
    const acquereur = await creerAcquereurDeTest("REFL1");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "Hésite encore",
      interet: "a_reflechir",
    });

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeDefined();
    expect(champs?.cible).toEqual({ type: "acquereur", id: acquereur.id });
    expect(champs?.titre).toBe(`Relancer ${acquereur.prenom} ${acquereur.nom} après la visite de ${bien.reference}`);
  });

  it("inconnu : tâche acquéreur pour recueillir le retour", async () => {
    const bien = await creerBienDeTest("INCONNU1");
    const acquereur = await creerAcquereurDeTest("INCONNU1");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "Pas encore de retour clair",
      interet: "inconnu",
    });

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeDefined();
    expect(champs?.cible).toEqual({ type: "acquereur", id: acquereur.id });
    expect(champs?.titre).toBe(
      `Recueillir le retour de ${acquereur.prenom} ${acquereur.nom} après la visite de ${bien.reference}`
    );
  });

  it("pas_interesse : aucune tâche (undefined, succès honnête ADR-032)", async () => {
    const bien = await creerBienDeTest("PASINT1");
    const acquereur = await creerAcquereurDeTest("PASINT1");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "Ne correspond pas à ses attentes",
      interet: "pas_interesse",
    });

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeUndefined();
  });

  it("bien archivé au moment du traitement : aucune tâche", async () => {
    const bien = await creerBienDeTest("ARCH1");
    const acquereur = await creerAcquereurDeTest("ARCH1");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "Intéressé",
      interet: "interesse",
    });
    await archiverBien(bien.id);

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeUndefined();
    await desarchiverBien(bien.id);
  });

  it("acquéreur archivé au moment du traitement : aucune tâche", async () => {
    const bien = await creerBienDeTest("ARCH2");
    const acquereur = await creerAcquereurDeTest("ARCH2");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "À réfléchir",
      interet: "a_reflechir",
    });
    await archiverAcquereur(acquereur.id);

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeUndefined();
  });

  it("compte rendu introuvable (identifiant valide mais inexistant) : aucune tâche, jamais d'exception", async () => {
    await expect(
      trouverRegle(REGLE)!.construireTache(evenementDeTest("00000000-0000-0000-0000-000000000000"))
    ).resolves.toBeUndefined();
  });
});
