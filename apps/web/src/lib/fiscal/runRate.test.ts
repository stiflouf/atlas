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
const { enregistrerHistoriqueAmorcage } = await import("@/lib/historiqueAmorcageRepository");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { enregistrerRemuneration, marquerRemunerationEncaissee } = await import("@/lib/remunerationRepository");
const { evaluerRunRate, ventilerRunRateSurAnnee, SEUIL_MOIS_MINIMUM_RUN_RATE } = await import("./runRate");

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
const DOSSIER_SIX_MOIS = "test-dossier-runrate-six-mois";
const DOSSIER_CINQ_MOIS = "test-dossier-runrate-cinq-mois";
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of [DOSSIER_SIX_MOIS, DOSSIER_CINQ_MOIS]) {
    await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, id));
  }
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerEncaissement(dossierFiscalId: string, suffixe: string, montantCentimes: number, date: string) {
  const bien = await creerBien({
    reference: `[test réel] RUNRATE-${suffixe}`,
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
    nom: `[test réel] RunRate ${suffixe}`,
    email: `test-réel-runrate-${suffixe}@example.com`,
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

describe("evaluerRunRate — seuil des 6 mois entièrement couverts (correction n° 2)", () => {
  it("[1000, 0, 1000, 0, 1000, 0] sur 6 mois garantis : fiable, moyenne 500, utilise bien les 6 mois", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_SIX_MOIS }).onConflictDoNothing();
    const moisFrontiere = ajouterMois(moisCourant, -7);
    await enregistrerHistoriqueAmorcage(
      DOSSIER_SIX_MOIS,
      Number(moisFrontiere.slice(0, 4)),
      0,
      dernierJourDuMois(moisFrontiere)
    );
    const montants = [1000, 0, 1000, 0, 1000, 0];
    for (let i = 0; i < montants.length; i++) {
      if (montants[i] > 0) {
        await creerEncaissement(DOSSIER_SIX_MOIS, `m${i}`, montants[i], `${ajouterMois(moisCourant, -6 + i)}-10`);
      }
    }

    const resultat = await evaluerRunRate(DOSSIER_SIX_MOIS);
    expect(resultat).toEqual({ fiable: true, moisHistoriqueUtilises: 6, moyenneMensuelleCentimes: 500 });
  });

  it("5 mois garantis seulement : non fiable, jamais un run-rate calculé sur un historique trop court", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_CINQ_MOIS }).onConflictDoNothing();
    const moisFrontiere = ajouterMois(moisCourant, -6);
    await enregistrerHistoriqueAmorcage(
      DOSSIER_CINQ_MOIS,
      Number(moisFrontiere.slice(0, 4)),
      0,
      dernierJourDuMois(moisFrontiere)
    );
    await creerEncaissement(DOSSIER_CINQ_MOIS, "001", 100000, `${ajouterMois(moisCourant, -5)}-10`);

    const resultat = await evaluerRunRate(DOSSIER_CINQ_MOIS);
    expect(resultat).toEqual({ fiable: false, moisHistoriqueUtilises: SEUIL_MOIS_MINIMUM_RUN_RATE - 1 });
  });
});

describe("ventilerRunRateSurAnnee — ventilation plate, aucune saisonnalité", () => {
  it("répartit la moyenne mensuelle sur les 12 mois de l'année cible", () => {
    const ventilation = ventilerRunRateSurAnnee(2027, 500);
    expect(ventilation).toHaveLength(12);
    expect(ventilation[0]).toEqual({ mois: "2027-01", montantCentimes: 500 });
    expect(ventilation[11]).toEqual({ mois: "2027-12", montantCentimes: 500 });
    expect(ventilation.every((m) => m.montantCentimes === 500)).toBe(true);
  });
});
