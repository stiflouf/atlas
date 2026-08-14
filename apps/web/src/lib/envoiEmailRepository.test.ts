import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { envoisEmail: envoisEmailTable } = await import("@/db/schema");
const {
  calculerContenuHash,
  demarrerTentativeEnvoi,
  getEnvoiEmailById,
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

    const premiere = await demarrerTentativeEnvoi({ id, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });
    expect(premiere).toBeDefined();
    expect(deriverEtatEnvoiEmail(premiere!)).toBe("en_cours");

    // Jamais un second envoi : rejouer exactement la même clé ne réécrit rien.
    const seconde = await demarrerTentativeEnvoi({ id, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });
    expect(seconde).toBeUndefined();

    const relue = await getEnvoiEmailById(id);
    expect(relue).toBeDefined();
  });

  it("marquerEnvoiReussi() pose reussiLe et gmailMessageId, dérive l'état 'envoye'", async () => {
    const id = randomUUID();
    idsCrees.push(id);
    const contenuHash = calculerContenuHash("jean@test.local", "Objet", "Corps");
    await demarrerTentativeEnvoi({ id, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });

    const resultat = await marquerEnvoiReussi(id, "gmail-msg-1");
    expect(resultat).toBeDefined();
    expect(deriverEtatEnvoiEmail(resultat!)).toBe("envoye");
    expect(resultat!.gmailMessageId).toBe("gmail-msg-1");
  });

  it("marquerEnvoiEchoue() pose echoueLe, dérive l'état 'echec'", async () => {
    const id = randomUUID();
    idsCrees.push(id);
    const contenuHash = calculerContenuHash("jean@test.local", "Objet", "Corps");
    await demarrerTentativeEnvoi({ id, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });

    const resultat = await marquerEnvoiEchoue(id, "erreur_google_500");
    expect(deriverEtatEnvoiEmail(resultat!)).toBe("echec");
  });

  it("marquerEnvoiIncertain() pose incertainLe, dérive l'état 'incertain', distinct de 'echec'", async () => {
    const id = randomUUID();
    idsCrees.push(id);
    const contenuHash = calculerContenuHash("jean@test.local", "Objet", "Corps");
    await demarrerTentativeEnvoi({ id, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });

    const resultat = await marquerEnvoiIncertain(id, "reseau_ou_timeout");
    expect(deriverEtatEnvoiEmail(resultat!)).toBe("incertain");
  });

  it("gel concurrent : une tentative déjà résolue (succès) ne peut plus jamais être réécrite", async () => {
    const id = randomUUID();
    idsCrees.push(id);
    const contenuHash = calculerContenuHash("jean@test.local", "Objet", "Corps");
    await demarrerTentativeEnvoi({ id, destinataireEmail: "jean@test.local", objet: "Objet", contenuHash });
    await marquerEnvoiReussi(id, "gmail-msg-2");

    const rejeuEchec = await marquerEnvoiEchoue(id, "tentative_tardive");
    expect(rejeuEchec).toBeUndefined();
    const relue = await getEnvoiEmailById(id);
    expect(deriverEtatEnvoiEmail(relue!)).toBe("envoye"); // inchangé
  });
});
