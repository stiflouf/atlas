import { describe, expect, it } from "vitest";
import { BASES_LEGALES, DOCUMENT_SIGNATURE_CONSENT, estBaseLegale } from "./basesLegales";
import {
  CONTROLLER_MODEL,
  DESTINATAIRES_V1,
  FINALITES_V1,
  INFORMATION_ARTICLE_13,
  INFORMATION_ARTICLE_14,
  MARKETING_B2C_EMAIL_POLICY,
  PRIVACY_NOTICE_VERSION,
  PUBLIC_PRIVACY_PAGE_ENABLED,
  SHORT_NOTICE_AT_BON_VISITE_ENABLED,
  blocagesPublicationNotice,
  decisionsPrivacyVersionnees,
} from "./politiqueConfidentialite";
import {
  POLITIQUES_CONSERVATION_V1,
  RETENTION_ENFORCEMENT_V1_LIVRE,
  politiqueConservation,
  politiquesConservationIndecises,
} from "./conservation";
import { INTERETS_LEGITIMES_V1, LIA_STATUS, interetLegitime } from "./interetLegitime";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — ces tests verrouillent des DÉCISIONS, pas un
// comportement technique. Leur rôle n'est pas de prouver que du code fonctionne : c'est d'empêcher
// qu'une décision de confidentialité soit modifiée par inadvertance, en particulier celles qui
// auraient l'air d'être des simplifications (« mettre consentement comme base du bon de visite »,
// « donner une durée au texte libre »).

describe("T13 — version des décisions privacy", () => {
  it("la version est exactement domiora-privacy-v1", () => {
    expect(PRIVACY_NOTICE_VERSION).toBe("domiora-privacy-v1");
    expect(decisionsPrivacyVersionnees().version).toBe("domiora-privacy-v1");
  });

  it("le modèle de responsabilité est porté par le workspace, jamais par DOMIORA", () => {
    expect(CONTROLLER_MODEL).toBe("WORKSPACE_LEGAL_CONTROLLER");
    // Aucune finalité, aucun destinataire ne désigne DOMIORA comme responsable.
    const serialise = JSON.stringify(decisionsPrivacyVersionnees());
    expect(serialise).not.toMatch(/DOMIORA_IS_GDPR_COMPLIANT/);
    expect(serialise).not.toMatch(/responsable[^"]*DOMIORA/i);
  });
});

describe("T14 / T15 — une finalité, une base juridique", () => {
  it("aucune finalité n'est sans base juridique", () => {
    expect(FINALITES_V1.length).toBeGreaterThan(0);
    for (const finalite of FINALITES_V1) {
      expect(finalite.baseLegale, finalite.cle).toBeDefined();
      expect(estBaseLegale(finalite.baseLegale), finalite.cle).toBe(true);
    }
  });

  it("aucune finalité ne porte plusieurs bases : le champ est scalaire par construction", () => {
    for (const finalite of FINALITES_V1) {
      expect(Array.isArray(finalite.baseLegale), finalite.cle).toBe(false);
      expect(typeof finalite.baseLegale, finalite.cle).toBe("string");
    }
  });

  it("les finalités ont des clés uniques", () => {
    const cles = FINALITES_V1.map((finalite) => finalite.cle);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it("chaque finalité est rattachée à une preuve dans le produit", () => {
    for (const finalite of FINALITES_V1) {
      expect(finalite.preuveProduit.length, finalite.cle).toBeGreaterThan(0);
    }
  });

  it("toute finalité fondée sur l'intérêt légitime nomme son intérêt, et réciproquement", () => {
    for (const finalite of FINALITES_V1) {
      if (finalite.baseLegale === "LEGITIMATE_INTEREST") {
        expect(finalite.interetLegitimeCle, finalite.cle).toBeDefined();
        expect(interetLegitime(finalite.interetLegitimeCle as string), finalite.cle).toBeDefined();
      } else {
        expect(finalite.interetLegitimeCle, finalite.cle).toBeUndefined();
      }
    }
  });

  it("toute obligation légale nomme sa sous-finalité, et jamais l'inverse", () => {
    for (const finalite of FINALITES_V1) {
      if (finalite.baseLegale === "LEGAL_OBLIGATION") {
        // La garde de DECISION_2 B : « obligation légale » seule est refusée.
        expect(finalite.sousFinaliteObligationLegale, finalite.cle).toBeTruthy();
        expect((finalite.sousFinaliteObligationLegale as string).length, finalite.cle).toBeGreaterThan(30);
      } else {
        expect(finalite.sousFinaliteObligationLegale, finalite.cle).toBeUndefined();
      }
    }
  });

  it("chaque finalité pointe une politique de conservation existante", () => {
    for (const finalite of FINALITES_V1) {
      expect(politiqueConservation(finalite.politiqueConservationCle), finalite.cle).toBeDefined();
    }
  });

  it("aucune finalité V1 n'est fondée sur le consentement", () => {
    // Le produit ne collecte aucun consentement RGPD : une finalité qui s'en prévaudrait
    // s'appuierait sur une preuve inexistante.
    expect(FINALITES_V1.filter((finalite) => finalite.baseLegale === "CONSENT")).toEqual([]);
  });
});

describe("T17 / T18 — bon de visite", () => {
  const bonVisite = FINALITES_V1.find((finalite) => finalite.cle === "BON_VISITE_PREUVE_INTERVENTION");

  it("la finalité existe et repose sur l'intérêt légitime", () => {
    expect(bonVisite).toBeDefined();
    expect(bonVisite?.baseLegale).toBe("LEGITIMATE_INTEREST");
  });

  it("elle n'est ni fondée sur le consentement, ni sur une obligation légale générique", () => {
    expect(bonVisite?.baseLegale).not.toBe("CONSENT");
    expect(bonVisite?.baseLegale).not.toBe("LEGAL_OBLIGATION");
    expect(bonVisite?.sousFinaliteObligationLegale).toBeUndefined();
  });

  it("l'intérêt poursuivi couvre la réalité de la visite et la défense de droits", () => {
    const interet = interetLegitime("BON_VISITE_EVIDENCE");
    expect(interet).toBeDefined();
    expect(interet?.interetPoursuivi).toMatch(/réalité de la visite/i);
    expect(interet?.interetPoursuivi).toMatch(/défense de droits/i);
  });

  it("DOCUMENT_SIGNATURE_CONSENT est distinct de toute base juridique", () => {
    // La garantie centrale de la DECISION_2 D : la case de signature n'est pas assignable à un
    // champ de base légale, et ne figure pas dans le vocabulaire fermé.
    expect(DOCUMENT_SIGNATURE_CONSENT).toBe("DOCUMENT_SIGNATURE_CONSENT");
    expect(estBaseLegale(DOCUMENT_SIGNATURE_CONSENT)).toBe(false);
    expect(BASES_LEGALES as readonly string[]).not.toContain(DOCUMENT_SIGNATURE_CONSENT);
    expect(BASES_LEGALES as readonly string[]).not.toContain("DOCUMENT_SIGNATURE_CONSENT");
  });
});

describe("T16 — prospection commerciale électronique B2C", () => {
  it("la politique est explicitement non supportée sans consentement", () => {
    expect(MARKETING_B2C_EMAIL_POLICY).toBe("NOT_SUPPORTED_WITHOUT_MARKETING_CONSENT");
  });

  it("aucune finalité de prospection commerciale électronique ne figure dans la matrice", () => {
    const suspectes = FINALITES_V1.filter((finalite) => /PROSPECTION|MARKETING/i.test(finalite.cle));
    expect(suspectes).toEqual([]);
  });

  it("aucune finalité ne prétend détenir un consentement marketing", () => {
    const serialise = JSON.stringify(FINALITES_V1);
    expect(serialise).not.toMatch(/marketing_consent|opt_in|consent_at/i);
  });
});

describe("T19 / T20 / T21 — conservation", () => {
  it("T19 — la conservation prospect est de 3 ans, depuis la collecte ou le dernier contact entrant", () => {
    const prospect = politiqueConservation("PROSPECT_MARKETING");
    expect(prospect?.statut).toBe("DECIDEE");
    if (prospect?.statut !== "DECIDEE") throw new Error("politique prospect indécise");
    expect(prospect.regles).toHaveLength(2);
    for (const regle of prospect.regles) {
      expect(regle.duree).toEqual({ unite: "ANNEES", valeur: 3 });
      expect(regle.phase).toBe("ACTIVE");
    }
    expect(prospect.regles.map((regle) => regle.declencheur)).toEqual([
      "COLLECTED_AT",
      "LAST_INBOUND_CONTACT_AT",
    ]);
  });

  it("la conservation client après la relation est de 3 ans depuis sa fin", () => {
    const client = politiqueConservation("CUSTOMER_MARKETING");
    if (client?.statut !== "DECIDEE") throw new Error("politique client indécise");
    expect(client.regles[0].duree).toEqual({ unite: "ANNEES", valeur: 3 });
    expect(client.regles[0].declencheur).toBe("RELATIONSHIP_END_AT");
  });

  it("T20 — le bon de visite signé est conservé 5 ans depuis la signature, en archive probatoire", () => {
    const bon = politiqueConservation("SIGNED_VISIT_FORM");
    if (bon?.statut !== "DECIDEE") throw new Error("politique bon de visite indécise");
    expect(bon.regles).toHaveLength(1);
    expect(bon.regles[0].duree).toEqual({ unite: "ANNEES", valeur: 5 });
    expect(bon.regles[0].declencheur).toBe("SIGNED_AT");
    expect(bon.regles[0].phase).toBe("ARCHIVE_PROBATOIRE");
    expect(bon.legalHoldApplicable).toBe(true);
  });

  it("les 5 ans sont qualifiés de politique probatoire, jamais de durée légale spéciale", () => {
    const bon = politiqueConservation("SIGNED_VISIT_FORM");
    if (bon?.statut !== "DECIDEE") throw new Error("politique bon de visite indécise");
    expect(bon.justification).toMatch(/politique de conservation probatoire retenue par DOMIORA/i);
    expect(bon.justification).toMatch(/PAS une durée légale obligatoire spéciale/i);
  });

  it("session 7 jours et état OIDC 10 minutes reflètent le comportement existant", () => {
    const session = politiqueConservation("SESSION");
    const etat = politiqueConservation("OIDC_STATE");
    if (session?.statut !== "DECIDEE" || etat?.statut !== "DECIDEE") throw new Error("politiques indécises");
    expect(session.regles[0].duree).toEqual({ unite: "JOURS", valeur: 7 });
    expect(etat.regles[0].duree).toEqual({ unite: "MINUTES", valeur: 10 });
  });

  it("la connexion Google court jusqu'à déconnexion ou révocation, sans échéance fixe", () => {
    const google = politiqueConservation("GOOGLE_CONNECTION");
    if (google?.statut !== "DECIDEE") throw new Error("politique Google indécise");
    expect(google.regles[0].duree.unite).toBe("JUSQU_A_EVENEMENT");
    expect(google.regles[0].declencheur).toBe("DISCONNECT_OR_REVOCATION");
  });

  it("T21 — les catégories non tranchées restent explicitement UNDECIDED, avec un motif", () => {
    const indecises = politiquesConservationIndecises();
    expect(indecises.map((politique) => politique.cle).sort()).toEqual([
      "ACTIVE_CLIENT_OR_PROJECT_DATA",
      "FREE_TEXT_NOTES",
      "TRANSACTION_DOCUMENTS",
    ]);
    for (const politique of indecises) {
      if (politique.statut !== "UNDECIDED") throw new Error("statut inattendu");
      expect(politique.raisonIndecision.length, politique.cle).toBeGreaterThan(40);
    }
  });

  it("aucune politique indécise ne porte de durée : rien n'est inventé", () => {
    for (const politique of politiquesConservationIndecises()) {
      expect(politique).not.toHaveProperty("regles");
    }
  });

  it("le texte libre ne reçoit aucune archive probatoire par défaut", () => {
    const texteLibre = politiqueConservation("FREE_TEXT_NOTES");
    expect(texteLibre?.statut).toBe("UNDECIDED");
  });

  it("l'application des durées n'est pas livrée, et le dit", () => {
    expect(RETENTION_ENFORCEMENT_V1_LIVRE).toBe(false);
  });

  it("les clés de politique sont uniques", () => {
    const cles = POLITIQUES_CONSERVATION_V1.map((politique) => politique.cle);
    expect(new Set(cles).size).toBe(cles.length);
  });
});

describe("T22 — aucune publication activée dans ce lot", () => {
  it("la page publique de confidentialité est désactivée", () => {
    expect(PUBLIC_PRIVACY_PAGE_ENABLED).toBe(false);
  });

  it("la notice courte du bon de visite est désactivée", () => {
    expect(SHORT_NOTICE_AT_BON_VISITE_ENABLED).toBe(false);
  });

  it("les blocages de publication sont nommés, dont l'absence d'application des durées", () => {
    const blocages = blocagesPublicationNotice();
    expect(blocages.map((blocage) => blocage.cle)).toContain("RETENTION_ENFORCEMENT_V1_ABSENT");
    expect(blocages.map((blocage) => blocage.cle)).toContain("POLITIQUES_CONSERVATION_UNDECIDED");
  });

  it("la remise des informations Article 13 et Article 14 n'est pas implémentée", () => {
    expect(INFORMATION_ARTICLE_13.statutLivraison).toBe("NOT_IMPLEMENTED");
    expect(INFORMATION_ARTICLE_14.statutLivraison).toBe("NOT_IMPLEMENTED");
  });
});

describe("structure Article 13 / Article 14", () => {
  it("Article 13 vise la collecte directe, et le bon de visite est son seul point identifié", () => {
    expect(INFORMATION_ARTICLE_13.pointsDeCollecte).toEqual(["BON_VISITE_SIGNATURE"]);
    expect(INFORMATION_ARTICLE_13.moment).toMatch(/avant la saisie et la signature/i);
  });

  it("Article 14 vise les données non collectées auprès de la personne, tiers d'agenda compris", () => {
    expect(INFORMATION_ARTICLE_14.pointsDeCollecte).toContain("TIERS_INCIDENTS_DE_L_AGENDA");
    expect(INFORMATION_ARTICLE_14.pointsDeCollecte).toContain("CONTACT_CREE_PAR_LE_CONSEILLER");
    expect(INFORMATION_ARTICLE_14.moment).toMatch(/première communication/i);
  });
});

describe("intérêt légitime : intérêt nommé, balance non prétendue", () => {
  it("chaque intérêt documenté reste marqué comme balance à documenter", () => {
    expect(INTERETS_LEGITIMES_V1.length).toBeGreaterThan(0);
    for (const interet of INTERETS_LEGITIMES_V1) {
      expect(interet.liaStatus, interet.cle).toBe(LIA_STATUS);
      expect(LIA_STATUS).toBe("TO_BE_DOCUMENTED");
    }
  });

  it("chaque intérêt dit ce qui serait perdu sans le traitement", () => {
    for (const interet of INTERETS_LEGITIMES_V1) {
      expect(interet.consequenceSansTraitement.length, interet.cle).toBeGreaterThan(30);
    }
  });
});

describe("destinataires et prestataires", () => {
  it("la qualification juridique de chaque tiers reste à valider", () => {
    for (const destinataire of DESTINATAIRES_V1) {
      expect(destinataire.qualificationJuridique, destinataire.cle).toBe("TO_VALIDATE");
    }
  });

  it("le service de reformulation de texte est déclaré inactif en production", () => {
    const reformulation = DESTINATAIRES_V1.find((d) => d.cle === "SERVICE_REFORMULATION_TEXTE");
    expect(reformulation?.actifEnProduction).toBe(false);
  });
});
