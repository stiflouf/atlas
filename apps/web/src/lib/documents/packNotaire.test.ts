import { describe, expect, it } from "vitest";
import {
  calculerPackNotaire,
  genererManifestePackNotaire,
  genererNomExport,
  type ContextePackNotaire,
} from "./packNotaire";
import type { Bien } from "@/types/bien";
import type { Compromis } from "@/types/compromis";
import type { DocumentBien } from "@/types/documentBien";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import type { ProfilAcquereur } from "@/types/client";

function creerBien(overrides: Partial<Bien> = {}): Bien {
  return {
    id: "bien-1",
    reference: "REF-1",
    titre: "Appartement test",
    type: "appartement",
    adresse: "1 rue Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 3,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...overrides,
  };
}

function creerCompromis(overrides: Partial<Compromis> = {}): Compromis {
  return {
    id: "compromis-1",
    bienId: "bien-1",
    acquereurId: "acquereur-1",
    prixConvenu: 300000,
    dateSignature: "2026-02-01",
    statut: "en_cours",
    creeLe: "2026-02-01T10:00:00.000Z",
    ...overrides,
  };
}

function creerProspectVendeur(overrides: Partial<ProspectVendeur> = {}): ProspectVendeur {
  return {
    id: "prospect-1",
    nom: "Dupont",
    bienId: "bien-1",
    creeLe: "2026-01-01T10:00:00.000Z",
    modifieLe: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

function creerAcquereur(overrides: Partial<ProfilAcquereur> = {}): ProfilAcquereur {
  return {
    id: "acquereur-1",
    prenom: "Jean",
    nom: "Martin",
    email: "jean@test.local",
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte",
    notes: "",
    datePremiereContact: "2026-01-01",
    ...overrides,
  };
}

let compteur = 0;
function creerDocument(overrides: Partial<DocumentBien> = {}): DocumentBien {
  compteur += 1;
  return {
    id: `doc-${compteur}`,
    bienId: "bien-1",
    nom: `Document ${compteur}`,
    categorie: "autre",
    nomFichierOriginal: "fichier.pdf",
    cleStockage: `cle-${compteur}`,
    tailleOctets: 1024,
    typeMime: "application/pdf",
    creeLe: "2026-01-10T10:00:00.000Z",
    etatVerification: "non_verifie",
    ...overrides,
  };
}

const MAINTENANT = new Date("2026-06-01T00:00:00.000Z");
const compromisActuel = creerCompromis();
const prospectVendeurOrigine = creerProspectVendeur();
const acquereur = creerAcquereur();

describe("calculerPackNotaire — sévérités", () => {
  it("une exigence manquante produit a_obtenir, jamais bloquant_technique", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [], MAINTENANT);
    const constat = pack.constats.find((c) => c.code.startsWith("manquant_bien_titre_propriete"));
    expect(constat?.severite).toBe("a_obtenir");
    expect(pack.documentsInterdits).toHaveLength(0);
  });

  it("un diagnostic périmé produit un constat factuel a_verifier, jamais une conclusion juridique", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({
      bienId: bien.id,
      typeDocument: "dpe",
      dateFinValidite: "2026-01-01",
      etatVerification: "confirme",
    });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    const constat = pack.constats.find((c) => c.code === "perime_diagnostic_dpe");
    expect(constat?.severite).toBe("a_verifier");
    expect(constat?.message).toContain("date de fin de validité");
    expect(constat?.message).not.toMatch(/impossible|interdit/i);
    expect(pack.documentsInterdits.map((d) => d.id)).not.toContain(doc.id);
  });

  it("une exigence incoherente (document rejete) produit bloquant_technique et exclut le document", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, typeDocument: "titre_propriete", etatVerification: "rejete" });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.documentsInterdits.map((d) => d.id)).toContain(doc.id);
    expect(pack.constats.some((c) => c.severite === "bloquant_technique" && c.documentId === doc.id)).toBe(true);
  });

  it("honoraires non renseignés produit a_obtenir, jamais bloquant", () => {
    const bien = creerBien();
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [], MAINTENANT);
    const constat = pack.constats.find((c) => c.code === "honoraires_non_renseignes");
    expect(constat?.severite).toBe("a_obtenir");
  });

  it("PV AG incomplet uniquement signalé si une copropriété est renseignée", () => {
    const sansCopro = calculerPackNotaire(
      { bien: creerBien({ chargeHonoraires: "vendeur" }), compromisActuel, prospectVendeurOrigine, acquereur },
      [],
      MAINTENANT
    );
    expect(sansCopro.constats.some((c) => c.code === "copropriete_pv_ag_incomplet")).toBe(false);

    const avecCopro = calculerPackNotaire(
      {
        bien: creerBien({ chargeHonoraires: "vendeur", nomCopropriete: "Résidence A" }),
        compromisActuel,
        prospectVendeurOrigine,
        acquereur,
      },
      [],
      MAINTENANT
    );
    const constat = avecCopro.constats.find((c) => c.code === "copropriete_pv_ag_incomplet");
    expect(constat?.severite).toBe("a_obtenir");
  });
});

describe("calculerPackNotaire — anti-mauvais-dossier", () => {
  it("compromisId différent du compromis courant -> bloquant_technique, document interdit", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, compromisId: "compromis-autre" });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.documentsInterdits.map((d) => d.id)).toContain(doc.id);
    expect(pack.constats.some((c) => c.code === `contradiction_compromis_${doc.id}`)).toBe(true);
  });

  it("compromisId renseigné mais aucun compromis courant -> a_verifier, jamais interdit (correction n°2)", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, compromisId: "compromis-quelconque" });
    const pack = calculerPackNotaire({ bien, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.documentsInterdits.map((d) => d.id)).not.toContain(doc.id);
    const constat = pack.constats.find((c) => c.code === `contexte_compromis_indisponible_${doc.id}`);
    expect(constat?.severite).toBe("a_verifier");
  });

  it("acquereurId différent de celui du compromis courant -> bloquant_technique", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, acquereurId: "acquereur-autre" });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.documentsInterdits.map((d) => d.id)).toContain(doc.id);
  });

  it("acquereurId renseigné sans compromis courant -> a_verifier, jamais interdit", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, acquereurId: "acquereur-1" });
    const pack = calculerPackNotaire({ bien, prospectVendeurOrigine }, [doc], MAINTENANT);
    expect(pack.documentsInterdits.map((d) => d.id)).not.toContain(doc.id);
    expect(pack.constats.find((c) => c.code === `contexte_acquereur_indisponible_${doc.id}`)?.severite).toBe(
      "a_verifier"
    );
  });

  it("prospectVendeurId différent du contact vendeur principal -> bloquant_technique", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, prospectVendeurId: "prospect-autre" });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.documentsInterdits.map((d) => d.id)).toContain(doc.id);
  });

  it("prospectVendeurId renseigné sans contact vendeur principal -> a_verifier, jamais interdit (correction n°4)", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, prospectVendeurId: "prospect-quelconque" });
    const pack = calculerPackNotaire({ bien, compromisActuel, acquereur }, [doc], MAINTENANT);
    expect(pack.documentsInterdits.map((d) => d.id)).not.toContain(doc.id);
    const constat = pack.constats.find((c) => c.code === `contexte_prospect_vendeur_indisponible_${doc.id}`);
    expect(constat?.severite).toBe("a_verifier");
  });

  it("divergence copropriete/adresse déclarée reste a_verifier, jamais bloquant_technique", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur", nomCopropriete: "Résidence A" });
    const doc = creerDocument({ bienId: bien.id, coproprieteDeclaree: "Résidence B", adresseDeclaree: "9 avenue Ailleurs" });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.documentsInterdits.map((d) => d.id)).not.toContain(doc.id);
    expect(pack.constats.filter((c) => c.documentId === doc.id).every((c) => c.severite === "a_verifier")).toBe(true);
  });
});

describe("calculerPackNotaire — sélection proposée vs disponible", () => {
  it("confirme + present -> sélection proposée automatique", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, typeDocument: "titre_propriete", etatVerification: "confirme" });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.selectionProposee.map((d) => d.id)).toContain(doc.id);
  });

  it("present + non_verifie (défaut à l'upload) n'est jamais auto-sélectionné", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, typeDocument: "titre_propriete", etatVerification: "non_verifie" });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.selectionProposee.map((d) => d.id)).not.toContain(doc.id);
    expect(pack.documentsDisponibles.map((d) => d.id)).toContain(doc.id);
  });

  it("état checklist a_verifier n'est jamais auto-sélectionné, même confirme", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, typeDocument: "dpe", etatVerification: "confirme" }); // pas de dateFinValidite -> a_verifier
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.selectionProposee.map((d) => d.id)).not.toContain(doc.id);
    expect(pack.documentsDisponibles.map((d) => d.id)).toContain(doc.id);
  });

  it("un document rejete n'apparaît ni en sélection proposée ni en disponible", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, typeDocument: "titre_propriete", etatVerification: "rejete" });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.selectionProposee.map((d) => d.id)).not.toContain(doc.id);
    expect(pack.documentsDisponibles.map((d) => d.id)).not.toContain(doc.id);
    expect(pack.documentsInterdits.map((d) => d.id)).toContain(doc.id);
  });
});

describe("calculerPackNotaire — état de préparation", () => {
  it("sans compromis courant -> contexte_transactionnel_incomplet, jamais un verdict de complétude", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur", nomCopropriete: undefined });
    const pack = calculerPackNotaire({ bien, prospectVendeurOrigine, acquereur }, [], MAINTENANT);
    expect(pack.etatPreparation).toBe("contexte_transactionnel_incomplet");
  });

  it("avec compromis courant et un document interdit -> elements_bloquants", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const doc = creerDocument({ bienId: bien.id, etatVerification: "rejete" });
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [doc], MAINTENANT);
    expect(pack.etatPreparation).toBe("elements_bloquants");
  });

  it("avec compromis courant, sans interdit, avec un a_obtenir restant -> elements_a_traiter", () => {
    const bien = creerBien(); // chargeHonoraires non renseigné -> a_obtenir
    const pack = calculerPackNotaire({ bien, compromisActuel, prospectVendeurOrigine, acquereur }, [], MAINTENANT);
    expect(pack.etatPreparation).toBe("elements_a_traiter");
  });
});

describe("genererNomExport", () => {
  it("préfixe séquentiel à deux chiffres", () => {
    const bien = creerBien();
    const doc = creerDocument({ bienId: bien.id, typeDocument: "titre_propriete", typeMime: "application/pdf" });
    expect(genererNomExport(doc, 0, { bien })).toMatch(/^01_/);
    expect(genererNomExport(doc, 8, { bien })).toMatch(/^09_/);
  });

  it("CNI vendeur inclut le nom du contact vendeur principal", () => {
    const bien = creerBien();
    const doc = creerDocument({
      bienId: bien.id,
      typeDocument: "cni",
      prospectVendeurId: prospectVendeurOrigine.id,
      typeMime: "application/pdf",
    });
    const nom = genererNomExport(doc, 0, { bien, prospectVendeurOrigine });
    expect(nom).toContain("Vendeur");
    expect(nom).toContain("Dupont");
  });

  it("CNI acquéreur inclut le nom de l'acquéreur enregistré", () => {
    const bien = creerBien();
    const doc = creerDocument({
      bienId: bien.id,
      typeDocument: "cni",
      acquereurId: acquereur.id,
      typeMime: "application/pdf",
    });
    const nom = genererNomExport(doc, 0, { bien, acquereur });
    expect(nom).toContain("Acquereur");
    expect(nom).toContain("Martin");
  });

  it("PV AG inclut l'année uniquement si dateDocument est renseignée, jamais un repli sur creeLe", () => {
    const bien = creerBien();
    const avecDate = creerDocument({
      bienId: bien.id,
      typeDocument: "pv_ag",
      dateDocument: "2026-06-01",
      creeLe: "2027-01-01T00:00:00.000Z",
      typeMime: "application/pdf",
    });
    expect(genererNomExport(avecDate, 0, { bien })).toContain("2026");
    expect(genererNomExport(avecDate, 0, { bien })).not.toContain("2027");

    const sansDate = creerDocument({ bienId: bien.id, typeDocument: "pv_ag", typeMime: "application/pdf" });
    const nomSansDate = genererNomExport(sansDate, 0, { bien });
    expect(nomSansDate).not.toMatch(/20\d{2}/);
  });

  it("sans typeDocument, replie sur le nom saisi assaini", () => {
    const bien = creerBien();
    const doc = creerDocument({ bienId: bien.id, nom: "Plan étage 2", typeMime: "application/pdf" });
    const nom = genererNomExport(doc, 0, { bien });
    expect(nom).toBe("01_Plan_etage_2.pdf");
  });
});

describe("genererManifestePackNotaire", () => {
  it("utilise un wording prudent, jamais 'Vendeur'/'Acquéreur' seuls", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const ctx: ContextePackNotaire = { bien, compromisActuel, prospectVendeurOrigine, acquereur };
    const pack = calculerPackNotaire(ctx, [], MAINTENANT);
    const manifeste = genererManifestePackNotaire(ctx, pack, []);
    expect(manifeste).toContain("Contact vendeur principal : Dupont");
    expect(manifeste).toContain("Acquéreur enregistré : Jean Martin");
    expect(manifeste).not.toMatch(/^Vendeur :/m);
    expect(manifeste).not.toMatch(/^Acquéreur :/m);
  });

  it("n'invente jamais une donnée absente", () => {
    const bien = creerBien();
    const ctx: ContextePackNotaire = { bien };
    const pack = calculerPackNotaire(ctx, [], MAINTENANT);
    const manifeste = genererManifestePackNotaire(ctx, pack, []);
    expect(manifeste).toContain("Contact vendeur principal : non renseigné");
    expect(manifeste).toContain("Acquéreur enregistré : non renseigné");
    expect(manifeste).toContain("Charge des honoraires : non renseignée");
  });

  it("liste les documents inclus et les constats restants", () => {
    const bien = creerBien({ chargeHonoraires: "vendeur" });
    const ctx: ContextePackNotaire = { bien, compromisActuel, prospectVendeurOrigine, acquereur };
    const doc = creerDocument({ bienId: bien.id, typeDocument: "titre_propriete", etatVerification: "confirme" });
    const pack = calculerPackNotaire(ctx, [doc], MAINTENANT);
    const manifeste = genererManifestePackNotaire(ctx, pack, [doc]);
    expect(manifeste).toContain("Documents inclus (1)");
    expect(manifeste).toContain("01_Titre_de_propriete.pdf");
  });
});
