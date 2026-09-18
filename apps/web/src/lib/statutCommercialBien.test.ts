import { describe, expect, it } from "vitest";
import type { Bien } from "@/types/bien";
import type { Compromis } from "@/types/compromis";
import { statutCommercialBienEffectif } from "./statutCommercialBien";
import type { Offre } from "@/types/offre";

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

function compromisTest(surcharge: Partial<Compromis> = {}): Compromis {
  return {
    id: "compromis-test",
    bienId: "bien-test",
    acquereurId: "acquereur-test",
    prixConvenu: 300000,
    dateSignature: "2026-08-01",
    statut: "en_cours",
    creeLe: "2026-08-01T10:00:00.000Z",
    ...surcharge,
  };
}

describe("statutCommercialBienEffectif — jalons legacy et compromis structurés", () => {
  it("retourne en_commercialisation par défaut, sans jalon ni compromis", () => {
    expect(statutCommercialBienEffectif(bienTest(), [], [])).toBe("en_commercialisation");
  });

  it("retourne offre_en_cours quand offreEnCoursLe est posé", () => {
    const bien = bienTest({ offreEnCoursLe: "2026-08-01T10:00:00.000Z" });
    expect(statutCommercialBienEffectif(bien, [], [])).toBe("offre_en_cours");
  });

  it("retourne compromis_signe quand compromisSigneLe est posé", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    expect(statutCommercialBienEffectif(bien, [], [])).toBe("compromis_signe");
  });

  it("retourne vendu quand un compromis realise avec dateActeReelle existe, prioritaire sur compromis_signe", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const compromis = [compromisTest({ statut: "realise", dateActeReelle: "2026-10-08" })];

    expect(statutCommercialBienEffectif(bien, [], compromis)).toBe("vendu");
  });

  it("ne retourne jamais vendu si le compromis realise n'a pas de dateActeReelle (garde défensive)", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const compromis = [compromisTest({ statut: "realise", dateActeReelle: undefined })];

    expect(statutCommercialBienEffectif(bien, [], compromis)).toBe("compromis_signe");
  });

  it("ignore les compromis en_cours ou annule pour la dérivation de vendu", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const compromis = [
      compromisTest({ id: "c1", statut: "en_cours" }),
      compromisTest({ id: "c2", statut: "annule", dateActeReelle: undefined }),
    ];

    expect(statutCommercialBienEffectif(bien, [], compromis)).toBe("compromis_signe");
  });

  // ADR-046 — le modèle structuré (compromisListe) devient prioritaire sur le jalon legacy
  // bien.compromisSigneLe pour "compromis_signe", dès qu'un compromis structuré existe pour ce
  // bien : voir les 5 tests suivants, qui couvrent précisément la matrice legacy/structuré.

  it("legacy seul : aucun compromis structuré, jalon renseigné -> compromis_signe (compatibilité anciens dossiers)", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    expect(statutCommercialBienEffectif(bien, [], [])).toBe("compromis_signe");
  });

  it("structuré en_cours, jalon legacy absent -> compromis_signe (source structurée seule suffit)", () => {
    const bien = bienTest({ compromisSigneLe: undefined });
    const compromis = [compromisTest({ statut: "en_cours" })];
    expect(statutCommercialBienEffectif(bien, [], compromis)).toBe("compromis_signe");
  });

  it("structuré annulé + jalon legacy stale -> jamais compromis_signe (test de régression principal ADR-046)", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const compromis = [compromisTest({ statut: "annule", dateAnnulation: "2026-08-10", motifAnnulation: "desaccord_prix" })];
    expect(statutCommercialBienEffectif(bien, [], compromis)).not.toBe("compromis_signe");
    expect(statutCommercialBienEffectif(bien, [], compromis)).toBe("en_commercialisation");
  });

  it("structuré annulé + jalon legacy stale + offreEnCoursLe posé -> retombe sur offre_en_cours, pas compromis_signe", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z", offreEnCoursLe: "2026-08-01T10:00:00.000Z" });
    const compromis = [compromisTest({ statut: "annule", dateAnnulation: "2026-08-10", motifAnnulation: "desaccord_prix" })];
    expect(statutCommercialBienEffectif(bien, [], compromis)).toBe("offre_en_cours");
  });

  it("structuré realise + dateActeReelle -> vendu, quel que soit le jalon legacy (aucune régression)", () => {
    const bienAvecJalon = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const bienSansJalon = bienTest({ compromisSigneLe: undefined });
    const compromis = [compromisTest({ statut: "realise", dateActeReelle: "2026-10-08" })];
    expect(statutCommercialBienEffectif(bienAvecJalon, [], compromis)).toBe("vendu");
    expect(statutCommercialBienEffectif(bienSansJalon, [], compromis)).toBe("vendu");
  });

  it("plusieurs compromis historiques annulés, jalon stale -> jamais compromis_signe (pas seulement le plus récent)", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const compromis = [
      compromisTest({ id: "c1", statut: "annule", dateAnnulation: "2026-05-01", motifAnnulation: "desaccord_prix" }),
      compromisTest({ id: "c2", statut: "annule", dateAnnulation: "2026-07-01", motifAnnulation: "financement_refuse" }),
    ];
    expect(statutCommercialBienEffectif(bien, [], compromis)).not.toBe("compromis_signe");
  });
});

// ADR-061 §10 — précédence Offre canonique > jalon legacy, par ENTITÉ : dès qu'une offre canonique
// existe (quel que soit son statut), `biens.offre_en_cours_le` n'est plus lu ; `offre_acceptee`
// s'intercale entre compromis et offre en cours.
function offreTest(surcharge: Partial<Offre> = {}): Offre {
  return {
    id: "offre-test",
    bienId: "bien-test",
    acquereurId: "acquereur-test",
    montant: 300000,
    dateOffre: "2026-08-01",
    statut: "en_cours",
    creeLe: "2026-08-01T10:00:00.000Z",
    ...surcharge,
  };
}

describe("statutCommercialBienEffectif — offres canoniques (ADR-061)", () => {
  it("A. aucune offre canonique + jalon legacy posé -> offre_en_cours (legacy-only)", () => {
    expect(statutCommercialBienEffectif(bienTest({ offreEnCoursLe: "2026-08-01T10:00:00.000Z" }), [], [])).toBe("offre_en_cours");
  });

  it("B. offre canonique en_cours -> offre_en_cours, jalon legacy ignoré", () => {
    expect(statutCommercialBienEffectif(bienTest(), [offreTest()], [])).toBe("offre_en_cours");
  });

  it("C. offre acceptee -> offre_acceptee (jamais offre_en_cours), même avec d'autres offres en cours", () => {
    expect(statutCommercialBienEffectif(bienTest(), [offreTest({ statut: "acceptee" })], [])).toBe("offre_acceptee");
    expect(statutCommercialBienEffectif(bienTest(), [offreTest({ id: "o1", statut: "acceptee" }), offreTest({ id: "o2" })], [])).toBe("offre_acceptee");
  });

  it("D. canonique finale (refusee / retiree / caduque) + jalon legacy posé -> en_commercialisation, JAMAIS offre_en_cours", () => {
    const bien = bienTest({ offreEnCoursLe: "2026-08-01T10:00:00.000Z" });
    for (const statut of ["refusee", "retiree", "caduque"] as const) {
      expect(statutCommercialBienEffectif(bien, [offreTest({ statut })], []), statut).toBe("en_commercialisation");
    }
  });

  it("E. compromis non annulé > offre acceptée ; vendu > tout", () => {
    const offres = [offreTest({ statut: "acceptee" })];
    expect(statutCommercialBienEffectif(bienTest(), offres, [compromisTest({ statut: "en_cours" })])).toBe("compromis_signe");
    expect(statutCommercialBienEffectif(bienTest(), offres, [compromisTest({ statut: "realise", dateActeReelle: "2026-10-08" })])).toBe("vendu");
  });

  it("F. compromis annulé + offre restée acceptee -> offre_acceptee (l'annulation ne touche pas l'offre) ; jalons legacy jamais restaurés", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z", offreEnCoursLe: "2026-08-01T10:00:00.000Z" });
    const compromis = [compromisTest({ statut: "annule", dateAnnulation: "2026-08-10", motifAnnulation: "desaccord_prix" })];
    expect(statutCommercialBienEffectif(bien, [offreTest({ statut: "acceptee" })], compromis)).toBe("offre_acceptee");
    expect(statutCommercialBienEffectif(bien, [offreTest({ statut: "caduque" })], compromis)).toBe("en_commercialisation");
  });
});
