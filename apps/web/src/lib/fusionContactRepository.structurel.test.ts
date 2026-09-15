import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-059 — LE MOTEUR de fusion, sans UI. Ce que ces gardes figent : une transaction unique,
// FOR UPDATE par id croissant, aucune session, aucun writer de contacts en dehors de
// contactRepository (identité par `modifierIdentiteContact`, marqueur par
// `marquerContactFusionne`), journal en insertion seule, aucun instantané legacy réécrit, aucun
// verrou repointé, et aucun écran ni Server Action qui l'appelle.

const SRC = join(__dirname, "..");
const MOTEUR = join(SRC, "lib", "fusionContactRepository.ts");

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

const moteur = codeSeul(MOTEUR);

describe("fusionContactRepository — transaction et verrous", () => {
  it("une seule transaction, et tout le moteur est dedans", () => {
    expect(moteur.match(/\.transaction\(/g)?.length).toBe(1);
    // Aucune écriture avant l'ouverture de la transaction.
    const avant = moteur.slice(0, moteur.indexOf(".transaction("));
    expect(avant).not.toMatch(/\.(insert|update|delete)\(/);
    // Toute écriture passe par `tx`, jamais par `executeur` ni `getDb()`.
    expect(moteur).not.toMatch(/executeur\s*\.\s*(insert|update|delete|select)\(/);
    expect(moteur).not.toMatch(/getDb\(\)\s*\.\s*(insert|update|delete|select)\(/);
  });

  it("FOR UPDATE sur les deux contacts, en une instruction, par id croissant", () => {
    const verrou = moteur.match(/\.from\(contactsTable\)[\s\S]*?\.for\("update"\)/)?.[0] ?? "";
    expect(verrou).toContain("inArray(contactsTable.id, [contactSurvivantId, contactAbsorbeId])");
    expect(verrou).toContain(".orderBy(asc(contactsTable.id))");
    expect(moteur.match(/\.for\("update"\)/g)?.length).toBe(1);
    // Le verrou précède toute vérification d'invariant et toute écriture.
    expect(moteur.indexOf('.for("update")')).toBeLessThan(moteur.indexOf('statut: "contact_introuvable" }', moteur.indexOf(".transaction(")));
    expect(moteur.indexOf('.for("update")')).toBeLessThan(moteur.indexOf("tx.update("));
  });

  it("self merge et ids invalides sont refusés avant la transaction", () => {
    const avant = moteur.slice(0, moteur.indexOf(".transaction("));
    expect(avant).toContain('if (contactSurvivantId === contactAbsorbeId) return { statut: "meme_contact" }');
    expect(avant).toContain("UUID_REGEX.test(contactSurvivantId)");
  });
});

describe("fusionContactRepository — frontières", () => {
  it("aucune session, aucun Next, aucune action : le moteur reçoit son acteur en paramètre", () => {
    expect(moteur).not.toMatch(/next\/|sessionAtlas|workspaceCourant|exigerSession|@\/actions|cookies\(/);
    expect(moteur).toContain("acteur: ActeurFusion");
  });

  it("n'écrit jamais contacts lui-même : identité par modifierIdentiteContact, marqueur par marquerContactFusionne", () => {
    expect(moteur).not.toMatch(/update\(\s*contactsTable/);
    expect(moteur).toContain("modifierIdentiteContact(contactSurvivantId, params.identiteFinale, workspaceId, tx)");
    expect(moteur).toContain("marquerContactFusionne(contactAbsorbeId, contactSurvivantId, workspaceId, tx)");
    // Identité avant marqueur, marqueur avant journal.
    expect(moteur.indexOf("modifierIdentiteContact(")).toBeLessThan(moteur.indexOf("marquerContactFusionne("));
    expect(moteur.indexOf("marquerContactFusionne(")).toBeLessThan(moteur.indexOf("insert(contactFusionsTable)"));
  });

  it("le journal est inséré une fois, jamais mis à jour ni supprimé", () => {
    expect(moteur.match(/insert\(contactFusionsTable\)/g)?.length).toBe(1);
    expect(moteur).not.toMatch(/\.(update|delete)\(\s*contactFusionsTable/);
  });

  it("les dossiers historiques ne reçoivent que contact_id : aucun instantané d'identité réécrit", () => {
    for (const table of ["acquereursTable", "prospectsVendeursTable", "interactionsTable", "referencesExternesTable"]) {
      const sets = [...moteur.matchAll(new RegExp(`\\.update\\(${table}\\)\\s*\\.set\\(([^)]*)\\)`, "g"))].map((m) => m[1]);
      expect(sets.length, table).toBe(1);
      expect(sets[0].replace(/\s/g, ""), table).toBe("{contactId:contactSurvivantId}");
    }
    // Le seul autre UPDATE est le rôle d'une partie conservée ; la seule suppression, une partie dédoublée.
    expect(moteur.match(/\.update\(partiesProjetTable\)\.set\(\{ role: principal \}\)/g)?.length).toBe(1);
    expect(moteur.match(/tx\.delete\(/g)?.length).toBe(1);
    expect(moteur).toContain("tx.delete(partiesProjetTable)");
  });

  it("les verrous humains ne sont ni repointés, ni supprimés, ni posés directement", () => {
    expect(moteur).not.toMatch(/champsVerrouilles|champVerrouilleRepository|verrouillerChamp/);
  });

  it("les parties des projets communs sont dédoublées AVANT le repoint global", () => {
    expect(moteur.indexOf("tx.delete(partiesProjetTable)")).toBeLessThan(moteur.indexOf(".set({ contactId: contactSurvivantId })"));
  });

  it("le moteur ne choisit jamais une identité : il vérifie le choix humain contre les deux identités réelles", () => {
    expect(moteur).toContain("champInvalide(identiteAvantSurvivant, identiteAvantAbsorbe, params.identiteFinale, params.choixParChamp)");
    expect(moteur).not.toMatch(/plusRecent|plusComplet|Math\.max\(.*modifieLe/);
  });

  it("les acquittements sont recalculés sous verrou avec des clés déterministes, par l'analyse partagée", () => {
    // La définition de « contradiction » vit dans fusionContactAnalyse.ts, pure, partagée avec le
    // read model de préparation : ce que l'écran annonce est ce que le moteur exige.
    expect(moteur).toContain('import { avertissementsReferencesExternes } from "@/lib/fusionContactAnalyse"');
    const analyse = codeSeul(join(SRC, "lib", "fusionContactAnalyse.ts"));
    expect(analyse).toContain('cle: `reference_externe_contradictoire:${cle}`');
    expect(analyse).not.toMatch(/@\/db\/|drizzle-orm|\.(insert|update|delete|select)\(/);
    expect(moteur).toContain('statut: "avertissement_reference_externe_requis"');
    expect(moteur).toContain('statut: "acquittement_inconnu"');
    expect(moteur.indexOf("avertissementsReferencesExternes(refs")).toBeGreaterThan(moteur.indexOf('.for("update")'));
  });

  it("une seule porte vers le moteur : la Server Action fusionnerContactsAction — aucune page ni composant", () => {
    const appelants = listerFichiersSource(SRC)
      .filter((chemin) => chemin !== MOTEUR)
      .filter((chemin) => /fusionContactRepository|fusionnerContacts\(/.test(codeSeul(chemin)));
    expect(appelants).toEqual([join(SRC, "actions", "fusionnerContacts.ts")]);
    for (const dossier of ["app", "components"]) {
      const fautifs = listerFichiersSource(join(SRC, dossier)).filter((chemin) =>
        /fusionContactRepository|fusionnerContacts\(/.test(codeSeul(chemin))
      );
      expect(fautifs, dossier).toEqual([]);
    }
  });
});
