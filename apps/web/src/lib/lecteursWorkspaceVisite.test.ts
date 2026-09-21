import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// VISIT_NATIVE_ENTRY_V1 (final workspace hardening) — lecteurs scopés workspace du formulaire de
// planification : filtrage SQL, aucun repli mock, archivés exclus, nombre de requêtes indépendant
// de N (une requête de liste, plus les résolutions groupées identité/critères côté acquéreur).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, workspaces: workspacesTable } = await import("@/db/schema");
const { creerBien, archiverBien, getBienDuWorkspace, listerBiensActifsDuWorkspace } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur, getAcquereurDuWorkspace, listerAcquereursActifsDuWorkspace } = await import("@/lib/clientRepository");

const M = `[test réel] LECTEURS-WS-VISITE ${Date.now()}`;
const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  if (idsWorkspaces.length) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unAutreWorkspace() {
  const id = `ws-lecteurs-visite-${Date.now()}-${idsWorkspaces.length}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace lecteurs visite" });
  idsWorkspaces.push(id);
  return id;
}

async function unBien(suffixe: string, workspaceId: string) {
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

async function unAcquereur(suffixe: string, workspaceId: string) {
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom: `${M} ${suffixe}`,
      email: `lecteurs-ws-${suffixe}-${Date.now()}@example.com`,
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

function executeurCompteur() {
  const db = getDb();
  let requetes = 0;
  const executeur = new Proxy(db, {
    get(cible, propriete, recepteur) {
      if (propriete === "select") requetes += 1;
      return Reflect.get(cible, propriete, recepteur);
    },
  }) as typeof db;
  return { executeur, requetes: () => requetes };
}

describe("lecteurs Bien scopés workspace", () => {
  it("liste les biens actifs du workspace seulement ; un bien d'un autre workspace est invisible et introuvable", async () => {
    const autre = await unAutreWorkspace();
    const bienA = await unBien("A", WORKSPACE_TEST);
    const bienB = await unBien("B", autre);
    const archive = await unBien("ARCHIVE", WORKSPACE_TEST);
    await archiverBien(archive.id);

    const ids = (await listerBiensActifsDuWorkspace(WORKSPACE_TEST)).map((b) => b.id);
    expect(ids).toContain(bienA.id);
    expect(ids).not.toContain(bienB.id);
    expect(ids).not.toContain(archive.id);
    expect((await listerBiensActifsDuWorkspace(autre)).map((b) => b.id)).toEqual([bienB.id]);

    expect(await getBienDuWorkspace(bienB.id, WORKSPACE_TEST)).toBeUndefined();
    expect((await getBienDuWorkspace(bienA.id, WORKSPACE_TEST))?.id).toBe(bienA.id);
    expect(await getBienDuWorkspace("pas-un-uuid", WORKSPACE_TEST)).toBeUndefined();
  });

  it("une seule requête, indépendante de N", async () => {
    await unBien("N1", WORKSPACE_TEST);
    await unBien("N2", WORKSPACE_TEST);
    const { executeur, requetes } = executeurCompteur();
    await listerBiensActifsDuWorkspace(WORKSPACE_TEST, executeur);
    expect(requetes()).toBe(1);
  });
});

describe("lecteurs Acquéreur scopés workspace", () => {
  it("liste les acquéreurs actifs du workspace seulement ; un acquéreur d'un autre workspace est invisible et introuvable", async () => {
    const autre = await unAutreWorkspace();
    const acqA = await unAcquereur("A", WORKSPACE_TEST);
    const acqB = await unAcquereur("B", autre);
    const archive = await unAcquereur("ARCHIVE", WORKSPACE_TEST);
    await archiverAcquereur(archive.id);

    const ids = (await listerAcquereursActifsDuWorkspace(WORKSPACE_TEST)).map((a) => a.id);
    expect(ids).toContain(acqA.id);
    expect(ids).not.toContain(acqB.id);
    expect(ids).not.toContain(archive.id);
    expect((await listerAcquereursActifsDuWorkspace(autre)).map((a) => a.id)).toEqual([acqB.id]);

    expect(await getAcquereurDuWorkspace(acqB.id, WORKSPACE_TEST)).toBeUndefined();
    expect((await getAcquereurDuWorkspace(acqA.id, WORKSPACE_TEST))?.id).toBe(acqA.id);
  });

  it("nombre de requêtes borné, indépendant de N (liste + résolutions groupées critères/identité)", async () => {
    await unAcquereur("N1", WORKSPACE_TEST);
    await unAcquereur("N2", WORKSPACE_TEST);
    const avec2 = executeurCompteur();
    await listerAcquereursActifsDuWorkspace(WORKSPACE_TEST, avec2.executeur);
    await unAcquereur("N3", WORKSPACE_TEST);
    await unAcquereur("N4", WORKSPACE_TEST);
    const avec4 = executeurCompteur();
    await listerAcquereursActifsDuWorkspace(WORKSPACE_TEST, avec4.executeur);
    expect(avec4.requetes()).toBe(avec2.requetes());
    expect(avec2.requetes()).toBeLessThanOrEqual(3);
  });
});
