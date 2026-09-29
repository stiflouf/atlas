import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// GLOBAL_READER_GUARD_EXTENSION_V1 — la frontière de l'écran de communication.
//
// Ce module était l'angle mort : il n'est ni un écran ni une action, donc la garde des lecteurs
// unitaires ne le voyait pas ; et comme la garde des LISTES le surveillait bien, il paraissait
// couvert. Trois de ses quatre branches recevaient un identifiant directement des searchParams
// (`tacheId`, `bienId`) et le passaient à un lecteur racine GLOBAL. Un lien forgé suffisait à faire
// apparaître, dans l'écran d'un conseiller, le titre d'une tâche d'un autre workspace, le nom et
// l'adresse email de son destinataire, et l'adresse du bien concerné — avec un formulaire d'envoi
// prêt à partir vers ce contact.
//
// Chaque refus a sa contre-épreuve : une garde qui casserait la résolution pour tout le monde
// passerait tous les refus sans rien protéger.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  taches: tachesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerTache } = await import("@/lib/tacheRepository");
const { resoudreContexteEcranCommunication } = await import("./contexteEcranCommunication");

const M = `Zgre1${Date.now()}`;
const WORKSPACE_B = `ws-gre1-${Date.now()}`;

const TITRE_TACHE_A = `${M} Relancer le dossier de A`;
const TITRE_TACHE_B = `${M} Relancer le dossier confidentiel de B`;
const NOM_ACQ_A = `${M}AcquereurA`;
const NOM_ACQ_B = `${M}AcquereurB`;
const EMAIL_ACQ_B = `${M}.confidentiel.b@example.test`;
const ADRESSE_BIEN_B = `${M} rue confidentielle de B`;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsTaches: string[] = [];

let bienA: Awaited<ReturnType<typeof creerBien>>;
let bienB: Awaited<ReturnType<typeof creerBien>>;
let acquereurA: Awaited<ReturnType<typeof creerAcquereur>>;
let acquereurB: Awaited<ReturnType<typeof creerAcquereur>>;
let tacheA: Awaited<ReturnType<typeof creerTache>>;
let tacheB: Awaited<ReturnType<typeof creerTache>>;

let compteur = 0;

async function unBien(workspaceId: string, adresse: string) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] GRE1-${compteur}-${Date.now()}`,
      titre: `${M} Bien ${compteur}`,
      type: "appartement",
      adresse,
      ville: "Testville",
      codePostal: "00000",
      surface: 60,
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

async function unAcquereur(workspaceId: string, nom: string, email: string) {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom,
      email,
      telephone: "0600000000",
      budgetMin: 200000,
      budgetMax: 500000,
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

async function uneTacheAcquereur(workspaceId: string, titre: string, acquereurId: string) {
  const tache = await creerTache(
    {
      titre,
      contexte: undefined,
      type: "relance",
      priorite: "normale",
      echeance: "2026-12-01",
      origine: "manuelle",
      cible: { type: "acquereur", id: acquereurId },
    },
    workspaceId
  );
  idsTaches.push(tache.id);
  return tache;
}

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] communications B" });
  bienA = await unBien(WORKSPACE_TEST, `${M} rue de A`);
  bienB = await unBien(WORKSPACE_B, ADRESSE_BIEN_B);
  acquereurA = await unAcquereur(WORKSPACE_TEST, NOM_ACQ_A, `${M}.a@example.test`);
  acquereurB = await unAcquereur(WORKSPACE_B, NOM_ACQ_B, EMAIL_ACQ_B);
  tacheA = await uneTacheAcquereur(WORKSPACE_TEST, TITRE_TACHE_A, acquereurA.id);
  tacheB = await uneTacheAcquereur(WORKSPACE_B, TITRE_TACHE_B, acquereurB.id);
});

afterAll(async () => {
  if (idsTaches.length > 0) await getDb().delete(tachesTable).where(inArray(tachesTable.id, idsTaches));
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, [WORKSPACE_B]));
});

// Tout ce que la branche produit, mis à plat : c'est là-dedans qu'une donnée étrangère
// apparaîtrait, pas seulement dans un champ précis.
function aplatir(resultat: unknown): string {
  // `JSON.stringify(undefined)` rend `undefined`, pas une chaîne : un contexte refusé doit tout de
  // même produire un texte vide à inspecter.
  return JSON.stringify(resultat, (_cle, valeur) => (typeof valeur === "function" ? undefined : valeur)) ?? "";
}

describe("Branche tâche — une tâche d'un autre workspace est introuvable", () => {
  it("session A + tacheId de B : aucun contexte, aucune donnée de B", async () => {
    const resultat = await resoudreContexteEcranCommunication({ tacheId: tacheB.id }, WORKSPACE_TEST);

    expect(resultat).toBeUndefined();
    const texte = aplatir(resultat);
    expect(texte).not.toContain(TITRE_TACHE_B);
    expect(texte).not.toContain(NOM_ACQ_B);
    expect(texte).not.toContain(EMAIL_ACQ_B);
  });

  it("contre-épreuve — session A + tacheId de A : contexte normal, destinataire résolu", async () => {
    const resultat = await resoudreContexteEcranCommunication({ tacheId: tacheA.id }, WORKSPACE_TEST);

    expect(resultat).toBeDefined();
    expect(resultat!.titre).toBe(TITRE_TACHE_A);
    const texte = aplatir(resultat);
    expect(texte).toContain(NOM_ACQ_A);
    expect(texte).not.toContain(NOM_ACQ_B);
    expect(texte).not.toContain(EMAIL_ACQ_B);
  });

  it("une tâche de A vue depuis B est tout aussi introuvable — la frontière joue dans les deux sens", async () => {
    const resultat = await resoudreContexteEcranCommunication({ tacheId: tacheA.id }, WORKSPACE_B);
    expect(resultat).toBeUndefined();
  });
});

describe("Branche constat — un bien d'un autre workspace est introuvable", () => {
  it("session A + bienId de B : aucun contexte, ni adresse ni titre de B", async () => {
    const resultat = await resoudreContexteEcranCommunication(
      { bienId: bienB.id, exigenceCode: "bien_titre_propriete" },
      WORKSPACE_TEST
    );

    expect(resultat).toBeUndefined();
    expect(aplatir(resultat)).not.toContain(ADRESSE_BIEN_B);
  });

  it("contre-épreuve — session A + bienId de A : la branche s'exécute réellement", async () => {
    // Le contexte n'aboutit que si l'exigence de checklist est effectivement en défaut ; ce qui est
    // vérifié ici est que la branche VA jusqu'à la checklist au lieu de s'arrêter sur un bien
    // introuvable. Un bien neuf sans document a nécessairement des exigences manquantes.
    const resultat = await resoudreContexteEcranCommunication(
      { bienId: bienA.id, exigenceCode: "bien_titre_propriete" },
      WORKSPACE_TEST
    );

    expect(resultat).toBeDefined();
    expect(aplatir(resultat)).not.toContain(ADRESSE_BIEN_B);
  });
});

describe("Branche notaire — même frontière", () => {
  it("session A + bienId de B : aucun contexte, aucune donnée de B", async () => {
    const resultat = await resoudreContexteEcranCommunication({ bienId: bienB.id, notaire: "1" }, WORKSPACE_TEST);

    expect(resultat).toBeUndefined();
    expect(aplatir(resultat)).not.toContain(ADRESSE_BIEN_B);
  });

  it("contre-épreuve — session A + bienId de A : contexte produit", async () => {
    const resultat = await resoudreContexteEcranCommunication({ bienId: bienA.id, notaire: "1" }, WORKSPACE_TEST);

    expect(resultat).toBeDefined();
    expect(aplatir(resultat)).not.toContain(ADRESSE_BIEN_B);
  });
});

describe("Branche acquéreur — déjà scopée par V2B2, vérifiée ici pour non-régression", () => {
  it("session A + acquereurId de B : aucun contexte", async () => {
    const resultat = await resoudreContexteEcranCommunication({ acquereurId: acquereurB.id }, WORKSPACE_TEST);
    expect(resultat).toBeUndefined();
    expect(aplatir(resultat)).not.toContain(NOM_ACQ_B);
  });
});
