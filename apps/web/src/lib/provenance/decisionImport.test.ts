import { describe, expect, it } from "vitest";
import { deciderApplicationValeurExterne } from "./decisionImport";
import type { SourceDeVerite } from "@/types/provenance";

// ADR-056 invariant 4 — le cas fondateur de l'ADR, testé exhaustivement. La fonction est pure :
// ces tests couvrent TOUTES les combinaisons de ses trois entrées booléennes/énumérées, ce qui
// n'est possible que parce qu'elle ne touche ni la base, ni le réseau.

const SOURCES: SourceDeVerite[] = ["domiora", "externe"];

describe("deciderApplicationValeurExterne — le cas 450 000 / 470 000", () => {
  it("importe une valeur sur un champ libre quand le fournisseur fait foi", () => {
    // Étape 1 de l'ADR : l'import initial pose 450 000.
    expect(
      deciderApplicationValeurExterne({
        valeurLocale: undefined,
        valeurExterne: 450_000,
        champVerrouille: false,
        sourceDeVerite: "externe",
      })
    ).toBe("appliquer");
  });

  it("REFUSE d'écraser une correction humaine, et le dit", () => {
    // Étape 3 : l'humain a corrigé à 470 000 et verrouillé le champ ; le pull propose 450 000.
    // Aucune écriture, et le désaccord devient un fait visible.
    expect(
      deciderApplicationValeurExterne({
        valeurLocale: 470_000,
        valeurExterne: 450_000,
        champVerrouille: true,
        sourceDeVerite: "externe",
      })
    ).toBe("conflit");
  });

  it("le verrou l'emporte même quand le fournisseur fait foi", () => {
    // C'est tout l'objet de l'invariant 4 : « human validation > external sync », sans condition.
    // Le verrou est évalué AVANT la source de vérité.
    for (const sourceDeVerite of SOURCES) {
      expect(
        deciderApplicationValeurExterne({
          valeurLocale: "corrigé à la main",
          valeurExterne: "proposé par la source",
          champVerrouille: true,
          sourceDeVerite,
        }),
        `source ${sourceDeVerite}`
      ).toBe("conflit");
    }
  });

  it("un accord n'est jamais un conflit, même sur un champ verrouillé", () => {
    // Étape 2 revisitée : si la source finit par proposer la valeur corrigée, il n'y a plus rien à
    // arbitrer. Déclarer un conflit ici produirait du bruit permanent sur des données d'accord.
    for (const sourceDeVerite of SOURCES) {
      for (const champVerrouille of [true, false]) {
        expect(
          deciderApplicationValeurExterne({
            valeurLocale: 470_000,
            valeurExterne: 470_000,
            champVerrouille,
            sourceDeVerite,
          }),
          `verrou=${champVerrouille} source=${sourceDeVerite}`
        ).toBe("ignorer");
      }
    }
  });

  it("quand DOMIORA fait foi, un écart est signalé plutôt qu'appliqué", () => {
    // ADR-056 §5 : `domiora` = le pull ne sert plus qu'à DÉTECTER des écarts. Un écart tu ne serait
    // pas un écart détecté.
    expect(
      deciderApplicationValeurExterne({
        valeurLocale: 470_000,
        valeurExterne: 450_000,
        champVerrouille: false,
        sourceDeVerite: "domiora",
      })
    ).toBe("conflit");
  });

  it("ne coerce jamais les types : 450000 et « 450000 » ne disent pas la même chose", () => {
    // Traiter ces deux valeurs comme égales ferait disparaître un vrai désaccord de typage entre
    // deux systèmes, silencieusement.
    expect(
      deciderApplicationValeurExterne({
        valeurLocale: 450_000,
        valeurExterne: "450000",
        champVerrouille: false,
        sourceDeVerite: "externe",
      })
    ).toBe("appliquer");
  });

  it("deux absences de valeur sont un accord, pas un conflit", () => {
    expect(
      deciderApplicationValeurExterne({
        valeurLocale: undefined,
        valeurExterne: undefined,
        champVerrouille: true,
        sourceDeVerite: "externe",
      })
    ).toBe("ignorer");
  });

  it("aucune combinaison ne produit une écriture sur un champ verrouillé", () => {
    // Balayage exhaustif : quelles que soient les valeurs et la source, un champ verrouillé ne
    // renvoie JAMAIS « appliquer ». C'est l'invariant, vérifié et non supposé.
    const valeurs = [undefined, null, 0, 450_000, "", "texte", true, false];
    for (const valeurLocale of valeurs) {
      for (const valeurExterne of valeurs) {
        for (const sourceDeVerite of SOURCES) {
          const decision = deciderApplicationValeurExterne({
            valeurLocale,
            valeurExterne,
            champVerrouille: true,
            sourceDeVerite,
          });
          expect(decision, `${String(valeurLocale)} vs ${String(valeurExterne)} / ${sourceDeVerite}`).not.toBe(
            "appliquer"
          );
        }
      }
    }
  });
});
