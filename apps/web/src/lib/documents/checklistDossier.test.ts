import { describe, expect, it } from "vitest";
import { calculerChecklistDossier } from "./checklistDossier";
import type { Bien } from "@/types/bien";
import type { Compromis } from "@/types/compromis";
import type { DocumentBien } from "@/types/documentBien";
import type { ProspectVendeur } from "@/types/prospectVendeur";

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

describe("calculerChecklistDossier", () => {
  it("exigence copropriété non_applicable si biens.nomCopropriete est absent", () => {
    const resultat = calculerChecklistDossier({ bien: creerBien() }, [], MAINTENANT);
    const reglement = resultat.exigences.find((e) => e.code === "copropriete_reglement");
    expect(reglement?.etat).toBe("non_applicable");
  });

  it("exigence copropriété manquante si nomCopropriete renseigné mais aucun document", () => {
    const resultat = calculerChecklistDossier(
      { bien: creerBien({ nomCopropriete: "Résidence A" }) },
      [],
      MAINTENANT
    );
    const reglement = resultat.exigences.find((e) => e.code === "copropriete_reglement");
    expect(reglement?.etat).toBe("manquant");
  });

  it("exigence copropriété présente si le document correspondant existe", () => {
    const bien = creerBien({ nomCopropriete: "Résidence A" });
    const doc = creerDocument({ bienId: bien.id, typeDocument: "reglement_copropriete", etatVerification: "confirme" });
    const resultat = calculerChecklistDossier({ bien }, [doc], MAINTENANT);
    const reglement = resultat.exigences.find((e) => e.code === "copropriete_reglement");
    expect(reglement?.etat).toBe("present");
    expect(reglement?.document?.id).toBe(doc.id);
  });

  it("diagnostic sans dateFinValidite -> a_verifier (validité inconnue, jamais présumée)", () => {
    const bien = creerBien();
    const doc = creerDocument({ typeDocument: "dpe", etatVerification: "confirme" });
    const resultat = calculerChecklistDossier({ bien }, [doc], MAINTENANT);
    expect(resultat.exigences.find((e) => e.code === "diagnostic_dpe")?.etat).toBe("a_verifier");
  });

  it("diagnostic avec dateFinValidite dépassée -> perime", () => {
    const bien = creerBien();
    const doc = creerDocument({ typeDocument: "dpe", dateFinValidite: "2026-01-01", etatVerification: "confirme" });
    const resultat = calculerChecklistDossier({ bien }, [doc], MAINTENANT);
    expect(resultat.exigences.find((e) => e.code === "diagnostic_dpe")?.etat).toBe("perime");
  });

  it("diagnostic avec dateFinValidite future -> present", () => {
    const bien = creerBien();
    const doc = creerDocument({ typeDocument: "dpe", dateFinValidite: "2027-01-01", etatVerification: "confirme" });
    const resultat = calculerChecklistDossier({ bien }, [doc], MAINTENANT);
    expect(resultat.exigences.find((e) => e.code === "diagnostic_dpe")?.etat).toBe("present");
  });

  it("document etatVerification=rejete -> incoherent, même avec une validité par ailleurs correcte", () => {
    const bien = creerBien();
    const doc = creerDocument({ typeDocument: "dpe", dateFinValidite: "2027-01-01", etatVerification: "rejete" });
    const resultat = calculerChecklistDossier({ bien }, [doc], MAINTENANT);
    expect(resultat.exigences.find((e) => e.code === "diagnostic_dpe")?.etat).toBe("incoherent");
  });

  it("document etatVerification=a_verifier (hors diagnostic) -> exigence a_verifier", () => {
    const bien = creerBien();
    const doc = creerDocument({ typeDocument: "titre_propriete", etatVerification: "a_verifier" });
    const resultat = calculerChecklistDossier({ bien }, [doc], MAINTENANT);
    expect(resultat.exigences.find((e) => e.code === "bien_titre_propriete")?.etat).toBe("a_verifier");
  });

  it("un document non_verifie (défaut) satisfait une exigence sans suivi de validité", () => {
    const bien = creerBien();
    const doc = creerDocument({ typeDocument: "titre_propriete" });
    const resultat = calculerChecklistDossier({ bien }, [doc], MAINTENANT);
    expect(resultat.exigences.find((e) => e.code === "bien_titre_propriete")?.etat).toBe("present");
  });

  it("exigence parties_cni_acquereur non applicable sans compromis, manquante avec compromis sans CNI", () => {
    const bien = creerBien();
    const sansCompromis = calculerChecklistDossier({ bien }, [], MAINTENANT);
    expect(sansCompromis.exigences.find((e) => e.code === "parties_cni_acquereur")?.etat).toBe("non_applicable");

    const compromisActuel = creerCompromis();
    const avecCompromis = calculerChecklistDossier({ bien, compromisActuel }, [], MAINTENANT);
    expect(avecCompromis.exigences.find((e) => e.code === "parties_cni_acquereur")?.etat).toBe("manquant");
  });

  it("parties_cni_acquereur ne compte que la CNI du bon acquéreur (cohérence du rattachement)", () => {
    const bien = creerBien();
    const compromisActuel = creerCompromis({ acquereurId: "acquereur-1" });
    const cniAutreAcquereur = creerDocument({ typeDocument: "cni", acquereurId: "acquereur-2" });
    const resultatMauvais = calculerChecklistDossier({ bien, compromisActuel }, [cniAutreAcquereur], MAINTENANT);
    expect(resultatMauvais.exigences.find((e) => e.code === "parties_cni_acquereur")?.etat).toBe("manquant");

    const cniBonAcquereur = creerDocument({ typeDocument: "cni", acquereurId: "acquereur-1" });
    const resultatBon = calculerChecklistDossier({ bien, compromisActuel }, [cniBonAcquereur], MAINTENANT);
    expect(resultatBon.exigences.find((e) => e.code === "parties_cni_acquereur")?.etat).toBe("present");
  });

  it("parties_cni_vendeur utilise le prospect vendeur d'origine", () => {
    const bien = creerBien();
    const prospectVendeurOrigine = creerProspectVendeur();
    const cni = creerDocument({ typeDocument: "cni", prospectVendeurId: prospectVendeurOrigine.id });
    const resultat = calculerChecklistDossier({ bien, prospectVendeurOrigine }, [cni], MAINTENANT);
    expect(resultat.exigences.find((e) => e.code === "parties_cni_vendeur")?.etat).toBe("present");
  });

  it("choisit le document le plus récent (dateDocument) parmi plusieurs candidats", () => {
    const bien = creerBien();
    const ancien = creerDocument({ typeDocument: "titre_propriete", dateDocument: "2025-01-01" });
    const recent = creerDocument({ typeDocument: "titre_propriete", dateDocument: "2026-01-01" });
    const resultat = calculerChecklistDossier({ bien }, [ancien, recent], MAINTENANT);
    expect(resultat.exigences.find((e) => e.code === "bien_titre_propriete")?.document?.id).toBe(recent.id);
  });

  it("PV AG : décompte dérivé, jamais un booléen, limité aux 3 plus récents", () => {
    const bien = creerBien();
    const pv2023 = creerDocument({ typeDocument: "pv_ag", dateDocument: "2023-06-01" });
    const pv2024 = creerDocument({ typeDocument: "pv_ag", dateDocument: "2024-06-01" });
    const pv2025 = creerDocument({ typeDocument: "pv_ag", dateDocument: "2025-06-01" });
    const pv2026 = creerDocument({ typeDocument: "pv_ag", dateDocument: "2026-06-01" });
    const resultat = calculerChecklistDossier({ bien }, [pv2023, pv2024, pv2025, pv2026], MAINTENANT);
    expect(resultat.pvAg.attendus).toBe(3);
    expect(resultat.pvAg.presents.map((d) => d.id)).toEqual([pv2026.id, pv2025.id, pv2024.id]);
  });

  it("PV AG rejeté n'est jamais compté comme présent", () => {
    const bien = creerBien();
    const rejete = creerDocument({ typeDocument: "pv_ag", dateDocument: "2026-06-01", etatVerification: "rejete" });
    const resultat = calculerChecklistDossier({ bien }, [rejete], MAINTENANT);
    expect(resultat.pvAg.presents).toHaveLength(0);
  });

  it("honorairesRenseignes reflète biens.chargeHonoraires, jamais une valeur par défaut", () => {
    expect(calculerChecklistDossier({ bien: creerBien() }, [], MAINTENANT).honorairesRenseignes).toBe(false);
    expect(
      calculerChecklistDossier({ bien: creerBien({ chargeHonoraires: "vendeur" }) }, [], MAINTENANT)
        .honorairesRenseignes
    ).toBe(true);
  });
});
