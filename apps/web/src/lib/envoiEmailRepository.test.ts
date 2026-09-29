import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { envoisEmail: envoisEmailTable, workspaces: workspacesTable } = await import("@/db/schema");
const {
  calculerContenuHash,
  demarrerTentativeEnvoi,
  getEnvoiEmailDuWorkspace,
  marquerEnvoiEchoue,
  marquerEnvoiIncertain,
  marquerEnvoiReussi,
} = await import("./envoiEmailRepository");
const { deriverEtatEnvoiEmail } = await import("@/types/envoiEmail");

const idsCrees: string[] = [];
afterAll(async () => {
  for (const id of idsCrees) await getDb().delete(envoisEmailTable).where(eq(envoisEmailTable.id, id));
});

describe("calculerContenuHash", () => {
  it("est déterministe pour un même contenu, différent si le contenu diffère", () => {
    const a = calculerContenuHash("jean@test.local", "Objet", "Corps");
    const b = calculerContenuHash("jean@test.local", "Objet", "Corps");
    const c = calculerContenuHash("jean@test.local", "Objet", "Corps différent");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("envoiEmailRepository — idempotence", () => {
  it("demarrerTentativeEnvoi() insère une première fois, retourne undefined en cas de rejeu de la même clé", async () => {
    const id = randomUUID();
    idsCrees.push(id);
    const contenuHash = calculerContenuHash("jean@test.local", "Objet", "Corps");

    const premiere = await demarrerTentativeEnvoi({ id, workspaceId: WORKSPACE_TEST, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });
    expect(premiere).toBeDefined();
    expect(deriverEtatEnvoiEmail(premiere!)).toBe("en_cours");

    // Jamais un second envoi : rejouer exactement la même clé ne réécrit rien.
    const seconde = await demarrerTentativeEnvoi({ id, workspaceId: WORKSPACE_TEST, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });
    expect(seconde).toBeUndefined();

    const relue = await getEnvoiEmailDuWorkspace(id, WORKSPACE_TEST);
    expect(relue).toBeDefined();
  });

  it("marquerEnvoiReussi(, WORKSPACE_TEST) pose reussiLe et gmailMessageId, dérive l'état 'envoye'", async () => {
    const id = randomUUID();
    idsCrees.push(id);
    const contenuHash = calculerContenuHash("jean@test.local", "Objet", "Corps");
    await demarrerTentativeEnvoi({ id, workspaceId: WORKSPACE_TEST, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });

    const resultat = await marquerEnvoiReussi(id, "gmail-msg-1", WORKSPACE_TEST);
    expect(resultat).toBeDefined();
    expect(deriverEtatEnvoiEmail(resultat!)).toBe("envoye");
    expect(resultat!.gmailMessageId).toBe("gmail-msg-1");
  });

  it("marquerEnvoiEchoue(, WORKSPACE_TEST) pose echoueLe, dérive l'état 'echec'", async () => {
    const id = randomUUID();
    idsCrees.push(id);
    const contenuHash = calculerContenuHash("jean@test.local", "Objet", "Corps");
    await demarrerTentativeEnvoi({ id, workspaceId: WORKSPACE_TEST, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });

    const resultat = await marquerEnvoiEchoue(id, "erreur_google_500", WORKSPACE_TEST);
    expect(deriverEtatEnvoiEmail(resultat!)).toBe("echec");
  });

  it("marquerEnvoiIncertain(, WORKSPACE_TEST) pose incertainLe, dérive l'état 'incertain', distinct de 'echec'", async () => {
    const id = randomUUID();
    idsCrees.push(id);
    const contenuHash = calculerContenuHash("jean@test.local", "Objet", "Corps");
    await demarrerTentativeEnvoi({ id, workspaceId: WORKSPACE_TEST, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });

    const resultat = await marquerEnvoiIncertain(id, "reseau_ou_timeout", WORKSPACE_TEST);
    expect(deriverEtatEnvoiEmail(resultat!)).toBe("incertain");
  });

  it("gel concurrent : une tentative déjà résolue (succès) ne peut plus jamais être réécrite", async () => {
    const id = randomUUID();
    idsCrees.push(id);
    const contenuHash = calculerContenuHash("jean@test.local", "Objet", "Corps");
    await demarrerTentativeEnvoi({ id, workspaceId: WORKSPACE_TEST, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });
    await marquerEnvoiReussi(id, "gmail-msg-2", WORKSPACE_TEST);

    const rejeuEchec = await marquerEnvoiEchoue(id, "tentative_tardive", WORKSPACE_TEST);
    expect(rejeuEchec).toBeUndefined();
    const relue = await getEnvoiEmailDuWorkspace(id, WORKSPACE_TEST);
    expect(deriverEtatEnvoiEmail(relue!)).toBe("envoye"); // inchangé
  });
});

// GLOBAL_READER_GUARD_EXTENSION_V1 — la clé d'idempotence d'un envoi est fournie par le NAVIGATEUR.
// Les accesseurs ne portaient aucun périmètre alors que la table en a un : un id d'un autre
// workspace rendait son état (`envoye` / `echec` / `incertain`), c'est-à-dire un oracle sur
// l'activité de quelqu'un d'autre. Ce qui est vérifié ici n'est pas qu'un état précis est caché,
// mais que TOUS les états deviennent indistinguables d'un id jamais utilisé.
describe("Frontière workspace — envois d'email", () => {
  const WORKSPACE_B = `ws-envoi-${Date.now()}`;
  const idsB: string[] = [];

  beforeAll(async () => {
    await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] envois B" });
  });

  afterAll(async () => {
    if (idsB.length > 0) await getDb().delete(envoisEmailTable).where(inArray(envoisEmailTable.id, idsB));
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, [WORKSPACE_B]));
  });

  async function unEnvoiDansB(resolution?: "reussi" | "echoue" | "incertain") {
    const id = randomUUID();
    idsB.push(id);
    const contenuHash = calculerContenuHash("confidentiel@b.test", "Objet B", "Corps B");
    await demarrerTentativeEnvoi({
      id,
      workspaceId: WORKSPACE_B,
      destinataireEmail: "confidentiel@b.test",
      objet: "Objet B",
      contenuHash,
    });
    if (resolution === "reussi") await marquerEnvoiReussi(id, "gmail-b", WORKSPACE_B);
    if (resolution === "echoue") await marquerEnvoiEchoue(id, "erreur-b", WORKSPACE_B);
    if (resolution === "incertain") await marquerEnvoiIncertain(id, "incertain-b", WORKSPACE_B);
    return id;
  }

  it("tous les états d'un envoi de B sont indistinguables depuis A : introuvable", async () => {
    for (const resolution of [undefined, "reussi", "echoue", "incertain"] as const) {
      const id = await unEnvoiDansB(resolution);
      expect(await getEnvoiEmailDuWorkspace(id, WORKSPACE_TEST), `état ${resolution ?? "en_cours"}`).toBeUndefined();
    }
  });

  it("contre-épreuve — chacun de ces envois reste parfaitement lisible depuis B", async () => {
    const id = await unEnvoiDansB("reussi");
    const lu = await getEnvoiEmailDuWorkspace(id, WORKSPACE_B);
    expect(lu).toBeDefined();
    expect(lu!.gmailMessageId).toBe("gmail-b");
  });

  it("A ne peut pas résoudre la tentative de B : la ligne de B reste intacte", async () => {
    const id = await unEnvoiDansB();

    expect(await marquerEnvoiReussi(id, "gmail-vole-par-a", WORKSPACE_TEST)).toBeUndefined();

    const depuisB = await getEnvoiEmailDuWorkspace(id, WORKSPACE_B);
    expect(depuisB).toBeDefined();
    expect(depuisB!.gmailMessageId).toBeUndefined();
    expect(depuisB!.reussiLe).toBeUndefined();
  });
});
