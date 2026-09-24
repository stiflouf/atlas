import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// VISIT_NATIVE_ENTRY_V1 — page unique de planification : depuis un match (bien + acquéreur
// préremplis, champs cachés), depuis le Bien (acquéreur à choisir), depuis l'Acquéreur (bien à
// choisir, compatibles d'abord). Aucun Calendar impliqué : aucun mock Google nécessaire.
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: async () => "default" }));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, workspaces: workspacesTable } = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const NouvelleVisitePage = (await import("./page")).default;

const M = `[test réel] PAGE-NOUVELLE-VISITE ${Date.now()}`;
const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsWorkspaces) await getDb().delete(workspacesTable).where(eq(workspacesTable.id, id));
});

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-page-nouvelle-visite-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace page nouvelle visite" });
  idsWorkspaces.push(id);
  return id;
}

async function unBien(suffixe: string, workspaceId = WORKSPACE_TEST) {
  const bien = await creerBien(
    {
      reference: `${M}-${suffixe}`,
      titre: `${M} ${suffixe}`,
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
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  return bien;
}

async function unAcquereur(suffixe: string, workspaceId = WORKSPACE_TEST) {
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom: `${M} ${suffixe}`,
      email: `page-nouvelle-visite-${suffixe}-${Date.now()}@example.com`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

async function rendre(params: Record<string, string>): Promise<string> {
  return renderToStaticMarkup(await NouvelleVisitePage({ searchParams: Promise.resolve(params) }));
}

describe("/visites/nouvelle", () => {
  it("depuis un match : bien et acquéreur préremplis en champs cachés, date civile seule, retour bien", async () => {
    const bien = await unBien("MATCH");
    const acquereur = await unAcquereur("MATCH");

    const html = await rendre({ bienId: bien.id, acquereurId: acquereur.id, retour: "bien" });

    expect(html).toContain(`type="hidden" name="bienId" value="${bien.id}"`);
    expect(html).toContain(`type="hidden" name="acquereurId" value="${acquereur.id}"`);
    expect(html).toContain(`type="hidden" name="retour" value="bien"`);
    expect(html).toContain('type="date"');
    expect(html).not.toContain('type="time"');
    expect(html).toContain(`href="/biens/${bien.id}?onglet=visites"`);
    expect(html).not.toContain("/preparer");
  });

  it("depuis le Bien : acquéreur à choisir dans une liste (bien fixé)", async () => {
    const bien = await unBien("BIEN");
    const acquereur = await unAcquereur("BIEN");

    const html = await rendre({ bienId: bien.id, retour: "bien" });

    expect(html).toContain(`type="hidden" name="bienId" value="${bien.id}"`);
    expect(html).toContain('id="planifier-visite-acquereur" name="acquereurId"');
    expect(html).toContain(`<option value="${acquereur.id}"`);
  });

  it("depuis l'Acquéreur : bien à choisir dans une liste (acquéreur fixé), retour acquéreur", async () => {
    const bien = await unBien("ACQ");
    const acquereur = await unAcquereur("ACQ");

    const html = await rendre({ acquereurId: acquereur.id, retour: "acquereur" });

    expect(html).toContain(`type="hidden" name="acquereurId" value="${acquereur.id}"`);
    expect(html).toContain('id="planifier-visite-bien" name="bienId"');
    expect(html).toContain(`<option value="${bien.id}"`);
    expect(html).toContain(`href="/clients/${acquereur.id}"`);
  });

  it("bien archivé ou `retour` hors enum : jamais préfixé, jamais une redirection arbitraire", async () => {
    const bien = await unBien("ARCHIVE");
    await archiverBien(bien.id, WORKSPACE_TEST);

    const html = await rendre({ bienId: bien.id, retour: "https://evil.example" });

    expect(html).not.toContain(`name="bienId" value="${bien.id}"`);
    expect(html).not.toContain("evil");
    expect(html).toContain('href="/"');
  });

  // FINAL WORKSPACE HARDENING — aucune fuite d'un autre workspace, ni en liste ni en préremplissage.
  describe("isolation workspace", () => {
    it("A. workspace A voit ses Biens/Acquéreurs, jamais ceux de B", async () => {
      const autre = await unAutreWorkspace("A");
      const bienA = await unBien("WS-A");
      const acquereurA = await unAcquereur("WS-A");
      const bienB = await unBien("WS-B", autre);
      const acquereurB = await unAcquereur("WS-B", autre);

      const html = await rendre({});

      expect(html).toContain(`<option value="${bienA.id}"`);
      expect(html).toContain(`<option value="${acquereurA.id}"`);
      expect(html).not.toContain(bienB.id);
      expect(html).not.toContain(bienB.titre);
      expect(html).not.toContain(acquereurB.id);
      expect(html).not.toContain(acquereurB.nom);
    });

    it("B. URL préremplie avec un bienId de B depuis A : rien de B n'est rendu, bien à choisir", async () => {
      const autre = await unAutreWorkspace("B");
      const bienB = await unBien("PREFILL-B", autre);

      const html = await rendre({ bienId: bienB.id, retour: "bien" });

      expect(html).not.toContain(bienB.id);
      expect(html).not.toContain(bienB.titre);
      expect(html).not.toContain(bienB.reference);
      expect(html).toContain('id="planifier-visite-bien" name="bienId"');
      expect(html).toContain('href="/"');
    });

    it("C. URL préremplie avec un acquereurId de B depuis A : aucune identité de B rendue, acquéreur à choisir", async () => {
      const autre = await unAutreWorkspace("C");
      const acquereurB = await unAcquereur("PREFILL-B", autre);

      const html = await rendre({ acquereurId: acquereurB.id, retour: "acquereur" });

      expect(html).not.toContain(acquereurB.id);
      expect(html).not.toContain(acquereurB.nom);
      expect(html).toContain('id="planifier-visite-acquereur" name="acquereurId"');
      expect(html).toContain('href="/"');
    });

    it("D. préremplissage A → A : toujours fixé", async () => {
      const bien = await unBien("A-A");
      const acquereur = await unAcquereur("A-A");

      const html = await rendre({ bienId: bien.id, acquereurId: acquereur.id });

      expect(html).toContain(`type="hidden" name="bienId" value="${bien.id}"`);
      expect(html).toContain(`type="hidden" name="acquereurId" value="${acquereur.id}"`);
    });
  });
});
