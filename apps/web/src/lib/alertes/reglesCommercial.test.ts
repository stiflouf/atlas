import { describe, expect, it } from "vitest";
import { produireAlertesCommercial } from "./reglesCommercial";
import { contexteTest, projectionAnnuelleTest } from "./contexteTest";

describe("B1 — encaissement attendu dépassé", () => {
  it("se déclenche quand au moins une vente a une date d'encaissement prévue dépassée", () => {
    const alertes = produireAlertesCommercial(
      contexteTest({
        projectionAnnuelle: projectionAnnuelleTest({ nombreEncaissementsAttendusDepasses: 2, encaissementsAttendusDepassesCentimes: 500_000 }),
      })
    );
    expect(alertes).toHaveLength(1);
    expect(alertes[0].type).toBe("encaissement_attendu_depasse");
    expect(alertes[0].niveau).toBe("attention");
  });

  it("ne se déclenche pas quand aucun encaissement attendu n'est dépassé", () => {
    const alertes = produireAlertesCommercial(contexteTest({ projectionAnnuelle: projectionAnnuelleTest({ nombreEncaissementsAttendusDepasses: 0 }) }));
    expect(alertes).toHaveLength(0);
  });

  it("le libellé (titre) reste neutre, jamais 'retard' ni 'incident' ni 'anomalie'", () => {
    const alertes = produireAlertesCommercial(
      contexteTest({ projectionAnnuelle: projectionAnnuelleTest({ nombreEncaissementsAttendusDepasses: 1 }) })
    );
    expect(alertes[0].titre.toLowerCase()).not.toMatch(/retard|incident|anomalie/);
    expect(alertes[0].titre.toLowerCase()).toContain("encaissement");
  });

  it("se déclenche indépendamment de tout profil fiscal (donnée purement commerciale)", () => {
    const alertes = produireAlertesCommercial(
      contexteTest({ fiscal: undefined, projectionAnnuelle: projectionAnnuelleTest({ nombreEncaissementsAttendusDepasses: 1 }) })
    );
    expect(alertes).toHaveLength(1);
  });
});
