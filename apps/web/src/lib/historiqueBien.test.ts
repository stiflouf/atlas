import { describe, expect, it } from "vitest";
import type { Bien } from "@/types/bien";
import type { Tache } from "@/types/tache";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import type { Offre } from "@/types/offre";
import type { Compromis } from "@/types/compromis";
import { formatMontantCentimes, type Remuneration } from "@/types/remuneration";
import { deriverHistoriqueBien } from "./historiqueBien";

// Réplique le formatage de historiqueBien.ts (Intl.NumberFormat produit des espaces insécables
// spéciales, pas des espaces classiques — comparer via ce même formateur plutôt qu'une chaîne
// littérale codée en dur évite un faux échec dépendant de l'environnement ICU).
function formatPrix(montant: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    montant
  );
}

function bienTest(surcharge: Partial<Bien> = {}): Bien {
  return {
    id: "bien-test",
    reference: "TEST-001",
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
    ...surcharge,
  };
}

function tacheTest(surcharge: Partial<Tache> = {}): Tache {
  return {
    id: "tache-test",
    titre: "Tâche de test",
    priorite: "normale",
    type: "autre",
    origine: "manuelle",
    creeLe: "2026-08-01T10:00:00.000Z",
    ...surcharge,
  };
}

describe("deriverHistoriqueBien", () => {
  it("ne produit aucun événement pour un bien mocké sans creeLe et sans tâche", () => {
    expect(deriverHistoriqueBien(bienTest({ creeLe: undefined }), [])).toEqual([]);
  });

  it("produit « Bien créé » à partir de bien.creeLe", () => {
    const evenements = deriverHistoriqueBien(bienTest({ creeLe: "2026-01-05T09:00:00.000Z" }), []);
    expect(evenements).toEqual([{ date: "2026-01-05T09:00:00.000Z", texte: "Bien créé" }]);
  });

  it("produit « Tâche créée » à partir de tache.creeLe", () => {
    const tache = tacheTest({ titre: "Relancer les Dubois" });
    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [tache]);
    expect(evenements).toEqual([{ date: tache.creeLe, texte: "Tâche créée : Relancer les Dubois" }]);
  });

  it("produit aussi « Tâche terminée » quand la tâche est terminée", () => {
    const tache = tacheTest({
      titre: "Relire le compromis",
      termineeLe: "2026-08-05T14:00:00.000Z",
    });
    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [tache]);

    expect(evenements).toEqual([
      { date: "2026-08-05T14:00:00.000Z", texte: "Tâche terminée : Relire le compromis" },
      { date: "2026-08-01T10:00:00.000Z", texte: "Tâche créée : Relire le compromis" },
    ]);
  });

  it("produit aussi « Tâche annulée » quand la tâche est annulée", () => {
    const tache = tacheTest({
      titre: "Envoyer un devis",
      annuleeLe: "2026-08-06T09:00:00.000Z",
    });
    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [tache]);

    expect(evenements).toEqual([
      { date: "2026-08-06T09:00:00.000Z", texte: "Tâche annulée : Envoyer un devis" },
      { date: "2026-08-01T10:00:00.000Z", texte: "Tâche créée : Envoyer un devis" },
    ]);
  });

  it("trie tous les événements par date décroissante", () => {
    const bien = bienTest({ creeLe: "2026-01-01T00:00:00.000Z" });
    const tache = tacheTest({
      titre: "Envoyer les diagnostics",
      creeLe: "2026-06-01T00:00:00.000Z",
      termineeLe: "2026-07-01T00:00:00.000Z",
    });

    const evenements = deriverHistoriqueBien(bien, [tache]);

    expect(evenements.map((e) => e.date)).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("produit « Visite effectuée — {label} » sans jamais inclure le texte du retour", () => {
    const compteRendu: CompteRenduVisite = {
      id: "cr-1",
      bienId: "bien-test",
      acquereurId: "acquereur-test",
      dateVisite: "2026-08-03",
      retour: "Texte libre confidentiel qui ne doit jamais apparaître dans l'historique.",
      interet: "interesse",
      creeLe: "2026-08-03T18:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [], [compteRendu]);

    expect(evenements).toEqual([{ date: "2026-08-03", texte: "Visite effectuée — Intéressé" }]);
  });

  it("inclut toutes les visites du bien, quel que soit l'acquéreur", () => {
    const visiteA: CompteRenduVisite = {
      id: "cr-a",
      bienId: "bien-test",
      acquereurId: "acquereur-a",
      dateVisite: "2026-08-01",
      retour: "Retour A",
      interet: "pas_interesse",
      creeLe: "2026-08-01T10:00:00.000Z",
    };
    const visiteB: CompteRenduVisite = {
      id: "cr-b",
      bienId: "bien-test",
      acquereurId: "acquereur-b",
      dateVisite: "2026-08-05",
      retour: "Retour B",
      interet: "a_reflechir",
      creeLe: "2026-08-05T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [], [visiteA, visiteB]);

    expect(evenements.map((e) => e.texte)).toEqual([
      "Visite effectuée — À réfléchir",
      "Visite effectuée — Pas intéressé",
    ]);
  });

  it("produit « Offre en cours » et « Compromis signé » à partir des jalons du bien", () => {
    const bien = bienTest({
      creeLe: undefined,
      offreEnCoursLe: "2026-08-01T10:00:00.000Z",
      compromisSigneLe: "2026-08-10T10:00:00.000Z",
    });

    const evenements = deriverHistoriqueBien(bien, []);

    expect(evenements).toEqual([
      { date: "2026-08-10T10:00:00.000Z", texte: "Compromis signé" },
      { date: "2026-08-01T10:00:00.000Z", texte: "Offre en cours" },
    ]);
  });

  it("ne produit « Compromis signé » sans « Offre en cours » que si le compromis a été marqué directement", () => {
    const bien = bienTest({ creeLe: undefined, compromisSigneLe: "2026-08-10T10:00:00.000Z" });

    const evenements = deriverHistoriqueBien(bien, []);

    expect(evenements).toEqual([{ date: "2026-08-10T10:00:00.000Z", texte: "Compromis signé" }]);
  });

  it("produit « Offre reçue — {montant} » à partir d'une offre, sans jamais nommer l'acquéreur", () => {
    const offre: Offre = {
      id: "offre-1",
      bienId: "bien-test",
      acquereurId: "acquereur-confidentiel",
      montant: 480000,
      dateOffre: "2026-08-01",
      statut: "en_cours",
      creeLe: "2026-08-01T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [], [], [offre]);

    expect(evenements).toEqual([{ date: "2026-08-01", texte: `Offre reçue — ${formatPrix(480000)}` }]);
    expect(evenements.some((e) => e.texte.includes("acquereur-confidentiel"))).toBe(false);
  });

  it("ne produit aucun événement pour un changement de statut d'offre (pas de date de transition fiable)", () => {
    const offreAcceptee: Offre = {
      id: "offre-2",
      bienId: "bien-test",
      acquereurId: "acquereur-test",
      montant: 500000,
      dateOffre: "2026-08-01",
      statut: "acceptee",
      creeLe: "2026-08-01T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [], [], [offreAcceptee]);

    expect(evenements).toEqual([{ date: "2026-08-01", texte: `Offre reçue — ${formatPrix(500000)}` }]);
  });

  it("inclut toutes les offres du bien, triées avec le reste des événements", () => {
    const offreA: Offre = {
      id: "offre-a",
      bienId: "bien-test",
      acquereurId: "acquereur-a",
      montant: 400000,
      dateOffre: "2026-08-01",
      statut: "en_cours",
      creeLe: "2026-08-01T10:00:00.000Z",
    };
    const offreB: Offre = {
      id: "offre-b",
      bienId: "bien-test",
      acquereurId: "acquereur-b",
      montant: 420000,
      dateOffre: "2026-08-05",
      statut: "en_cours",
      creeLe: "2026-08-05T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [], [], [offreA, offreB]);

    expect(evenements.map((e) => e.texte)).toEqual([
      `Offre reçue — ${formatPrix(420000)}`,
      `Offre reçue — ${formatPrix(400000)}`,
    ]);
  });

  it("produit « Compromis structuré — {prix} » à partir d'un compromis, sans jamais nommer l'acquéreur", () => {
    const c: Compromis = {
      id: "compromis-1",
      bienId: "bien-test",
      acquereurId: "acquereur-confidentiel",
      prixConvenu: 480000,
      dateSignature: "2026-08-05",
      statut: "en_cours",
      creeLe: "2026-08-05T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [], [], [], [c]);

    expect(evenements).toEqual([{ date: "2026-08-05", texte: `Compromis structuré — ${formatPrix(480000)}` }]);
    expect(evenements.some((e) => e.texte.includes("acquereur-confidentiel"))).toBe(false);
  });

  it("ne produit pas « Vente finalisée » pour un compromis realise sans dateActeReelle (garde défensive)", () => {
    const c: Compromis = {
      id: "compromis-2",
      bienId: "bien-test",
      acquereurId: "acquereur-test",
      prixConvenu: 500000,
      dateSignature: "2026-08-05",
      statut: "realise",
      creeLe: "2026-08-05T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [], [], [], [c]);

    expect(evenements).toEqual([{ date: "2026-08-05", texte: `Compromis structuré — ${formatPrix(500000)}` }]);
  });

  it("produit « Vente finalisée — {prix} » daté par dateActeReelle quand le compromis est realise avec une date réelle", () => {
    const c: Compromis = {
      id: "compromis-vendu",
      bienId: "bien-test",
      acquereurId: "acquereur-confidentiel",
      prixConvenu: 495000,
      dateSignature: "2026-08-05",
      dateActe: "2026-10-01",
      dateActeReelle: "2026-10-08",
      statut: "realise",
      creeLe: "2026-08-05T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [], [], [], [c]);

    expect(evenements).toEqual([
      { date: "2026-10-08", texte: `Vente finalisée — ${formatPrix(495000)}` },
      { date: "2026-08-05", texte: `Compromis structuré — ${formatPrix(495000)}` },
    ]);
    expect(evenements.some((e) => e.texte.includes("acquereur-confidentiel"))).toBe(false);
  });

  it("distingue « Compromis structuré » (entité détaillée) de « Compromis signé » (jalon générique ADR-014) quand les deux coexistent", () => {
    const bien = bienTest({ creeLe: undefined, compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const c: Compromis = {
      id: "compromis-3",
      bienId: "bien-test",
      acquereurId: "acquereur-test",
      prixConvenu: 500000,
      dateSignature: "2026-08-05",
      statut: "en_cours",
      creeLe: "2026-08-05T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bien, [], [], [], [c]);

    expect(evenements.map((e) => e.texte)).toEqual(
      expect.arrayContaining(["Compromis signé", `Compromis structuré — ${formatPrix(500000)}`])
    );
    expect(evenements).toHaveLength(2);
  });

  it("distingue les trois événements liés au compromis quand ils coexistent tous : générique ADR-014, création, vente finalisée", () => {
    const bien = bienTest({ creeLe: undefined, compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const c: Compromis = {
      id: "compromis-4",
      bienId: "bien-test",
      acquereurId: "acquereur-test",
      prixConvenu: 500000,
      dateSignature: "2026-08-05",
      dateActeReelle: "2026-10-08",
      statut: "realise",
      creeLe: "2026-08-05T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bien, [], [], [], [c]);

    expect(evenements.map((e) => e.texte)).toEqual(
      expect.arrayContaining([
        "Compromis signé",
        `Compromis structuré — ${formatPrix(500000)}`,
        `Vente finalisée — ${formatPrix(500000)}`,
      ])
    );
    expect(evenements).toHaveLength(3);
  });

  it("ne produit aucun événement pour une rémunération sans dateEncaissementReelle (prévisionnelle, pas encore un fait acquis, ADR-021)", () => {
    const c: Compromis = {
      id: "compromis-remuneration-1",
      bienId: "bien-test",
      acquereurId: "acquereur-test",
      prixConvenu: 300000,
      dateSignature: "2026-08-05",
      statut: "en_cours",
      creeLe: "2026-08-05T10:00:00.000Z",
    };
    const r: Remuneration = {
      id: "remuneration-1",
      compromisId: "compromis-remuneration-1",
      montantRemunerationConseillerCentimes: 1000000,
      creeLe: "2026-08-05T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [], [], [], [c], [r]);

    expect(evenements).toEqual([{ date: "2026-08-05", texte: `Compromis structuré — ${formatPrix(300000)}` }]);
  });

  it("produit « Rémunération encaissée — {montant} » daté par dateEncaissementReelle (ADR-021)", () => {
    const c: Compromis = {
      id: "compromis-remuneration-2",
      bienId: "bien-test",
      acquereurId: "acquereur-test",
      prixConvenu: 300000,
      dateSignature: "2026-08-05",
      dateActeReelle: "2026-10-08",
      statut: "realise",
      creeLe: "2026-08-05T10:00:00.000Z",
    };
    const r: Remuneration = {
      id: "remuneration-2",
      compromisId: "compromis-remuneration-2",
      montantRemunerationConseillerCentimes: 1248736,
      dateEncaissementReelle: "2026-10-20",
      creeLe: "2026-08-05T10:00:00.000Z",
    };

    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [], [], [], [c], [r]);

    expect(evenements[0]).toEqual({
      date: "2026-10-20",
      texte: `Rémunération encaissée — ${formatMontantCentimes(1248736)}`,
    });
  });
});
