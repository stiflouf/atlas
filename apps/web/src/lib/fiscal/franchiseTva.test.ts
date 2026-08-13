import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Référentiel réel seedé : seuil_tva_base = 37 500,00 €, seuil_tva_majore = 41 250,00 €, depuis
// 2026-01-01.
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
const { calculerFranchiseTva } = await import("./franchiseTva");

const DOSSIER_FRANCHISE = "test-dossier-tva-franchise";
const DOSSIER_REDEVABLE = "test-dossier-tva-redevable";
const DOSSIER_PARTIEL = "test-dossier-tva-partiel";
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of [DOSSIER_FRANCHISE, DOSSIER_REDEVABLE, DOSSIER_PARTIEL]) {
    await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, id));
  }
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerEncaissement(dossierFiscalId: string, suffixe: string, montantCentimes: number, date: string) {
  const bien = await creerBien({
    reference: `[test réel] TVA-${suffixe}`,
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
    nom: `[test réel] TVA ${suffixe}`,
    email: `test-réel-tva-${suffixe}@example.com`,
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

describe("calculerFranchiseTva — correction obligatoire n° 3 (franchise uniquement)", () => {
  it("calcule les marges avant seuils pour un profil en franchise, couverture complète", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_FRANCHISE }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_FRANCHISE,
      dateDebutValidite: "2026-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2026-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    await enregistrerHistoriqueAmorcage(DOSSIER_FRANCHISE, 2026, 0, "2026-01-01");
    // Mesure avant/après plutôt qu'une égalité absolue sur caReferenceConnuCentimes/marges :
    // remuneration n'est pas cloisonnée par dossier fiscal (mono-dossier V1, ADR-023) —
    // resoudreAssietteAnnuelle() somme TOUS les encaissements réels de l'année, y compris ceux
    // d'autres dossiers/fixtures. seuilBase/seuilMajore, eux, viennent uniquement du référentiel
    // seedé (regle_fiscale) — jamais affectés par l'assiette — restent en égalité absolue.
    const avant = await calculerFranchiseTva(DOSSIER_FRANCHISE, 2026);
    await creerEncaissement(DOSSIER_FRANCHISE, "001", 1000000, "2026-03-01"); // 10 000 €

    const resultat = await calculerFranchiseTva(DOSSIER_FRANCHISE, 2026);
    expect(avant.statut).toBe("calcule");
    expect(resultat.statut).toBe("calcule");
    if (resultat.statut === "calcule" && avant.statut === "calcule") {
      expect(resultat.valeur.caReferenceConnuCentimes - avant.valeur.caReferenceConnuCentimes).toBe(1000000);
      expect(resultat.valeur.seuilBaseCentimes).toBe(3750000);
      expect(resultat.valeur.seuilMajoreCentimes).toBe(4125000);
      expect(avant.valeur.margeAvantSeuilBaseCentimes - resultat.valeur.margeAvantSeuilBaseCentimes).toBe(1000000);
      expect(avant.valeur.margeAvantSeuilMajoreCentimes - resultat.valeur.margeAvantSeuilMajoreCentimes).toBe(1000000);
    }
  });

  it("un profil redevable retourne indisponible — Atlas ne stocke pas le montant HT nécessaire", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_REDEVABLE }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_REDEVABLE,
      dateDebutValidite: "2026-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2026-01-01",
      regimeFiscal: "declaration_controlee",
      regimeTva: "redevable_reel_simplifie",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });

    const resultat = await calculerFranchiseTva(DOSSIER_REDEVABLE, 2026);
    expect(resultat).toEqual({
      statut: "indisponible",
      raisons: [{ type: "regime_tva_non_supporte", regimeTva: "redevable_reel_simplifie" }],
    });
  });

  it("couverture partielle : statut partiel, jamais 'calcule' sur un CA incertain", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_PARTIEL }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_PARTIEL,
      dateDebutValidite: "2026-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    // Aucune ligne historique_amorcage : couverture partielle malgré un encaissement connu. Reste
    // sur 2026 (référentiel valide, année non future) volontairement — remuneration n'est pas
    // cloisonnée par dossier fiscal (mono-dossier V1), donc cette assiette capte aussi
    // l'encaissement du premier test : l'assertion de montant est une borne minimale, pas une
    // égalité exacte, pour rester robuste à cela.
    await creerEncaissement(DOSSIER_PARTIEL, "003", 1000000, "2026-03-01");

    const resultat = await calculerFranchiseTva(DOSSIER_PARTIEL, 2026);
    expect(resultat.statut).toBe("partiel");
    if (resultat.statut === "partiel") {
      expect(resultat.valeurConnue.caReferenceConnuCentimes).toBeGreaterThanOrEqual(1000000);
      expect(resultat.raisons.some((r) => r.type === "assiette_incomplete")).toBe(true);
    }
  });
});
