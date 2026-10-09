import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POLITIQUES_CONSERVATION_V1, politiqueConservation } from "@/lib/privacy/conservation";
import {
  agregerEvaluations,
  ajouterAnnees,
  dureeAnneesPourDeclencheur,
  evaluerBonVisiteSigne,
  statutPolitique,
  type CandidatBonVisiteRetention,
} from "./eligibilite";
import { CLES_POLITIQUES_CONSERVATION } from "./statutsRetention";

// RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — tests du MOTEUR PUR. Aucune base, aucun
// réseau : des dates en entrée, un verdict en sortie. La frontière exacte de l'échéance est testée
// explicitement, parce que c'est le seul endroit où un calcul de conservation peut se tromper d'un
// cran sans que rien ne le signale.

function politique(cle: string) {
  const trouvee = politiqueConservation(cle);
  if (!trouvee) throw new Error(`politique ${cle} absente de conservation.ts`);
  return trouvee;
}

const DUREE_BON = (() => {
  const duree = dureeAnneesPourDeclencheur(politique("SIGNED_VISIT_FORM"), "SIGNED_AT");
  if (duree === undefined) throw new Error("la durée de SIGNED_VISIT_FORM doit être lisible depuis conservation.ts");
  return duree;
})();

function bon(partiel: Partial<CandidatBonVisiteRetention> = {}): CandidatBonVisiteRetention {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    workspaceId: "default",
    statut: "signe",
    signeLe: new Date("2020-01-15T10:00:00.000Z"),
    ...partiel,
  };
}

describe("ADR-066 — la durée des 5 ans vient de conservation.ts, jamais de ce moteur", () => {
  it("SIGNED_VISIT_FORM déclare 5 ans sur le déclencheur SIGNED_AT", () => {
    expect(DUREE_BON).toBe(5);
  });

  it("un déclencheur absent de la politique ne produit aucune durée de repli", () => {
    expect(dureeAnneesPourDeclencheur(politique("SIGNED_VISIT_FORM"), "RELATIONSHIP_END_AT")).toBeUndefined();
  });

  it("une politique UNDECIDED n'expose aucune durée", () => {
    expect(dureeAnneesPourDeclencheur(politique("FREE_TEXT_NOTES"), "SIGNED_AT")).toBeUndefined();
  });
});

describe("T1/T2/T3 — SIGNED_VISIT_FORM : frontière des 5 ans", () => {
  const signeLe = new Date("2020-01-15T10:00:00.000Z");
  const echeance = new Date("2025-01-15T10:00:00.000Z");

  it("T1 — moins de 5 ans après la signature : non éligible, et l'échéance est tout de même rendue", () => {
    const evaluation = evaluerBonVisiteSigne(bon({ signeLe }), new Date("2024-12-31T23:59:59.000Z"), DUREE_BON);
    expect(evaluation.statut).toBe("NOT_YET_ELIGIBLE");
    expect(evaluation.eligibleAt?.toISOString()).toBe(echeance.toISOString());
  });

  it("T1 bis — une milliseconde avant l'échéance : non éligible", () => {
    const evaluation = evaluerBonVisiteSigne(bon({ signeLe }), new Date(echeance.getTime() - 1), DUREE_BON);
    expect(evaluation.statut).toBe("NOT_YET_ELIGIBLE");
  });

  it("T2 — exactement à l'échéance : éligible (>= et non >)", () => {
    const evaluation = evaluerBonVisiteSigne(bon({ signeLe }), echeance, DUREE_BON);
    expect(evaluation.statut).toBe("ELIGIBLE");
    expect(evaluation.eligibleAt?.toISOString()).toBe(echeance.toISOString());
  });

  it("T3 — au-delà de 5 ans : éligible", () => {
    const evaluation = evaluerBonVisiteSigne(bon({ signeLe }), new Date("2031-06-01T00:00:00.000Z"), DUREE_BON);
    expect(evaluation.statut).toBe("ELIGIBLE");
  });
});

describe("T4/T5 — fail-closed au niveau de la ligne", () => {
  it("T4 — signe_le absent : BLOCKED, jamais éligible et jamais une date de repli", () => {
    const evaluation = evaluerBonVisiteSigne(bon({ signeLe: undefined }), new Date("2099-01-01T00:00:00.000Z"), DUREE_BON);
    expect(evaluation.statut).toBe("BLOCKED");
    expect(evaluation.blockerCode).toBe("SIGNED_AT_MISSING");
    expect(evaluation.eligibleAt).toBeUndefined();
  });

  it("T4 bis — date invalide : BLOCKED, jamais une échéance NaN silencieuse", () => {
    const evaluation = evaluerBonVisiteSigne(
      bon({ signeLe: new Date("pas-une-date") }),
      new Date("2099-01-01T00:00:00.000Z"),
      DUREE_BON
    );
    expect(evaluation.statut).toBe("BLOCKED");
    expect(evaluation.blockerCode).toBe("SIGNED_AT_MISSING");
  });

  it("T5 — statut connu mais différent de 'signe' : hors périmètre, jamais éligible", () => {
    for (const statut of ["brouillon", "annule"]) {
      const evaluation = evaluerBonVisiteSigne(bon({ statut }), new Date("2099-01-01T00:00:00.000Z"), DUREE_BON);
      expect(evaluation.statut, statut).toBe("OUT_OF_SCOPE");
      expect(evaluation.eligibleAt, statut).toBeUndefined();
    }
  });

  it("statut hors vocabulaire : BLOCKED et non OUT_OF_SCOPE — on ne sait pas ce qu'est cette ligne", () => {
    const evaluation = evaluerBonVisiteSigne(bon({ statut: "signe_v2" }), new Date("2099-01-01T00:00:00.000Z"), DUREE_BON);
    expect(evaluation.statut).toBe("BLOCKED");
    expect(evaluation.blockerCode).toBe("UNKNOWN_ENTITY_STATE");
  });
});

describe("T6 — le calcul ne dépend pas du fuseau de la machine", () => {
  it("l'échéance est calculée en UTC, quelle que soit la valeur de TZ au moment de l'exécution", () => {
    const signeLe = new Date("2020-03-01T00:00:00.000Z");
    const attendu = "2025-03-01T00:00:00.000Z";
    const tzInitial = process.env.TZ;
    try {
      for (const tz of ["UTC", "Europe/Paris", "Pacific/Kiritimati", "Pacific/Niue"]) {
        process.env.TZ = tz;
        const evaluation = evaluerBonVisiteSigne(bon({ signeLe }), new Date("2024-01-01T00:00:00.000Z"), DUREE_BON);
        expect(evaluation.eligibleAt?.toISOString(), tz).toBe(attendu);
      }
    } finally {
      if (tzInitial === undefined) delete process.env.TZ;
      else process.env.TZ = tzInitial;
    }
  });

  it("5 ans est de l'arithmétique de calendrier, jamais 5 × 365 jours en millisecondes", () => {
    // 2020-2024 contient deux 29 février : une durée en millisecondes dériverait de deux jours.
    expect(ajouterAnnees(new Date("2020-01-15T10:00:00.000Z"), 5).toISOString()).toBe("2025-01-15T10:00:00.000Z");
    const parMillisecondes = new Date(new Date("2020-01-15T10:00:00.000Z").getTime() + 5 * 365 * 86_400_000);
    expect(parMillisecondes.toISOString()).not.toBe("2025-01-15T10:00:00.000Z");
  });

  it("29 février + 5 ans : débordement déterministe sur le 1er mars, jamais une date antérieure", () => {
    const echeance = ajouterAnnees(new Date("2020-02-29T12:00:00.000Z"), 5);
    expect(echeance.toISOString()).toBe("2025-03-01T12:00:00.000Z");
    expect(echeance.getTime()).toBeGreaterThan(new Date("2020-02-29T12:00:00.000Z").getTime());
  });
});

describe("T7/T8 — PROSPECT_MARKETING reste bloquée faute de dernier contact entrant fiable", () => {
  it("T7 — statut BLOCKED_MISSING_TRIGGER, cause nommée", () => {
    const evalue = statutPolitique(politique("PROSPECT_MARKETING"));
    expect(evalue.status).toBe("BLOCKED_MISSING_TRIGGER");
    expect(evalue.blockerCode).toBe("LAST_INBOUND_CONTACT_AT_MISSING");
  });

  it("T8 — `dernier_contact_le` n'est utilisé nulle part comme déclencheur, sous aucune forme", () => {
    // Non-régression de l'erreur la plus coûteuse de ce domaine : `dernier_contact_le` est avancé
    // par des gestes du CONSEILLER (ajout d'une note, RDV d'estimation marqué réalisé), jamais par
    // un contact émanant du prospect. L'employer prolongerait la durée de prospection par la seule
    // activité de l'agence. La garde porte sur tout le répertoire retention/, hors tests.
    const lister = (racine: string): string[] =>
      readdirSync(racine).flatMap((entree) => {
        const chemin = join(racine, entree);
        return statSync(chemin).isDirectory() ? lister(chemin) : [chemin];
      });
    const fichiers = lister(__dirname).filter((c) => c.endsWith(".ts") && !c.includes(".test."));
    expect(fichiers.length).toBeGreaterThan(0);
    for (const fichier of fichiers) {
      const code = readFileSync(fichier, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ");
      expect(code, fichier).not.toMatch(/dernierContactLe|dernier_contact_le/);
    }
  });

  it("T8 bis — aucune composition du type max(dernier_contact_le, cree_le) n'existe", () => {
    const evalue = statutPolitique(politique("PROSPECT_MARKETING"));
    // Rien ne doit ressembler à un calcul : pas de blocage « avant suppression » (qui sous-entendrait
    // que l'échéance est connue), et aucun mécanisme déclaré.
    expect(evalue.blocagesAvantSuppression).toBeUndefined();
    expect(evalue.mechanism).toBeUndefined();
  });
});

describe("T9 — CUSTOMER_MARKETING : aucune fin de relation canonique", () => {
  it("BLOCKED_MISSING_TRIGGER, cause nommée, aucune déduction depuis archive_le ni compromis", () => {
    const evalue = statutPolitique(politique("CUSTOMER_MARKETING"));
    expect(evalue.status).toBe("BLOCKED_MISSING_TRIGGER");
    expect(evalue.blockerCode).toBe("RELATIONSHIP_END_AT_MISSING");
  });
});

describe("T10/T11/T12 — les trois catégories UNDECIDED restent bloquées", () => {
  for (const cle of ["TRANSACTION_DOCUMENTS", "FREE_TEXT_NOTES", "ACTIVE_CLIENT_OR_PROJECT_DATA"]) {
    it(`${cle} → BLOCKED_UNDECIDED_POLICY, sans aucune date`, () => {
      const evalue = statutPolitique(politique(cle));
      expect(evalue.status).toBe("BLOCKED_UNDECIDED_POLICY");
      expect(evalue.blockerCode).toBe("POLICY_UNDECIDED");
    });
  }

  it("le caractère indécis est LU depuis conservation.ts, jamais codé en dur ici", () => {
    const indecises = POLITIQUES_CONSERVATION_V1.filter((p) => p.statut === "UNDECIDED").map((p) => p.cle);
    expect(indecises).toEqual(["TRANSACTION_DOCUMENTS", "FREE_TEXT_NOTES", "ACTIVE_CLIENT_OR_PROJECT_DATA"]);
    for (const p of POLITIQUES_CONSERVATION_V1) {
      if (p.statut !== "UNDECIDED") continue;
      expect(statutPolitique(p).status).toBe("BLOCKED_UNDECIDED_POLICY");
    }
  });
});

describe("T13/T14/T15 — politiques déjà appliquées ou partiellement appliquées", () => {
  it("T13 — SESSION : ALREADY_ENFORCED, mécanisme nommé, aucun scan à construire", () => {
    const evalue = statutPolitique(politique("SESSION"));
    expect(evalue.status).toBe("ALREADY_ENFORCED");
    expect(evalue.mechanism).toMatch(/iron-session/);
    expect(evalue.blockerCode).toBeUndefined();
  });

  it("T14 — OIDC_STATE : ALREADY_ENFORCED, mécanisme nommé", () => {
    const evalue = statutPolitique(politique("OIDC_STATE"));
    expect(evalue.status).toBe("ALREADY_ENFORCED");
    expect(evalue.mechanism).toMatch(/600 s/);
  });

  it("T15 — GOOGLE_CONNECTION : PARTIAL_EXISTING_RUNTIME, et l'écart est écrit", () => {
    const evalue = statutPolitique(politique("GOOGLE_CONNECTION"));
    expect(evalue.status).toBe("PARTIAL_EXISTING_RUNTIME");
    expect(evalue.mechanism).toMatch(/illisible/);
  });
});

describe("SIGNED_VISIT_FORM — calculable, et strictement rien de plus", () => {
  it("COMPUTABLE_DRY_RUN_ONLY, avec les trois blocages de suppression énoncés", () => {
    const evalue = statutPolitique(politique("SIGNED_VISIT_FORM"));
    expect(evalue.status).toBe("COMPUTABLE_DRY_RUN_ONLY");
    expect(evalue.blocagesAvantSuppression).toEqual([
      "LEGAL_HOLD_MODEL_MISSING",
      "FILE_DELETE_PRIMITIVE_MISSING",
      "DELETE_PATH_MISSING",
    ]);
  });

  it("aucun statut du vocabulaire ne signifie « actionnable » : la liste est fermée et vérifiée", () => {
    const evalue = statutPolitique(politique("SIGNED_VISIT_FORM"));
    expect(JSON.stringify(evalue)).not.toMatch(/ACTIONABLE|READY_FOR_DELETE|DELETABLE/i);
  });
});

describe("toutes les politiques de conservation.ts sont couvertes, aucune ne reçoit de statut par défaut", () => {
  it("chaque politique déclarée obtient un statut du vocabulaire fermé, et aucune n'est UNKNOWN_POLICY", () => {
    expect(POLITIQUES_CONSERVATION_V1.map((p) => p.cle).sort()).toEqual([...CLES_POLITIQUES_CONSERVATION].sort());
    for (const p of POLITIQUES_CONSERVATION_V1) {
      const evalue = statutPolitique(p);
      expect(evalue.policyCode, p.cle).toBe(p.cle);
      expect(evalue.blockerCode, p.cle).not.toBe("UNKNOWN_POLICY");
    }
  });
});

describe("agrégation — les identifiants tombent ici, par construction", () => {
  it("ne rend que des compteurs et deux bornes de dates", () => {
    const agregat = agregerEvaluations([
      evaluerBonVisiteSigne(bon({ id: "a", signeLe: new Date("2015-01-01T00:00:00.000Z") }), new Date("2026-01-01T00:00:00.000Z"), DUREE_BON),
      evaluerBonVisiteSigne(bon({ id: "b", signeLe: new Date("2018-06-01T00:00:00.000Z") }), new Date("2026-01-01T00:00:00.000Z"), DUREE_BON),
      evaluerBonVisiteSigne(bon({ id: "c", signeLe: new Date("2025-01-01T00:00:00.000Z") }), new Date("2026-01-01T00:00:00.000Z"), DUREE_BON),
      evaluerBonVisiteSigne(bon({ id: "d", statut: "brouillon" }), new Date("2026-01-01T00:00:00.000Z"), DUREE_BON),
      evaluerBonVisiteSigne(bon({ id: "e", signeLe: undefined }), new Date("2026-01-01T00:00:00.000Z"), DUREE_BON),
    ]);
    expect(agregat.eligibleCount).toBe(2);
    expect(agregat.notYetEligibleCount).toBe(1);
    expect(agregat.outOfScopeCount).toBe(1);
    expect(agregat.blockedCount).toBe(1);
    expect(agregat.oldestEligibleAt?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(agregat.newestEligibleAt?.toISOString()).toBe("2023-06-01T00:00:00.000Z");
    expect(JSON.stringify(agregat)).not.toMatch(/"a"|"b"|"c"|"d"|"e"/);
  });

  it("aucun candidat : compteurs à zéro et aucune borne inventée", () => {
    const agregat = agregerEvaluations([]);
    expect(agregat).toEqual({
      eligibleCount: 0,
      blockedCount: 0,
      outOfScopeCount: 0,
      notYetEligibleCount: 0,
      oldestEligibleAt: undefined,
      newestEligibleAt: undefined,
    });
  });
});
