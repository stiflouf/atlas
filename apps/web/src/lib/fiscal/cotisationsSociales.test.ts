import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration — utilise le référentiel réel seedé (taux_cotisations_bnc_general, 25,6 %
// depuis 2026-01-01) : toutes les fixtures se placent en 2026 pour rester dans sa période de
// validité, sans jamais insérer de règle concurrente (0015_seed_referentiel_fiscal_2026.sql).
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
const { calculerCotisationsSociales } = await import("./cotisationsSociales");

const DOSSIER_MICRO_GENERAL = "test-dossier-cotisations-micro-general";
const DOSSIER_DECLARATION = "test-dossier-cotisations-declaration";
const DOSSIER_CIPAV = "test-dossier-cotisations-cipav";
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of [DOSSIER_MICRO_GENERAL, DOSSIER_DECLARATION, DOSSIER_CIPAV]) {
    await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, id));
  }
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerEncaissement(dossierFiscalId: string, suffixe: string, montantCentimes: number, date: string) {
  const bien = await creerBien({
    reference: `[test réel] COTIS-${suffixe}`,
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
    nom: `[test réel] Cotisations ${suffixe}`,
    email: `test-réel-cotisations-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  const compromis = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: date });
  idsCompromisCrees.push(compromis.id);
  await getDb().update(compromisTable).set({ statut: "realise" }).where(eq(compromisTable.id, compromis.id));
  await getDb().insert(dossierFiscalTable).values({ id: dossierFiscalId }).onConflictDoNothing();
  await enregistrerRemuneration({ compromisId: compromis.id, montantRemunerationConseillerCentimes: montantCentimes });
  await marquerRemunerationEncaissee(compromis.id, date);
}

describe("calculerCotisationsSociales — correction obligatoire n° 2 (garde de régime)", () => {
  it("applique le taux micro-BNC régime général sur un profil couvert", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_MICRO_GENERAL }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_MICRO_GENERAL,
      dateDebutValidite: "2026-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    await enregistrerHistoriqueAmorcageComplet(DOSSIER_MICRO_GENERAL, 2026);
    await creerEncaissement(DOSSIER_MICRO_GENERAL, "001", 1000000, "2026-03-01");

    const resultat = await calculerCotisationsSociales(DOSSIER_MICRO_GENERAL, 2026);
    expect(resultat.statut).toBe("calcule");
    if (resultat.statut === "calcule") {
      expect(resultat.valeur).toBe(256000); // 10 000 € x 25,6 %
      expect(resultat.provenance[0].code).toBe("taux_cotisations_bnc_general");
    }
  });

  // Année délibérément passée et antérieure au référentiel (2019, avant 2026-01-01) pour les deux
  // tests suivants : la garde de régime (regime_non_couvert) se déclenche AVANT toute résolution de
  // règle — resoudreRegle n'est jamais appelé, donc l'absence de référentiel à cette date n'affecte
  // pas le résultat. Isole aussi ces tests de l'année 2026 utilisée par le test précédent
  // (remuneration n'est pas cloisonnée par dossier fiscal, mono-dossier V1, ADR-023).
  it("ne applique JAMAIS le taux micro à une déclaration contrôlée — regime_non_couvert", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_DECLARATION }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_DECLARATION,
      dateDebutValidite: "2015-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2015-01-01",
      regimeFiscal: "declaration_controlee",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    await enregistrerHistoriqueAmorcageComplet(DOSSIER_DECLARATION, 2019);
    await creerEncaissement(DOSSIER_DECLARATION, "002", 1000000, "2019-03-01");

    const resultat = await calculerCotisationsSociales(DOSSIER_DECLARATION, 2019);
    expect(resultat.statut).toBe("indisponible");
    if (resultat.statut === "indisponible") {
      expect(resultat.raisons).toContainEqual({
        type: "regime_non_couvert",
        regimeFiscal: "declaration_controlee",
        date: "2019-03-01",
      });
    }
  });

  it("la Cipav n'a aucun code couvert en V1 — regime_non_couvert, jamais le taux du régime général", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_CIPAV }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_CIPAV,
      dateDebutValidite: "2015-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2015-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "cipav",
    });
    await enregistrerHistoriqueAmorcageComplet(DOSSIER_CIPAV, 2018);
    await creerEncaissement(DOSSIER_CIPAV, "003", 1000000, "2018-03-01");

    const resultat = await calculerCotisationsSociales(DOSSIER_CIPAV, 2018);
    expect(resultat.statut).toBe("indisponible");
  });
});

async function enregistrerHistoriqueAmorcageComplet(dossierFiscalId: string, annee: number) {
  await enregistrerHistoriqueAmorcage(dossierFiscalId, annee, 0, `${annee}-01-01`);
}
