import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Référentiel réel seedé : taux_versement_liberatoire_bnc (2,2 %) et
// seuil_rfr_versement_liberatoire_par_part (293 150,00 €, RFR N-2) depuis 2026-01-01.
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
const { enregistrerRfrFoyer } = await import("@/lib/rfrFoyerRepository");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { enregistrerRemuneration, marquerRemunerationEncaissee } = await import("@/lib/remunerationRepository");
const { calculerVersementLiberatoire, verifierEligibiliteRfr } = await import("./versementLiberatoire");

const DOSSIER_ACTIF = "test-dossier-vfl-actif";
const DOSSIER_INACTIF = "test-dossier-vfl-inactif";
const DOSSIER_RFR = "test-dossier-vfl-rfr";
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of [DOSSIER_ACTIF, DOSSIER_INACTIF, DOSSIER_RFR]) {
    await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, id));
  }
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerEncaissement(dossierFiscalId: string, suffixe: string, montantCentimes: number, date: string) {
  const bien = await creerBien({
    reference: `[test réel] VFL-${suffixe}`,
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
    nom: `[test réel] VFL ${suffixe}`,
    email: `test-réel-vfl-${suffixe}@example.com`,
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
  await enregistrerRemuneration({ compromisId: compromis.id, montantRemunerationConseillerCentimes: montantCentimes });
  await marquerRemunerationEncaissee(compromis.id, date);
}

describe("calculerVersementLiberatoire — actif seulement si le profil l'indique, jamais dérivé du RFR", () => {
  it("calcule le VFL quand le profil l'indique actif", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_ACTIF }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_ACTIF,
      dateDebutValidite: "2026-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
      optionVersementLiberatoire: true,
    });
    await enregistrerHistoriqueAmorcage(DOSSIER_ACTIF, 2026, 0, "2026-01-01");
    await creerEncaissement(DOSSIER_ACTIF, "001", 1000000, "2026-03-01");

    const resultat = await calculerVersementLiberatoire(DOSSIER_ACTIF, 2026);
    expect(resultat.statut).toBe("calcule");
    if (resultat.statut === "calcule") expect(resultat.valeur).toBe(22000); // 10 000 € x 2,2 %
  });

  it("reste à 0 quand le profil ne l'indique pas actif — même avec un RFR très favorable", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_INACTIF }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_INACTIF,
      dateDebutValidite: "2026-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
      optionVersementLiberatoire: false,
    });
    // RFR très bas : largement sous le seuil d'éligibilité — ne doit JAMAIS activer le VFL tout seul.
    await enregistrerRfrFoyer(DOSSIER_INACTIF, 2024, 100000, 100);
    await enregistrerHistoriqueAmorcage(DOSSIER_INACTIF, 2026, 0, "2026-01-01");
    await creerEncaissement(DOSSIER_INACTIF, "002", 1000000, "2026-03-01");

    const resultat = await calculerVersementLiberatoire(DOSSIER_INACTIF, 2026);
    expect(resultat.statut).toBe("calcule");
    if (resultat.statut === "calcule") expect(resultat.valeur).toBe(0);

    const eligibilite = await verifierEligibiliteRfr(DOSSIER_INACTIF, 2026);
    expect(eligibilite).toMatchObject({ statut: "calcule", eligible: true });
  });
});

describe("verifierEligibiliteRfr — contrôle informatif séparé", () => {
  it("indisponible quand aucune ligne RFR N-2 n'existe", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_RFR }).onConflictDoNothing();
    const resultat = await verifierEligibiliteRfr(DOSSIER_RFR, 2026);
    expect(resultat).toEqual({ statut: "indisponible", raisons: [{ type: "rfr_absent", anneeRfrAttendue: 2024 }] });
  });

  it("éligible quand le RFR par part est sous le seuil", async () => {
    await enregistrerRfrFoyer(DOSSIER_RFR, 2024, 1000000, 100); // 10 000 € pour 1 part
    const resultat = await verifierEligibiliteRfr(DOSSIER_RFR, 2026);
    expect(resultat).toMatchObject({ statut: "calcule", eligible: true, rfrParPartCentimes: 1000000 });
  });

  it("non éligible quand le RFR par part dépasse le seuil", async () => {
    await enregistrerRfrFoyer(DOSSIER_RFR, 2024, 5000000, 100); // 50 000 € pour 1 part > seuil 29 315 €
    const resultat = await verifierEligibiliteRfr(DOSSIER_RFR, 2026);
    expect(resultat).toMatchObject({ statut: "calcule", eligible: false });
  });
});
