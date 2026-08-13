import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

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
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { enregistrerRemuneration, marquerRemunerationEncaissee } = await import("@/lib/remunerationRepository");
const { calculerProjectionPluriannuelle } = await import("./projectionPluriannuelle");

const [{ aujourdhui }] = await getDb().execute<{ aujourdhui: string }>(sql`select to_char(current_date, 'YYYY-MM-DD') as aujourdhui`);

function ajouterMois(moisIso: string, delta: number): string {
  const [annee, mois] = moisIso.split("-").map(Number);
  const total = annee * 12 + (mois - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
function dernierJourDuMois(moisIso: string): string {
  const [annee, mois] = moisIso.split("-").map(Number);
  return new Date(Date.UTC(annee, mois, 0)).toISOString().slice(0, 10);
}

const moisCourant = aujourdhui.slice(0, 7);
const anneeCourante = Number(aujourdhui.slice(0, 4));
const anneeCible = anneeCourante + 1; // N+1
const DOSSIER_TEST_ID = "test-dossier-projection-pluriannuelle";
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, DOSSIER_TEST_ID));
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerCompromisPourPipeline(suffixe: string, montantCentimes: number, datePrevue: string, statut: "en_cours" | "realise") {
  const bien = await creerBien({
    reference: `[test réel] PROJPLURI-${suffixe}`,
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2020-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] ProjPluri ${suffixe}`,
    email: `test-réel-projpluri-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2020-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  const compromis = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2020-01-01" });
  idsCompromisCrees.push(compromis.id);
  if (statut === "realise") {
    await getDb().update(compromisTable).set({ statut: "realise" }).where(eq(compromisTable.id, compromis.id));
  }
  await enregistrerRemuneration({
    compromisId: compromis.id,
    montantRemunerationConseillerCentimes: montantCentimes,
    dateEncaissementPrevue: datePrevue,
  });
}

async function creerEncaissementReel(suffixe: string, montantCentimes: number, date: string) {
  const bien = await creerBien({
    reference: `[test réel] PROJPLURI-HIST-${suffixe}`,
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2020-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] ProjPluriHist ${suffixe}`,
    email: `test-réel-projpluri-hist-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2020-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  const compromis = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: date });
  idsCompromisCrees.push(compromis.id);
  await getDb().update(compromisTable).set({ statut: "realise" }).where(eq(compromisTable.id, compromis.id));
  await enregistrerRemuneration({ compromisId: compromis.id, montantRemunerationConseillerCentimes: montantCentimes });
  await marquerRemunerationEncaissee(compromis.id, date);
}

describe("calculerProjectionPluriannuelle — correction obligatoire n° 1 (jamais pipeline + run-rate)", () => {
  it("prépare un dossier avec 6 mois d'historique garanti (600 000 centimes/mois -> run-rate 7 200 000) et un pipeline daté de 1 800 000 sur l'année cible", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_TEST_ID }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_TEST_ID,
      dateDebutValidite: "2020-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });

    const moisFrontiere = ajouterMois(moisCourant, -7);
    await enregistrerHistoriqueAmorcage(
      DOSSIER_TEST_ID,
      Number(moisFrontiere.slice(0, 4)),
      0,
      dernierJourDuMois(moisFrontiere)
    );
    for (let i = -6; i <= -1; i++) {
      await creerEncaissementReel(`m${i}`, 600000, `${ajouterMois(moisCourant, i)}-10`);
    }

    // Pipeline daté sur l'année cible N+1 : un compromis en_cours (12 000 €) + une vente finalisée
    // non encaissée (6 000 €) = 18 000 € au total, jamais mélangés au run-rate.
    await creerCompromisPourPipeline("001", 1200000, `${anneeCible}-03-15`, "en_cours");
    await creerCompromisPourPipeline("002", 600000, `${anneeCible}-09-15`, "realise");
  });

  it("le pipeline (18 000 €) et le run-rate (72 000 €) restent deux blocs séparés, jamais 90 000 €", async () => {
    const projections = await calculerProjectionPluriannuelle(DOSSIER_TEST_ID, anneeCible, 1);
    expect(projections).toHaveLength(1);
    const annee = projections[0];

    expect(annee.pipeline.montantCentimes).toBe(1800000); // 18 000 €
    expect(annee.statistique.montantCentimes).toBe(7200000); // 72 000 € (600 000 x 12)
    expect(annee.statistique.moisHistoriqueUtilises).toBe(6);

    // Aucun champ ne doit jamais additionner les deux — vérifié structurellement (le type ne
    // possède pas de champ total) ET par une somme explicite qui doit rester fausse.
    expect(annee).not.toHaveProperty("totalProjeteCentimes");
    const sommeErronee = (annee.pipeline.montantCentimes ?? 0) + (annee.statistique.montantCentimes ?? 0);
    expect(sommeErronee).toBe(9000000); // ce que donnerait l'erreur — jamais lu nulle part dans le type
    expect(annee.pipeline.montantCentimes).not.toBe(sommeErronee);
    expect(annee.statistique.montantCentimes).not.toBe(sommeErronee);
  });

  it("les conséquences fiscales du pipeline et du run-rate sont calculées séparément", async () => {
    const [annee] = await calculerProjectionPluriannuelle(DOSSIER_TEST_ID, anneeCible, 1);
    expect(annee.pipeline.consequencesFiscales?.cotisations.statut).toBe("calcule");
    expect(annee.statistique.consequencesFiscales?.cotisations.statut).toBe("calcule");
    if (annee.pipeline.consequencesFiscales?.cotisations.statut === "calcule") {
      expect(annee.pipeline.consequencesFiscales.cotisations.valeur).toBe(460800); // 18 000 € x 25,6 %
    }
  });
});
