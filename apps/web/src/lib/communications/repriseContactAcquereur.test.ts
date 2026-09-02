import { describe, expect, it } from "vitest";
import {
  construireRepriseContactAcquereur,
  type EntreesRepriseContact,
  type RepriseContactAcquereur,
} from "./repriseContactAcquereur";
import { genererBrouillonEmail } from "./genererBrouillonEmail";
import { assemblerFaits } from "./contexteCommunication";
import { construireIdOpportunite } from "@/lib/opportunites/id";
import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { CompteRenduVisite, Interet } from "@/types/compteRenduVisite";
import type { Compromis } from "@/types/compromis";
import type { EvaluationCritere, ResultatCompatibilite, StatutCompatibilite } from "@/lib/compatibilite/types";
import type { Offre } from "@/types/offre";
import type { Opportunite } from "@/types/opportunite";
import type { Tache } from "@/types/tache";
import type { Visite } from "@/types/visite";

const MAINTENANT = new Date("2026-09-02T09:00:00.000Z");

const ACQUEREUR: ProfilAcquereur = {
  id: "11111111-1111-1111-1111-111111111111",
  prenom: "Camille",
  nom: "Ferrand",
  email: "camille.ferrand@example.test",
  telephone: "0100000001",
  budgetMin: 320_000,
  budgetMax: 420_000,
  criteres: ["Proximité gare"],
  stadeProjet: "recherche_active",
  notes: "Prêt bancaire accordé.",
  datePremiereContact: "2026-07-26",
  piecesMin: 3,
  surfaceMin: 70,
  necessiteParking: true,
  necessiteExterieur: true,
};

const BIEN = { id: "b1", reference: "DEMO-2026-001", adresse: "14 rue des Tilleuls Fictifs" } as Bien;
const BIEN_AUTRE = { id: "b2", reference: "DEMO-2026-002", adresse: "3 allée des Charmes Fictive" } as Bien;

const VISITE_REALISEE: Visite = {
  id: "22222222-2222-2222-2222-222222222222",
  bienId: BIEN.id,
  acquereurId: ACQUEREUR.id,
  datePrevue: "2026-08-31",
  statut: "realisee",
  rendezVousCalendarId: "gcal-1",
  creeLe: "2026-08-28T09:00:00.000Z",
};

function compteRendu(interet: Interet, surcharge: Partial<CompteRenduVisite> = {}): CompteRenduVisite {
  return {
    id: "cr1",
    bienId: BIEN.id,
    acquereurId: ACQUEREUR.id,
    visiteId: VISITE_REALISEE.id,
    dateVisite: VISITE_REALISEE.datePrevue,
    retour: "La cuisine ne lui convenait pas du tout, budget probablement trop juste.",
    interet,
    creeLe: "2026-08-31T18:00:00.000Z",
    ...surcharge,
  };
}

function critere(nom: string, statut: EvaluationCritere["statut"]): EvaluationCritere {
  return { critere: nom, label: nom, statut, explication: `Explication interne pour ${nom}` };
}

function compatibilite(
  bienId: string,
  statutGlobal: StatutCompatibilite,
  criteres: EvaluationCritere[]
): ResultatCompatibilite {
  return { bienId, acquereurId: ACQUEREUR.id, statutGlobal, criteres };
}

const CRITERES_COMPATIBLES = [
  critere("secteur_geographique", "compatible"),
  critere("budget_max", "compatible"),
  critere("pieces_min", "compatible"),
  critere("surface_min", "compatible"),
  critere("parking", "compatible"),
];

function opportuniteMatch(bienId: string): Opportunite {
  return {
    id: construireIdOpportunite("match_a_exploiter", { type: "acquereur", id: ACQUEREUR.id }, bienId),
    type: "match_a_exploiter",
    priorite: "moyenne",
    cible: { type: "acquereur", id: ACQUEREUR.id },
    titre: `Proposer ${bienId} à Camille Ferrand`,
    raison: "Secteur, budget : tous compatibles. Aucune visite n'est enregistrée sur ce rapprochement.",
    action: { libelle: "Voir l'acquéreur", href: `/clients/${ACQUEREUR.id}` },
  };
}

function tache(surcharge: Partial<Tache> = {}): Tache {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    titre: "Rappeler Camille",
    contexte: "Client difficile, financement douteux — insister.",
    type: "relance",
    priorite: "normale",
    origine: "manuelle",
    creeLe: "2026-09-01T09:00:00.000Z",
    ...surcharge,
  };
}

function reprise(surcharge: Partial<EntreesRepriseContact> = {}): RepriseContactAcquereur | undefined {
  return construireRepriseContactAcquereur({
    acquereur: ACQUEREUR,
    visites: [],
    comptesRendus: [],
    offres: [],
    compromis: [],
    compatibilites: [],
    opportunites: [],
    tachesActives: [],
    biens: [BIEN, BIEN_AUTRE],
    maintenant: MAINTENANT,
    ...surcharge,
  });
}

// ---------------------------------------------------------------------------
// Post-visite
// ---------------------------------------------------------------------------

describe("post-visite", () => {
  it("intéressé : reprise proposée avec les faits de visite partageables", () => {
    const r = reprise({ visites: [VISITE_REALISEE], comptesRendus: [compteRendu("interesse")] })!;
    expect(r.motif).toBe("post_visite");
    expect(r.libelle).toBe("Préparer la relance");
    expect(r.raison).toBe("Visite réalisée le 31 août 2026 · intérêt : Intéressé");
    expect(r.intention).toBe("suivi_visite");
    expect(r.faitsPartageables).toEqual({
      bienAdresse: "14 rue des Tilleuls Fictifs",
      dateVisite: "31 août 2026",
      interetVisite: "Intéressé",
    });
    expect(r.href).toBe(`/communications/nouveau?acquereurId=${ACQUEREUR.id}`);
  });

  it("à réfléchir : relance douce, aucun jugement dans la raison ni dans le message", () => {
    const r = reprise({ visites: [VISITE_REALISEE], comptesRendus: [compteRendu("a_reflechir")] })!;
    expect(r.libelle).toBe("Préparer une relance douce");
    expect(r.faitsPartageables!.interetVisite).toBe("À réfléchir");

    const brouillon = genererBrouillonEmail(
      r.intention!,
      assemblerFaits({ type: "acquereur", id: ACQUEREUR.id, nom: "Ferrand", prenom: "Camille" }, r.faitsPartageables!),
      "relance_douce"
    );
    // Les formulations proscrites sont celles qui prêtent une intention ou un reproche au client —
    // pas la formule de politesse « n'hésitez pas à me recontacter », qui n'affirme rien de lui.
    for (const interdit of ["vous hésitez", "pas convaincu", "toujours pas répondu", "n'avez pas répondu"]) {
      expect(brouillon.corps.toLowerCase()).not.toContain(interdit.toLowerCase());
    }
    expect(brouillon.corps).toContain("Suite à votre visite");
  });

  it("pas intéressé : aucune reprise — jamais une relance pour pousser le même bien", () => {
    expect(reprise({ visites: [VISITE_REALISEE], comptesRendus: [compteRendu("pas_interesse")] })).toBeUndefined();
  });

  it("intérêt non précisé : aucune orientation commerciale inventée", () => {
    expect(reprise({ visites: [VISITE_REALISEE], comptesRendus: [compteRendu("inconnu")] })).toBeUndefined();
  });

  it("visite encore planifiée : aucune reprise post-visite", () => {
    expect(
      reprise({ visites: [{ ...VISITE_REALISEE, statut: "planifiee" }], comptesRendus: [compteRendu("interesse")] })
    ).toBeUndefined();
  });

  it("une tâche active existante porte la communication : le chemin tacheId est préféré", () => {
    const r = reprise({
      visites: [VISITE_REALISEE],
      comptesRendus: [compteRendu("interesse")],
      tachesActives: [tache({ acquereurId: ACQUEREUR.id })],
    })!;
    expect(r.href).toBe("/communications/nouveau?tacheId=33333333-3333-3333-3333-333333333333");
    expect(r.tacheId).toBe("33333333-3333-3333-3333-333333333333");
    // Via une tâche, le contexte existant (ADR-031) fait foi : rien n'est reconstruit ici.
    expect(r.faitsPartageables).toBeUndefined();
    expect(r.intention).toBeUndefined();
  });

  it("une tâche non-UUID n'ouvre jamais un chemin de communication mort", () => {
    const r = reprise({
      visites: [VISITE_REALISEE],
      comptesRendus: [compteRendu("interesse")],
      tachesActives: [tache({ id: "demo-tache-1", acquereurId: ACQUEREUR.id })],
    })!;
    expect(r.href).toBe(`/communications/nouveau?acquereurId=${ACQUEREUR.id}`);
  });

  it("absorbe l'opportunité VALUE-01 équivalente : une seule représentation", () => {
    const idAttendu = construireIdOpportunite(
      "suivi_visite",
      { type: "visite", id: VISITE_REALISEE.id },
      "prochaine_etape_absente"
    );
    const opportunite: Opportunite = {
      id: idAttendu,
      type: "suivi_visite",
      priorite: "moyenne",
      cible: { type: "visite", id: VISITE_REALISEE.id },
      titre: "Donner une suite à la visite de Camille Ferrand",
      raison: "Le compte rendu indique un acquéreur intéressé, sans prochaine étape enregistrée.",
      action: { libelle: "Ouvrir la visite", href: `/visites/${VISITE_REALISEE.id}` },
    };
    const r = reprise({
      visites: [VISITE_REALISEE],
      comptesRendus: [compteRendu("interesse")],
      opportunites: [opportunite],
    })!;
    expect(r.opportuniteId).toBe(idAttendu);
  });
});

// ---------------------------------------------------------------------------
// Bien à présenter
// ---------------------------------------------------------------------------

describe("bien compatible à présenter", () => {
  const ENTREES_MATCH = {
    compatibilites: [compatibilite(BIEN.id, "compatible", CRITERES_COMPATIBLES)],
    opportunites: [opportuniteMatch(BIEN.id)],
  };

  it("propose le bien avec deux ou trois critères formulés pour le client", () => {
    const r = reprise(ENTREES_MATCH)!;
    expect(r.motif).toBe("bien_a_presenter");
    expect(r.libelle).toBe("Présenter ce bien");
    expect(r.intention).toBe("suivi_acquereur");
    expect(r.faitsPartageables).toEqual({
      bienAdresse: "14 rue des Tilleuls Fictifs",
      criteresCompatibles: ["le secteur que vous recherchez", "votre budget", "le nombre de pièces"],
    });
  });

  it("la raison vient du moteur VALUE-01, jamais recalculée", () => {
    expect(reprise(ENTREES_MATCH)!.raison).toBe(ENTREES_MATCH.opportunites[0].raison);
  });

  it("le message reste sobre : aucune promesse, aucune probabilité", () => {
    const r = reprise(ENTREES_MATCH)!;
    const brouillon = genererBrouillonEmail(
      r.intention!,
      assemblerFaits({ type: "acquereur", id: ACQUEREUR.id, nom: "Ferrand", prenom: "Camille" }, r.faitsPartageables!),
      "professionnel"
    );
    expect(brouillon.corps).toContain(
      "Ce bien correspond à le secteur que vous recherchez, votre budget, le nombre de pièces."
    );
    for (const interdit of ["parfait", "idéal", "%", "chance", "opportunité à ne pas manquer"]) {
      expect(brouillon.corps.toLowerCase()).not.toContain(interdit);
    }
  });

  it("aucune opportunité VALUE-01 : aucune reprise, même si la compatibilité est bonne", () => {
    // L'absence d'opportunité porte les décisions du moteur (acquéreur non en recherche active, ou
    // tâche absorbante déjà ouverte) — jamais rejouées ici.
    expect(reprise({ compatibilites: ENTREES_MATCH.compatibilites, opportunites: [] })).toBeUndefined();
  });

  it("statut « à vérifier » : jamais un message présentant le bien comme correspondant", () => {
    const r = reprise({
      compatibilites: [
        compatibilite(BIEN.id, "a_verifier", [
          critere("secteur_geographique", "compatible"),
          critere("accessibilite", "a_verifier"),
        ]),
      ],
      opportunites: [opportuniteMatch(BIEN.id)],
    });
    expect(r).toBeUndefined();
  });

  it("une visite existe déjà sur la paire : aucune présentation du même bien", () => {
    expect(reprise({ ...ENTREES_MATCH, visites: [{ ...VISITE_REALISEE, statut: "planifiee" }] })).toBeUndefined();
  });

  it("plusieurs biens compatibles : sélection déterministe et stable", () => {
    const entrees = {
      compatibilites: [
        compatibilite(BIEN_AUTRE.id, "compatible", CRITERES_COMPATIBLES),
        compatibilite(BIEN.id, "compatible", CRITERES_COMPATIBLES),
      ],
      opportunites: [opportuniteMatch(BIEN.id), opportuniteMatch(BIEN_AUTRE.id)],
    };
    expect(reprise(entrees)!.bienId).toBe(BIEN.id);
    expect(reprise(entrees)).toEqual(reprise(entrees));
  });

  it("un critère inconnu du vocabulaire client est ignoré, jamais rendu tel quel", () => {
    const r = reprise({
      compatibilites: [
        compatibilite(BIEN.id, "compatible", [
          critere("critere_futur_inconnu", "compatible"),
          critere("budget_max", "compatible"),
        ]),
      ],
      opportunites: [opportuniteMatch(BIEN.id)],
    })!;
    expect(r.faitsPartageables!.criteresCompatibles).toEqual(["votre budget"]);
  });
});

// ---------------------------------------------------------------------------
// Transaction avancée
// ---------------------------------------------------------------------------

const OFFRE_ACCEPTEE: Offre = {
  id: "44444444-4444-4444-4444-444444444444",
  bienId: BIEN.id,
  acquereurId: ACQUEREUR.id,
  montant: 730_000,
  dateOffre: "2026-08-27",
  statut: "acceptee",
  dateDecision: "2026-08-29",
  creeLe: "2026-08-27T09:00:00.000Z",
};

const COMPROMIS_EN_COURS: Compromis = {
  id: "55555555-5555-5555-5555-555555555555",
  bienId: BIEN.id,
  acquereurId: ACQUEREUR.id,
  prixConvenu: 730_000,
  dateSignature: "2026-08-31",
  dateActe: "2026-11-16",
  statut: "en_cours",
  creeLe: "2026-08-31T09:00:00.000Z",
};

const TACHE_NOTAIRE = tache({
  id: "66666666-6666-6666-6666-666666666666",
  titre: "Confirmer la date de l'acte avec l'étude notariale",
  contexte: "Compromis signé, acte prévu dans deux mois et demi.",
  type: "appel",
  priorite: "haute",
  compromisId: COMPROMIS_EN_COURS.id,
});

describe("transaction avancée", () => {
  it("compromis en cours + tâche ouverte : la communication reprend la tâche existante", () => {
    const r = reprise({ compromis: [COMPROMIS_EN_COURS], tachesActives: [TACHE_NOTAIRE] })!;
    expect(r.motif).toBe("suivi_transaction");
    expect(r.libelle).toBe("Préparer le message");
    expect(r.raison).toBe("Compromis en cours · une tâche de suivi est ouverte");
    expect(r.href).toBe(`/communications/nouveau?tacheId=${TACHE_NOTAIRE.id}`);
    expect(r.faitsPartageables).toBeUndefined();
  });

  it("compromis en cours sans aucune tâche : aucun email inventé", () => {
    expect(reprise({ compromis: [COMPROMIS_EN_COURS] })).toBeUndefined();
  });

  it("offre acceptée : jamais une relance commerciale générique post-visite", () => {
    const r = reprise({
      offres: [OFFRE_ACCEPTEE],
      visites: [VISITE_REALISEE],
      comptesRendus: [compteRendu("interesse")],
    });
    // Aucune tâche : rien à proposer, et surtout pas la relance post-visite du dossier d'avant.
    expect(r).toBeUndefined();
  });

  it("le dossier engagé prime sur la présentation d'un autre bien", () => {
    const r = reprise({
      compromis: [COMPROMIS_EN_COURS],
      tachesActives: [TACHE_NOTAIRE],
      compatibilites: [compatibilite(BIEN_AUTRE.id, "compatible", CRITERES_COMPATIBLES)],
      opportunites: [opportuniteMatch(BIEN_AUTRE.id)],
    })!;
    expect(r.motif).toBe("suivi_transaction");
  });
});

// ---------------------------------------------------------------------------
// Frontière interne / externe
// ---------------------------------------------------------------------------

describe("frontière interne / externe", () => {
  const SENSIBLES = [
    "difficile",
    "douteux",
    "insister",
    "cuisine",
    "trop juste",
    "Explication interne",
    ACQUEREUR.notes,
  ];

  function verifierAucunMotSensible(r: RepriseContactAcquereur) {
    const projection = JSON.stringify(r.faitsPartageables ?? {});
    for (const mot of SENSIBLES) expect(projection.toLowerCase()).not.toContain(mot.toLowerCase());
  }

  it("la note acquéreur n'atteint jamais la projection communicationnelle", () => {
    verifierAucunMotSensible(
      reprise({
        acquereur: { ...ACQUEREUR, notes: "client difficile, financement douteux, insister" },
        visites: [VISITE_REALISEE],
        comptesRendus: [compteRendu("interesse")],
      })!
    );
  });

  it("le contexte libre d'une tâche n'atteint jamais la projection", () => {
    const r = reprise({
      visites: [VISITE_REALISEE],
      comptesRendus: [compteRendu("interesse")],
      tachesActives: [tache({ acquereurId: ACQUEREUR.id, contexte: "financement douteux, insister" })],
    })!;
    verifierAucunMotSensible(r);
    expect(JSON.stringify(r)).not.toContain("douteux");
  });

  it("le retour libre d'un compte rendu ne personnalise jamais le message", () => {
    const r = reprise({ visites: [VISITE_REALISEE], comptesRendus: [compteRendu("interesse")] })!;
    verifierAucunMotSensible(r);
    const brouillon = genererBrouillonEmail(
      r.intention!,
      assemblerFaits({ type: "acquereur", id: ACQUEREUR.id, nom: "Ferrand", prenom: "Camille" }, r.faitsPartageables!),
      "cordial"
    );
    expect(brouillon.corps.toLowerCase()).not.toContain("cuisine");
    expect(brouillon.corps.toLowerCase()).not.toContain("budget probablement");
  });

  it("l'explication interne d'un critère ne sort jamais, seule sa formulation client est utilisée", () => {
    const r = reprise({
      compatibilites: [compatibilite(BIEN.id, "compatible", CRITERES_COMPATIBLES)],
      opportunites: [opportuniteMatch(BIEN.id)],
    })!;
    verifierAucunMotSensible(r);
  });

  it("aucun identifiant technique ne circule dans les faits partageables", () => {
    const r = reprise({ visites: [VISITE_REALISEE], comptesRendus: [compteRendu("interesse")] })!;
    const projection = JSON.stringify(r.faitsPartageables);
    expect(projection).not.toContain(ACQUEREUR.id);
    expect(projection).not.toContain(VISITE_REALISEE.id);
    expect(projection).not.toContain(BIEN.id);
  });
});

// ---------------------------------------------------------------------------
// Absence de motif et déterminisme
// ---------------------------------------------------------------------------

describe("absence de motif", () => {
  it("aucun fait exploitable : aucune reprise proposée", () => {
    expect(reprise()).toBeUndefined();
  });

  it("fiche archivée : jamais sollicitée", () => {
    expect(
      reprise({
        acquereur: { ...ACQUEREUR, archiveLe: "2026-09-01T09:00:00.000Z" },
        visites: [VISITE_REALISEE],
        comptesRendus: [compteRendu("interesse")],
      })
    ).toBeUndefined();
  });

  it("aucune tâche n'est jamais créée pour obtenir un point d'entrée", () => {
    // La fonction est pure : sa seule sortie possible sans tâche est le chemin acquereurId.
    const r = reprise({ visites: [VISITE_REALISEE], comptesRendus: [compteRendu("interesse")] })!;
    expect(r.href).not.toContain("tacheId");
    expect(r.tacheId).toBeUndefined();
  });

  it("faits identiques : sortie strictement identique", () => {
    const entrees = { visites: [VISITE_REALISEE], comptesRendus: [compteRendu("interesse")] };
    expect(reprise(entrees)).toEqual(reprise(entrees));
  });

  it("une communication déjà accomplie et sa tâche terminée ne produisent aucune fausse action", () => {
    // Les tâches terminées ne sont jamais passées en entrée (`tachesActives`) : une tâche close ne
    // peut donc ni porter une reprise, ni en faire naître une.
    const r = reprise({
      compromis: [COMPROMIS_EN_COURS],
      tachesActives: [],
    });
    expect(r).toBeUndefined();
  });
});
