import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — gardes STRUCTURELLES, sur le même modèle que
// frontiereWorkspace.structurel.test.ts : elles ne prouvent rien par elles-mêmes, elles empêchent
// une régression silencieuse de ce que ce lot a délibérément NE PAS fait.
//
// Les trois régressions qu'elles visent sont celles qui passeraient le plus facilement inaperçues :
// publier une notice avant que les durées soient appliquées, modifier le parcours du bon de visite
// en croyant « ajouter l'information RGPD », et poser l'écran d'identité sans garde de rôle.

const SRC = join(__dirname, "..", "..");
const lire = (chemin: string) => readFileSync(chemin, "utf8");
const codeSeul = (chemin: string) =>
  lire(chemin)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

function listerFichiers(racine: string, filtre: (chemin: string) => boolean): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(racine)) {
    const chemin = join(racine, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...listerFichiers(chemin, filtre));
    else if (filtre(chemin)) trouves.push(chemin);
  }
  return trouves;
}

const ECRAN_CONFIG = join(SRC, "app", "parametres", "confidentialite", "page.tsx");
const ACTION = join(SRC, "actions", "identiteResponsablePrivacy.ts");
const GARDE_OWNER = join(SRC, "lib", "auth", "ownerWorkspaceCourant.ts");

describe("T22 — aucune page publique de confidentialité n'est activée", () => {
  it("aucune route publique n'a été ajoutée au proxy", () => {
    const proxy = codeSeul(join(SRC, "proxy.ts"));
    // PRIVATE BY DEFAULT (ADR-047) : la liste des chemins publics reste celle de l'authentification.
    expect(proxy).toContain('CHEMINS_PUBLICS = new Set(["/connexion", "/api/auth/atlas/login", "/api/auth/atlas/callback"])');
    expect(proxy).not.toMatch(/confidentialite|privacy|mentions|legal/i);
  });

  it("aucune route /privacy, /confidentialite publique ou /mentions-legales n'existe", () => {
    const pages = listerFichiers(join(SRC, "app"), (chemin) => chemin.endsWith("page.tsx"));
    const publiques = pages.filter((chemin) => /\/(privacy|mentions-legales|politique-confidentialite)\//.test(chemin));
    expect(publiques).toEqual([]);
    // Le seul écran de ce lot est sous /parametres, donc derrière la session.
    const privacyPages = pages.filter((chemin) => /confidentialite/.test(chemin));
    expect(privacyPages).toHaveLength(1);
    expect(privacyPages[0]).toContain(join("app", "parametres", "confidentialite"));
  });

  it("l'écran de configuration n'affiche aucun texte de notice destiné aux personnes concernées", () => {
    const ecran = lire(ECRAN_CONFIG);
    // Il parle au propriétaire du workspace, jamais à une personne concernée : aucune formule
    // d'information à la première personne, aucune mention de droits présentée comme une notice.
    expect(ecran).not.toMatch(/vos données|vous disposez d|droit d.accès|réclamation/i);
    // Le JSX coupe les phrases : on normalise les blancs avant de chercher la formule.
    expect(ecran.replace(/\s+/g, " ")).toMatch(/ne sont pas encore publiées/i);
  });
});

describe("T23 — le parcours du bon de visite est inchangé", () => {
  const FICHIERS_BON_VISITE = [
    join(SRC, "lib", "bonVisite", "templateBonVisite.ts"),
    join(SRC, "lib", "bonVisite", "pdfBonVisite.ts"),
    join(SRC, "components", "visite", "BonVisiteSignatureForm.tsx"),
    join(SRC, "actions", "bonVisite.ts"),
    join(SRC, "lib", "bonVisiteRepository.ts"),
  ];

  it("aucun fichier du bon de visite ne référence la gouvernance privacy", () => {
    for (const fichier of FICHIERS_BON_VISITE) {
      const code = codeSeul(fichier);
      expect(code, fichier).not.toMatch(/lib\/privacy|PRIVACY_NOTICE|identiteResponsable|privacyRightsEmail/);
    }
  });

  it("les deux textes de consentement de signature sont intacts", () => {
    const template = lire(join(SRC, "lib", "bonVisite", "templateBonVisite.ts"));
    expect(template).toContain(
      "Je reconnais avoir pris connaissance du présent bon de visite, confirme l'exactitude des "
    );
    expect(template).toContain("Je reconnais avoir pris connaissance du texte ci-dessus et je le signe volontairement.");
    expect(template).toContain('VERSION_TEMPLATE_BON_VISITE_V2 = "domiora-v2"');
  });

  it("aucun bloc d'information RGPD n'a été inséré dans le formulaire de signature", () => {
    const formulaire = lire(join(SRC, "components", "visite", "BonVisiteSignatureForm.tsx"));
    expect(formulaire).not.toMatch(/RGPD|responsable du traitement|données personnelles|confidentialité/i);
  });

  it("le template du bon de visite ne gagne aucune version", () => {
    const template = lire(join(SRC, "lib", "bonVisite", "templateBonVisite.ts"));
    expect(template).not.toContain("domiora-v3");
  });
});

describe("T3 / T4 / T5 — gardes de l'écran et de l'action", () => {
  it("l'écran exige le propriétaire du workspace en première instruction", () => {
    const ecran = codeSeul(ECRAN_CONFIG);
    expect(ecran).toContain("exigerOwnerWorkspaceCourant()");
    // Aucune lecture avant la garde.
    expect(ecran.indexOf("exigerOwnerWorkspaceCourant()")).toBeLessThan(ecran.indexOf("getIdentiteResponsable("));
  });

  it("l'action exige la session puis le propriétaire, et ne lit aucun workspaceId du formulaire", () => {
    const action = codeSeul(ACTION);
    expect(action).toContain("exigerSessionAtlas()");
    expect(action).toContain("exigerOwnerWorkspaceCourant()");
    expect(action.indexOf("exigerSessionAtlas()")).toBeLessThan(action.indexOf("exigerOwnerWorkspaceCourant()"));
    // C'est ce qui rend une écriture inter-workspace impossible à FORMULER : il n'y a rien à
    // falsifier dans le formulaire.
    expect(action).not.toMatch(/formData\.get\(["']workspace/i);
    expect(action).not.toContain("exigerWorkspaceCourant()");
  });

  it("la garde de rôle est fail-closed et n'accepte que owner", () => {
    const garde = codeSeul(GARDE_OWNER);
    expect(garde).toContain('role !== "owner"');
    expect(garde).not.toMatch(/\?\?\s*["']owner["']|\|\|\s*["']owner["']/);
  });

  it("l'écran ne prend aucun paramètre d'URL : il porte toujours sur le workspace de la session", () => {
    const ecran = codeSeul(ECRAN_CONFIG);
    expect(ecran).not.toMatch(/params|searchParams/);
  });

  it("seul le repository privacy écrit les colonnes d'identité du responsable", () => {
    const fichiers = listerFichiers(SRC, (chemin) => chemin.endsWith(".ts") || chemin.endsWith(".tsx"));
    const ecrivains = fichiers.filter((chemin) => {
      if (chemin.includes("workspacePrivacyRepository.ts")) return false;
      if (chemin.includes(".test.")) return false;
      const code = codeSeul(chemin);
      // Une ÉCRITURE Drizzle sur ces colonnes, pas une déclaration de type qui les nomme :
      // `identiteResponsable.ts` décrit la forme de l'identité et ne doit pas être compté.
      return /\.set\(/.test(code) && /controllerLegalName|privacyIdentityModifieLe/.test(code);
    });
    // Convention ADR-007 : seuls les *Repository.ts parlent à Postgres, et ici un seul le fait.
    expect(ecrivains).toEqual([]);
  });
});

describe("le lot ne crée ni purge, ni consentement marketing, ni tracking d'information", () => {
  it("aucun moteur de purge n'est introduit", () => {
    const fichiersPrivacy = listerFichiers(
      join(SRC, "lib", "privacy"),
      // Les fichiers de test sont exclus : celui-ci cite les motifs interdits pour les chercher.
      (chemin) => chemin.endsWith(".ts") && !chemin.includes(".test.")
    );
    for (const fichier of fichiersPrivacy) {
      const code = codeSeul(fichier);
      expect(code, fichier).not.toMatch(/\.delete\(|DELETE FROM|purge\(|TRUNCATE|setInterval|cron/i);
    }
  });

  it("aucune colonne de consentement marketing n'est ajoutée au schéma", () => {
    const schema = codeSeul(join(SRC, "db", "schema.ts"));
    expect(schema).not.toMatch(/marketingConsent|optIn|consentAt|marketing_consent|opt_in|consent_at/i);
  });

  it("aucun tracking de remise d'information Article 14 n'est ajouté au schéma", () => {
    const schema = codeSeul(join(SRC, "db", "schema.ts"));
    expect(schema).not.toMatch(/privacyInformationDeliveredAt|informationRemiseLe|noticeDeliveredAt/i);
  });

  it("le schéma fiscal n'est pas touché par ce lot", () => {
    const schema = codeSeul(join(SRC, "db", "schema.ts"));
    // Les quatre tables fiscales conservent exactement leurs colonnes d'origine : le bloc de
    // `dossierFiscal` est isolé du CODE (commentaires retirés — ils parlent abondamment de
    // workspace_id pour expliquer pourquoi la colonne n'y est PAS).
    expect(schema).toContain("export const dossierFiscal = pgTable(");
    const blocFiscal = schema.slice(
      schema.indexOf("export const dossierFiscal = pgTable("),
      schema.indexOf("export const profilFiscal = pgTable(")
    );
    expect(blocFiscal).not.toMatch(/workspaceId|workspace_id/);
    expect(blocFiscal).not.toMatch(/controller|privacy/i);
  });

  it("les treize colonnes privacy du workspace sont toutes nullables", () => {
    const schema = lire(join(SRC, "db", "schema.ts"));
    const bloc = schema.slice(schema.indexOf('export const workspaces = pgTable('), schema.indexOf("export const workspaceMembres"));
    for (const colonne of [
      "controller_legal_name",
      "controller_legal_form",
      "controller_trade_name",
      "controller_address_line1",
      "controller_address_line2",
      "controller_postal_code",
      "controller_city",
      "controller_country_code",
      "controller_siren",
      "privacy_rights_email",
      "dpo_name",
      "dpo_email",
      "privacy_identity_modifie_le",
    ]) {
      expect(bloc, colonne).toContain(`"${colonne}"`);
      // Aucun .notNull() ni .default() sur ces colonnes : la ligne entière est vérifiée.
      const ligne = bloc.split("\n").find((l) => l.includes(`"${colonne}"`)) ?? "";
      expect(ligne, colonne).not.toMatch(/notNull\(\)|\.default\(/);
    }
  });

  it("la migration 0059 est additive : aucun DROP, aucun UPDATE, aucun NOT NULL", () => {
    const migration = readFileSync(
      join(SRC, "db", "migrations", "0059_workspace_privacy_identity.sql"),
      "utf8"
    )
      .split("\n")
      .filter((ligne) => !ligne.trim().startsWith("--"))
      .join("\n");
    expect(migration).not.toMatch(/DROP|UPDATE|DELETE|SET NOT NULL|DEFAULT/i);
    expect(migration.match(/ADD COLUMN/g)).toHaveLength(13);
    expect(migration.match(/ADD CONSTRAINT/g)).toHaveLength(2);
  });
});
