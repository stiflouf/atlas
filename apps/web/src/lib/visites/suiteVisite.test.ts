import { describe, expect, it } from "vitest";
import { construireSuiteVisite, titreTacheProchaineEtape } from "./suiteVisite";
import type { ProfilAcquereur } from "@/types/client";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import type { Tache } from "@/types/tache";

const BIEN_ID = "11111111-1111-1111-1111-111111111111";

const ACQUEREUR = {
  id: "22222222-2222-2222-2222-222222222222",
  prenom: "Camille",
  nom: "Ferrand",
} as ProfilAcquereur;

const PROSPECT_VENDEUR = {
  id: "66666666-6666-6666-6666-666666666666",
  bienId: BIEN_ID,
  prenom: "Hélène",
  nom: "Roux",
} as ProspectVendeur;

function compteRendu(surcharge: Partial<CompteRenduVisite> = {}): CompteRenduVisite {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    bienId: BIEN_ID,
    acquereurId: ACQUEREUR.id,
    visiteId: "44444444-4444-4444-4444-444444444444",
    dateVisite: "2026-08-28",
    retour: "Retour de visite.",
    interet: "interesse",
    creeLe: "2026-08-28T18:00:00.000Z",
    ...surcharge,
  };
}

function tache(surcharge: Partial<Tache> = {}): Tache {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    titre: "Tâche",
    type: "relance",
    priorite: "normale",
    origine: "manuelle",
    creeLe: "2026-08-29T09:00:00.000Z",
    ...surcharge,
  } as Tache;
}

// `null` signifie explicitement « aucun prospect vendeur rattaché au bien » — distinct d'un
// argument omis, qui retombe sur le cas nominal (un vendeur existe).
function suite(entrees: {
  compteRendu?: CompteRenduVisite;
  prospectVendeur?: ProspectVendeur | null;
  tachesAcquereur?: Tache[];
  tachesVendeur?: Tache[];
}) {
  return construireSuiteVisite({
    acquereur: ACQUEREUR,
    prospectVendeur: entrees.prospectVendeur === null ? undefined : (entrees.prospectVendeur ?? PROSPECT_VENDEUR),
    compteRendu: entrees.compteRendu ?? compteRendu(),
    tachesAcquereur: entrees.tachesAcquereur ?? [],
    tachesVendeur: entrees.tachesVendeur ?? [],
  });
}

const cles = (s: ReturnType<typeof suite>) => s.actions.map((a) => a.cle);
const action = (s: ReturnType<typeof suite>, cle: string) => s.actions.find((a) => a.cle === cle);

describe("intérêt = intéressé", () => {
  it("propose le suivi acquéreur et le retour vendeur", () => {
    const resultat = suite({});
    expect(cles(resultat)).toEqual(["suivi_acquereur", "retour_vendeur"]);
    expect(resultat.raison).toContain("intéressé");
  });

  it("ne propose jamais deux fois « Créer une offre » : ce CTA reste celui d'ADR-044, hors du bloc", () => {
    expect(cles(suite({}))).not.toContain("creer_offre");
  });

  it("au plus deux actions, jamais un mur de boutons", () => {
    expect(suite({}).actions.length).toBeLessThanOrEqual(2);
  });
});

describe("intérêt = à réfléchir", () => {
  it("propose une relance douce et le retour vendeur, jamais un dossier froid ou perdu", () => {
    const resultat = suite({ compteRendu: compteRendu({ interet: "a_reflechir" }) });
    expect(cles(resultat)).toEqual(["suivi_acquereur", "retour_vendeur"]);
    expect(action(resultat, "suivi_acquereur")!.libelle).toBe("Prévoir une relance douce");
    expect(resultat.raison).not.toMatch(/froid|perdu/i);
  });
});

describe("intérêt = pas intéressé", () => {
  it("ne propose aucune relance commerciale, seulement le retour vendeur", () => {
    const resultat = suite({ compteRendu: compteRendu({ interet: "pas_interesse" }) });
    expect(cles(resultat)).toEqual(["retour_vendeur"]);
    expect(cles(resultat)).not.toContain("suivi_acquereur");
    expect(cles(resultat)).not.toContain("creer_offre");
  });

  it("aucune action ne pousse le bien, même si une tâche de suivi acquéreur traîne encore", () => {
    const resultat = suite({
      compteRendu: compteRendu({ interet: "pas_interesse" }),
      tachesAcquereur: [tache({ titre: "Relancer Camille Ferrand", acquereurId: ACQUEREUR.id })],
    });
    expect(cles(resultat)).toEqual(["retour_vendeur"]);
  });
});

describe("intérêt = inconnu", () => {
  it("n'invente aucune orientation commerciale", () => {
    const resultat = suite({ compteRendu: compteRendu({ interet: "inconnu" }) });
    expect(resultat.raison).toBe("Le retour de l'acquéreur n'est pas encore établi.");
    expect(cles(resultat)).toContain("retour_vendeur");
  });
});

describe("prochaine étape", () => {
  const PROCHAINE = "Recontacter Camille vendredi pour savoir si elle souhaite une seconde visite";

  it("affichée telle quelle, et proposée à la création quand aucune tâche ne la couvre", () => {
    const resultat = suite({ compteRendu: compteRendu({ prochaineEtape: PROCHAINE }) });
    expect(resultat.prochaineEtape).toBe(PROCHAINE);
    expect(resultat.proposerTacheDepuisProchaineEtape).toBe(true);
  });

  it("aucune proposition de création quand une tâche active porte déjà exactement cette action", () => {
    const resultat = suite({
      compteRendu: compteRendu({ prochaineEtape: PROCHAINE }),
      tachesAcquereur: [tache({ titre: titreTacheProchaineEtape(PROCHAINE), acquereurId: ACQUEREUR.id })],
    });
    expect(resultat.proposerTacheDepuisProchaineEtape).toBe(false);
  });

  it("une tâche TERMINÉE ne bloque pas la création : elle ne couvre plus rien", () => {
    const resultat = suite({
      compteRendu: compteRendu({ prochaineEtape: PROCHAINE }),
      tachesAcquereur: [
        tache({
          titre: titreTacheProchaineEtape(PROCHAINE),
          acquereurId: ACQUEREUR.id,
          termineeLe: "2026-08-30T09:00:00.000Z",
        }),
      ],
    });
    expect(resultat.proposerTacheDepuisProchaineEtape).toBe(true);
  });

  it("aucune prochaine étape -> rien à promouvoir", () => {
    const resultat = suite({});
    expect(resultat.prochaineEtape).toBeUndefined();
    expect(resultat.proposerTacheDepuisProchaineEtape).toBe(false);
  });

  it("aucune date n'est déduite du texte : le libellé est repris à l'identique", () => {
    expect(titreTacheProchaineEtape(`  ${PROCHAINE}  `)).toBe(PROCHAINE);
  });
});

describe("tâches déjà planifiées (ADR-041 / ADR-042)", () => {
  it("une tâche de suivi acquéreur active devient la cible de l'action, via le parcours existant", () => {
    const resultat = suite({
      tachesAcquereur: [
        tache({ id: "aaaaaaaa-0000-0000-0000-000000000001", titre: "Faire le point avec Camille Ferrand", acquereurId: ACQUEREUR.id }),
      ],
    });
    expect(action(resultat, "suivi_acquereur")).toMatchObject({
      libelle: "Préparer la relance",
      href: "/communications/nouveau?tacheId=aaaaaaaa-0000-0000-0000-000000000001",
    });
    expect(resultat.tachesPlanifiees.map((t) => t.titre)).toContain("Faire le point avec Camille Ferrand");
  });

  it("une tâche de retour vendeur active devient la cible de l'action vendeur (ADR-042)", () => {
    const resultat = suite({
      tachesVendeur: [
        tache({
          id: "bbbbbbbb-0000-0000-0000-000000000002",
          titre: "Faire le retour de visite au vendeur",
          prospectVendeurId: PROSPECT_VENDEUR.id,
        }),
      ],
    });
    expect(action(resultat, "retour_vendeur")).toMatchObject({
      libelle: "Préparer le retour vendeur",
      href: "/communications/nouveau?tacheId=bbbbbbbb-0000-0000-0000-000000000002",
    });
  });

  it("les deux tâches automatiques présentes -> aucun CTA de création, seulement les suivis à préparer", () => {
    const resultat = suite({
      tachesAcquereur: [
        tache({ id: "aaaaaaaa-0000-0000-0000-000000000001", titre: "Relancer Camille Ferrand", acquereurId: ACQUEREUR.id }),
      ],
      tachesVendeur: [
        tache({
          id: "bbbbbbbb-0000-0000-0000-000000000002",
          titre: "Faire le retour de visite au vendeur",
          prospectVendeurId: PROSPECT_VENDEUR.id,
        }),
      ],
    });
    expect(resultat.tachesPlanifiees).toHaveLength(2);
    // Aucune action ne repart vers une création : chacune ouvre la préparation de la tâche déjà là.
    expect(resultat.actions.every((a) => a.href.startsWith("/communications/nouveau?tacheId="))).toBe(true);
  });

  it("aucune tâche : les actions pointent vers la planification existante, jamais vers une création implicite", () => {
    const resultat = suite({});
    expect(action(resultat, "suivi_acquereur")!.href).toBe(`/taches/nouveau?acquereurId=${ACQUEREUR.id}`);
    expect(action(resultat, "retour_vendeur")!.href).toBe(`/taches/nouveau?prospectVendeurId=${PROSPECT_VENDEUR.id}`);
  });

  it("aucun prospect vendeur rattaché au bien : aucune action vendeur inventée", () => {
    const resultat = suite({ prospectVendeur: null });
    expect(cles(resultat)).toEqual(["suivi_acquereur"]);
  });

  it("visite entièrement suivie (tâches ouvertes + prochaine étape couverte) -> aucune action urgente artificielle", () => {
    const PROCHAINE = "Rappeler la semaine prochaine";
    const resultat = suite({
      compteRendu: compteRendu({ prochaineEtape: PROCHAINE }),
      tachesAcquereur: [
        tache({ id: "aaaaaaaa-0000-0000-0000-000000000001", titre: PROCHAINE, acquereurId: ACQUEREUR.id }),
      ],
      tachesVendeur: [
        tache({ id: "bbbbbbbb-0000-0000-0000-000000000002", titre: "Retour vendeur", prospectVendeurId: PROSPECT_VENDEUR.id }),
      ],
    });
    expect(resultat.proposerTacheDepuisProchaineEtape).toBe(false);
    expect(resultat.actions.every((a) => a.href.startsWith("/communications/nouveau?tacheId="))).toBe(true);
  });
});

describe("frontière donnée interne / action", () => {
  it("le retour libre, même sensible, n'altère jamais les actions déterminées", () => {
    const sensible = "Acquéreur pénible, budget douteux, ne pas perdre de temps";
    const avec = suite({ compteRendu: compteRendu({ retour: sensible }) });
    const sans = suite({ compteRendu: compteRendu({ retour: "Retour de visite." }) });

    expect(avec.actions).toEqual(sans.actions);
    expect(avec.raison).toBe(sans.raison);
    expect(JSON.stringify(avec)).not.toContain("pénible");
  });
});
