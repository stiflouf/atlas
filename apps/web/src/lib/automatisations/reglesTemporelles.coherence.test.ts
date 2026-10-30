import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCANNERS_TEMPORELS } from "./scanTemporel";
import { CATALOGUE_REGLES_AUTOMATISATION } from "./catalogueRegles";
import {
  CODES_REGLE_TEMPORELLE,
  LIBELLE_SEUIL_REGLE_TEMPORELLE,
  estRegleTemporelle,
} from "@/types/automatisation";

// PILOT_PRODUCTION_HARDENING_V1 — gardes de cohérence des règles TEMPORELLES.
//
// Mode de panne réellement survenu, et que ces tests ferment : l'écran `/automatisations` et la
// Server Action d'activation tenaient CHACUN sa propre liste de règles temporelles, écrite à la
// main. Elles ont divergé (4 contre 6). Conséquence exacte : `visite_j_1` et
// `visite_sans_compte_rendu` n'obtenaient aucun champ de seuil dans l'écran, donc `seuil_jours`
// restait NULL, donc la Server Action refusait leur activation en levant — un écran d'erreur à
// chaque clic, et deux règles définitivement inactivables.
//
// Ce qui est vérifié ici n'est donc pas « les 6 codes attendus sont là » (ça, le registre le disait
// déjà) mais qu'aucun consommateur ne puisse se REDÉCLARER sa propre liste : ces tests lisent la
// source des deux fichiers concernés.

function lireSource(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), "utf8");
}

const SOURCE_ECRAN = "../../app/automatisations/page.tsx";
const SOURCE_ACTION = "../../actions/automatisations.ts";

describe("CODES_REGLE_TEMPORELLE — source de vérité unique", () => {
  it("couvre exactement le registre d'exécution SCANNERS_TEMPORELS", () => {
    expect([...CODES_REGLE_TEMPORELLE].sort()).toEqual(SCANNERS_TEMPORELS.map((s) => s.codeRegle).sort());
  });

  it("ne contient que des codes réels du catalogue", () => {
    const codesCatalogue = new Set(CATALOGUE_REGLES_AUTOMATISATION.map((r) => r.code));
    for (const code of CODES_REGLE_TEMPORELLE) {
      expect(codesCatalogue.has(code), `${code} absent du catalogue`).toBe(true);
    }
  });

  it("inclut les deux règles Visite — celles que l'asymétrie rendait inactivables", () => {
    expect(estRegleTemporelle("visite_j_1")).toBe(true);
    expect(estRegleTemporelle("visite_sans_compte_rendu")).toBe(true);
  });

  it("ne qualifie pas de temporelle une règle purement événementielle", () => {
    expect(estRegleTemporelle("suivi_apres_visite")).toBe(false);
    expect(estRegleTemporelle("nouveau_match_bien_acquereur")).toBe(false);
    expect(estRegleTemporelle("retour_vendeur_apres_visite")).toBe(false);
  });
});

describe("LIBELLE_SEUIL_REGLE_TEMPORELLE — un sens métier par règle", () => {
  it("chaque règle temporelle a un libellé non vide (aucun repli générique possible)", () => {
    for (const code of CODES_REGLE_TEMPORELLE) {
      const libelle = LIBELLE_SEUIL_REGLE_TEMPORELLE[code];
      expect(libelle, `${code} sans libellé de seuil`).toBeDefined();
      expect(libelle.prefixe.trim().length, `${code} : préfixe vide`).toBeGreaterThan(0);
      expect(libelle.suffixe.trim().length, `${code} : suffixe vide`).toBeGreaterThan(0);
    }
  });

  it("aucun libellé n'est le texte générique que l'écran utilisait en repli", () => {
    // L'ancien écran affichait `?? "Après"` / `?? "jours"` pour toute règle absente de SA liste :
    // un libellé qui ressemble à ce repli signalerait qu'on a rempli le Record sans réfléchir au
    // sens réel du seuil pour cette règle.
    for (const code of CODES_REGLE_TEMPORELLE) {
      expect(LIBELLE_SEUIL_REGLE_TEMPORELLE[code].suffixe.trim()).not.toBe("jours");
    }
  });

  it("le libellé de visite_j_1 dit que la fenêtre est un jour civil exact, pas un intervalle", () => {
    // Le scanner compare `datePrevue` à `aujourd'hui + seuilJours` par ÉGALITÉ
    // (`visitesPlanifieesPourDate`). Un libellé laissant croire à un intervalle ferait saisir 3 à
    // un conseiller persuadé de couvrir J-1, J-2 et J-3.
    const libelle = LIBELLE_SEUIL_REGLE_TEMPORELLE.visite_j_1;
    expect(`${libelle.prefixe} ${libelle.suffixe}`.toLowerCase()).toContain("exactement");
  });
});

describe("Aucun consommateur ne redéclare sa propre liste de règles temporelles", () => {
  it("l'écran /automatisations dérive de la source commune", () => {
    const source = lireSource(SOURCE_ECRAN);
    expect(source).toContain("estRegleTemporelle");
    expect(source).toContain("LIBELLE_SEUIL_REGLE_TEMPORELLE");
    // La liste locale supprimée, sous ses deux anciens noms.
    expect(source).not.toMatch(/const\s+REGLES_TEMPORELLES\s*(:|=)/);
    expect(source).not.toMatch(/const\s+LIBELLE_SEUIL\s*(:|=)/);
  });

  it("la Server Action d'activation dérive de la même source", () => {
    const source = lireSource(SOURCE_ACTION);
    expect(source).toContain("estRegleTemporelle");
    expect(source).not.toMatch(/const\s+REGLES_AVEC_SEUIL_OBLIGATOIRE\s*(:|=)/);
  });

  it("ni l'écran ni l'action n'énumèrent en dur un code de règle temporelle", () => {
    // Le vrai invariant : citer `"visite_j_1"` dans l'un des deux fichiers est précisément ce qui
    // permettait aux deux listes de divergier. Le code n'apparaît plus que dans la source commune.
    for (const chemin of [SOURCE_ECRAN, SOURCE_ACTION]) {
      const source = lireSource(chemin);
      const lignesDeCode = source
        .split("\n")
        .filter((ligne) => !ligne.trimStart().startsWith("//"))
        .join("\n");
      for (const code of CODES_REGLE_TEMPORELLE) {
        expect(lignesDeCode, `${chemin} énumère ${code} en dur`).not.toContain(`"${code}"`);
      }
    }
  });
});
