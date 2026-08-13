import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration — chargerProjectionAnnuelle() (dashboardRepository) est un agrégat global
// ancré sur CURRENT_DATE, non filtré par dossier fiscal : mêmes contraintes que
// dashboardRepository.test.ts (delta avant/après, jamais une valeur absolue). encaisseReel, lui, est
// scopé par dossier fiscal — un dossier de test dédié avec amorçage confirmé isole ce bloc.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  dossierFiscal: dossierFiscalTable,
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
} = await import("@/db/schema");
const { enregistrerProfilFiscal } = await import("@/lib/profilFiscalRepository");
const { enregistrerHistoriqueAmorcage } = await import("@/lib/historiqueAmorcageRepository");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis, marquerCompromisRealise } = await import("@/lib/compromisRepository");
const { enregistrerRemuneration, marquerRemunerationEncaissee } = await import("@/lib/remunerationRepository");
const { chargerProjectionAnnuelle } = await import("@/lib/dashboardRepository");
const { calculerProjectionFinAnnee } = await import("./projectionFinAnnee");

const DOSSIER_TEST_ID = "test-dossier-projection-fin-annee";
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

const annee = new Date().getFullYear();

afterAll(async () => {
  await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, DOSSIER_TEST_ID));
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienEtAcquereurDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] PROJFIN-${suffixe}`,
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
    nom: `[test réel] ProjFin ${suffixe}`,
    email: `test-réel-projfin-${suffixe}@example.com`,
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

describe("calculerProjectionFinAnnee — trois blocs jamais fusionnés silencieusement (ADR-024)", () => {
  it("prépare un dossier fiscal de test avec amorçage confirmé", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_TEST_ID }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_TEST_ID,
      dateDebutValidite: "2026-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    await enregistrerHistoriqueAmorcage(DOSSIER_TEST_ID, annee, 0, `${annee}-01-01`);
  });

  it("le bloc encaissé réel reflète calculerAssietteAnnuelle, indépendamment des deux autres blocs", async () => {
    const avant = await calculerProjectionFinAnnee(DOSSIER_TEST_ID, annee);
    expect(avant.encaisseReel.couverture).toBe("complete");

    const { bien, acquereur } = await creerBienEtAcquereurDeTest("001");
    const c = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-01-15" });
    idsCompromisCrees.push(c.id);
    await marquerCompromisRealise(c.id, "2026-01-15");
    await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 100000 });
    await marquerRemunerationEncaissee(c.id, "2026-02-01");

    const apres = await calculerProjectionFinAnnee(DOSSIER_TEST_ID, annee);
    expect(apres.encaisseReel.montantConnuCentimes).toBe(avant.encaisseReel.montantConnuCentimes + 100000);
    // Aucun effet sur les deux autres blocs — un encaissement réel n'est ni un "restant" ni un "en cours".
    expect(apres.finaliseNonEncaisseRestant).toEqual(avant.finaliseNonEncaisseRestant);
    expect(apres.compromisEnCoursRestant).toEqual(avant.compromisEnCoursRestant);
  });

  it("le bloc finalisé non encaissé restant et le bloc compromis en cours restant sont mutuellement exclusifs", async () => {
    const avantDashboard = await chargerProjectionAnnuelle();

    const { bien: bienFinalise, acquereur: acquereurFinalise } = await creerBienEtAcquereurDeTest("002");
    const compromisFinalise = await enregistrerCompromis({
      bienId: bienFinalise.id,
      acquereurId: acquereurFinalise.id,
      prixConvenu: 300000,
      dateSignature: "2026-01-15",
    });
    idsCompromisCrees.push(compromisFinalise.id);
    await marquerCompromisRealise(compromisFinalise.id, "2026-01-15");
    await enregistrerRemuneration({
      compromisId: compromisFinalise.id,
      montantRemunerationConseillerCentimes: 150000,
      dateEncaissementPrevue: `${annee}-12-30`,
    });

    const { bien: bienEnCours, acquereur: acquereurEnCours } = await creerBienEtAcquereurDeTest("003");
    const compromisEnCours = await enregistrerCompromis({
      bienId: bienEnCours.id,
      acquereurId: acquereurEnCours.id,
      prixConvenu: 300000,
      dateSignature: "2026-01-15",
    });
    idsCompromisCrees.push(compromisEnCours.id);
    await enregistrerRemuneration({
      compromisId: compromisEnCours.id,
      montantRemunerationConseillerCentimes: 170000,
      dateEncaissementPrevue: `${annee}-12-30`,
    });

    const apresDashboard = await chargerProjectionAnnuelle();
    const apres = await calculerProjectionFinAnnee(DOSSIER_TEST_ID, annee);

    expect(apresDashboard.finaliseNonEncaisseRestantCentimes).toBe(
      (avantDashboard.finaliseNonEncaisseRestantCentimes ?? 0) + 150000
    );
    expect(apresDashboard.previsionnelRestantCentimes).toBe((avantDashboard.previsionnelRestantCentimes ?? 0) + 170000);
    expect(apres.finaliseNonEncaisseRestant.montantCentimes).toBe(apresDashboard.finaliseNonEncaisseRestantCentimes);
    expect(apres.compromisEnCoursRestant.montantCentimes).toBe(apresDashboard.previsionnelRestantCentimes);
  });

  it("la projection couverte fin d'année est la somme exacte des trois blocs quand tous sont connus", async () => {
    const resultat = await calculerProjectionFinAnnee(DOSSIER_TEST_ID, annee);
    if (
      resultat.finaliseNonEncaisseRestant.montantCentimes !== undefined &&
      resultat.compromisEnCoursRestant.montantCentimes !== undefined
    ) {
      expect(resultat.projectionCouverteFinAnneeCentimes).toBe(
        resultat.encaisseReel.montantConnuCentimes +
          resultat.finaliseNonEncaisseRestant.montantCentimes +
          resultat.compromisEnCoursRestant.montantCentimes
      );
    }
  });
});
