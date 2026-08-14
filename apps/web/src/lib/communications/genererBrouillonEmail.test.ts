import { describe, expect, it } from "vitest";
import { genererBrouillonEmail } from "./genererBrouillonEmail";
import type { FaitsCommunication, IntentionCommunication, TonMessage } from "./contexteCommunication";

const TOUTES_INTENTIONS: IntentionCommunication[] = [
  "relance_prospect_vendeur",
  "suivi_rdv_estimation",
  "suivi_acquereur",
  "suivi_visite",
  "demande_document_manquant",
  "relance_piece_a_verifier",
  "message_compromis",
  "message_notaire",
];

const TOUS_TONS: TonMessage[] = ["professionnel", "cordial", "court", "relance_douce"];

describe("genererBrouillonEmail — aucune donnée inventée", () => {
  it("aucun fait absent n'apparaît dans le corps, pour toutes les intentions et tous les tons", () => {
    const faitsVides: FaitsCommunication = {};
    for (const intention of TOUTES_INTENTIONS) {
      for (const ton of TOUS_TONS) {
        const brouillon = genererBrouillonEmail(intention, faitsVides, ton);
        expect(brouillon.corps).not.toMatch(/undefined|null|NaN/);
        expect(brouillon.objet).not.toMatch(/undefined|null|NaN/);
      }
    }
  });

  it("salutation générique sans prénom/nom connu, jamais un nom inventé", () => {
    const brouillon = genererBrouillonEmail("relance_prospect_vendeur", {}, "professionnel");
    expect(brouillon.corps).toContain("Bonjour,");
  });

  it("utilise le prénom quand connu, sinon le nom", () => {
    const avecPrenom = genererBrouillonEmail(
      "suivi_acquereur",
      { destinataireNom: "Martin", destinatairePrenom: "Jean" },
      "professionnel"
    );
    expect(avecPrenom.corps).toContain("Bonjour Jean,");

    const sansPrenom = genererBrouillonEmail("relance_prospect_vendeur", { destinataireNom: "Dupont" }, "professionnel");
    expect(sansPrenom.corps).toContain("Bonjour Dupont,");
  });

  it("intègre uniquement le nom du type de document, jamais son contenu (correction n°4)", () => {
    const brouillon = genererBrouillonEmail(
      "demande_document_manquant",
      { documentLabel: "Pré-état daté" },
      "professionnel"
    );
    expect(brouillon.corps).toContain("Pré-état daté");
    expect(brouillon.corps.length).toBeLessThan(600); // pas de contenu de document intégré
  });

  it("un fait bienAdresse présent apparaît, absent il est omis proprement (pas d'espace réservé)", () => {
    const avecAdresse = genererBrouillonEmail(
      "suivi_visite",
      { bienAdresse: "12 rue de la Paix", dateVisite: "3 mars 2026" },
      "professionnel"
    );
    expect(avecAdresse.corps).toContain("12 rue de la Paix");

    const sansAdresse = genererBrouillonEmail("suivi_visite", { dateVisite: "3 mars 2026" }, "professionnel");
    expect(sansAdresse.corps).not.toContain("undefined");
    expect(sansAdresse.corps).not.toMatch(/\(\s*\)/);
  });

  it("le ton court produit un texte strictement plus court que le ton professionnel", () => {
    const faits: FaitsCommunication = {
      destinataireNom: "Dupont",
      destinatairePrenom: "Sophie",
      documentLabel: "Diagnostic gaz",
      bienAdresse: "12 rue X",
    };
    const court = genererBrouillonEmail("relance_piece_a_verifier", faits, "court");
    const professionnel = genererBrouillonEmail("relance_piece_a_verifier", faits, "professionnel");
    expect(court.corps.length).toBeLessThan(professionnel.corps.length);
  });

  it("message_notaire liste les documents à obtenir uniquement s'ils sont fournis", () => {
    const sansListe = genererBrouillonEmail("message_notaire", { bienAdresse: "12 rue X" }, "professionnel");
    expect(sansListe.corps).not.toContain("restent encore à obtenir");

    const avecListe = genererBrouillonEmail(
      "message_notaire",
      { bienAdresse: "12 rue X", documentsAObtenirNotaire: ["Pré-état daté", "PV AG"] },
      "professionnel"
    );
    expect(avecListe.corps).toContain("Pré-état daté");
    expect(avecListe.corps).toContain("PV AG");
  });

  it("recopie tacheContexte tel quel, jamais réinterprété", () => {
    const brouillon = genererBrouillonEmail(
      "relance_prospect_vendeur",
      { tacheContexte: "Rappel suite à notre échange téléphonique du 2 mars" },
      "professionnel"
    );
    expect(brouillon.corps).toContain("Rappel suite à notre échange téléphonique du 2 mars");
  });

  it("le destinataireEmail transmis se retrouve tel quel dans le brouillon, jamais deviné", () => {
    const avecEmail = genererBrouillonEmail("suivi_acquereur", {}, "professionnel", "jean@test.local");
    expect(avecEmail.destinataireEmail).toBe("jean@test.local");

    const sansEmail = genererBrouillonEmail("suivi_acquereur", {}, "professionnel");
    expect(sansEmail.destinataireEmail).toBeUndefined();
  });
});
