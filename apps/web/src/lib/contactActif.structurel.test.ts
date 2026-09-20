import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-059 §10 — un contact absorbé est figé : TOUT writer de production qui écrit un `contact_id`
// passe par la garde partagée (`contactActif.ts`, lecture SOUS VERROU), sauf le moteur de fusion,
// seul autorisé à repointer un absorbé. Une garde par writer est une garde oubliée un jour.

const SRC = join(__dirname, "..");
const ALLOWLIST_MOTEUR = [join(SRC, "lib", "fusionContactRepository.ts")];

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function listerFichiersSource(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return listerFichiersSource(chemin);
    return /\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

// Un writer de contact_id : un `.values({ … contactId … })` / `.set({ … contactId … })` (clé ou
// raccourci), ou une fonction `colonnesCible` qui fabrique cette clé pour une insertion.
const ECRIT_CONTACT_ID = /\.(values|set)\(\s*\{[^}]*\bcontactId\b[^}]*\}|function colonnesCible\([\s\S]*?\bcontactId\s*:/;

const writers = listerFichiersSource(SRC).filter((chemin) => ECRIT_CONTACT_ID.test(codeSeul(chemin)));

describe("ADR-059 §10 — gardes d'écriture sur contact_id", () => {
  it("l'inventaire des writers est celui attendu, et chacun passe par la garde partagée", () => {
    // `join()` produit des chemins avec le séparateur natif de l'OS (`\` sous Windows) —
    // normalisés en `/` UNIQUEMENT pour la comparaison structurelle ci-dessous.
    expect(writers.map((c) => c.replaceAll("\\", "/").replace(SRC.replaceAll("\\", "/") + "/", "")).sort()).toEqual(
      [
        "lib/bonVisiteRepository.ts",
        "lib/clientRepository.ts",
        "lib/fusionContactRepository.ts",
        "lib/interactionRepository.ts",
        "lib/partieMandatRepository.ts",
        "lib/partieProjetRepository.ts",
        "lib/prospectVendeurRepository.ts",
        "lib/provenance/champVerrouilleRepository.ts",
        "lib/provenance/referenceExterneRepository.ts",
        "lib/rattachementContact.ts",
      ].sort()
    );
    for (const chemin of writers) {
      if (ALLOWLIST_MOTEUR.includes(chemin)) continue;
      const code = codeSeul(chemin);
      expect(code, chemin).toMatch(/import \{[^}]*\b(exigerContactActif|verrouillerContactActif)\b[^}]*\} from "@\/lib\/contactActif"/);
      expect(code, chemin).toMatch(/\b(exigerContactActif|verrouillerContactActif)\(/);
    }
  });

  it("la garde lit SOUS VERROU, ne suit jamais la chaîne, distingue introuvable et fusionné", () => {
    const garde = codeSeul(join(SRC, "lib", "contactActif.ts"));
    expect(garde).toContain('.for("update")');
    expect(garde).not.toMatch(/fusionneDansContactId\s*[,)]|resoudreContactActif|MAX_CHAINE_FUSION/);
    expect(garde).toContain('return { statut: "fusionne" }');
    expect(garde).toContain('return { statut: "introuvable" }');
    expect(garde).toContain("export class ErreurContactFusionne extends Error");
    expect(garde).not.toMatch(/\.(insert|update|delete)\(/);
  });

  it("chaque writer feuille verrouille dans une transaction (savepoint si l'appelant en a une)", () => {
    for (const fichier of ["interactionRepository.ts", "partieProjetRepository.ts", "clientRepository.ts", "prospectVendeurRepository.ts"]) {
      const code = codeSeul(join(SRC, "lib", fichier));
      expect(code, fichier).toContain("executeur.transaction(async (tx) =>");
      expect(code, fichier).toMatch(/exigerContactActif\([^)]*,\s*tx/);
    }
    // ADR-060 §16 — writer à résultat typé : la garde rend `contact_introuvable` / `contact_fusionne`,
    // après le verrou du mandat (ordre mandat → contact, sans cycle avec le moteur).
    {
      const code = codeSeul(join(SRC, "lib", "partieMandatRepository.ts"));
      expect(code).toContain("executeur.transaction(async (tx) =>");
      expect(code).toMatch(/verrouillerContactActif\(input\.contactId, tx, workspaceId\)/);
    }
    for (const fichier of ["champVerrouilleRepository.ts", "referenceExterneRepository.ts"]) {
      const code = codeSeul(join(SRC, "lib", "provenance", fichier));
      expect(code, fichier).toContain("executeur.transaction(async (tx) =>");
      expect(code, fichier).toContain('if (cible.type === "contact")'.replace("cible", fichier === "referenceExterneRepository.ts" ? "input.cible" : "cible"));
      expect(code, fichier).toMatch(/verrouillerContactActif\([^)]*,\s*tx\)/);
    }
  });

  it("aucun writer ne réécrit une cible absorbée vers son survivant", () => {
    // Les repositories de dossier portent aussi une LECTURE de navigation (`getNavigationContact*`,
    // ADR-059) qui résout le contact actif : elle est autorisée, hors des writers.
    const LECTURE_NAVIGATION: Record<string, RegExp> = {
      [join(SRC, "lib", "clientRepository.ts")]: /export async function creerAcquereur[\s\S]*?\n}/,
      [join(SRC, "lib", "prospectVendeurRepository.ts")]: /export async function creerProspectVendeur[\s\S]*?\n}/,
    };
    for (const chemin of writers) {
      if (ALLOWLIST_MOTEUR.includes(chemin)) continue;
      const code = codeSeul(chemin);
      expect(code, chemin).not.toMatch(/contactId\s*=\s*[^;]*fusionneDansContactId|\.fusionneDansContactId\s*\?\?/);
      const perimetre = LECTURE_NAVIGATION[chemin];
      if (perimetre) {
        const writer = code.match(perimetre)?.[0] ?? "";
        expect(writer.length, chemin).toBeGreaterThan(0);
        expect(writer, chemin).not.toContain("resoudreContactActif");
        expect(code.match(/resoudreContactActif\(/g)?.length, chemin).toBe(1);
        expect(code, chemin).toMatch(/export async function getNavigationContact\w+\([\s\S]*?resoudreContactActif\(/);
      } else {
        expect(code, chemin).not.toContain("resoudreContactActif");
      }
    }
  });

  it("le moteur reste le seul à repointer un contact_id, et il n'importe pas la garde feuille", () => {
    const moteur = codeSeul(ALLOWLIST_MOTEUR[0]);
    expect(moteur).toContain(".set({ contactId: contactSurvivantId })");
    expect(moteur).not.toContain("@/lib/contactActif");
  });

  it("la finalisation Gmail traduit un contact absorbé en état explicite, sans réécrire la cible", () => {
    const code = codeSeul(join(SRC, "lib", "communications", "finaliserEnvoiGmail.ts"));
    expect(code).toContain("erreur instanceof ErreurContactFusionne");
    expect(code).toContain('statut: "email_envoye_contact_fusionne"');
    expect(code).not.toMatch(/resoudreContactActif|fusionneDansContactId/);
  });
});
