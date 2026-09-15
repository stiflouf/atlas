import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-059 — l'écran de fusion CONSOMME un read model et APPELLE une Server Action, qui appelle le
// moteur UNE fois. Frontières verrouillées : aucune base ni repository d'écriture dans la page ou le
// composant, aucun workspace depuis le formulaire, aucune décision d'identité dans l'action, aucun
// second moteur, aucune similarité comme condition, aucun repoint direct.

const RACINE = join(__dirname, "..", "..", "..", "..", "..");
const PAGE = join(__dirname, "page.tsx");
const COMPOSANT = join(RACINE, "components", "contact", "FusionContactsFormulaire.tsx");
const ACTION = join(RACINE, "actions", "fusionnerContacts.ts");
const READ_MODEL = join(RACINE, "lib", "preparationFusionContactRepository.ts");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const page = codeSeul(PAGE);
const composant = codeSeul(COMPOSANT);
const action = codeSeul(ACTION);
const readModel = codeSeul(READ_MODEL);

describe("/contacts/[id]/fusionner/[absorbeId] — page et composant", () => {
  it("la page passe par le read model de préparation et n'importe ni base, ni schéma, ni moteur", () => {
    expect(page).toMatch(/import \{ preparerFusionContacts \} from "@\/lib\/preparationFusionContactRepository"/);
    expect(page).toContain("preparerFusionContacts({ workspaceId, contactSurvivantId: survivantId, contactAbsorbeId: absorbeId })");
    for (const source of [page, composant]) {
      expect(source).not.toMatch(/@\/db\/|drizzle-orm|Table\b|fusionContactRepository|fusionnerContacts\(|contactRepository|trouverContactsSimilaires/);
    }
  });

  it("le workspace vient de la session ; le premier segment est le conservé, le second l'absorbé", () => {
    expect(page).toContain("exigerWorkspaceCourant()");
    expect(page).toContain("const { id: survivantId, absorbeId } = await params;");
    expect(page).not.toMatch(/searchParams[^;]*workspace/);
  });

  it("introuvable ou identique = 404 ; déjà absorbé = état explicite sans formulaire ; jamais de redirect", () => {
    expect(page).toContain('if (preparation.statut === "contact_introuvable" || preparation.statut === "meme_contact") notFound();');
    expect(page).toContain('preparation.statut === "deja_fusionne"');
    expect(page).toContain("Ce contact n’est plus actif.");
    expect(page).not.toMatch(/redirect\(/);
  });

  it("le composant rend un seul formulaire, sans saisie libre, avec Inverser en simple navigation", () => {
    expect(composant.match(/<form/g)?.length).toBe(1);
    expect(composant).toContain("<form action={action}");
    expect(composant).not.toMatch(/type="text"|type="email"|type="tel"|<textarea|<Input/);
    expect(composant).toContain("href={`/contacts/${absorbe.contact.id}/fusionner/${survivant.contact.id}`}");
    expect(composant).not.toMatch(/"use client"|onClick|useState|fetch\(/);
    // Un conflit n'a pas de valeur par défaut.
    expect(composant).not.toMatch(/defaultChecked|checked=/);
    expect(composant).toContain('type="radio" name={nom} value="survivant" required');
    expect(composant).toContain('type="radio" name={nom} value="absorbe" required');
    expect(composant).toContain('type="checkbox" name="confirmation" value="oui" required');
    expect(composant).toContain('type="checkbox" name="acquittement" value={avertissement.cle} required');
    expect(composant).not.toMatch(/name="workspaceId"/);
  });

  it("aucun id technique ni jargon de base dans le résumé d'impact", () => {
    expect(composant).not.toMatch(/idsDeplaces|DELETE|UPDATE|partiesProjetSupprimees/);
    expect(composant).toContain("participation en double sera regroupée");
  });
});

describe("fusionnerContactsAction — orchestration seule", () => {
  it("session et workspace depuis le contexte, jamais du formulaire", () => {
    expect(action).toContain("await exigerSessionAtlas()");
    expect(action).toContain("await exigerWorkspaceCourant()");
    expect(action).not.toMatch(/formData\.get\("workspace/);
  });

  it("appelle fusionnerContacts exactement une fois, sans repli ni seconde tentative", () => {
    expect(action.match(/fusionnerContacts\(/g)?.length).toBe(1);
    // La seule boucle lit les quatre choix du formulaire ; aucune boucle n'entoure l'appel au moteur.
    expect(action).not.toMatch(/while\s*\(|retry|reessay|catch\s*\(/);
    expect(action.match(/for\s*\(/g)?.length).toBe(1);
    expect(action.indexOf("for (")).toBeLessThan(action.indexOf("fusionnerContacts("));
  });

  it("n'écrit rien elle-même et n'importe aucun writer", () => {
    expect(action).not.toMatch(/@\/db\/|drizzle-orm|\.(insert|update|delete)\(|transaction\(/);
    expect(action).not.toMatch(/modifierIdentiteContact|marquerContactFusionne|creerContact|rattachementContact/);
  });

  it("les identités attendues viennent de la relecture serveur, jamais d'un champ caché", () => {
    expect(action).toContain("identiteAttendueSurvivant: preparation.survivant.identiteAttendue");
    expect(action).toContain("identiteAttendueAbsorbe: preparation.absorbe.identiteAttendue");
    expect(action).not.toMatch(/identiteAttendue\w*:\s*\{[^}]*formData/);
    // La date vue par la page est comparée à la relecture avant d'appeler le moteur.
    expect(action.indexOf('formData.get("survivantModifieLe")')).toBeLessThan(action.indexOf("fusionnerContacts("));
  });

  it("l'identité finale se déduit du choix et des identités relues : aucune valeur libre, aucune règle par défaut", () => {
    expect(action).toContain("identiteFinale(choixParChamp, preparation.survivant.identiteAttendue, preparation.absorbe.identiteAttendue)");
    expect(action).not.toMatch(/formData\.get\("(nom|prenom|email|telephone)"\)/);
    expect(action).not.toMatch(/plusRecent|plusComplet|nonNull|Math\.max/);
    expect(action).toContain('const CHOIX_VALIDES: readonly ChoixFusionChamp[] = ["survivant", "absorbe", "identique", "absence_comblee"]');
  });

  it("la confirmation est exigée côté serveur, avant toute lecture", () => {
    expect(action.indexOf('formData.get("confirmation") !== "oui"')).toBeLessThan(action.indexOf("preparerFusionContacts("));
  });

  it("chaque résultat du moteur est traduit ; succès → fiche du survivant", () => {
    for (const statut of [
      '"fusionne"',
      '"meme_contact"',
      '"contact_introuvable"',
      '"deja_fusionne"',
      '"identite_modifiee_entre_temps"',
      '"choix_identite_invalide"',
      '"avertissement_reference_externe_requis"',
      '"acquittement_inconnu"',
    ]) {
      expect(action, statut).toContain(`case ${statut}:`);
    }
    expect(action).toContain("redirect(`/contacts/${resultat.contactSurvivantId}`)");
  });
});

describe("preparationFusionContactRepository — lecture, sans similarité comme garde", () => {
  it("n'écrit jamais, n'importe aucun writer ni le moteur, et n'appelle pas la similarité", () => {
    expect(readModel).not.toMatch(/\.(insert|update|delete)\(|transaction\(/);
    expect(readModel).not.toMatch(/fusionContactRepository|contactRepository|rattachementContact|similariteContactRepository|@\/actions/);
    expect(readModel).toContain('import { avertissementsReferencesExternes } from "@/lib/fusionContactAnalyse"');
  });

  it("le workspace est obligatoire et filtré sur les contacts, un absorbé n'est jamais préparé", () => {
    expect(readModel).toContain("eq(contactsTable.workspaceId, workspaceId)");
    expect(readModel).not.toMatch(/workspaceId\?|workspaceId\s*=\s*["'`]/);
    expect(readModel).toContain('if (estContactFusionne(survivant) || estContactFusionne(absorbe)) return { statut: "deja_fusionne" };');
  });
});
