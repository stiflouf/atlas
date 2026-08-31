import { describe, expect, it } from "vitest";
import { produireAlertesDonnees } from "./reglesDonnees";
import { assietteTest, contexteFiscalTest, contexteTest, profilTest, remunerationTest, projectionAnnuelleTest } from "./contexteTest";

function typesDe(alertes: ReturnType<typeof produireAlertesDonnees>): string[] {
  return alertes.map((a) => a.type);
}

describe("A1 — profil fiscal absent", () => {
  it("se déclenche quand aucun profil fiscal n'existe", () => {
    const alertes = produireAlertesDonnees(contexteTest({ fiscal: undefined }));
    expect(typesDe(alertes)).toEqual(["profil_fiscal_absent"]);
    // `information` et non `action_requise` : ne rien avoir renseigné de fiscal est l'état normal
    // du premier jour, jamais une urgence qui devrait passer devant les dossiers du conseiller.
    expect(alertes[0].niveau).toBe("information");
    expect(alertes[0].action?.href).toBe("/fiscal#profil");
  });

  it("ne se déclenche pas quand un profil fiscal existe", () => {
    const alertes = produireAlertesDonnees(contexteTest());
    expect(typesDe(alertes)).not.toContain("profil_fiscal_absent");
  });
});

describe("A2a — champ réellement inconnu (action_requise, l'utilisateur peut compléter)", () => {
  it("regimeFiscal = inconnu déclenche profil_fiscal_inconnu", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({ fiscal: contexteFiscalTest({ profil: profilTest({ regimeFiscal: "inconnu" }) }) })
    );
    const alerte = alertes.find((a) => a.type === "profil_fiscal_inconnu" && a.donneesDeclencheuses.code === "regimeFiscal");
    expect(alerte).toBeDefined();
    expect(alerte?.niveau).toBe("action_requise");
  });

  it("regimeTva = inconnu et affiliationRetraite = inconnu déclenchent chacun leur propre alerte", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({
        fiscal: contexteFiscalTest({ profil: profilTest({ regimeTva: "inconnu", affiliationRetraite: "inconnu" }) }),
      })
    );
    const codes = alertes.filter((a) => a.type === "profil_fiscal_inconnu").map((a) => a.donneesDeclencheuses.code);
    expect(codes.sort()).toEqual(["affiliationRetraite", "regimeTva"]);
  });

  it("ne se déclenche pas quand tous les champs sont renseignés", () => {
    const alertes = produireAlertesDonnees(contexteTest());
    expect(typesDe(alertes)).not.toContain("profil_fiscal_inconnu");
  });
});

describe("A2b — régime connu mais non couvert par le moteur (jamais une action de changer de régime)", () => {
  it("regimeFiscal = declaration_controlee déclenche regime_non_couvert, sans action", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({ fiscal: contexteFiscalTest({ profil: profilTest({ regimeFiscal: "declaration_controlee" }) }) })
    );
    const alerte = alertes.find((a) => a.type === "regime_non_couvert" && a.donneesDeclencheuses.code === "regime_fiscal");
    expect(alerte).toBeDefined();
    expect(alerte?.action).toBeUndefined();
    expect(alerte?.explication).not.toMatch(/changer|modifier votre régime/i);
  });

  it("regimeTva redevable non franchise déclenche regime_non_couvert en information", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({ fiscal: contexteFiscalTest({ profil: profilTest({ regimeTva: "redevable_reel_simplifie" }) }) })
    );
    const alerte = alertes.find((a) => a.type === "regime_non_couvert" && a.donneesDeclencheuses.code === "regime_tva");
    expect(alerte).toBeDefined();
    expect(alerte?.niveau).toBe("information");
  });

  it("micro_bnc + franchise (couverts) ne déclenchent rien", () => {
    const alertes = produireAlertesDonnees(contexteTest());
    expect(typesDe(alertes)).not.toContain("regime_non_couvert");
  });
});

describe("A3 — assiette incomplète (jamais l'absence brute d'une ligne historique_amorcage)", () => {
  it("se déclenche sur couverture 'partielle'", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({
        fiscal: contexteFiscalTest({ assiette: assietteTest({ couverture: "partielle", periodesInconnues: [{ debut: "2026-01-01", fin: "2026-08-13" }] }) }),
      })
    );
    expect(typesDe(alertes)).toContain("assiette_incomplete");
    const alerte = alertes.find((a) => a.type === "assiette_incomplete")!;
    expect(alerte.niveau).toBe("action_requise");
    expect(alerte.action?.href).toBe("/fiscal#amorcage");
  });

  it("ne se déclenche pas sur couverture 'complete' (activité démarrée avec Atlas, par exemple)", () => {
    const alertes = produireAlertesDonnees(contexteTest({ fiscal: contexteFiscalTest({ assiette: assietteTest({ couverture: "complete" }) }) }));
    expect(typesDe(alertes)).not.toContain("assiette_incomplete");
  });
});

describe("A4/A5 — compteurs agrégés uniquement (aucun listing individuel)", () => {
  it("A4 se déclenche quand des compromis/ventes n'ont pas de rémunération renseignée", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({ remuneration: remunerationTest({ nombreCompromisEnCoursEligibles: 5, nombreRemunerationsPrevisionnellesRenseignees: 2 }) })
    );
    const alerte = alertes.find((a) => a.type === "remuneration_manquante");
    expect(alerte).toBeDefined();
    expect(alerte?.titre).toContain("3");
  });

  it("A4 ne se déclenche pas quand tout est renseigné", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({ remuneration: remunerationTest({ nombreCompromisEnCoursEligibles: 5, nombreRemunerationsPrevisionnellesRenseignees: 5 }) })
    );
    expect(typesDe(alertes)).not.toContain("remuneration_manquante");
  });

  it("A5 se déclenche quand des rémunérations renseignées n'ont pas de date d'encaissement prévue", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({
        remuneration: remunerationTest({ nombreRemunerationsPrevisionnellesRenseignees: 4 }),
        projectionAnnuelle: projectionAnnuelleTest({ nombreRemunerationsPrevisionnellesAvecDatePrevue: 1 }),
      })
    );
    const alerte = alertes.find((a) => a.type === "date_encaissement_prevue_manquante");
    expect(alerte).toBeDefined();
    expect(alerte?.titre).toContain("3");
  });

  it("A5 ne se déclenche pas quand toutes les rémunérations renseignées ont une date prévue", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({
        remuneration: remunerationTest({ nombreRemunerationsPrevisionnellesRenseignees: 4 }),
        projectionAnnuelle: projectionAnnuelleTest({ nombreRemunerationsPrevisionnellesAvecDatePrevue: 4 }),
      })
    );
    expect(typesDe(alertes)).not.toContain("date_encaissement_prevue_manquante");
  });
});

describe("A6 — règle légale absente (ACRE inclus, jamais un cas C3 séparé)", () => {
  it("se déclenche pour un code regle_absente rencontré", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({
        fiscal: contexteFiscalTest({
          cotisations: { statut: "indisponible", raisons: [{ type: "regle_absente", code: "taux_acre_micro_entrepreneur", date: "2026-06-01" }] },
        }),
      })
    );
    const alerte = alertes.find((a) => a.type === "regle_legale_absente");
    expect(alerte).toBeDefined();
    expect(alerte?.donneesDeclencheuses.code).toBe("taux_acre_micro_entrepreneur");
    expect(alerte?.action).toBeUndefined();
  });

  it("déduplique par code même si plusieurs moteurs émettent la même raison (ACRE dans cotisations ET vfl)", () => {
    const raisonAcre = { type: "regle_absente" as const, code: "taux_acre_micro_entrepreneur", date: "2026-06-01" };
    const alertes = produireAlertesDonnees(
      contexteTest({
        fiscal: contexteFiscalTest({
          cotisations: { statut: "indisponible", raisons: [raisonAcre] },
          vfl: { statut: "indisponible", raisons: [raisonAcre] },
        }),
      })
    );
    expect(alertes.filter((a) => a.type === "regle_legale_absente")).toHaveLength(1);
  });

  it("produit une alerte distincte par code distinct", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({
        fiscal: contexteFiscalTest({
          cotisations: { statut: "indisponible", raisons: [{ type: "regle_absente", code: "code-a", date: "2026-06-01" }] },
          cfp: { statut: "indisponible", raisons: [{ type: "regle_absente", code: "code-b", date: "2026-06-01" }] },
        }),
      })
    );
    expect(alertes.filter((a) => a.type === "regle_legale_absente")).toHaveLength(2);
  });
});

describe("A7 — historique run-rate insuffisant (fenêtre 1 à 5 mois strictement)", () => {
  it("se déclenche entre 1 et 5 mois garantis", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({ fiscal: contexteFiscalTest({ runRate: { fiable: false, moisHistoriqueUtilises: 3 } }) })
    );
    expect(typesDe(alertes)).toContain("historique_run_rate_insuffisant");
  });

  it("ne se déclenche pas à 0 mois (absence légitime, pas une anomalie)", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({ fiscal: contexteFiscalTest({ runRate: { fiable: false, moisHistoriqueUtilises: 0 } }) })
    );
    expect(typesDe(alertes)).not.toContain("historique_run_rate_insuffisant");
  });

  it("ne se déclenche pas à partir de 6 mois", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({ fiscal: contexteFiscalTest({ runRate: { fiable: false, moisHistoriqueUtilises: 6 } }) })
    );
    expect(typesDe(alertes)).not.toContain("historique_run_rate_insuffisant");
  });

  it("ne se déclenche jamais quand le run-rate est fiable", () => {
    const alertes = produireAlertesDonnees(
      contexteTest({ fiscal: contexteFiscalTest({ runRate: { fiable: true, moisHistoriqueUtilises: 8, moyenneMensuelleCentimes: 1000 } }) })
    );
    expect(typesDe(alertes)).not.toContain("historique_run_rate_insuffisant");
  });
});
