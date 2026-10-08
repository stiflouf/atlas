import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — ce que seule une vraie base peut prouver : que la
// migration 0059 laisse le workspace historique INTACT, qu'elle n'a inventé aucune identité, et que
// les deux CHECK refusent effectivement une forme invalide tout en laissant passer l'absence.
//
// Le pendant hors base (complétude, validation de saisie, décisions versionnées) vit dans
// src/lib/privacy/*.test.ts et ne demande aucun Postgres.
//
// Test d'intégration : exige un Postgres local migré (voir docs/DEVELOPER_ONBOARDING.md, Partie 4).
// La DATABASE_URL est fixée par vitest.setup.ts (garde test/production) — ce `??=` est un no-op.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { workspaces: workspacesTable } = await import("@/db/schema");
const { getIdentiteResponsable, enregistrerIdentiteResponsable } = await import("@/lib/workspacePrivacyRepository");
const { identiteResponsablePrete, champsManquantsPourNotice } = await import("@/lib/privacy/identiteResponsable");
const { roleDansWorkspace } = await import("@/lib/workspaceRepository");

const WORKSPACE_HISTORIQUE = "default";
// Second workspace créé pour ce fichier : c'est le seul moyen d'éprouver un refus de périmètre
// sans toucher au workspace historique, dont l'intégrité est précisément l'objet de T1.
const WORKSPACE_ETRANGER = "[test réel] workspace-privacy-etranger";

const CHAMPS_VIDES = {
  controllerLegalName: null,
  controllerLegalForm: null,
  controllerTradeName: null,
  controllerAddressLine1: null,
  controllerAddressLine2: null,
  controllerPostalCode: null,
  controllerCity: null,
  controllerCountryCode: null,
  controllerSiren: null,
  privacyRightsEmail: null,
  dpoName: null,
  dpoEmail: null,
};

afterAll(async () => {
  // Le workspace historique est REMIS À NULL, pas laissé renseigné : ces tests ne doivent pas
  // doter la base de développement d'une identité juridique fictive.
  await getDb()
    .update(workspacesTable)
    .set({ ...CHAMPS_VIDES, privacyIdentityModifieLe: null })
    .where(eq(workspacesTable.id, WORKSPACE_HISTORIQUE));
  await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_ETRANGER));
});

describe("T1 / T2 — migration additive sans backfill", () => {
  it("T1 — le workspace historique existe toujours après la migration", async () => {
    const identite = await getIdentiteResponsable(WORKSPACE_HISTORIQUE);
    expect(identite).not.toBeNull();
  });

  it("T2 — aucun backfill : les treize colonnes sont nulles sur une base migrée", async () => {
    // Lu en SQL direct plutôt que par le repository : on vérifie l'état des COLONNES, pas la
    // capacité du mapper à rendre des null. Le driver `postgres` rend un tableau de lignes, pas un
    // objet `{ rows }` — même forme de cast que appartenanceWorkspace.test.ts.
    const resultat = await getDb().execute(sql`
      SELECT controller_legal_name, controller_legal_form, controller_trade_name,
             controller_address_line1, controller_address_line2, controller_postal_code,
             controller_city, controller_country_code, controller_siren,
             privacy_rights_email, dpo_name, dpo_email, privacy_identity_modifie_le
      FROM workspaces WHERE id = ${WORKSPACE_HISTORIQUE}
    `);
    const lignes = resultat as unknown as Record<string, unknown>[];
    expect(lignes).toHaveLength(1);
    for (const [colonne, valeur] of Object.entries(lignes[0])) {
      expect(valeur, colonne).toBeNull();
    }
  });

  it("le nom d'affichage du workspace n'a pas été recopié en raison sociale", async () => {
    // Le seul repli qui aurait été techniquement possible, et qui aurait été faux.
    const resultat = await getDb().execute(sql`
      SELECT nom, controller_legal_name FROM workspaces WHERE id = ${WORKSPACE_HISTORIQUE}
    `);
    const lignes = resultat as unknown as { controller_legal_name: unknown }[];
    expect(lignes[0].controller_legal_name).toBeNull();
  });

  it("un workspace sans identité privacy est exploitable : l'état est incomplet, pas en erreur", async () => {
    const identite = await getIdentiteResponsable(WORKSPACE_HISTORIQUE);
    if (!identite) throw new Error("workspace historique introuvable");
    expect(identiteResponsablePrete(identite)).toBe(false);
    expect(champsManquantsPourNotice(identite).length).toBeGreaterThan(0);
  });

  it("un workspace inexistant rend null, distinct d'une identité vide", async () => {
    expect(await getIdentiteResponsable("[test réel] workspace-absent")).toBeNull();
  });
});

describe("T3 — enregistrement de l'identité", () => {
  it("l'identité enregistrée est relue à l'identique et devient prête", async () => {
    const enregistree = await enregistrerIdentiteResponsable(WORKSPACE_HISTORIQUE, {
      ...CHAMPS_VIDES,
      controllerLegalName: "Camille Dupré",
      controllerLegalForm: "EI",
      controllerAddressLine1: "12 rue des Lilas",
      controllerPostalCode: "75011",
      controllerCity: "Paris",
      controllerCountryCode: "FR",
      privacyRightsEmail: "droits@exemple.test",
    });
    expect(enregistree).not.toBeNull();
    if (!enregistree) throw new Error("écriture sans retour");
    expect(enregistree.controllerLegalName).toBe("Camille Dupré");
    expect(identiteResponsablePrete(enregistree)).toBe(true);
    // La date de dernière modification est posée par le writer, jamais par l'appelant.
    expect(enregistree.privacyIdentityModifieLe).toBeInstanceOf(Date);

    const relue = await getIdentiteResponsable(WORKSPACE_HISTORIQUE);
    expect(relue?.controllerLegalName).toBe("Camille Dupré");
    expect(relue?.privacyRightsEmail).toBe("droits@exemple.test");
  });

  it("un champ vidé redevient NULL : une valeur renseignée reste effaçable", async () => {
    await enregistrerIdentiteResponsable(WORKSPACE_HISTORIQUE, {
      ...CHAMPS_VIDES,
      controllerLegalName: "Camille Dupré",
      controllerSiren: "123456789",
    });
    const avec = await getIdentiteResponsable(WORKSPACE_HISTORIQUE);
    expect(avec?.controllerSiren).toBe("123456789");

    await enregistrerIdentiteResponsable(WORKSPACE_HISTORIQUE, {
      ...CHAMPS_VIDES,
      controllerLegalName: "Camille Dupré",
    });
    const sans = await getIdentiteResponsable(WORKSPACE_HISTORIQUE);
    expect(sans?.controllerSiren).toBeNull();
  });

  it("une personne morale s'enregistre aussi bien qu'une personne physique", async () => {
    const societe = await enregistrerIdentiteResponsable(WORKSPACE_HISTORIQUE, {
      ...CHAMPS_VIDES,
      controllerLegalName: "Agence Lilas SAS",
      controllerLegalForm: "SAS",
      controllerTradeName: "Lilas Immobilier",
      controllerSiren: "987654321",
      controllerAddressLine1: "3 avenue du Parc",
      controllerPostalCode: "69003",
      controllerCity: "Lyon",
      controllerCountryCode: "FR",
      privacyRightsEmail: "rgpd@lilas.test",
    });
    expect(societe?.controllerLegalForm).toBe("SAS");
    expect(identiteResponsablePrete(societe!)).toBe(true);
  });

  it("un workspace inexistant ne crée rien et rend null", async () => {
    const resultat = await enregistrerIdentiteResponsable("[test réel] workspace-absent", {
      ...CHAMPS_VIDES,
      controllerLegalName: "Ne doit pas exister",
    });
    expect(resultat).toBeNull();
  });
});

describe("T5 — frontière de workspace", () => {
  it("écrire dans un workspace ne touche jamais l'identité d'un autre", async () => {
    await getDb().insert(workspacesTable).values({ id: WORKSPACE_ETRANGER, nom: "Workspace étranger" }).onConflictDoNothing();

    await enregistrerIdentiteResponsable(WORKSPACE_HISTORIQUE, {
      ...CHAMPS_VIDES,
      controllerLegalName: "Responsable du workspace historique",
      privacyRightsEmail: "historique@exemple.test",
    });

    // Le workspace étranger n'a jamais été ciblé : son identité reste vide.
    const etranger = await getIdentiteResponsable(WORKSPACE_ETRANGER);
    expect(etranger).not.toBeNull();
    expect(etranger?.controllerLegalName).toBeNull();
    expect(etranger?.privacyRightsEmail).toBeNull();
  });

  it("T4 — une identité non membre n'a aucun rôle, donc n'est pas propriétaire", async () => {
    // La garde `exigerOwnerWorkspaceCourant` refuse tout ce qui n'est pas exactement 'owner' :
    // ici on prouve que la source de ce rôle rend bien `null` pour un non-membre.
    expect(await roleDansWorkspace(WORKSPACE_HISTORIQUE, "[test réel] sub-non-membre")).toBeNull();
    expect(await roleDansWorkspace(WORKSPACE_ETRANGER, "[test réel] sub-non-membre")).toBeNull();
  });
});

describe("T6 / T7 — contraintes de forme en base", () => {
  it("un SIREN non conforme est refusé par la base, même en contournant la validation applicative", async () => {
    await expect(
      getDb().execute(sql`UPDATE workspaces SET controller_siren = '1234' WHERE id = ${WORKSPACE_HISTORIQUE}`)
    ).rejects.toThrow();
    await expect(
      getDb().execute(sql`UPDATE workspaces SET controller_siren = '12345678A' WHERE id = ${WORKSPACE_HISTORIQUE}`)
    ).rejects.toThrow();
  });

  it("un code pays non conforme est refusé par la base", async () => {
    await expect(
      getDb().execute(sql`UPDATE workspaces SET controller_country_code = 'FRA' WHERE id = ${WORKSPACE_HISTORIQUE}`)
    ).rejects.toThrow();
    await expect(
      getDb().execute(sql`UPDATE workspaces SET controller_country_code = 'fr' WHERE id = ${WORKSPACE_HISTORIQUE}`)
    ).rejects.toThrow();
  });

  it("les deux CHECK laissent passer l'absence : c'est ce qui rend la migration applicable", async () => {
    await expect(
      getDb().execute(
        sql`UPDATE workspaces SET controller_siren = NULL, controller_country_code = NULL WHERE id = ${WORKSPACE_HISTORIQUE}`
      )
    ).resolves.toBeDefined();
  });

  it("aucun CHECK d'email n'est posé : la validation reste applicative", async () => {
    // Décision assumée (ADR-065 §5) : le dépôt n'a aucun pattern SQL d'email sur ses quatre
    // colonnes d'email existantes. Ce test documente le choix plutôt que de le laisser deviner.
    await expect(
      getDb().execute(sql`UPDATE workspaces SET privacy_rights_email = 'pas-un-email' WHERE id = ${WORKSPACE_HISTORIQUE}`)
    ).resolves.toBeDefined();
  });
});
