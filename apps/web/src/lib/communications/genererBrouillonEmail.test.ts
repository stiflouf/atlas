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
  "retour_vendeur_apres_visite",
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

  // EMAIL-DEMO-02 — cette attente était l'inverse jusqu'au 1er septembre 2026 (« recopie
  // tacheContexte tel quel »). Le retour terrain a tranché : une note de suivi CRM n'est pas du
  // texte prêt à envoyer. Le test n'est pas assoupli, il est retourné avec la règle métier.
  it("ne recopie jamais la note de suivi interne de la tâche dans le corps", () => {
    const brouillon = genererBrouillonEmail(
      "relance_prospect_vendeur",
      { tacheContexte: "Rappel suite à notre échange téléphonique du 2 mars" },
      "professionnel"
    );
    expect(brouillon.corps).not.toContain("Rappel suite à notre échange téléphonique du 2 mars");
    // La formulation externe neutre prend sa place — jamais un paragraphe manquant.
    expect(brouillon.corps).toContain("Auriez-vous un moment pour échanger sur la suite ?");
  });

  it("aucune intention n'injecte la note interne, quel que soit le ton", () => {
    const NOTE = "vendeur difficile, insister rapidement";
    const faits = {
      tacheContexte: NOTE,
      bienAdresse: "14 rue des Tilleuls",
      dateRdvEstimation: "15 août 2026",
      dateVisite: "10 mars 2026",
      interetVisite: "Intéressé",
      dateActeCompromis: "1 décembre 2026",
      documentLabel: "Pré-état daté",
      mandatPropose: true,
    };
    const intentions = [
      "relance_prospect_vendeur",
      "suivi_rdv_estimation",
      "suivi_acquereur",
      "suivi_visite",
      "demande_document_manquant",
      "relance_piece_a_verifier",
      "message_compromis",
      "message_notaire",
      "retour_vendeur_apres_visite",
    ] as const;
    const tons = ["professionnel", "cordial", "court", "relance_douce"] as const;

    for (const intention of intentions) {
      for (const ton of tons) {
        const brouillon = genererBrouillonEmail(intention, faits, ton);
        expect(brouillon.corps, `${intention} / ${ton}`).not.toContain(NOTE);
        expect(brouillon.corps, `${intention} / ${ton}`).not.toContain("difficile");
      }
    }
  });

  // Cas réel à l'origine du correctif : tâche « Relancer Hélène Vasseur sur la proposition de
  // mandat », dont le contexte interne était « Mandat proposé il y a 6 jours, sans réponse depuis. »
  describe("suivi_rdv_estimation avec proposition de mandat en attente", () => {
    const faitsHelene = {
      destinatairePrenom: "Hélène",
      dateRdvEstimation: "15 août 2026",
      mandatPropose: true,
      tacheContexte: "Mandat proposé il y a 6 jours, sans réponse depuis.",
    };

    it("professionnel : mentionne le rendez-vous, sa date et la proposition de mandat, sans la note interne", () => {
      const { corps } = genererBrouillonEmail("suivi_rdv_estimation", faitsHelene, "professionnel");

      expect(corps).not.toContain("Mandat proposé il y a 6 jours, sans réponse depuis.");
      expect(corps).toContain("Bonjour Hélène,");
      expect(corps).toContain("rendez-vous d'estimation du 15 août 2026");
      expect(corps).toContain("proposition de mandat");
      expect(corps).toContain("Je reste bien entendu disponible");
      expect(corps).toContain("Cordialement,");
    });

    it("relance douce : formulation externe distincte du ton professionnel", () => {
      const doux = genererBrouillonEmail("suivi_rdv_estimation", faitsHelene, "relance_douce").corps;
      const pro = genererBrouillonEmail("suivi_rdv_estimation", faitsHelene, "professionnel").corps;

      expect(doux).not.toContain("Mandat proposé il y a 6 jours, sans réponse depuis.");
      expect(doux).not.toBe(pro);
      expect(doux).toContain("rendez-vous d'estimation du 15 août 2026");
      expect(doux).toContain("Avez-vous eu le temps de réfléchir à notre proposition de mandat ?");
      expect(doux).toContain("Je reste à votre disposition");
    });

    it("sans proposition de mandat : aucune mention de mandat n'est inventée", () => {
      const { corps } = genererBrouillonEmail(
        "suivi_rdv_estimation",
        { destinatairePrenom: "Hélène", dateRdvEstimation: "15 août 2026" },
        "professionnel"
      );

      expect(corps).not.toContain("mandat");
      expect(corps).toContain("je souhaitais faire le point avec vous");
    });
  });

  it("retour_vendeur_apres_visite (ADR-042) : objet contient l'adresse du bien, jamais un nom d'acquéreur", () => {
    const brouillon = genererBrouillonEmail(
      "retour_vendeur_apres_visite",
      { bienAdresse: "5 rue de la Vente", dateVisite: "10 mars 2026", interetVisiteValeur: "interesse" },
      "professionnel"
    );
    expect(brouillon.objet).toBe("Retour de visite — 5 rue de la Vente");
    expect(brouillon.objet).not.toMatch(/[A-Z][a-zé]+ [A-Z][a-zé]+/); // aucun "Prénom Nom" de tiers
  });

  it("retour_vendeur_apres_visite : contenu déterministe distinct par valeur d'intérêt, jamais affirmatif pour inconnu/absent", () => {
    const base: FaitsCommunication = { bienAdresse: "5 rue de la Vente", dateVisite: "10 mars 2026" };

    const interesse = genererBrouillonEmail("retour_vendeur_apres_visite", { ...base, interetVisiteValeur: "interesse" }, "professionnel");
    expect(interesse.corps).toContain("a manifesté son intérêt");

    const aReflechir = genererBrouillonEmail("retour_vendeur_apres_visite", { ...base, interetVisiteValeur: "a_reflechir" }, "professionnel");
    expect(aReflechir.corps).toContain("prendre le temps de réfléchir");

    const pasInteresse = genererBrouillonEmail("retour_vendeur_apres_visite", { ...base, interetVisiteValeur: "pas_interesse" }, "professionnel");
    expect(pasInteresse.corps).toContain("ne souhaite pas donner suite");

    const inconnu = genererBrouillonEmail("retour_vendeur_apres_visite", { ...base, interetVisiteValeur: "inconnu" }, "professionnel");
    expect(inconnu.corps).toContain("n'est pas encore établi");
    expect(inconnu.corps).not.toContain("a manifesté son intérêt");
    expect(inconnu.corps).not.toContain("ne souhaite pas donner suite");

    // interetVisiteValeur absent (défensif, ex. compte rendu introuvable) : même prudence que "inconnu".
    const absent = genererBrouillonEmail("retour_vendeur_apres_visite", base, "professionnel");
    expect(absent.corps).toContain("n'est pas encore établi");
  });

  it("retour_vendeur_apres_visite : jamais retour/prochaineEtape (champs inexistants sur FaitsCommunication, structurellement exclus)", () => {
    // FaitsCommunication ne porte structurellement aucun champ `retour`/`prochaineEtape` — la
    // whitelist est donc garantie par le système de types lui-même, pas seulement par convention.
    // Ce test documente explicitement l'invariant (ADR-042 §31) plutôt que de le supposer.
    const faits: FaitsCommunication = {
      bienAdresse: "5 rue de la Vente",
      dateVisite: "10 mars 2026",
      interetVisiteValeur: "interesse",
      tacheContexte: "[MARQUEUR_NE_DOIT_JAMAIS_SORTIR_SI_NON_ATTENDU]",
    };
    const brouillon = genererBrouillonEmail("retour_vendeur_apres_visite", faits, "professionnel");
    // tacheContexte n'est délibérément pas lu par ce builder (contrairement à d'autres intentions)
    // : le contenu reste entièrement déterministe, jamais un texte libre injecté.
    expect(brouillon.corps).not.toContain("MARQUEUR_NE_DOIT_JAMAIS_SORTIR");
  });

  it("le destinataireEmail transmis se retrouve tel quel dans le brouillon, jamais deviné", () => {
    const avecEmail = genererBrouillonEmail("suivi_acquereur", {}, "professionnel", "jean@test.local");
    expect(avecEmail.destinataireEmail).toBe("jean@test.local");

    const sansEmail = genererBrouillonEmail("suivi_acquereur", {}, "professionnel");
    expect(sansEmail.destinataireEmail).toBeUndefined();
  });
});
