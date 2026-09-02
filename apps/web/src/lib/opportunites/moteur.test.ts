import { describe, expect, it } from "vitest";
import { detecterOpportunites } from "./moteur";
import type { ContexteOpportunites } from "./contexte";
import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import type { Tache } from "@/types/tache";
import type { Visite } from "@/types/visite";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import type { ResultatCompatibilite } from "@/lib/compatibilite/types";

// VALUE-01 — moteur purement déterministe : `maintenant` est injecté, aucun test ne dépend de
// l'horloge ni du fuseau de la machine.
const MAINTENANT = new Date("2026-09-02T10:00:00+02:00");

const BIEN: Bien = {
  id: "11111111-1111-1111-1111-111111111111",
  reference: "DEMO-2026-001",
  titre: "Appartement 4 pièces",
  type: "appartement",
  adresse: "14 rue des Tilleuls",
  ville: "Houilles",
  codePostal: "78800",
  surface: 82,
  pieces: 4,
  prix: 389000,
  statutMandat: "actif",
  dateMandat: "2026-07-19",
  caracteristiques: [],
  description: "",
};

const ACQUEREUR: ProfilAcquereur = {
  id: "22222222-2222-2222-2222-222222222222",
  prenom: "Camille",
  nom: "Ferrand",
  email: "camille@test.local",
  telephone: "0100000001",
  budgetMin: 320000,
  budgetMax: 420000,
  criteres: [],
  stadeProjet: "recherche_active",
  notes: "",
  datePremiereContact: "2026-07-26",
};

function prospect(surcharge: Partial<ProspectVendeur> = {}): ProspectVendeur {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    nom: "Vasseur",
    prenom: "Hélène",
    creeLe: "2026-08-08T09:00:00.000Z",
    mandatProposeLe: "2026-08-27T09:00:00.000Z",
    ...surcharge,
  } as ProspectVendeur;
}

function compatibilite(surcharge: Partial<ResultatCompatibilite> = {}): ResultatCompatibilite {
  return {
    bienId: BIEN.id,
    acquereurId: ACQUEREUR.id,
    statutGlobal: "compatible",
    criteres: [
      { critere: "budget_max", label: "Budget maximum", statut: "compatible", explication: "Dans le budget." },
      { critere: "pieces_min", label: "Nombre de pièces minimum", statut: "compatible", explication: "Suffisant." },
    ],
    ...surcharge,
  };
}

function contexte(surcharge: Partial<ContexteOpportunites> = {}): ContexteOpportunites {
  return {
    biens: [BIEN],
    acquereurs: [ACQUEREUR],
    prospectsVendeurs: [],
    visites: [],
    comptesRendus: [],
    compatibilites: [],
    tachesActives: [],
    ...surcharge,
  };
}

function tache(surcharge: Partial<Tache> = {}): Tache {
  return {
    id: "99999999-9999-9999-9999-999999999999",
    titre: "Tâche",
    type: "relance",
    priorite: "normale",
    origine: "manuelle",
    creeLe: "2026-08-30T09:00:00.000Z",
    ...surcharge,
  } as Tache;
}

const VISITE: Visite = {
  id: "44444444-4444-4444-4444-444444444444",
  bienId: BIEN.id,
  acquereurId: ACQUEREUR.id,
  datePrevue: "2026-08-28",
  statut: "realisee",
  rendezVousCalendarId: "gcal-abc",
  creeLe: "2026-08-20T09:00:00.000Z",
};

function compteRendu(surcharge: Partial<CompteRenduVisite> = {}): CompteRenduVisite {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    bienId: BIEN.id,
    acquereurId: ACQUEREUR.id,
    visiteId: VISITE.id,
    dateVisite: "2026-08-28",
    retour: "Retour de visite.",
    interet: "interesse",
    prochaineEtape: "Faire une offre écrite",
    creeLe: "2026-08-28T18:00:00.000Z",
    ...surcharge,
  };
}

describe("CAS 1 — prospect vendeur à relancer", () => {
  it("mandat proposé non signé et ancienneté suffisante -> relance", () => {
    const [opportunite, ...reste] = detecterOpportunites(
      contexte({ prospectsVendeurs: [prospect()] }),
      MAINTENANT
    );
    expect(reste).toHaveLength(0);
    expect(opportunite.type).toBe("relance_prospect_vendeur");
    expect(opportunite.titre).toContain("Hélène Vasseur");
    expect(opportunite.titre).toContain("6 jours");
    expect(opportunite.action.href).toBe("/prospects-vendeurs/33333333-3333-3333-3333-333333333333");
    expect(opportunite.depuisJours).toBe(6);
  });

  it("mandat déjà signé -> aucune relance", () => {
    const resultat = detecterOpportunites(
      contexte({ prospectsVendeurs: [prospect({ mandatSigneLe: "2026-08-29T09:00:00.000Z" })] }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(0);
  });

  it("proposition envoyée hier -> pas encore une relance", () => {
    const resultat = detecterOpportunites(
      contexte({ prospectsVendeurs: [prospect({ mandatProposeLe: "2026-09-01T09:00:00.000Z" })] }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(0);
  });
});

describe("CAS 2 — visite à suivre", () => {
  it("visite réalisée sans compte rendu -> suivi", () => {
    const [opportunite] = detecterOpportunites(contexte({ visites: [VISITE] }), MAINTENANT);
    expect(opportunite.type).toBe("suivi_visite");
    expect(opportunite.raison).toContain("aucun compte rendu");
    expect(opportunite.action.href).toBe("/visites/44444444-4444-4444-4444-444444444444");
  });

  it("visite déjà suivie (compte rendu et prochaine étape) -> aucune opportunité redondante", () => {
    const resultat = detecterOpportunites(
      contexte({ visites: [VISITE], comptesRendus: [compteRendu()] }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(0);
  });

  it("acquéreur intéressé sans prochaine étape -> suite à donner", () => {
    const [opportunite] = detecterOpportunites(
      contexte({ visites: [VISITE], comptesRendus: [compteRendu({ prochaineEtape: undefined })] }),
      MAINTENANT
    );
    expect(opportunite.type).toBe("suivi_visite");
    expect(opportunite.titre).toContain("Donner une suite");
  });

  it("visite seulement planifiée -> rien à suivre", () => {
    const resultat = detecterOpportunites(
      contexte({ visites: [{ ...VISITE, statut: "planifiee" }] }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(0);
  });
});

describe("CAS 3 — match compatible à exploiter", () => {
  it("compatible et aucune visite sur la paire -> proposition", () => {
    const [opportunite] = detecterOpportunites(contexte({ compatibilites: [compatibilite()] }), MAINTENANT);
    expect(opportunite.type).toBe("match_a_exploiter");
    expect(opportunite.titre).toBe("Proposer DEMO-2026-001 à Camille Ferrand");
    expect(opportunite.raison).toContain("Aucune visite n'est enregistrée");
    expect(opportunite.action.href).toBe("/clients/22222222-2222-2222-2222-222222222222");
  });

  it("incompatible -> aucune opportunité commerciale", () => {
    const resultat = detecterOpportunites(
      contexte({ compatibilites: [compatibilite({ statutGlobal: "incompatible" })] }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(0);
  });

  it("une visite existe déjà sur la paire -> aucune proposition", () => {
    const resultat = detecterOpportunites(
      contexte({ compatibilites: [compatibilite()], visites: [{ ...VISITE, statut: "annulee" }] }),
      MAINTENANT
    );
    expect(resultat.filter((o) => o.type === "match_a_exploiter")).toHaveLength(0);
  });

  it("acquéreur déjà engagé (compromis) -> aucune proposition d'un autre bien", () => {
    const resultat = detecterOpportunites(
      contexte({
        acquereurs: [{ ...ACQUEREUR, stadeProjet: "compromis" }],
        compatibilites: [compatibilite()],
      }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(0);
  });
});

describe("CAS 4 — information bloquante à vérifier", () => {
  const aVerifier = compatibilite({
    statutGlobal: "a_verifier",
    criteres: [
      { critere: "budget_max", label: "Budget maximum", statut: "compatible", explication: "Dans le budget." },
      {
        critere: "accessibilite",
        label: "Accessibilité",
        statut: "a_verifier",
        explication: "Ascenseur non renseigné.",
      },
    ],
  });

  it("statut à vérifier -> action de vérification, jamais une proposition commerciale", () => {
    const [opportunite, ...reste] = detecterOpportunites(contexte({ compatibilites: [aVerifier] }), MAINTENANT);
    expect(reste).toHaveLength(0);
    expect(opportunite.type).toBe("information_a_verifier");
    expect(opportunite.type).not.toBe("match_a_exploiter");
    expect(opportunite.titre).toContain("accessibilité");
    expect(opportunite.raison).toContain("Camille Ferrand");
    expect(opportunite.action.href).toBe("/biens/11111111-1111-1111-1111-111111111111");
  });

  it("une seule opportunité par bien et par critère, même avec plusieurs acquéreurs concernés", () => {
    const second: ProfilAcquereur = { ...ACQUEREUR, id: "66666666-6666-6666-6666-666666666666", prenom: "Yanis", nom: "Delaunay" };
    const resultat = detecterOpportunites(
      contexte({
        acquereurs: [ACQUEREUR, second],
        compatibilites: [aVerifier, { ...aVerifier, acquereurId: second.id }],
      }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(1);
    expect(resultat[0].raison).toContain("Camille Ferrand, Yanis Delaunay");
  });
});

describe("déduplication avec les tâches actives", () => {
  it("une tâche sur le prospect absorbe la relance calculée", () => {
    const resultat = detecterOpportunites(
      contexte({
        prospectsVendeurs: [prospect()],
        tachesActives: [
          tache({ titre: "Relancer Hélène Vasseur sur la proposition de mandat", prospectVendeurId: prospect().id }),
        ],
      }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(0);
  });

  it("une tâche sur le bien absorbe la vérification d'information", () => {
    const aVerifier = compatibilite({
      statutGlobal: "a_verifier",
      criteres: [{ critere: "accessibilite", label: "Accessibilité", statut: "a_verifier", explication: "Inconnu." }],
    });
    const resultat = detecterOpportunites(
      contexte({
        compatibilites: [aVerifier],
        tachesActives: [tache({ titre: "Vérifier la présence d'un ascenseur", bienId: BIEN.id })],
      }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(0);
  });

  it("une tâche sur l'acquéreur absorbe le match et le suivi de visite", () => {
    const resultat = detecterOpportunites(
      contexte({
        compatibilites: [compatibilite()],
        visites: [VISITE],
        tachesActives: [tache({ titre: "Proposer une seconde visite", acquereurId: ACQUEREUR.id })],
      }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(0);
  });

  it("une tâche sur un AUTRE dossier n'absorbe rien", () => {
    const resultat = detecterOpportunites(
      contexte({
        prospectsVendeurs: [prospect()],
        tachesActives: [tache({ titre: "Relancer quelqu'un d'autre", prospectVendeurId: "77777777-7777-7777-7777-777777777777" })],
      }),
      MAINTENANT
    );
    expect(resultat).toHaveLength(1);
  });
});

describe("ordre de restitution", () => {
  it("trie par priorité puis par ancienneté, de façon déterministe", () => {
    const resultat = detecterOpportunites(
      contexte({
        prospectsVendeurs: [prospect()],
        visites: [VISITE],
        compatibilites: [
          compatibilite({
            statutGlobal: "a_verifier",
            criteres: [{ critere: "accessibilite", label: "Accessibilité", statut: "a_verifier", explication: "Inconnu." }],
          }),
        ],
      }),
      MAINTENANT
    );

    expect(resultat.map((o) => o.type)).toEqual([
      "relance_prospect_vendeur",
      "suivi_visite",
      "information_a_verifier",
    ]);
    // Deux évaluations du même contexte produisent exactement la même liste, dans le même ordre.
    const seconde = detecterOpportunites(
      contexte({
        prospectsVendeurs: [prospect()],
        visites: [VISITE],
        compatibilites: [
          compatibilite({
            statutGlobal: "a_verifier",
            criteres: [{ critere: "accessibilite", label: "Accessibilité", statut: "a_verifier", explication: "Inconnu." }],
          }),
        ],
      }),
      MAINTENANT
    );
    expect(seconde.map((o) => o.id)).toEqual(resultat.map((o) => o.id));
  });

  it("aucune opportunité ne porte de score ni de probabilité", () => {
    const resultat = detecterOpportunites(
      contexte({ prospectsVendeurs: [prospect()], compatibilites: [compatibilite()] }),
      MAINTENANT
    );
    for (const opportunite of resultat) {
      expect(opportunite.raison).not.toMatch(/\d+\s?%/);
      expect(JSON.stringify(opportunite)).not.toContain("score");
      expect(opportunite.action.href.startsWith("/")).toBe(true);
    }
  });
});

// VALUE-02 — la tâche créée explicitement depuis une prochaine étape cible l'acquéreur (ADR-041) :
// elle doit donc être absorbée par la déduplication VALUE-01, sans quoi le conseiller verrait la
// même action deux fois, dans Aujourd'hui et sur sa liste de tâches.
describe("interaction VALUE-01 / VALUE-02", () => {
  it("visite intéressée sans prochaine étape -> opportunité, puis absorbée dès qu'une tâche acquéreur existe", () => {
    const base = contexte({
      visites: [VISITE],
      comptesRendus: [compteRendu({ prochaineEtape: undefined })],
    });

    const avant = detecterOpportunites(base, MAINTENANT);
    expect(avant.map((o) => o.type)).toEqual(["suivi_visite"]);

    const apres = detecterOpportunites(
      {
        ...base,
        tachesActives: [
          tache({ titre: "Recontacter Camille vendredi", acquereurId: ACQUEREUR.id }),
        ],
      },
      MAINTENANT
    );
    expect(apres).toHaveLength(0);
  });
});
