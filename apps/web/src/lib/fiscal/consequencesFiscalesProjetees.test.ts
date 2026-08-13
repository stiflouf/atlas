import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { dossierFiscal: dossierFiscalTable } = await import("@/db/schema");
const { enregistrerProfilFiscal } = await import("@/lib/profilFiscalRepository");
const { calculerConsequencesFiscalesProjetees, calculerConsequencesFiscalesHypothese } = await import(
  "./consequencesFiscalesProjetees"
);

const DOSSIER_STABLE = "test-dossier-consequences-projetees-stable";
const DOSSIER_INSTABLE = "test-dossier-consequences-projetees-instable";
const DOSSIER_DECLARATION = "test-dossier-consequences-projetees-declaration";

afterAll(async () => {
  for (const id of [DOSSIER_STABLE, DOSSIER_INSTABLE, DOSSIER_DECLARATION]) {
    await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, id));
  }
});

describe("calculerConsequencesFiscalesProjetees — réutilise les gardes de régime ADR-024", () => {
  it("un profil en déclaration contrôlée est indisponible pour les cotisations/CFP/VFL, et micro-BNC est indéterminé", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_DECLARATION }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_DECLARATION,
      dateDebutValidite: "2020-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "declaration_controlee",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });

    const resultat = await calculerConsequencesFiscalesProjetees(DOSSIER_DECLARATION, 2027, [
      { montantCentimes: 1000000, date: "2027-06-01" },
    ]);
    expect(resultat.cotisations.statut).toBe("indisponible");
    expect(resultat.cfp.statut).toBe("indisponible");
    expect(resultat.microBnc.statut).toBe("indeterminee");
  });
});

describe("calculerConsequencesFiscalesHypothese — correction obligatoire n° 4/5 (jamais de ventilation devinée)", () => {
  it("un profil et des règles stables toute l'année : la même hypothèse annuelle est taxée directement", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_STABLE }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_STABLE,
      dateDebutValidite: "2020-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });

    const resultat = await calculerConsequencesFiscalesHypothese(DOSSIER_STABLE, 2027, 1000000);
    expect(resultat.cotisations).toMatchObject({ statut: "calcule", valeur: 256000 }); // 25,6 %
    expect(resultat.cfp).toMatchObject({ statut: "calcule", valeur: 2000 }); // 0,2 %
  });

  it("un changement de régime en cours d'année : ventilation_requise partout, jamais une répartition devinée", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_INSTABLE }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_INSTABLE,
      dateDebutValidite: "2020-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    // Bascule en déclaration contrôlée en cours de l'année projetée 2028.
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_INSTABLE,
      dateDebutValidite: "2028-07-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "declaration_controlee",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });

    const resultat = await calculerConsequencesFiscalesHypothese(DOSSIER_INSTABLE, 2028, 1000000);
    expect(resultat.cotisations).toMatchObject({ statut: "indisponible", raisons: [{ type: "ventilation_requise", annee: 2028 }] });
    expect(resultat.cfp.statut).toBe("indisponible");
    expect(resultat.vfl.statut).toBe("indisponible");
    expect(resultat.microBnc).toMatchObject({ statut: "indeterminee" });
    expect(resultat.franchiseTva).toMatchObject({ statut: "indisponible" });
  });
});
