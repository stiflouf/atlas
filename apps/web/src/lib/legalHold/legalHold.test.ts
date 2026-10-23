import { describe, expect, it } from "vitest";
import {
  ErreurLegalHoldInvalide,
  cleUniciteHoldActif,
  estActif,
  estSousLegalHold,
  validerIdentiteSub,
  validerMotif,
  validerMotifCode,
  validerTypeCible,
  validerWorkspaceId,
} from "./legalHold";
import { LONGUEUR_MIN_MOTIF, MOTIFS_LEGAL_HOLD, TYPES_CIBLE_LEGAL_HOLD } from "./statutsLegalHold";

// LEGAL_HOLD_FOUNDATION_V1 (ADR-068) — ce que le DOMAINE PUR doit garantir, sans aucun Postgres.
//
// Le pendant base (pose, levée, isolation workspace, concurrence réelle) vit dans
// legalHoldRepository.test.ts : ce qu'une contrainte SQL tranche ne doit pas être « prouvé » par un
// test en mémoire, qui ne prouverait que la duplication de la règle.

describe("vocabulaires fermés", () => {
  it("un seul type de cible est supporté, et c'est celui que le moteur de rétention consulte", () => {
    // `bons_visite` est le seul type pour lequel une politique déclare `legalHoldApplicable: true`
    // (SIGNED_VISIT_FORM, ADR-065). Élargir cette liste sans brancher la lecture correspondante
    // produirait des holds inertes — une protection qui ne protège rien.
    expect([...TYPES_CIBLE_LEGAL_HOLD]).toEqual(["bons_visite"]);
  });

  it("les motifs couvrent les six cas documentés et aucun fourre-tout silencieux", () => {
    expect([...MOTIFS_LEGAL_HOLD]).toEqual([
      "CONTENTIEUX",
      "PRE_CONTENTIEUX",
      "OBLIGATION_CONSERVATION",
      "CONTROLE_OU_AUDIT",
      "DEMANDE_JURIDIQUE",
      "AUTRE_MOTIF_DOCUMENTE",
    ]);
  });

  it("un type de cible hors vocabulaire est refusé, jamais converti", () => {
    expect(() => validerTypeCible("documents_bien")).toThrow(ErreurLegalHoldInvalide);
    expect(() => validerTypeCible("bons_visite_")).toThrow(ErreurLegalHoldInvalide);
    expect(() => validerTypeCible(undefined)).toThrow(ErreurLegalHoldInvalide);
    expect(() => validerTypeCible(42)).toThrow(ErreurLegalHoldInvalide);
    expect(validerTypeCible("bons_visite")).toBe("bons_visite");
  });

  it("un motif hors vocabulaire est refusé, y compris une variante de casse", () => {
    expect(() => validerMotifCode("contentieux")).toThrow(ErreurLegalHoldInvalide);
    expect(() => validerMotifCode("AUTRE")).toThrow(ErreurLegalHoldInvalide);
    expect(() => validerMotifCode(null)).toThrow(ErreurLegalHoldInvalide);
    expect(validerMotifCode("CONTENTIEUX")).toBe("CONTENTIEUX");
  });
});

describe("motivation obligatoire", () => {
  it("un motif vide, blanc ou trop court est refusé", () => {
    expect(() => validerMotif("", "motif")).toThrow(ErreurLegalHoldInvalide);
    expect(() => validerMotif("   ", "motif")).toThrow(ErreurLegalHoldInvalide);
    // La longueur se mesure sur le texte UTILE : vingt espaces autour d'un caractère ne motivent
    // rien, et c'est exactement la forme qu'un champ obligatoire mal gardé reçoit en pratique.
    expect(() => validerMotif(`  ${"a".repeat(LONGUEUR_MIN_MOTIF - 1)}  `, "motif")).toThrow(
      ErreurLegalHoldInvalide
    );
    expect(() => validerMotif(undefined, "motif")).toThrow(ErreurLegalHoldInvalide);
  });

  it("un motif valide est conservé mais détrimé", () => {
    expect(validerMotif("  Assignation TJ Nantes 2026/0042  ", "motif")).toBe("Assignation TJ Nantes 2026/0042");
  });

  it("le message de refus ne recopie jamais la valeur refusée", () => {
    // Un motif décrit une affaire et peut nommer des personnes : il n'a rien à faire dans un journal
    // d'erreur, même tronqué.
    const secret = "Dupont";
    try {
      validerMotif(secret, "motif");
      expect.unreachable("un motif de 6 caractères doit être refusé");
    } catch (erreur) {
      expect((erreur as Error).message).not.toContain(secret);
      expect((erreur as Error).message).toContain("motif");
    }
  });

  it("le motif de levée est soumis à la même exigence que le motif de pose", () => {
    expect(() => validerMotif("ok", "motifLevee")).toThrow(ErreurLegalHoldInvalide);
    expect(validerMotif("Jugement definitif du 2026-05-12", "motifLevee")).toBe(
      "Jugement definitif du 2026-05-12"
    );
  });
});

describe("auteur et périmètre obligatoires", () => {
  it("un acte sans auteur identifié est refusé", () => {
    expect(() => validerIdentiteSub("", "poseParIdentiteSub")).toThrow(ErreurLegalHoldInvalide);
    expect(() => validerIdentiteSub("  ", "poseParIdentiteSub")).toThrow(ErreurLegalHoldInvalide);
    expect(() => validerIdentiteSub(undefined, "poseParIdentiteSub")).toThrow(ErreurLegalHoldInvalide);
    expect(validerIdentiteSub("sub-google-123", "poseParIdentiteSub")).toBe("sub-google-123");
  });

  it("un hold sans périmètre est refusé", () => {
    expect(() => validerWorkspaceId("")).toThrow(ErreurLegalHoldInvalide);
    expect(() => validerWorkspaceId(undefined)).toThrow(ErreurLegalHoldInvalide);
    expect(validerWorkspaceId("default")).toBe("default");
  });
});

describe("l'état actif est DÉRIVÉ, jamais stocké", () => {
  it("actif si et seulement si aucune date de levée", () => {
    expect(estActif({ leveLe: undefined })).toBe(true);
    expect(estActif({ leveLe: new Date("2026-05-12T10:00:00.000Z") })).toBe(false);
  });

  it("une colonne de levée NULL venue du driver est traitée comme « actif »", () => {
    // Drizzle rend `null` pour une colonne nullable, et `LegalHold` expose `undefined` : la fonction
    // doit conclure la même chose sur les deux formes, sans quoi un hold actif lu brut serait compté
    // comme levé — une protection disparue en silence.
    expect(estActif({ leveLe: null as unknown as undefined })).toBe(true);
  });
});

describe("la question « cette cible est-elle protégée ? »", () => {
  it("répond vrai pour une cible de l'ensemble, faux sinon", () => {
    const cibles = new Set(["bon-1", "bon-2"]);
    expect(estSousLegalHold(cibles, "bon-1")).toBe(true);
    expect(estSousLegalHold(cibles, "bon-3")).toBe(false);
  });

  it("un ensemble vide signifie « aucune protection connue », pas « lecture impossible »", () => {
    // Cette distinction est portée par le TYPE et par l'appelant, pas par cette fonction : une
    // lecture en échec remonte en exception et ne produit jamais cet ensemble vide (voir
    // retentionRepository et sa garde structurelle).
    expect(estSousLegalHold(new Set(), "bon-1")).toBe(false);
  });
});

describe("clé d'unicité d'un hold actif", () => {
  const base = {
    workspaceId: "default",
    entityType: "bons_visite" as const,
    entityId: "bon-1",
    motifCode: "CONTENTIEUX" as const,
  };

  it("deux motifs différents sur la même cible sont deux holds distincts", () => {
    // C'est la décision centrale du modèle : un contentieux ET un contrôle peuvent protéger la même
    // pièce en même temps, et lever l'un ne doit pas lever l'autre.
    expect(cleUniciteHoldActif(base)).not.toBe(cleUniciteHoldActif({ ...base, motifCode: "CONTROLE_OU_AUDIT" }));
  });

  it("la même cible dans deux workspaces donne deux clés distinctes", () => {
    expect(cleUniciteHoldActif(base)).not.toBe(cleUniciteHoldActif({ ...base, workspaceId: "autre" }));
  });

  it("deux poses identiques produisent la même clé", () => {
    expect(cleUniciteHoldActif(base)).toBe(cleUniciteHoldActif({ ...base }));
  });
});
