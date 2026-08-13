import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Référentiel réel seedé : taux_cfp_liberal_non_reglemente, 0,2 % depuis 2026-01-01, statut
// a_confirmer (ADR-023) — le moteur calcule quand même, la réserve est portée par la provenance.
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
const { calculerCfp } = await import("./cfp");

const DOSSIER_MICRO = "test-dossier-cfp-micro";
const DOSSIER_DECLARATION = "test-dossier-cfp-declaration";
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of [DOSSIER_MICRO, DOSSIER_DECLARATION]) {
    await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, id));
  }
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerEncaissement(dossierFiscalId: string, suffixe: string, montantCentimes: number, date: string) {
  const bien = await creerBien({
    reference: `[test réel] CFP-${suffixe}`,
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
    nom: `[test réel] CFP ${suffixe}`,
    email: `test-réel-cfp-${suffixe}@example.com`,
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

describe("calculerCfp — correction obligatoire n° 2 (garde de régime)", () => {
  it("calcule le CFP sur un profil micro-BNC, en conservant le statut a_confirmer dans la provenance", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_MICRO }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_MICRO,
      dateDebutValidite: "2026-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    await enregistrerHistoriqueAmorcage(DOSSIER_MICRO, 2026, 0, "2026-01-01");
    await creerEncaissement(DOSSIER_MICRO, "001", 1000000, "2026-03-01");

    const resultat = await calculerCfp(DOSSIER_MICRO, 2026);
    expect(resultat.statut).toBe("calcule");
    if (resultat.statut === "calcule") {
      expect(resultat.valeur).toBe(2000); // 10 000 € x 0,2 %
      expect(resultat.provenance[0].statutVerification).toBe("a_confirmer");
    }
  });

  // Année délibérément passée et antérieure au référentiel (2019) : la garde de régime
  // (regime_non_couvert) se déclenche avant toute résolution de règle, donc l'absence de
  // référentiel à cette date n'affecte pas le résultat — isole aussi ce test de l'année 2026
  // utilisée par le test précédent (remuneration n'est pas cloisonnée par dossier fiscal, ADR-023).
  it("ne s'applique jamais à une déclaration contrôlée", async () => {
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
    await enregistrerHistoriqueAmorcage(DOSSIER_DECLARATION, 2019, 0, "2019-01-01");
    await creerEncaissement(DOSSIER_DECLARATION, "002", 1000000, "2019-03-01");

    const resultat = await calculerCfp(DOSSIER_DECLARATION, 2019);
    expect(resultat.statut).toBe("indisponible");
  });
});
