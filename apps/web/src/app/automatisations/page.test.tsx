import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToPipeableStream } from "react-dom/server";
import { Writable } from "node:stream";
import { eq, inArray } from "drizzle-orm";
import type { ReactElement } from "react";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2B5 (ADR-054) — T7 : la page /automatisations ne montre QUE le périmètre de la
// session. Elle fait trois lectures (configurations, dernière exécution, dernier run de scan) qui
// étaient toutes globales avant ce lot : un conseiller voyait l'activation, la dernière exécution et
// le dernier scan d'un autre cabinet.
//
// Le workspace de session est mocké, même patron que app/page.test.tsx : `workspaceCourantMock` est
// réassignable pour rendre la MÊME page sous deux périmètres successifs et comparer les deux rendus.
let workspaceCourantMock = WORKSPACE_TEST;
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: async () => workspaceCourantMock,
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  offres: offresTable,
  taches: tachesTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  runsScanAutomatisation: runsScanAutomatisationTable,
  configurationsAutomatisation: configurationsAutomatisationTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerOffre } = await import("@/lib/offreRepository");
const { definirActivationAutomatisation, definirSeuilAutomatisation } = await import(
  "@/lib/automatisations/configurationAutomatisationRepository"
);
const { scannerOffreSansDecision } = await import("@/lib/automatisations/scanners/offreSansDecision");
const PageAutomatisations = (await import("./page")).default;

const REGLE = "offre_sans_decision" as const;
const M = `ZpageAuto${Date.now()}`;
const WORKSPACE_B = `ws-page-auto-${Date.now()}`;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsOffres: string[] = [];
let compteur = 0;

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] page automatisations B" });
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  await getDb()
    .update(configurationsAutomatisationTable)
    .set({ active: false, seuilJours: null })
    .where(eq(configurationsAutomatisationTable.regleCode, REGLE));
});

afterAll(async () => {
  workspaceCourantMock = WORKSPACE_TEST;
  await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  if (idsOffres.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetierTable.id })
      .from(evenementsMetierTable)
      .where(inArray(evenementsMetierTable.offreId, idsOffres));
    const idsEvt = evenements.map((e) => e.id);
    if (idsEvt.length > 0) {
      await getDb()
        .delete(executionsAutomatisationTable)
        .where(inArray(executionsAutomatisationTable.evenementId, idsEvt));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvt));
    }
    await getDb().delete(tachesTable).where(inArray(tachesTable.offreId, idsOffres));
    await getDb().delete(offresTable).where(inArray(offresTable.id, idsOffres));
  }
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  await getDb()
    .delete(configurationsAutomatisationTable)
    .where(eq(configurationsAutomatisationTable.workspaceId, WORKSPACE_B));
  await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
});

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

async function rendrePour(workspaceId: string): Promise<string> {
  workspaceCourantMock = workspaceId;
  return rendreVersHtml(await PageAutomatisations());
}

async function uneOffreEnCours(workspaceId: string, dateOffre: string) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] PAGEAUTO-${compteur}-${Date.now()}`,
      titre: "Bien page automatisations",
      type: "appartement",
      adresse: "1 rue de la Page",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom: `${M} Acquéreur ${compteur}`,
      email: `${M}.${compteur}@example.test`,
      telephone: "0600000000",
      budgetMin: 200000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "offre",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  const resultat = await creerOffre(
    { bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre },
    [],
    workspaceId
  );
  if (resultat.statut !== "creee") throw new Error(`création attendue, reçu ${resultat.statut}`);
  idsOffres.push(resultat.offre.id);
  return resultat.offre;
}

// La carte d'une règle est un bloc autonome dans le rendu : on l'isole pour asserter sur SON état,
// jamais sur le HTML entier (qui contient les douze règles du catalogue).
function carteDeLaRegle(html: string): string {
  const debut = html.indexOf(`value="${REGLE}"`);
  expect(debut, "la règle attendue doit figurer dans le rendu").toBeGreaterThan(-1);
  const suivante = html.indexOf('value="offre_acceptee_sans_compromis"', debut);
  return html.slice(debut, suivante === -1 ? html.length : suivante);
}

// Le seuil est rendu comme la valeur du champ nombre de la carte. On lit CETTE valeur, jamais une
// occurrence du nombre quelque part dans le HTML (« 30 » apparaît aussi dans un `width:30px`).
function seuilAffiche(carte: string): string | undefined {
  return /name="seuilJours" value="(\d+)"/.exec(carte)?.[1];
}

// Le libellé du bouton de bascule dit l'état COURANT de la règle (ADR-032, bascule explicite).
function activationAffichee(carte: string): string | undefined {
  return /<button type="submit"[^>]*>(Activée|Désactivée)<\/button>/.exec(carte)?.[1];
}

describe("T7 — /automatisations ne montre que le workspace de la session", () => {
  it("l'activation affichée est celle du workspace de session, jamais celle d'un autre", async () => {
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
    await definirSeuilAutomatisation(REGLE, 30, WORKSPACE_B);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_B);

    const htmlA = carteDeLaRegle(await rendrePour(WORKSPACE_TEST));
    const htmlB = carteDeLaRegle(await rendrePour(WORKSPACE_B));

    // Seuil : A affiche le sien (2), B le sien (30) — jamais l'inverse, jamais celui de l'autre.
    expect(seuilAffiche(htmlA)).toBe("2");
    expect(seuilAffiche(htmlB)).toBe("30");

    // Activation : A est désactivée, B est activée. C'est exactement ce qu'un lecteur global
    // confondait — les deux cartes auraient affiché le même état.
    expect(activationAffichee(htmlA)).toBe("Désactivée");
    expect(activationAffichee(htmlB)).toBe("Activée");

    // Les deux rendus diffèrent réellement : sans le scope, ils seraient identiques (même ligne lue).
    expect(htmlA).not.toBe(htmlB);
  });

  it("la dernière exécution et le dernier run de scan affichés sont ceux du workspace de session", async () => {
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_B);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_B);

    // Seul B produit réellement une exécution et un run : A reste sans historique.
    await uneOffreEnCours(WORKSPACE_B, "2026-06-01");
    await scannerOffreSansDecision(WORKSPACE_B, new Date("2026-06-10T10:00:00Z"));

    const runsB = await getDb()
      .select()
      .from(runsScanAutomatisationTable)
      .where(eq(runsScanAutomatisationTable.regleCode, REGLE));
    expect(runsB.every((r) => r.workspaceId === WORKSPACE_B)).toBe(true);
    expect(runsB.length).toBeGreaterThanOrEqual(1);

    const htmlB = carteDeLaRegle(await rendrePour(WORKSPACE_B));
    const htmlA = carteDeLaRegle(await rendrePour(WORKSPACE_TEST));

    // B voit son exécution réussie et son scan terminé…
    expect(htmlB).toContain("Réussie");
    expect(htmlB).toContain("Terminé");
    // …et A, qui n'a rien exécuté, n'affiche aucun des deux. Avant ce lot, les deux lectures étant
    // globales, A aurait affiché l'exécution et le run de B.
    expect(htmlA).not.toContain("Réussie");
    expect(htmlA).not.toContain("Terminé");
  });
});
