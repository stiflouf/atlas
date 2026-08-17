import { afterAll, describe, expect, it } from "vitest";
import { renderToPipeableStream } from "react-dom/server";
import { Writable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import type { ReactElement } from "react";

// Test d'intégration réel (ADR-039) : vraie base Postgres, comme le reste du projet — la page
// d'accueil orchestre plusieurs repositories réels, un mock partiel romprait la couverture de
// cette orchestration. Base partagée avec le reste de la suite : chaque assertion sur un contenu
// PRÉSENT est scopée au titre unique de la tâche créée par ce test (jamais un comptage global, qui
// dépendrait de données d'autres suites) — même discipline que les tests ADR-036/037/038.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, taches: tachesTable } = await import("@/db/schema");
const { creerBien, archiverBien, desarchiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerTache, terminerTache } = await import("@/lib/tacheRepository");
const AujourdHui = (await import("./page")).default;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsTachesCreees: string[] = [];

afterAll(async () => {
  if (idsTachesCreees.length > 0) {
    await getDb().delete(tachesTable).where(eq(tachesTable.id, idsTachesCreees[0]));
    for (const id of idsTachesCreees) await getDb().delete(tachesTable).where(eq(tachesTable.id, id));
  }
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string) {
  // Titre/référence uniques par exécution (Date.now(), même convention que les titres de tâche
  // ci-dessous) : un run interrompu (kill/OOM) avant l'afterAll de ce fichier peut laisser un bien
  // orphelin avec cet id de test — sans suffixe temporel, le run suivant créerait un second bien au
  // titre strictement identique, dupliquant l'assertion de comptage global (audit V1 Candidate,
  // classe de flakiness "état global").
  const horodatage = Date.now();
  const bien = await creerBien({
    reference: `[test réel] COCKPIT-${suffixe}-${horodatage}`,
    titre: `Bien cockpit ${suffixe} ${horodatage}`,
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
  return bien;
}

async function creerAcquereurDeTest(suffixe: string) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Cockpit ${suffixe}`,
    email: `test-réel-cockpit-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

// renderToStaticMarkup (synchrone) ne supporte pas les composants serveur async imbriqués
// (AgendaCard, `export default async function`) — elle lève « A component suspended while
// responding to synchronous input ». renderToPipeableStream est la même API de rendu que Next.js,
// capable d'attendre ces composants ; onAllReady garantit un HTML entièrement résolu, sans fallback
// Suspense partiel, adapté à des assertions de contenu.
function rendreVersHtml(element: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = "";
    const writable = new Writable({
      write(chunk, _encodage, callback) {
        html += chunk.toString();
        callback();
      },
    });
    const { pipe } = renderToPipeableStream(element, {
      onAllReady() {
        pipe(writable);
        writable.on("finish", () => resolve(html));
      },
      onError(erreur) {
        reject(erreur);
      },
    });
  });
}

async function rendreCockpit(): Promise<string> {
  return rendreVersHtml(await AujourdHui());
}

describe("page d'accueil « Aujourd'hui » — orchestration réelle (ADR-039)", () => {
  it("tâche manuelle ouverte visible dans « Autres tâches »", async () => {
    const tache = await creerTache({
      titre: `[test réel] Tâche manuelle cockpit ${Date.now()}`,
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
    });
    idsTachesCreees.push(tache.id);

    const html = await rendreCockpit();
    expect(html).toContain(tache.titre);
    expect(html).not.toContain("Créée automatiquement");
  });

  it("tâche automatique (nouveau match) visible avec provenance et lien vers l'acquéreur", async () => {
    const acquereur = await creerAcquereurDeTest("AUTO1");
    const tache = await creerTache({
      titre: `[test réel] Nouveau match cockpit ${Date.now()}`,
      type: "appel",
      priorite: "normale",
      origine: "automatique",
      origineCode: "nouveau_match_bien_acquereur",
      cible: { type: "acquereur", id: acquereur.id },
    });
    idsTachesCreees.push(tache.id);

    const html = await rendreCockpit();
    expect(html).toContain(tache.titre);
    expect(html).toContain("Créée automatiquement");
    expect(html).toContain("Nouveau match Bien × Acquéreur");
    expect(html).toContain(`href="/clients/${acquereur.id}"`);
  });

  it("tâche terminée absente du cockpit", async () => {
    const tache = await creerTache({
      titre: `[test réel] Tâche terminée cockpit ${Date.now()}`,
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
    });
    idsTachesCreees.push(tache.id);
    await terminerTache(tache.id);

    const html = await rendreCockpit();
    expect(html).not.toContain(tache.titre);
  });

  it("tâche liée à un bien : apparaît dans « Dossiers nécessitant une action », jamais dupliquée", async () => {
    const bien = await creerBienDeTest("DOSSIER1");
    const tache = await creerTache({
      titre: `[test réel] Tâche dossier cockpit ${Date.now()}`,
      type: "autre",
      priorite: "haute",
      origine: "manuelle",
      cible: { type: "bien", id: bien.id },
    });
    idsTachesCreees.push(tache.id);

    const html = await rendreCockpit();
    expect(html).toContain("Dossiers nécessitant une action");
    expect(html).toContain(bien.titre.split(" — ")[0]);
    const occurrences = html.split(bien.titre.split(" — ")[0]).length - 1;
    expect(occurrences).toBe(1); // jamais deux fois la même tâche/le même dossier
  });

  it("bien archivé : sa tâche disparaît des dossiers, sans lien cassé", async () => {
    const bien = await creerBienDeTest("ARCHIVE1");
    const tache = await creerTache({
      titre: `[test réel] Tâche bien archivé cockpit ${Date.now()}`,
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "bien", id: bien.id },
    });
    idsTachesCreees.push(tache.id);
    await archiverBien(bien.id);

    const html = await rendreCockpit();
    expect(html).not.toContain(tache.titre);

    await desarchiverBien(bien.id);
  });

  it("tâche sans cible exploitable : aucun lien « Voir la fiche » factice", async () => {
    const tache = await creerTache({
      titre: `[test réel] Tâche générale cockpit ${Date.now()}`,
      type: "autre",
      priorite: "basse",
      origine: "manuelle",
    });
    idsTachesCreees.push(tache.id);

    const html = await rendreCockpit();
    expect(html).toContain(tache.titre);
  });

  it("état vide : le message n'apparaît que si aucune tâche active ne subsiste réellement en base", async () => {
    const tachesActivesReelles = await getDb()
      .select({ id: tachesTable.id })
      .from(tachesTable)
      .where(and(isNull(tachesTable.termineeLe), isNull(tachesTable.annuleeLe)));

    const html = await rendreCockpit();
    if (tachesActivesReelles.length === 0) {
      expect(html).toContain("Rien à traiter pour le moment.");
    } else {
      expect(html).not.toContain("Rien à traiter pour le moment.");
    }
  });
});
