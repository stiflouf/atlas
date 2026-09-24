import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// VISIT_NATIVE_ENTRY_V1 — `creerVisiteAction` : seul appelant UI de `creerVisite` (ADR-063). Trois
// entrées produit (fiche Bien, fiche Acquéreur, match) convergent vers ce même contrat : bienId +
// acquereurId + date civile → Visite native `planifiee`, `rendez_vous_calendar_id` NULL, redirection
// vers /visites/{uuid} (jamais /preparer). Refus métier rendus au formulaire, jamais levés.
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: () => workspaceCourantMock() }));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, visites: visitesTable, workspaces: workspacesTable } = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { getVisiteById } = await import("@/lib/visiteRepository");
const { creerVisiteAction } = await import("./creerVisite");

const M = `[test réel] CREER-VISITE-ACTION ${Date.now()}`;
const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsWorkspaces: string[] = [];

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

afterAll(async () => {
  if (idsBiens.length > 0) await getDb().delete(visitesTable).where(inArray(visitesTable.bienId, idsBiens));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

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
      email: `creer-visite-${suffixe}-${Date.now()}@example.com`,
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

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-creer-visite-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace visite" });
  idsWorkspaces.push(id);
  return id;
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

// `redirect()` lève par conception (digest NEXT_REDIRECT;...;/chemin) : un succès se lit dans le
// digest, un refus dans le résultat rendu au formulaire.
async function soumettre(champs: Record<string, string>): Promise<{ redirection?: string; resultat?: Awaited<ReturnType<typeof creerVisiteAction>> }> {
  try {
    return { resultat: await creerVisiteAction({ statut: "idle" }, formulaire(champs)) };
  } catch (erreur) {
    return { redirection: String((erreur as { digest?: string }).digest ?? (erreur as Error).message) };
  }
}

async function visiteCreeePourBien(bienId: string) {
  const lignes = await getDb().select().from(visitesTable).where(eq(visitesTable.bienId, bienId));
  expect(lignes).toHaveLength(1);
  return lignes[0];
}

describe("creerVisiteAction — création native", () => {
  it("depuis la fiche Bien : Visite planifiee, calendarId NULL, bonne paire, redirection /visites/{uuid}?retour=bien", async () => {
    const bien = await unBien("BIEN");
    const acquereur = await unAcquereur("BIEN");

    const { redirection, resultat } = await soumettre({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-10-05", retour: "bien" });

    expect(resultat).toBeUndefined();
    const visite = await visiteCreeePourBien(bien.id);
    expect(visite).toMatchObject({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-10-05", statut: "planifiee", rendezVousCalendarId: null });
    expect(redirection).toContain(`NEXT_REDIRECT;replace;/visites/${visite.id}?retour=bien`);
    expect(redirection).not.toContain("/preparer");
  });

  it("depuis la fiche Acquéreur : même résultat, retour acquereur", async () => {
    const bien = await unBien("ACQ");
    const acquereur = await unAcquereur("ACQ");

    const { redirection } = await soumettre({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-10-06", retour: "acquereur" });

    const visite = await visiteCreeePourBien(bien.id);
    expect(visite.statut).toBe("planifiee");
    expect(visite.rendezVousCalendarId).toBeNull();
    expect(redirection).toContain(`/visites/${visite.id}?retour=acquereur`);
    expect(await getVisiteById(visite.id, WORKSPACE_TEST)).toMatchObject({ acquereurId: acquereur.id });
  });

  it("depuis un match (bien + acquéreur préremplis, sans retour) : Visite native, route canonique nue", async () => {
    const bien = await unBien("MATCH");
    const acquereur = await unAcquereur("MATCH");

    const { redirection } = await soumettre({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-10-07" });

    const visite = await visiteCreeePourBien(bien.id);
    expect(redirection).toContain(`NEXT_REDIRECT;replace;/visites/${visite.id};`);
  });

  it("`retour` hors enum (URL, chemin) : ignoré, jamais une redirection arbitraire", async () => {
    const bien = await unBien("RETOUR");
    const acquereur = await unAcquereur("RETOUR");

    const { redirection } = await soumettre({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-10-08", retour: "https://evil.example" });

    const visite = await visiteCreeePourBien(bien.id);
    expect(redirection).toContain(`NEXT_REDIRECT;replace;/visites/${visite.id};`);
    expect(redirection).not.toContain("evil");
  });
});

describe("creerVisiteAction — refus rendus au formulaire (jamais levés)", () => {
  it("saisie incomplète : message local, aucune écriture", async () => {
    const bien = await unBien("INCOMPLET");
    expect((await soumettre({ bienId: bien.id, acquereurId: "", datePrevue: "2026-10-01" })).resultat).toMatchObject({ statut: "erreur" });
    expect((await soumettre({ bienId: "", acquereurId: "", datePrevue: "2026-10-01" })).resultat).toMatchObject({ statut: "erreur" });
    const acquereur = await unAcquereur("INCOMPLET");
    expect((await soumettre({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "demain" })).resultat).toMatchObject({ statut: "erreur" });
    expect(await getDb().select().from(visitesTable).where(eq(visitesTable.bienId, bien.id))).toEqual([]);
  });

  it("bien archivé : refus contrôlé", async () => {
    const bien = await unBien("ARCHIVE-BIEN");
    const acquereur = await unAcquereur("ARCHIVE-BIEN");
    await archiverBien(bien.id, WORKSPACE_TEST);

    const { resultat } = await soumettre({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-10-01" });

    expect(resultat).toEqual({ statut: "erreur", message: "Ce bien est archivé : aucune visite ne peut y être planifiée." });
    expect(await getDb().select().from(visitesTable).where(eq(visitesTable.bienId, bien.id))).toEqual([]);
  });

  it("acquéreur archivé : refus contrôlé", async () => {
    const bien = await unBien("ARCHIVE-ACQ");
    const acquereur = await unAcquereur("ARCHIVE-ACQ");
    await archiverAcquereur(acquereur.id, WORKSPACE_TEST);

    const { resultat } = await soumettre({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-10-01" });

    expect(resultat).toEqual({ statut: "erreur", message: "Cet acquéreur est archivé : aucune visite ne peut être planifiée pour lui." });
  });

  it("workspace : impossible de planifier sur un bien ou un acquéreur d'un autre workspace", async () => {
    const autre = await unAutreWorkspace("ISO");
    const bienA = await unBien("ISO-A");
    const acquereurA = await unAcquereur("ISO-A");
    const bienB = await unBien("ISO-B", autre);
    const acquereurB = await unAcquereur("ISO-B", autre);

    expect((await soumettre({ bienId: bienB.id, acquereurId: acquereurA.id, datePrevue: "2026-10-01" })).resultat).toMatchObject({ statut: "erreur", message: "Ce bien est introuvable dans votre espace." });
    expect((await soumettre({ bienId: bienA.id, acquereurId: acquereurB.id, datePrevue: "2026-10-01" })).resultat).toMatchObject({ statut: "erreur", message: "Cet acquéreur est introuvable dans votre espace." });
    expect(await getDb().select().from(visitesTable).where(inArray(visitesTable.bienId, [bienA.id, bienB.id]))).toEqual([]);
  });
});
