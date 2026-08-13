import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : exerce la vraie base Postgres locale (pas de mock), car les garde-fous
// vérifiés ici (gel concurrent terminerTache/annulerTache, CHECK "au plus une cible") sont des
// propriétés de la requête SQL elle-même, pas de la logique applicative. Repli sur le même
// DATABASE_URL par défaut que drizzle.config.ts (Postgres local docker-compose de dev) si non
// défini par l'environnement.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { taches: tachesTable, biens: biensTable, acquereurs: acquereursTable } = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const {
  creerTache,
  terminerTache,
  annulerTache,
  getTacheById,
  getTachesPourBien,
  getTachesPourProspectVendeur,
} = await import("./tacheRepository");

const idsTachesCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsTachesCrees) {
    await getDb().delete(tachesTable).where(eq(tachesTable.id, id));
  }
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

async function creerAcquereurDeTest(suffixe: string) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Tâche ${suffixe}`,
    email: `test-réel-tache-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] TACHE-${suffixe}`,
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

describe("tacheRepository (intégration Postgres)", () => {
  it("creerTache() persiste une tâche sans termineeLe ni annuleeLe, sans cible", async () => {
    const tache = await creerTache({
      titre: "[test] Tâche sans cible",
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
    });
    idsTachesCrees.push(tache.id);

    expect(tache.termineeLe).toBeUndefined();
    expect(tache.annuleeLe).toBeUndefined();
    expect(tache.bienId).toBeUndefined();
  });

  it("creerTache() avec cible={type:'bien',id} pose bienId et laisse les six autres FK à undefined", async () => {
    const bien = await creerBienDeTest("001");
    const tache = await creerTache({
      titre: "[test] Tâche rattachée à un bien",
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "bien", id: bien.id },
    });
    idsTachesCrees.push(tache.id);

    expect(tache.bienId).toBe(bien.id);
    expect(tache.acquereurId).toBeUndefined();
    expect(tache.prospectVendeurId).toBeUndefined();
  });

  it("le CHECK taches_une_seule_cible_check rejette une insertion avec deux cibles simultanées", async () => {
    const bien = await creerBienDeTest("002");
    const acquereur = await creerAcquereurDeTest("002");
    try {
      await getDb()
        .insert(tachesTable)
        .values({
          titre: "[test] Deux cibles",
          type: "autre",
          priorite: "normale",
          origine: "manuelle",
          bienId: bien.id,
          acquereurId: acquereur.id,
        });
      expect.unreachable("l'insertion aurait dû être rejetée par le CHECK");
    } catch (erreur) {
      // drizzle-orm/postgres-js enveloppe l'erreur Postgres d'origine dans `cause` — le message de
      // haut niveau ("Failed query: ...") ne contient jamais le nom de la contrainte violée.
      expect((erreur as Error).cause).toMatchObject({ constraint_name: "taches_une_seule_cible_check" });
    }
  });

  it("terminerTache() pose termineeLe et laisse annuleeLe à undefined", async () => {
    const tache = await creerTache({
      titre: "[test] Tâche à terminer",
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
    });
    idsTachesCrees.push(tache.id);

    const terminee = await terminerTache(tache.id);

    expect(terminee?.termineeLe).toBeDefined();
    expect(terminee?.annuleeLe).toBeUndefined();
  });

  it("terminerTache() retourne undefined en second appel (gel concurrent — déjà terminée)", async () => {
    const tache = await creerTache({
      titre: "[test] Tâche gel concurrent",
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
    });
    idsTachesCrees.push(tache.id);

    await terminerTache(tache.id);
    const deuxieme = await terminerTache(tache.id);

    expect(deuxieme).toBeUndefined();
  });

  it("annulerTache() retourne undefined pour une tâche déjà terminée (gel concurrent croisé)", async () => {
    const tache = await creerTache({
      titre: "[test] Tâche déjà terminée",
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
    });
    idsTachesCrees.push(tache.id);

    await terminerTache(tache.id);
    const annulation = await annulerTache(tache.id);

    expect(annulation).toBeUndefined();
    const relue = await getTacheById(tache.id);
    expect(relue?.annuleeLe).toBeUndefined();
  });

  it("annulerTache() pose annuleeLe et laisse termineeLe à undefined", async () => {
    const tache = await creerTache({
      titre: "[test] Tâche à annuler",
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
    });
    idsTachesCrees.push(tache.id);

    const annulee = await annulerTache(tache.id);

    expect(annulee?.annuleeLe).toBeDefined();
    expect(annulee?.termineeLe).toBeUndefined();
  });

  it("terminerTache()/annulerTache()/getTacheById() sont des no-ops silencieux pour un id mocké (non-UUID)", async () => {
    await expect(terminerTache("tache-001")).resolves.toBeUndefined();
    await expect(annulerTache("tache-001")).resolves.toBeUndefined();
    await expect(getTacheById("tache-001")).resolves.toBeUndefined();
  });

  it("getTachesPourBien() ne retourne que les tâches réelles rattachées à ce bien", async () => {
    const bien = await creerBienDeTest("003");
    const tache = await creerTache({
      titre: "[test] Tâche du bien 003",
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "bien", id: bien.id },
    });
    idsTachesCrees.push(tache.id);

    const taches = await getTachesPourBien(bien.id);

    expect(taches.map((t) => t.id)).toContain(tache.id);
    expect(taches.every((t) => t.bienId === bien.id)).toBe(true);
  });

  it("getTachesPourProspectVendeur() renvoie un tableau vide pour un id mocké, sans requête DB", async () => {
    await expect(getTachesPourProspectVendeur("prospect-001")).resolves.toEqual([]);
  });
});
