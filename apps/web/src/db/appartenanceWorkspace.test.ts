import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

// ADR-054 — vérifications qui ne peuvent PAS être faites hors base : existence réelle du workspace
// historique après migration, comportement effectif du DEFAULT sur un INSERT qui ignore la colonne,
// et refus effectif des contraintes (NOT NULL, FK, CHECK). Le pendant structurel (classement des
// tables, absence de workspace_id sur les feuilles et les secrets) vit dans
// appartenanceWorkspace.structurel.test.ts et ne demande aucune base.
//
// Test d'intégration : exige un Postgres local migré (voir docs/DEVELOPER_ONBOARDING.md, Partie 4).
// La DATABASE_URL est fixée par vitest.setup.ts (garde test/production) — ce `??=` est un no-op.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { biens: biensTable, workspaces: workspacesTable, workspaceMembres } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");

const WORKSPACE_HISTORIQUE = "default";
const SUB_TEST = "[test réel] sub-appartenance-workspace";

const idsBiensCrees: string[] = [];

afterAll(async () => {
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  await getDb().delete(workspaceMembres).where(eq(workspaceMembres.identiteSub, SUB_TEST));
});

function nouveauBien(reference: string) {
  return {
    reference,
    titre: "Bien de test appartenance",
    type: "appartement" as const,
    adresse: "1 rue du Workspace",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif" as const,
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  };
}

describe("ADR-054 — appartenance workspace (intégration Postgres)", () => {
  it("le workspace historique 'default' existe après migration, sans nom inventé", async () => {
    const lignes = await getDb().select().from(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_HISTORIQUE));

    expect(lignes).toHaveLength(1);
    // `nom` reste NULL : la migration n'a fabriqué aucun libellé (ADR-009).
    expect(lignes[0].nom).toBeNull();
  });

  it("une écriture applicative pose explicitement le workspace reçu", async () => {
    // Le repository ne choisit jamais le périmètre : il écrit celui qu'on lui donne. C'est la
    // propriété que la migration 0033 rend obligatoire en retirant le DEFAULT.
    const bien = await creerBien(nouveauBien("[test réel] WS-EXPLICITE-001"), WORKSPACE_HISTORIQUE);
    idsBiensCrees.push(bien.id);

    const [ligne] = await getDb()
      .select({ workspaceId: biensTable.workspaceId })
      .from(biensTable)
      .where(eq(biensTable.id, bien.id));
    expect(ligne.workspaceId).toBe(WORKSPACE_HISTORIQUE);
  });

  it("refuse une insertion brute qui omet workspace_id (DEFAULT retiré par la migration 0033)", async () => {
    // Invariant de sécurité central de ce lot : avant 0033, cette insertion aurait silencieusement
    // rangé la ligne dans le workspace historique. Elle doit désormais échouer immédiatement.
    await expect(
      getDb().execute(sql`
        INSERT INTO biens (reference, titre, type, adresse, ville, code_postal, surface, pieces, prix, date_mandat)
        VALUES ('[test réel] WS-SANS-WORKSPACE-001', 'x', 'appartement', 'x', 'x', '00000', 50, 2, 300000, '2026-01-01')
      `)
    ).rejects.toThrow();
  });

  it("aucune ligne historique des tables racines ne porte un workspace inexistant", async () => {
    // Les FK le garantissent déjà ; ce test vérifie qu'elles sont bien EN PLACE sur la base migrée,
    // pas seulement déclarées dans schema.ts.
    const resultat = await getDb().execute(sql`
      SELECT count(*)::int AS orphelines
      FROM biens b
      LEFT JOIN workspaces w ON w.id = b.workspace_id
      WHERE w.id IS NULL
    `);

    expect((resultat as unknown as { orphelines: number }[])[0].orphelines).toBe(0);
  });

  it("refuse un workspace_id NULL sur une table racine", async () => {
    // SQL brut : le type Drizzle interdit déjà `null` à la compilation — on vérifie ici que la BASE
    // le refuse aussi, seule garantie qui survive à un accès hors application.
    await expect(
      getDb().execute(sql`
        INSERT INTO biens (reference, titre, type, adresse, ville, code_postal, surface, pieces, prix, date_mandat, workspace_id)
        VALUES ('[test réel] WS-NULL-001', 'x', 'appartement', 'x', 'x', '00000', 50, 2, 300000, '2026-01-01', NULL)
      `)
    ).rejects.toThrow();
  });

  it("refuse un workspace_id qui ne référence aucun workspace existant", async () => {
    await expect(
      getDb().execute(sql`
        INSERT INTO biens (reference, titre, type, adresse, ville, code_postal, surface, pieces, prix, date_mandat, workspace_id)
        VALUES ('[test réel] WS-FK-001', 'x', 'appartement', 'x', 'x', '00000', 50, 2, 300000, '2026-01-01', 'workspace-inexistant')
      `)
    ).rejects.toThrow();
  });

  it("accepte une appartenance 'owner' et refuse tout autre rôle", async () => {
    await getDb()
      .insert(workspaceMembres)
      .values({
        workspaceId: WORKSPACE_HISTORIQUE,
        identiteSub: SUB_TEST,
        email: "test@example.test",
        role: "owner",
      });

    const membres = await getDb().select().from(workspaceMembres).where(eq(workspaceMembres.identiteSub, SUB_TEST));
    expect(membres).toHaveLength(1);
    expect(membres[0].role).toBe("owner");

    // La PK composite (workspace_id, identite_sub) interdit un doublon d'appartenance.
    await expect(
      getDb()
        .insert(workspaceMembres)
        .values({
          workspaceId: WORKSPACE_HISTORIQUE,
          identiteSub: SUB_TEST,
          email: "test@example.test",
          role: "owner",
        })
    ).rejects.toThrow();

    // ADR-054 §5 : 'member'/'manager'/'admin' ne sont PAS dans le vocabulaire tant que leur
    // sémantique n'est pas implémentée.
    await expect(
      getDb().execute(sql`
        INSERT INTO workspace_membres (workspace_id, identite_sub, email, role)
        VALUES (${WORKSPACE_HISTORIQUE}, '[test réel] sub-role-invalide', 'test@example.test', 'manager')
      `)
    ).rejects.toThrow();
  });
});
