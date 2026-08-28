import { describe, expect, it } from "vitest";
import { deriverProchaineEtape } from "./prospectVendeurProchaineEtape";
import { deriverStatutProspectVendeur, type ProspectVendeur } from "@/types/prospectVendeur";

function prospect(partiel: Partial<ProspectVendeur> = {}): ProspectVendeur {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nom: "Boucher",
    creeLe: "2026-07-14T09:00:00.000Z",
    modifieLe: "2026-07-14T09:00:00.000Z",
    ...partiel,
  };
}

describe("deriverProchaineEtape — mapping stade -> action", () => {
  it("prospect : qualifier", () => {
    const p = prospect();
    expect(deriverStatutProspectVendeur(p)).toBe("prospect");
    expect(deriverProchaineEtape(p)).toEqual({ action: "qualifier", titre: "Qualifier le prospect" });
  });

  it("qualification : marquer le rendez-vous réalisé, avec appui de planification si aucune date prévue", () => {
    const p = prospect({ qualifieLe: "2026-07-18T09:00:00.000Z" });
    expect(deriverStatutProspectVendeur(p)).toBe("qualification");
    expect(deriverProchaineEtape(p)).toEqual({
      action: "marquer_rdv_realise",
      titre: "Marquer le rendez-vous d'estimation réalisé",
      appui: "planifier_rdv",
    });
  });

  it("qualification avec rendez-vous déjà prévu : aucun appui de planification", () => {
    const p = prospect({
      qualifieLe: "2026-07-18T09:00:00.000Z",
      rdvEstimationPrevuLe: "2026-07-29T12:30:00.000Z",
    });
    expect(deriverProchaineEtape(p)?.appui).toBeUndefined();
  });

  it("rendez_vous : enregistrer l'estimation", () => {
    const p = prospect({
      qualifieLe: "2026-07-18T09:00:00.000Z",
      rdvEstimationRealiseLe: "2026-07-29T12:30:00.000Z",
    });
    expect(deriverStatutProspectVendeur(p)).toBe("rendez_vous");
    expect(deriverProchaineEtape(p)).toEqual({ action: "enregistrer_estimation", titre: "Enregistrer l'estimation" });
  });

  it("estimation : proposer le mandat, avec appui de mise à jour de l'estimation", () => {
    const p = prospect({ estimationProposeeLe: "2026-08-02", estimationProposeeCentimes: 38_600_000 });
    expect(deriverStatutProspectVendeur(p)).toBe("estimation");
    expect(deriverProchaineEtape(p)).toEqual({
      action: "proposer_mandat",
      titre: "Marquer le mandat comme proposé",
      appui: "mettre_a_jour_estimation",
    });
  });

  it("mandat_propose : signer le mandat", () => {
    const p = prospect({ mandatProposeLe: "2026-08-20T09:00:00.000Z" });
    expect(deriverStatutProspectVendeur(p)).toBe("mandat_propose");
    expect(deriverProchaineEtape(p)).toEqual({ action: "signer_mandat", titre: "Signer le mandat et créer le bien" });
  });

  it("mandat_signe : aucune transition", () => {
    const p = prospect({
      mandatSigneLe: "2026-08-11T09:00:00.000Z",
      bienId: "22222222-2222-4222-8222-222222222222",
    });
    expect(deriverStatutProspectVendeur(p)).toBe("mandat_signe");
    expect(deriverProchaineEtape(p)).toBeUndefined();
  });

  it("perdu : aucune transition, y compris depuis un stade avancé", () => {
    const p = prospect({
      mandatProposeLe: "2026-08-04T09:00:00.000Z",
      datePerte: "2026-08-06",
      motifPerte: "choix_agence_concurrente",
    });
    expect(deriverStatutProspectVendeur(p)).toBe("perdu");
    expect(deriverProchaineEtape(p)).toBeUndefined();
  });
});

describe("deriverProchaineEtape — aucun jalon futur proposé au mauvais stade", () => {
  // Le défaut corrigé par la proposition 2 : « Signer le mandat » ne doit jamais être l'action
  // dominante d'un prospect qui vient d'être créé.
  it("un prospect neuf ne se voit jamais proposer la signature du mandat", () => {
    expect(deriverProchaineEtape(prospect())?.action).toBe("qualifier");
  });

  it("aucun stade intermédiaire ne propose la signature", () => {
    const stadesIntermediaires: Partial<ProspectVendeur>[] = [
      {},
      { qualifieLe: "2026-07-18T09:00:00.000Z" },
      { qualifieLe: "2026-07-18T09:00:00.000Z", rdvEstimationRealiseLe: "2026-07-29T12:30:00.000Z" },
      { estimationProposeeLe: "2026-08-02" },
    ];
    for (const partiel of stadesIntermediaires) {
      expect(deriverProchaineEtape(prospect(partiel))?.action).not.toBe("signer_mandat");
    }
  });

  it("la saisie hors séquence reste représentée : une estimation sans rendez-vous réalisé mène au mandat", () => {
    // ADR-027 : aucune séquence n'est imposée à la saisie ; la cascade teste estimationProposeeLe
    // AVANT rdvEstimationRealiseLe, une estimation chiffrée est donc le stade le plus avancé.
    const p = prospect({ estimationProposeeLe: "2026-08-02" });
    expect(deriverStatutProspectVendeur(p)).toBe("estimation");
    expect(deriverProchaineEtape(p)?.action).toBe("proposer_mandat");
  });
});
