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
const { chargerHistoriqueMensuel } = await import("./historiqueMensuel");

// aujourd'hui lu côté Postgres une seule fois (même stratégie que dashboardRepository.test.ts) pour
// ne jamais risquer un décalage jour/mois entre le process de test et le serveur.
const [{ aujourdhui }] = await getDb().execute<{ aujourdhui: string }>(sql`select to_char(current_date, 'YYYY-MM-DD') as aujourdhui`);

function ajouterMois(moisIso: string, delta: number): string {
  const [annee, mois] = moisIso.split("-").map(Number);
  const total = (annee * 12 + (mois - 1)) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
function dernierJourDuMois(moisIso: string): string {
  const [annee, mois] = moisIso.split("-").map(Number);
  return new Date(Date.UTC(annee, mois, 0)).toISOString().slice(0, 10);
}

const moisCourant = aujourdhui.slice(0, 7);
const DOSSIER_ZERO_LIGNE = "test-dossier-historique-mensuel-zero-ligne";
const DOSSIER_LIMITE = "test-dossier-historique-mensuel-limite";
const DOSSIER_MILIEU = "test-dossier-historique-mensuel-milieu-de-mois";
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of [DOSSIER_ZERO_LIGNE, DOSSIER_LIMITE, DOSSIER_MILIEU]) {
    await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, id));
  }
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerEncaissement(dossierFiscalId: string, suffixe: string, montantCentimes: number, date: string) {
  const bien = await creerBien({
    reference: `[test réel] HISTMENS-${suffixe}`,
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
    nom: `[test réel] HistMens ${suffixe}`,
    email: `test-réel-histmens-${suffixe}@example.com`,
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

describe("chargerHistoriqueMensuel — correction obligatoire n° 2 (série zero-remplie, frontière garantie)", () => {
  it("aucune ligne historique_amorcage : aucune frontière garantie, série vide", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_ZERO_LIGNE }).onConflictDoNothing();
    const serie = await chargerHistoriqueMensuel(DOSSIER_ZERO_LIGNE);
    expect(serie).toEqual([]);
  });

  it("amorçage confirmé au dernier jour d'un mois : le mois suivant est entièrement garanti, zero-rempli pour les mois sans encaissement", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_LIMITE }).onConflictDoNothing();
    // Frontière au dernier jour du mois M-7 : les 6 mois M-6 à M-1 sont entièrement garantis
    // (M = mois courant, jamais inclus car pas encore entièrement écoulé).
    const moisFrontiere = ajouterMois(moisCourant, -7);
    await enregistrerHistoriqueAmorcage(
      DOSSIER_LIMITE,
      Number(moisFrontiere.slice(0, 4)),
      0,
      dernierJourDuMois(moisFrontiere)
    );
    const moisM6 = ajouterMois(moisCourant, -6);
    const moisM4 = ajouterMois(moisCourant, -4);
    await creerEncaissement(DOSSIER_LIMITE, "001", 100000, `${moisM6}-10`);
    await creerEncaissement(DOSSIER_LIMITE, "002", 200000, `${moisM4}-20`);

    const serie = await chargerHistoriqueMensuel(DOSSIER_LIMITE);
    expect(serie.map((m) => m.mois)).toEqual([
      ajouterMois(moisCourant, -6),
      ajouterMois(moisCourant, -5),
      ajouterMois(moisCourant, -4),
      ajouterMois(moisCourant, -3),
      ajouterMois(moisCourant, -2),
      ajouterMois(moisCourant, -1),
    ]);
    expect(serie.find((m) => m.mois === moisM6)?.montantCentimes).toBe(100000);
    expect(serie.find((m) => m.mois === moisM4)?.montantCentimes).toBe(200000);
    // Zero-rempli, jamais absent de la série (correction n° 2 : un mois couvert sans encaissement = 0).
    expect(serie.find((m) => m.mois === ajouterMois(moisCourant, -5))?.montantCentimes).toBe(0);
    expect(serie.find((m) => m.mois === ajouterMois(moisCourant, -1))?.montantCentimes).toBe(0);
  });

  it("amorçage confirmé en milieu de mois : ce mois-là ne compte pas, le suivant est le premier garanti", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_MILIEU }).onConflictDoNothing();
    const moisFrontiere = ajouterMois(moisCourant, -7);
    // Le 15 du mois, pas le dernier jour : le mois frontière reste partiel.
    await enregistrerHistoriqueAmorcage(DOSSIER_MILIEU, Number(moisFrontiere.slice(0, 4)), 0, `${moisFrontiere}-15`);

    const serie = await chargerHistoriqueMensuel(DOSSIER_MILIEU);
    // Le mois frontière (-7) ne doit jamais apparaître ; le premier mois garanti est -6, comme dans
    // le test précédent où la frontière tombait exactement à la fin du mois -7.
    expect(serie[0]?.mois).toBe(ajouterMois(moisCourant, -6));
    expect(serie.some((m) => m.mois === moisFrontiere)).toBe(false);
  });
});
