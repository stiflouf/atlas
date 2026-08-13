import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Référentiel réel seedé : plafond_micro_bnc = 83 600,00 € du 2026-01-01 au 2029-01-01 (exclu).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  dossierFiscal: dossierFiscalTable,
  regleFiscale: regleFiscaleTable,
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
} = await import("@/db/schema");
const { enregistrerProfilFiscal } = await import("@/lib/profilFiscalRepository");
const { enregistrerHistoriqueAmorcage } = await import("@/lib/historiqueAmorcageRepository");
const { insererRegleFiscale } = await import("@/lib/referentielFiscalRepository");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { enregistrerRemuneration, marquerRemunerationEncaissee } = await import("@/lib/remunerationRepository");
const { calculerMicroBnc } = await import("./microBnc");

const DOSSIER_PLEIN_ANNEE = "test-dossier-microbnc-plein-annee";
const DOSSIER_CREATION = "test-dossier-microbnc-creation";
const DOSSIER_PARTIEL = "test-dossier-microbnc-partiel";
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsReglesFiscalesCreees: string[] = [];

afterAll(async () => {
  for (const id of [DOSSIER_PLEIN_ANNEE, DOSSIER_CREATION, DOSSIER_PARTIEL]) {
    await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, id));
  }
  for (const id of idsReglesFiscalesCreees) await getDb().delete(regleFiscaleTable).where(eq(regleFiscaleTable.id, id));
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerEncaissement(dossierFiscalId: string, suffixe: string, montantCentimes: number, date: string) {
  const bien = await creerBien({
    reference: `[test réel] MICROBNC-${suffixe}`,
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
    nom: `[test réel] MicroBNC ${suffixe}`,
    email: `test-réel-microbnc-${suffixe}@example.com`,
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

describe("calculerMicroBnc", () => {
  it("compare les recettes connues au plafond plein quand la couverture est complète", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_PLEIN_ANNEE }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_PLEIN_ANNEE,
      dateDebutValidite: "2020-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    // Amorçage confirmé pour N, N-1 et N-2 : les trois années sont pleinement couvertes, isolant ce
    // test sur la seule comparaison au plafond plein (le statut global reste "calcule"). Le
    // référentiel réel ne couvre plafond_micro_bnc qu'à partir de 2026-01-01 : une règle
    // supplémentaire, contiguë et non chevauchante (jusqu'en 2026-01-01 exclu), est nécessaire pour
    // que N-1/N-2 (2024/2025) soient résolubles.
    const regleAnterieure = await insererRegleFiscale({
      code: "plafond_micro_bnc",
      categorieActivite: "agent_commercial_immobilier",
      valeur: 8360000,
      unite: "centimes",
      dateDebutValidite: "2020-01-01",
      dateFinValidite: "2026-01-01",
      sourceLibelle: "Test — plafond micro-BNC pré-2026",
      sourceUrl: "https://example.invalid/test",
      statutVerification: "verifie_direct",
    });
    idsReglesFiscalesCreees.push(regleAnterieure.id);

    await enregistrerHistoriqueAmorcage(DOSSIER_PLEIN_ANNEE, 2026, 0, "2026-01-01");
    await enregistrerHistoriqueAmorcage(DOSSIER_PLEIN_ANNEE, 2025, 0, "2025-12-31");
    await enregistrerHistoriqueAmorcage(DOSSIER_PLEIN_ANNEE, 2024, 0, "2024-12-31");
    await creerEncaissement(DOSSIER_PLEIN_ANNEE, "001", 900000000, "2026-03-01"); // 9 000 000 € > plafond

    const resultat = await calculerMicroBnc(DOSSIER_PLEIN_ANNEE, 2026);
    expect(resultat.statut).toBe("calcule");
    if (resultat.statut === "calcule") {
      expect(resultat.valeur.plafondPleinCentimes).toBe(8360000);
      expect(resultat.valeur.anneeCourante).toMatchObject({ statut: "connue", depasse: true });
      expect(resultat.valeur.anneeCreation).toBe(false);
      expect(resultat.valeur.plafondProratiseReferenceCentimes).toBeUndefined();
    }
  });

  it("année de création : le prorata est une valeur de référence, jamais comparée pour 'depasse'", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_CREATION }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_CREATION,
      dateDebutValidite: "2026-07-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2026-07-01", // activité créée en cours d'année 2026
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    await enregistrerHistoriqueAmorcage(DOSSIER_CREATION, 2026, 0, "2026-07-01");
    await creerEncaissement(DOSSIER_CREATION, "002", 1000000, "2026-08-01"); // 10 000 €, sous le plafond plein ET le prorata

    const resultat = await calculerMicroBnc(DOSSIER_CREATION, 2026);
    expect(resultat.statut).toBe("calcule");
    if (resultat.statut === "calcule") {
      expect(resultat.valeur.anneeCreation).toBe(true);
      expect(resultat.valeur.plafondProratiseReferenceCentimes).toBeGreaterThan(0);
      expect(resultat.valeur.plafondProratiseReferenceCentimes).toBeLessThan(resultat.valeur.plafondPleinCentimes);
      // "depasse" compare toujours au plafond PLEIN, jamais à la valeur proratisée de référence.
      expect(resultat.valeur.anneeCourante).toMatchObject({ statut: "connue", depasse: false });
      // Aucune activité avant la création : N-1/N-2 absents, jamais "indeterminee".
      expect(resultat.valeur.anneeMoins1).toBeUndefined();
      expect(resultat.valeur.anneeMoins2).toBeUndefined();
    }
  });

  it("couverture partielle : statut global partiel, jamais un dépassement affirmé", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_PARTIEL }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_PARTIEL,
      dateDebutValidite: "2020-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    // Aucune ligne historique_amorcage : couverture partielle. Reste sur 2026 (année courante,
    // référentiel valide) volontairement — remuneration n'est pas cloisonnée par dossier fiscal
    // (mono-dossier V1), donc cette assiette capte aussi les encaissements des tests précédents ;
    // les assertions ci-dessous ne dépendent d'aucun montant exact pour rester robustes à cela.
    await creerEncaissement(DOSSIER_PARTIEL, "003", 1000000, "2026-03-01");

    const resultat = await calculerMicroBnc(DOSSIER_PARTIEL, 2026);
    expect(resultat.statut).toBe("partiel");
    if (resultat.statut === "partiel") {
      expect(resultat.valeurConnue.anneeCourante.statut).toBe("indeterminee");
      expect(resultat.raisons.some((r) => r.type === "assiette_incomplete")).toBe(true);
    }
  });

  it("un profil en déclaration contrôlée est indisponible pour le micro-BNC", async () => {
    const dossierId = "test-dossier-microbnc-declaration";
    await getDb().insert(dossierFiscalTable).values({ id: dossierId }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: dossierId,
      dateDebutValidite: "2026-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "declaration_controlee",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });

    const resultat = await calculerMicroBnc(dossierId, 2026);
    expect(resultat.statut).toBe("indisponible");

    await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, dossierId));
  });
});
