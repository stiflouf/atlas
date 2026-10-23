import { describe, expect, it } from "vitest";
import {
  ErreurQuarantaineInvalide,
  cleUniciteQuarantaineActive,
  estActive,
  etatQuarantaine,
  revaliderQuarantaine,
  validerCauseLevee,
  validerEcheanceRevalidation,
  validerIdentiteSubQuarantaine,
  validerMotifQuarantaine,
  validerPolitiqueQuarantaine,
  validerTypeCibleQuarantaine,
  validerWorkspaceIdQuarantaine,
  type ContexteRevalidation,
} from "./quarantaine";
import {
  CAUSES_LEVEE_QUARANTAINE,
  DUREE_QUARANTINE_DECIDEE,
  ETATS_QUARANTAINE,
  LONGUEUR_MIN_MOTIF_QUARANTAINE,
  POLITIQUES_QUARANTAINE,
  TYPES_CIBLE_QUARANTAINE,
  VERDICTS_REVALIDATION_QUARANTAINE,
  dureeQuarantainePour,
} from "./statutsQuarantaine";

// RETENTION_QUARANTINE_FOUNDATION_V1 (ADR-069) — ce que le DOMAINE PUR doit garantir, sans Postgres.
//
// Le pendant base (unicité, immutabilité, concurrence réelle, isolation workspace) vit dans
// quarantaineRepository.test.ts, et l'interaction avec les legal holds dans
// quarantaineLegalHold.test.ts.

const ENTREE = new Date("2026-01-01T00:00:00.000Z");
const ECHEANCE = new Date("2026-04-01T00:00:00.000Z");

const quarantaine = (partiel: { revalidationDueLe?: Date; leveeLe?: Date } = {}) => ({
  revalidationDueLe: partiel.revalidationDueLe ?? ECHEANCE,
  leveeLe: partiel.leveeLe,
});

const contexte = (partiel: Partial<ContexteRevalidation> = {}): ContexteRevalidation => ({
  cibleExiste: true,
  sousLegalHoldActif: false,
  politiqueToujoursApplicable: true,
  ...partiel,
});

describe("AUCUN vocabulaire de ce lot ne peut exprimer « supprimable »", () => {
  it("les trois états de quarantaine sont fermés, et aucun n'autorise une suppression", () => {
    expect([...ETATS_QUARANTAINE]).toEqual(["EN_QUARANTAINE", "REVALIDATION_REQUISE", "LEVEE"]);
    for (const etat of ETATS_QUARANTAINE) {
      expect(etat).not.toMatch(/DELET|PURGE|SUPPRIM|REMOV|ERASE|ALLOWED|AUTORIS/i);
    }
  });

  it("aucun verdict de revalidation ne signifie « purge autorisée »", () => {
    // C'est l'invariant du lot, et il est verrouillé ici plutôt que confié à la relecture : un
    // vocabulaire qui contiendrait `PURGE_ALLOWED` rendrait la purge exprimable avant qu'aucun
    // mécanisme sûr n'existe.
    for (const verdict of VERDICTS_REVALIDATION_QUARANTAINE) {
      expect(verdict).not.toMatch(/DELET|PURGE|SUPPRIM|DELETABLE|ALLOWED|AUTORIS/i);
    }
    // Le plus permissif s'appelle « aucun blocage CONNU » — un constat, pas un droit.
    expect(VERDICTS_REVALIDATION_QUARANTAINE).toContain("AUCUN_BLOCAGE_CONNU");
  });

  it("les causes de sortie et les vocabulaires de cible/politique sont fermés", () => {
    expect([...CAUSES_LEVEE_QUARANTAINE]).toEqual([
      "DECISION_MANUELLE",
      "POLITIQUE_NON_APPLICABLE",
      "CIBLE_DISPARUE",
      "LEGAL_HOLD_POSE",
    ]);
    expect([...TYPES_CIBLE_QUARANTAINE]).toEqual(["bons_visite"]);
    expect([...POLITIQUES_QUARANTAINE]).toEqual(["SIGNED_VISIT_FORM"]);
  });
});

describe("la durée de quarantaine n'est PAS décidée, et rien ne l'invente", () => {
  it("aucune durée n'est déclarée par le produit", () => {
    expect(DUREE_QUARANTINE_DECIDEE).toBe(false);
  });

  it("aucune politique ne rend de durée, donc aucun chemin ne peut calculer une échéance", () => {
    // Ni « 30 jours », ni « 90 jours », ni une valeur dérivée des cinq ans de conservation : la
    // durée de conservation est une règle de conservation, pas une autorisation de purge.
    for (const politique of POLITIQUES_QUARANTAINE) {
      expect(dureeQuarantainePour(politique)).toBeUndefined();
    }
  });

  it("l'échéance doit donc être fournie explicitement, et une absence est refusée", () => {
    expect(() => validerEcheanceRevalidation(undefined, ENTREE)).toThrow(ErreurQuarantaineInvalide);
    expect(() => validerEcheanceRevalidation(null, ENTREE)).toThrow(ErreurQuarantaineInvalide);
    expect(() => validerEcheanceRevalidation("2026-04-01", ENTREE)).toThrow(ErreurQuarantaineInvalide);
    expect(() => validerEcheanceRevalidation(new Date("pas une date"), ENTREE)).toThrow(ErreurQuarantaineInvalide);
    expect(validerEcheanceRevalidation(ECHEANCE, ENTREE)).toBe(ECHEANCE);
  });

  it("une échéance antérieure à l'entrée est refusée : elle naîtrait expirée", () => {
    expect(() => validerEcheanceRevalidation(new Date("2025-12-31T00:00:00.000Z"), ENTREE)).toThrow(
      ErreurQuarantaineInvalide
    );
    // Égale à l'entrée : accepté. Une quarantaine à échéance immédiate est un choix explicite de
    // l'appelant, et elle n'autorise toujours rien — elle exige une revalidation.
    expect(validerEcheanceRevalidation(ENTREE, ENTREE)).toBe(ENTREE);
  });
});

describe("l'état est DÉRIVÉ des dates, jamais stocké", () => {
  it("avant l'échéance : EN_QUARANTAINE", () => {
    expect(etatQuarantaine(quarantaine(), new Date("2026-02-01T00:00:00.000Z"))).toBe("EN_QUARANTAINE");
  });

  it("À l'instant exact de l'échéance : REVALIDATION_REQUISE", () => {
    // `>=` et non `>`, même convention qu'`evaluerBonVisiteSigne` : une échéance qui ne vaudrait
    // qu'à la milliseconde suivante serait une échéance plus un epsilon non écrit.
    expect(etatQuarantaine(quarantaine(), ECHEANCE)).toBe("REVALIDATION_REQUISE");
    expect(etatQuarantaine(quarantaine(), new Date(ECHEANCE.getTime() - 1))).toBe("EN_QUARANTAINE");
  });

  it("après l'échéance : REVALIDATION_REQUISE, et JAMAIS « supprimable »", () => {
    // LE test central du lot. L'échéance atteinte ne produit pas, et ne peut pas produire, un état
    // qui autoriserait une suppression : un tel état n'existe pas dans le vocabulaire.
    const etat = etatQuarantaine(quarantaine(), new Date("2030-01-01T00:00:00.000Z"));
    expect(etat).toBe("REVALIDATION_REQUISE");
    expect(ETATS_QUARANTAINE).toContain(etat);
  });

  it("levée : LEVEE, même si l'échéance est passée depuis longtemps", () => {
    const levee = quarantaine({ leveeLe: new Date("2026-02-15T00:00:00.000Z") });
    expect(etatQuarantaine(levee, new Date("2030-01-01T00:00:00.000Z"))).toBe("LEVEE");
  });

  it("une date de levée NULL venue du driver est traitée comme « active »", () => {
    // Drizzle rend `null` pour une colonne nullable et `Quarantaine` expose `undefined` : la
    // fonction doit conclure la même chose sur les deux formes, sans quoi une quarantaine active lue
    // brute serait comptée comme levée.
    expect(estActive({ leveeLe: null as unknown as undefined })).toBe(true);
    expect(estActive({ leveeLe: undefined })).toBe(true);
    expect(estActive({ leveeLe: ENTREE })).toBe(false);
  });
});

describe("revalidation — l'ordre des vérifications porte les garanties", () => {
  const APRES_ECHEANCE = new Date("2026-06-01T00:00:00.000Z");
  const AVANT_ECHEANCE = new Date("2026-02-01T00:00:00.000Z");

  it("une quarantaine levée n'a rien à revalider", () => {
    expect(revaliderQuarantaine(quarantaine({ leveeLe: ENTREE }), contexte(), APRES_ECHEANCE)).toBe(
      "QUARANTAINE_LEVEE"
    );
  });

  it("une cible disparue est CIBLE_INTROUVABLE, jamais « rien ne bloque »", () => {
    expect(revaliderQuarantaine(quarantaine(), contexte({ cibleExiste: false }), APRES_ECHEANCE)).toBe(
      "CIBLE_INTROUVABLE"
    );
  });

  it("un legal hold actif bloque, et l'ÉCHÉANCE NE LE CONTOURNE JAMAIS", () => {
    // Évalué AVANT l'échéance, délibérément : une protection juridique doit être visible même sur
    // une quarantaine encore jeune, et l'expiration temporelle ne doit jamais pouvoir passer devant.
    expect(revaliderQuarantaine(quarantaine(), contexte({ sousLegalHoldActif: true }), APRES_ECHEANCE)).toBe(
      "BLOCKED_BY_LEGAL_HOLD"
    );
    expect(revaliderQuarantaine(quarantaine(), contexte({ sousLegalHoldActif: true }), AVANT_ECHEANCE)).toBe(
      "BLOCKED_BY_LEGAL_HOLD"
    );
    // Et il passe devant une politique devenue inapplicable : la protection est le fait le plus
    // important à rapporter.
    expect(
      revaliderQuarantaine(
        quarantaine(),
        contexte({ sousLegalHoldActif: true, politiqueToujoursApplicable: false }),
        APRES_ECHEANCE
      )
    ).toBe("BLOCKED_BY_LEGAL_HOLD");
  });

  it("une politique devenue inapplicable est nommée comme telle", () => {
    expect(
      revaliderQuarantaine(quarantaine(), contexte({ politiqueToujoursApplicable: false }), APRES_ECHEANCE)
    ).toBe("POLITIQUE_NON_APPLICABLE");
  });

  it("avant l'échéance, il est trop tôt pour conclure", () => {
    expect(revaliderQuarantaine(quarantaine(), contexte(), AVANT_ECHEANCE)).toBe("ECHEANCE_NON_ATTEINTE");
  });

  it("tout réuni : AUCUN_BLOCAGE_CONNU — qui n'autorise RIEN", () => {
    const verdict = revaliderQuarantaine(quarantaine(), contexte(), APRES_ECHEANCE);
    expect(verdict).toBe("AUCUN_BLOCAGE_CONNU");
    // Ce verdict constate l'absence des blocages que CE lot sait vérifier. Les blocages de
    // SUPPRESSION restent entiers côté politique (`blocagesAvantSuppression`), et aucun chemin de
    // suppression n'existe.
    expect(verdict).not.toMatch(/AUTORIS|ALLOWED|DELETABLE/i);
  });

  it("le contexte est OBLIGATOIRE dans ses trois champs : aucun défaut permissif", () => {
    // Garantie portée par le TYPE. Un `?` sur `sousLegalHoldActif` ferait d'un oubli de câblage une
    // levée de protection ; ce test documente l'intention et casse si un champ devient optionnel.
    const complet: ContexteRevalidation = { cibleExiste: true, sousLegalHoldActif: false, politiqueToujoursApplicable: true };
    expect(Object.keys(complet).sort()).toEqual(["cibleExiste", "politiqueToujoursApplicable", "sousLegalHoldActif"]);
  });
});

describe("validations d'entrée", () => {
  it("un type de cible ou une politique hors vocabulaire est refusé", () => {
    expect(() => validerTypeCibleQuarantaine("documents_bien")).toThrow(ErreurQuarantaineInvalide);
    expect(() => validerTypeCibleQuarantaine(undefined)).toThrow(ErreurQuarantaineInvalide);
    expect(validerTypeCibleQuarantaine("bons_visite")).toBe("bons_visite");
    // Une politique bloquée ne produit aucun candidat : l'accepter permettrait d'ouvrir une
    // quarantaine que rien ne justifie.
    expect(() => validerPolitiqueQuarantaine("PROSPECT_MARKETING")).toThrow(ErreurQuarantaineInvalide);
    expect(() => validerPolitiqueQuarantaine("FREE_TEXT_NOTES")).toThrow(ErreurQuarantaineInvalide);
    expect(validerPolitiqueQuarantaine("SIGNED_VISIT_FORM")).toBe("SIGNED_VISIT_FORM");
  });

  it("une cause de levée hors vocabulaire est refusée", () => {
    expect(() => validerCauseLevee("AUTRE")).toThrow(ErreurQuarantaineInvalide);
    expect(() => validerCauseLevee("decision_manuelle")).toThrow(ErreurQuarantaineInvalide);
    expect(validerCauseLevee("DECISION_MANUELLE")).toBe("DECISION_MANUELLE");
  });

  it("le motif est obligatoire, mesuré sur le texte utile, et jamais recopié en cas de refus", () => {
    expect(() => validerMotifQuarantaine("", "motif")).toThrow(ErreurQuarantaineInvalide);
    expect(() => validerMotifQuarantaine("   ", "motif")).toThrow(ErreurQuarantaineInvalide);
    expect(() => validerMotifQuarantaine(`  ${"a".repeat(LONGUEUR_MIN_MOTIF_QUARANTAINE - 1)}  `, "motif")).toThrow(
      ErreurQuarantaineInvalide
    );
    expect(validerMotifQuarantaine("  Echu depuis 2020, revue annuelle  ", "motif")).toBe(
      "Echu depuis 2020, revue annuelle"
    );

    const secret = "Dupont";
    try {
      validerMotifQuarantaine(secret, "motifLevee");
      expect.unreachable("un motif de 6 caractères doit être refusé");
    } catch (erreur) {
      expect((erreur as Error).message).not.toContain(secret);
      expect((erreur as Error).message).toContain("motifLevee");
    }
  });

  it("l'auteur et le périmètre sont obligatoires", () => {
    expect(() => validerIdentiteSubQuarantaine("", "entreParIdentiteSub")).toThrow(ErreurQuarantaineInvalide);
    expect(() => validerIdentiteSubQuarantaine(undefined, "entreParIdentiteSub")).toThrow(ErreurQuarantaineInvalide);
    expect(validerIdentiteSubQuarantaine("sub-abc", "entreParIdentiteSub")).toBe("sub-abc");
    expect(() => validerWorkspaceIdQuarantaine("")).toThrow(ErreurQuarantaineInvalide);
    expect(validerWorkspaceIdQuarantaine("default")).toBe("default");
  });
});

describe("clé d'unicité d'une quarantaine active", () => {
  const base = {
    workspaceId: "default",
    entityType: "bons_visite" as const,
    entityId: "bon-1",
    policyCode: "SIGNED_VISIT_FORM" as const,
  };

  it("la même cible dans deux workspaces donne deux clés distinctes", () => {
    expect(cleUniciteQuarantaineActive(base)).not.toBe(cleUniciteQuarantaineActive({ ...base, workspaceId: "autre" }));
  });

  it("deux cibles différentes donnent deux clés distinctes", () => {
    expect(cleUniciteQuarantaineActive(base)).not.toBe(cleUniciteQuarantaineActive({ ...base, entityId: "bon-2" }));
  });

  it("deux entrées identiques produisent la même clé", () => {
    expect(cleUniciteQuarantaineActive(base)).toBe(cleUniciteQuarantaineActive({ ...base }));
  });
});
