import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

// ADR-054 — résolution du workspace courant. La session est mockée (même patron que les tests de
// Server Actions, ADR-047) ; l'appartenance, elle, est REELLEMENT lue et écrite en base : c'est
// précisément ce que ce module doit garantir.
const identiteCourante = { sub: "", email: "" };
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockImplementation(async () => identiteCourante),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { workspaceMembres } = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { exigerWorkspaceCourant } = await import("./workspaceCourant");

const SUB_A = "[test réel] sub-workspace-courant-A";
const SUB_B = "[test réel] sub-workspace-courant-B";
const EMAIL_AUTORISE = "conseiller-test@example.test";

function poserIdentite(sub: string, email: string) {
  identiteCourante.sub = sub;
  identiteCourante.email = email;
}

afterEach(async () => {
  for (const sub of [SUB_A, SUB_B]) {
    await getDb().delete(workspaceMembres).where(eq(workspaceMembres.identiteSub, sub));
  }
  delete process.env.ATLAS_ALLOWED_EMAIL;
  vi.unstubAllEnvs();
});

describe("exigerWorkspaceCourant — résolution et bootstrap", () => {
  it("bootstrappe l'appartenance owner à la première résolution, puis est idempotent", async () => {
    vi.stubEnv("ATLAS_ALLOWED_EMAIL", EMAIL_AUTORISE);
    poserIdentite(SUB_A, EMAIL_AUTORISE);

    const premier = await exigerWorkspaceCourant();
    expect(premier).toBe(WORKSPACE_TEST);

    // Rejoué : aucune seconde ligne, aucun doublon, même résultat.
    const second = await exigerWorkspaceCourant();
    expect(second).toBe(WORKSPACE_TEST);

    const lignes = await getDb().select().from(workspaceMembres).where(eq(workspaceMembres.identiteSub, SUB_A));
    expect(lignes).toHaveLength(1);
    expect(lignes[0].role).toBe("owner");
    expect(lignes[0].email).toBe(EMAIL_AUTORISE);
  });

  it("réutilise une appartenance existante sans jamais la modifier", async () => {
    await getDb()
      .insert(workspaceMembres)
      .values({ workspaceId: WORKSPACE_TEST, identiteSub: SUB_A, email: "ancien@example.test", role: "owner" });

    // Allowlist volontairement absente : une appartenance déjà établie n'a pas à être revalidée,
    // la résolution ne doit donc lire ni l'allowlist ni l'environnement dans ce cas.
    poserIdentite(SUB_A, EMAIL_AUTORISE);
    await expect(exigerWorkspaceCourant()).resolves.toBe(WORKSPACE_TEST);

    const [ligne] = await getDb().select().from(workspaceMembres).where(eq(workspaceMembres.identiteSub, SUB_A));
    expect(ligne.email).toBe("ancien@example.test");
  });

  it("refuse une identité non autorisée plutôt que de lui créer une appartenance", async () => {
    vi.stubEnv("ATLAS_ALLOWED_EMAIL", EMAIL_AUTORISE);
    poserIdentite(SUB_B, "intrus@example.test");

    await expect(exigerWorkspaceCourant()).rejects.toThrow(/non autorisée/i);

    const lignes = await getDb().select().from(workspaceMembres).where(eq(workspaceMembres.identiteSub, SUB_B));
    expect(lignes).toHaveLength(0);
  });

  it("échoue si l'allowlist n'est pas configurée (fail-closed, ADR-047)", async () => {
    poserIdentite(SUB_B, EMAIL_AUTORISE);
    await expect(exigerWorkspaceCourant()).rejects.toThrow();

    const lignes = await getDb().select().from(workspaceMembres).where(eq(workspaceMembres.identiteSub, SUB_B));
    expect(lignes).toHaveLength(0);
  });

  it("refuse de choisir quand plusieurs appartenances existent (FAIL CLOSED, aucun choix arbitraire)", async () => {
    // Situation impossible aujourd'hui (un seul workspace) mais qui doit échouer bruyamment si elle
    // survenait : choisir le premier écrirait des données dans un périmètre que personne n'a désigné.
    const [autreWorkspace] = await getDb()
      .insert((await import("@/db/schema")).workspaces)
      .values({ id: "[test réel] workspace-secondaire" })
      .returning({ id: (await import("@/db/schema")).workspaces.id });

    try {
      await getDb().insert(workspaceMembres).values([
        { workspaceId: WORKSPACE_TEST, identiteSub: SUB_A, email: EMAIL_AUTORISE, role: "owner" },
        { workspaceId: autreWorkspace.id, identiteSub: SUB_A, email: EMAIL_AUTORISE, role: "owner" },
      ]);

      poserIdentite(SUB_A, EMAIL_AUTORISE);
      await expect(exigerWorkspaceCourant()).rejects.toThrow(/plusieurs appartenances/i);
    } finally {
      const { workspaces } = await import("@/db/schema");
      await getDb()
        .delete(workspaceMembres)
        .where(and(eq(workspaceMembres.identiteSub, SUB_A), eq(workspaceMembres.workspaceId, autreWorkspace.id)));
      await getDb().delete(workspaces).where(eq(workspaces.id, autreWorkspace.id));
    }
  });
});
