import { describe, expect, it } from "vitest";
import {
  deriverJournalProspectVendeur,
  deriverParcoursProspectVendeur,
  joursDepuisDernierEchange,
} from "./prospectVendeurParcours";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import type { NoteProspectVendeur } from "@/types/noteProspectVendeur";

function prospect(partiel: Partial<ProspectVendeur> = {}): ProspectVendeur {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nom: "Boucher",
    creeLe: "2026-07-14T09:00:00.000Z",
    modifieLe: "2026-07-14T09:00:00.000Z",
    ...partiel,
  };
}

function note(partiel: Partial<NoteProspectVendeur> = {}): NoteProspectVendeur {
  return {
    id: "note-1",
    prospectVendeurId: "11111111-1111-4111-8111-111111111111",
    type: "appel",
    contenu: "Rappel effectué.",
    creeLe: "2026-08-19T09:04:00.000Z",
    ...partiel,
  };
}

describe("deriverParcoursProspectVendeur — ordre réel du code", () => {
  it("expose les six jalons dans l'ordre de deriverStatutProspectVendeur", () => {
    expect(deriverParcoursProspectVendeur(prospect()).map((j) => j.cle)).toEqual([
      "prospect",
      "qualification",
      "rendez_vous",
      "estimation",
      "mandat_propose",
      "mandat_signe",
    ]);
  });

  it("libelle le jalon de rendez-vous « RDV estimation », jamais un passé qui serait faux avant réalisation", () => {
    const jalon = deriverParcoursProspectVendeur(prospect()).find((j) => j.cle === "rendez_vous");
    expect(jalon?.libelle).toBe("RDV estimation");
  });

  it("marque le stade courant et le passé, sans inventer de date pour les jalons futurs", () => {
    const jalons = deriverParcoursProspectVendeur(prospect({ qualifieLe: "2026-07-18T09:00:00.000Z" }));
    const par = Object.fromEntries(jalons.map((j) => [j.cle, j]));

    expect(par.prospect.etat).toBe("passe");
    expect(par.prospect.date).toBe("2026-07-14T09:00:00.000Z");
    expect(par.qualification.etat).toBe("actuel");
    expect(par.estimation.etat).toBe("futur");
    expect(par.estimation.date).toBeUndefined();
    expect(par.mandat_signe.date).toBeUndefined();
  });

  it("affiche une date PRÉVUE sans franchir le jalon", () => {
    const jalons = deriverParcoursProspectVendeur(
      prospect({ qualifieLe: "2026-07-18T09:00:00.000Z", rdvEstimationPrevuLe: "2026-07-29T12:30:00.000Z" })
    );
    const rdv = jalons.find((j) => j.cle === "rendez_vous");
    expect(rdv?.previsionnel).toBe(true);
    expect(rdv?.date).toBe("2026-07-29T12:30:00.000Z");
    expect(rdv?.etat).toBe("futur");
  });

  it("une date réellement tenue franchit le jalon et cesse d'être prévisionnelle", () => {
    const jalons = deriverParcoursProspectVendeur(
      prospect({
        qualifieLe: "2026-07-18T09:00:00.000Z",
        rdvEstimationPrevuLe: "2026-07-29T12:30:00.000Z",
        rdvEstimationRealiseLe: "2026-07-29T14:05:00.000Z",
      })
    );
    const rdv = jalons.find((j) => j.cle === "rendez_vous");
    expect(rdv?.previsionnel).toBe(false);
    expect(rdv?.date).toBe("2026-07-29T14:05:00.000Z");
    expect(rdv?.etat).toBe("actuel");
  });

  it("représente une saisie hors séquence sans la corriger", () => {
    // Estimation chiffrée alors qu'aucun rendez-vous n'a été marqué réalisé : le rail doit montrer
    // le jalon rendez-vous comme non franchi, jamais le combler.
    const jalons = deriverParcoursProspectVendeur(prospect({ estimationProposeeLe: "2026-08-02" }));
    const par = Object.fromEntries(jalons.map((j) => [j.cle, j]));
    expect(par.rendez_vous.etat).toBe("futur");
    expect(par.estimation.etat).toBe("actuel");
  });

  it("mandat signé : les six segments sont franchis, aucun n'est « actuel »", () => {
    // Régression smoke (28/08/2026) : le dernier segment s'affichait en « actuel » (champagne)
    // alors que le pipeline est terminal — le design validé demande un rail entièrement franchi.
    const jalons = deriverParcoursProspectVendeur(
      prospect({
        qualifieLe: "2026-07-16T09:00:00.000Z",
        rdvEstimationRealiseLe: "2026-07-24T10:00:00.000Z",
        estimationProposeeLe: "2026-07-28",
        mandatProposeLe: "2026-08-04T09:00:00.000Z",
        mandatSigneLe: "2026-08-11T09:00:00.000Z",
        bienId: "22222222-2222-4222-8222-222222222222",
      })
    );

    expect(jalons).toHaveLength(6);
    expect(jalons.every((j) => j.etat === "passe")).toBe(true);
    expect(jalons.some((j) => j.etat === "actuel")).toBe(false);
  });

  it("un jalon jamais franchi reste « futur » même après la signature", () => {
    // Saisie hors séquence : le mandat est signé sans qu'un rendez-vous ait été marqué réalisé.
    // Le rail ne doit pas combler rétroactivement un jalon qui n'a jamais eu lieu.
    const jalons = deriverParcoursProspectVendeur(
      prospect({ mandatSigneLe: "2026-08-11T09:00:00.000Z", bienId: "22222222-2222-4222-8222-222222222222" })
    );
    const par = Object.fromEntries(jalons.map((j) => [j.cle, j]));

    expect(par.mandat_signe.etat).toBe("passe");
    expect(par.rendez_vous.etat).toBe("futur");
    expect(par.rendez_vous.date).toBeUndefined();
  });

  it("un prospect perdu n'a aucun jalon « actuel » mais conserve son chemin parcouru", () => {
    const jalons = deriverParcoursProspectVendeur(
      prospect({ qualifieLe: "2026-07-18T09:00:00.000Z", datePerte: "2026-08-06", motifPerte: "injoignable" })
    );
    expect(jalons.some((j) => j.etat === "actuel")).toBe(false);
    expect(jalons.find((j) => j.cle === "qualification")?.etat).toBe("passe");
  });
});

describe("deriverJournalProspectVendeur — fusion jalons + notes", () => {
  it("fusionne les deux sources et trie du plus récent au plus ancien", () => {
    const entrees = deriverJournalProspectVendeur(
      prospect({ qualifieLe: "2026-07-18T09:00:00.000Z", mandatProposeLe: "2026-08-20T09:00:00.000Z" }),
      [note({ creeLe: "2026-08-19T09:04:00.000Z" })]
    );

    expect(entrees.map((e) => (e.genre === "jalon" ? e.cle : "note"))).toEqual([
      "mandat_propose",
      "note",
      "qualification",
      "creation",
    ]);
  });

  it("n'invente aucune entrée pour un jalon sans date", () => {
    const entrees = deriverJournalProspectVendeur(prospect(), []);
    expect(entrees).toHaveLength(1);
    expect(entrees[0]).toMatchObject({ genre: "jalon", cle: "creation" });
  });

  it("distingue une planification d'une réalisation : deux faits réels, deux entrées", () => {
    const entrees = deriverJournalProspectVendeur(
      prospect({
        rdvEstimationPrevuLe: "2026-07-29T12:30:00.000Z",
        rdvEstimationRealiseLe: "2026-07-29T14:05:00.000Z",
      }),
      []
    );
    const cles = entrees.filter((e) => e.genre === "jalon").map((e) => (e.genre === "jalon" ? e.cle : ""));
    expect(cles).toContain("rdv_planifie");
    expect(cles).toContain("rdv_realise");
  });

  it("porte le montant réel de l'estimation, jamais un montant reconstitué", () => {
    const entree = deriverJournalProspectVendeur(
      prospect({ estimationProposeeLe: "2026-08-02", estimationProposeeCentimes: 38_600_000 }),
      []
    ).find((e) => e.genre === "jalon" && e.cle === "estimation");
    expect(entree).toMatchObject({ genre: "jalon", titre: "Estimation enregistrée" });
    expect(entree?.genre === "jalon" && entree.detail).toContain("386");
  });

  it("une estimation sans montant n'affiche aucun détail chiffré", () => {
    const entree = deriverJournalProspectVendeur(prospect({ estimationProposeeLe: "2026-08-02" }), []).find(
      (e) => e.genre === "jalon" && e.cle === "estimation"
    );
    expect(entree?.genre === "jalon" && entree.detail).toBeUndefined();
  });

  it("ne conserve aucune trace d'une valeur de jalon antérieure — ce n'est pas un journal d'audit", () => {
    // Une seule date par jalon existe en base : corriger la date déplace l'entrée, l'ancienne
    // valeur n'est pas retrouvable. Ce test fige cette limite assumée.
    const avant = deriverJournalProspectVendeur(prospect({ qualifieLe: "2026-07-18T09:00:00.000Z" }), []);
    const apres = deriverJournalProspectVendeur(prospect({ qualifieLe: "2026-07-25T09:00:00.000Z" }), []);

    const jalonsQualification = (entrees: typeof avant) =>
      entrees.filter((e) => e.genre === "jalon" && e.cle === "qualification");

    expect(jalonsQualification(avant)).toHaveLength(1);
    expect(jalonsQualification(apres)).toHaveLength(1);
    expect(jalonsQualification(apres)[0].date).toBe("2026-07-25T09:00:00.000Z");
  });

  it("porte le motif réel d'une perte, jamais un motif déduit", () => {
    const entree = deriverJournalProspectVendeur(
      prospect({ datePerte: "2026-08-06", motifPerte: "desaccord_estimation" }),
      []
    ).find((e) => e.genre === "jalon" && e.cle === "perte");
    expect(entree?.genre === "jalon" && entree.detail).toBe("Désaccord sur l'estimation");
  });
});

describe("joursDepuisDernierEchange", () => {
  it("compte depuis dernierContactLe quand il existe", () => {
    const jours = joursDepuisDernierEchange(
      prospect({ dernierContactLe: "2026-08-19T09:00:00.000Z" }),
      new Date("2026-08-28T09:00:00.000Z")
    );
    expect(jours).toBe(9);
  });

  it("retombe sur creeLe pour un prospect jamais contacté — même ancre que le moteur d'inactivité", () => {
    const jours = joursDepuisDernierEchange(prospect(), new Date("2026-07-16T09:00:00.000Z"));
    expect(jours).toBe(2);
  });
});
