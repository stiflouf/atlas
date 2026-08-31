import { describe, expect, it } from "vitest";
import { produireAlertes } from "./moteur";
import { contexteTest, remunerationTest } from "./contexteTest";

describe("produireAlertes — intégration règles + déduplication + priorité", () => {
  it("dossier complet et cohérent ne produit aucune alerte", () => {
    const alertes = produireAlertes(contexteTest());
    expect(alertes).toEqual([]);
  });

  it("profil absent : une seule alerte fiscale, jamais de cascade", () => {
    const alertes = produireAlertes(
      contexteTest({ fiscal: undefined, remuneration: remunerationTest({ nombreCompromisEnCoursEligibles: 3, nombreRemunerationsPrevisionnellesRenseignees: 1 }) })
    );
    expect(alertes.map((a) => a.type)).toEqual(
      expect.arrayContaining(["profil_fiscal_absent", "remuneration_manquante", "date_encaissement_prevue_manquante"])
    );
    expect(alertes).toHaveLength(3);
    // Le plus prioritaire passe en tête, jamais un score affiché. Depuis que profil_fiscal_absent
    // est de niveau `information` (reglesDonnees.ts), ce sont les alertes commerciales — de niveau
    // `attention` — qui ouvrent le cockpit, et l'absence de profil fiscal qui ferme la liste.
    expect(alertes[0].type).toBe("remuneration_manquante");
    expect(alertes[alertes.length - 1].type).toBe("profil_fiscal_absent");
    for (const alerte of alertes) {
      expect(alerte).not.toHaveProperty("score");
    }
  });

  it("le résultat est trié par priorité déterministe (niveau puis poids de type)", () => {
    const alertes = produireAlertes(
      contexteTest({
        remuneration: remunerationTest({ nombreCompromisEnCoursEligibles: 2, nombreRemunerationsPrevisionnellesRenseignees: 0 }),
      })
    );
    const niveaux = alertes.map((a) => a.niveau);
    const rangNiveau: Record<string, number> = { action_requise: 0, attention: 1, information: 2 };
    const rangs = niveaux.map((n) => rangNiveau[n]);
    expect(rangs).toEqual([...rangs].sort((a, b) => a - b));
  });
});
