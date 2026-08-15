import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";

// Test d'intégration réel (ADR-036) — même patron que
// src/app/api/automatisations/scan/route.test.ts (ADR-033) pour l'authentification, plus le
// scénario de reprise après crash qui est la raison d'être de cet endpoint (addendum de l'audit,
// §6) : une demande de resynchronisation déjà persistée mais jamais traitée (simulant un crash
// entre le commit de la mutation source et le traitement synchrone) doit être récupérée par le
// balayage, exactement une fois.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";
process.env.COMPATIBILITE_SCAN_SECRET = "secret-de-test-tres-long-et-suffisant";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, compatibilitesBienAcquereurEtat, compatibilitesARessynchroniser, evenementsMetier } =
  await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { POST } = await import("./route");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  if (idsBiensCrees.length > 0 || idsAcquereursCrees.length > 0) {
    await getDb()
      .delete(evenementsMetier)
      .where(or(inArray(evenementsMetier.bienId, idsBiensCrees), inArray(evenementsMetier.acquereurId, idsAcquereursCrees)));
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(
        or(
          inArray(compatibilitesBienAcquereurEtat.bienId, idsBiensCrees),
          inArray(compatibilitesBienAcquereurEtat.acquereurId, idsAcquereursCrees)
        )
      );
    await getDb()
      .delete(compatibilitesARessynchroniser)
      .where(
        or(
          inArray(compatibilitesARessynchroniser.bienId, idsBiensCrees),
          inArray(compatibilitesARessynchroniser.acquereurId, idsAcquereursCrees)
        )
      );
  }
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

function requete(autorisation?: string): Request {
  const headers = new Headers();
  if (autorisation !== undefined) headers.set("authorization", autorisation);
  return new Request("http://localhost/api/compatibilite/scan", { method: "POST", headers });
}

async function creerBienDeTest(suffixe: string, prix = 300000) {
  const bien = await creerBien({
    reference: `[test réel] SCAN-${suffixe}`,
    titre: "Bien de test scan",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 3,
    prix,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerAcquereurDeTest(suffixe: string, budgetMax = 400000) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Scan ${suffixe}`,
    email: `test-réel-scan-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

describe("POST /api/compatibilite/scan — authentification", () => {
  it("401 si l'en-tête Authorization est absent", async () => {
    expect((await POST(requete())).status).toBe(401);
  });

  it("401 si le secret est incorrect", async () => {
    expect((await POST(requete("Bearer mauvais-secret"))).status).toBe(401);
  });

  it("401 si le schéma n'est pas Bearer", async () => {
    expect((await POST(requete("Basic secret-de-test-tres-long-et-suffisant"))).status).toBe(401);
  });

  it("200 avec le secret correct", async () => {
    const reponse = await POST(requete("Bearer secret-de-test-tres-long-et-suffisant"));
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps).toHaveProperty("demandesExaminees");
  });
});

describe("POST /api/compatibilite/scan — reprise après crash simulé", () => {
  it("une demande jamais traitée (crash entre le commit de la mutation et le traitement synchrone) est récupérée exactement une fois", async () => {
    const acquereur = await creerAcquereurDeTest("REPRISE1", 400000);
    const bien = await creerBienDeTest("REPRISE1", 300000); // compatible

    // Simule le crash : la ligne de handoff est posée (comme le ferait creerBienAction dans sa
    // transaction) mais AUCUN traitement synchrone n'a jamais eu lieu ensuite.
    await getDb().insert(compatibilitesARessynchroniser).values({ bienId: bien.id });

    const reponse = await POST(requete("Bearer secret-de-test-tres-long-et-suffisant"));
    expect(reponse.status).toBe(200);

    const [etat] = await getDb()
      .select()
      .from(compatibilitesBienAcquereurEtat)
      .where(and(eq(compatibilitesBienAcquereurEtat.bienId, bien.id), eq(compatibilitesBienAcquereurEtat.acquereurId, acquereur.id)));
    expect(etat?.dernierStatut).toBe("compatible");
    expect(etat?.cycleCompatibilite).toBe(1);

    const evenements = await getDb()
      .select()
      .from(evenementsMetier)
      .where(and(eq(evenementsMetier.bienId, bien.id), eq(evenementsMetier.acquereurId, acquereur.id)));
    expect(evenements).toHaveLength(1);

    const [demande] = await getDb().select().from(compatibilitesARessynchroniser).where(eq(compatibilitesARessynchroniser.bienId, bien.id));
    expect(demande.traiteeLe).not.toBeNull();

    // Double scan : idempotent, aucun événement supplémentaire.
    await POST(requete("Bearer secret-de-test-tres-long-et-suffisant"));
    const evenementsApresSecondScan = await getDb()
      .select()
      .from(evenementsMetier)
      .where(and(eq(evenementsMetier.bienId, bien.id), eq(evenementsMetier.acquereurId, acquereur.id)));
    expect(evenementsApresSecondScan).toHaveLength(1);
  });
});
