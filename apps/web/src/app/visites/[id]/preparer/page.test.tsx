import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";

// Test d'intégration réel (ADR-041) : vraie base Postgres, `getRendezVousAvecContexte` mocké
// (même patron que moteur.test.ts/scanTemporel.test.ts, vi.mock hoisté) pour résoudre un rendez-
// vous fictif vers un bien/acquéreur RÉELS sans dépendre du mock statique data/agenda.ts (ids non-
// UUID) ni d'une vraie connexion Google Calendar. Couvre l'invariant central d'ADR-041 : un GET sur
// cette page ne matérialise jamais de Visite Atlas — seule la Server Action explicite le fait.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const RENDEZ_VOUS_ID_TEST = "gcal-test-preparer-adr041";
let contexteBienId = "";
let contexteAcquereurId = "";

vi.mock("@/lib/rendezVousContexte", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rendezVousContexte")>();
  return {
    ...actual,
    getRendezVousAvecContexte: vi.fn(async (id: string) => {
      if (id !== RENDEZ_VOUS_ID_TEST) return undefined;
      return {
        rdv: {
          id: RENDEZ_VOUS_ID_TEST,
          heure: "10h00",
          date: "2026-09-01",
          type: "visite" as const,
          titre: "Visite test ADR-041",
          preparationDisponible: true,
        },
        contexte: {
          rendezVousId: id,
          bien: { bienId: contexteBienId, confidence: 0.95, matchedBy: "assignation_directe" as const },
          client: { clientId: contexteAcquereurId, confidence: 0.95, matchedBy: "assignation_directe" as const },
          necessiteConfirmationBien: false,
          overallConfidence: 0.95,
        },
      };
    }),
  };
});

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, visites: visitesTable } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { materialiserVisiteAction } = await import("@/actions/visite");
const PreparerVisite = (await import("./page")).default;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function formulaireMaterialisation(): FormData {
  const fd = new FormData();
  fd.set("rendezVousCalendarId", RENDEZ_VOUS_ID_TEST);
  return fd;
}

async function visitesPourRendezVousTest() {
  return getDb().select().from(visitesTable).where(eq(visitesTable.rendezVousCalendarId, RENDEZ_VOUS_ID_TEST));
}

describe("GET /visites/[id]/preparer — jamais de mutation (ADR-041)", () => {
  it("bien/acquéreur résolus, visite non matérialisée : 0 écriture, action explicite affichée", async () => {
    const bien = await creerBien({
      reference: "[test réel] PREPARER-GET-1",
      titre: "Bien de test préparation",
      type: "appartement",
      adresse: "1 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 3,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    });
    idsBiensCrees.push(bien.id);
    const acquereur = await creerAcquereur({
      prenom: "Test",
      nom: "[test réel] Préparation GET",
      email: "test-réel-preparer-get@example.com",
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
    });
    idsAcquereursCrees.push(acquereur.id);
    contexteBienId = bien.id;
    contexteAcquereurId = acquereur.id;

    const avant = await visitesPourRendezVousTest();
    expect(avant).toHaveLength(0);

    const element = await PreparerVisite({ params: Promise.resolve({ id: RENDEZ_VOUS_ID_TEST }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Enregistrer et préparer cette visite");
    expect(html).toContain(bien.titre);

    const apres = await visitesPourRendezVousTest();
    expect(apres).toHaveLength(0); // le GET seul n'a jamais rien écrit
  });

  it("Server Action explicite : exactement 1 visite ; double soumission : toujours 1, même ligne", async () => {
    await materialiserVisiteAction(formulaireMaterialisation()).catch(() => {}); // redirect() attendu

    const apres1 = await visitesPourRendezVousTest();
    expect(apres1).toHaveLength(1);
    expect(apres1[0].statut).toBe("planifiee");

    await materialiserVisiteAction(formulaireMaterialisation()).catch(() => {});

    const apres2 = await visitesPourRendezVousTest();
    expect(apres2).toHaveLength(1);
    expect(apres2[0].id).toBe(apres1[0].id);
  });

  it("GET après matérialisation : aucune nouvelle écriture, page normale affichée (statut, compte rendu)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const avant = await visitesPourRendezVousTest();
    expect(avant).toHaveLength(1);

    const element = await PreparerVisite({ params: Promise.resolve({ id: RENDEZ_VOUS_ID_TEST }) });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("Enregistrer et préparer cette visite");
    expect(html).toContain("Planifiée");
    expect(html).toContain("Compte rendu de la visite");

    const apres = await visitesPourRendezVousTest();
    expect(apres).toHaveLength(1);
    expect(apres[0].id).toBe(avant[0].id);
  });
});
