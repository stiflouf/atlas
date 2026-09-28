import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2D1 (ADR-054) — la frontière DOMIORA de /visites/[id]/preparer.
//
// Ce que ce fichier teste, et que rien d'autre ne pouvait tester : le rapprochement d'un événement
// Calendar est TEXTUEL (une adresse, un nom de famille suffisent à produire un candidat). Tant que
// le pool de candidats était le catalogue complet, deux agences d'une même ville se disputaient le
// même événement. Le périmètre doit donc borner le POOL, pas le résultat — et c'est précisément ce
// qu'un test sur le HTML final ne montre pas : filtrer après coup donnerait le même écran dans les
// cas simples, tout en laissant la paire exister et la décision s'écrire en mémoire.
//
// D'où la forme des cas T3/T4/T10 : les données de A et de B sont RIGOUREUSEMENT HOMONYMES (même
// adresse, même identité). Avec un pool global, les deux candidats sont à égalité, le résolveur les
// déclare ambigus (DELTA_AMBIGUITE) et la page ne résout PLUS RIEN — les données de B ne « fuient »
// pas, elles DÉTRUISENT le contexte de A. Avec un pool scopé, A résout normalement. La contre-
// épreuve est donc intégrée au cas lui-même.
//
// L'identité de route reste `rendezVousCalendarId` (ADR-063) : aucun cas ici n'utilise `visite.id`.
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub-v2d1", email: "conseiller@example.com" }),
}));

// Google est mocké au plus bas niveau possible — connexion, token, transport — pour que TOUT le
// reste de la chaîne reste RÉEL : adapter, moteur de matching, résolveur, mémoire persistée. Un
// mock de `getRendezVousAvecContexte` aurait court-circuité exactement ce qu'on veut prouver.
const { evenementCourant } = vi.hoisted(() => ({ evenementCourant: { valeur: null as unknown } }));
vi.mock("@/lib/google/connexion", () => ({
  lireConnexionGoogle: vi.fn().mockResolvedValue({ refreshToken: "refresh-test", scope: "calendar" }),
}));
vi.mock("@/lib/google/oauth", () => ({
  rafraichirAccessToken: vi.fn().mockResolvedValue({ accessToken: "access-test", expiresAt: Date.now() + 3_600_000 }),
}));
vi.mock("@/lib/google/calendarClient", () => ({
  recupererEvenement: vi.fn(async () => evenementCourant.valeur),
  listerEvenements: vi.fn(async () => []),
}));

// Les cinq enrichissements externes de la page. Espionnés, jamais appelés pour de vrai : ce sont
// eux qui, avant ce lot, pouvaient partir vers des tiers avec l'adresse d'un bien d'un autre
// workspace — la page les lançait après avoir résolu le bien par un lecteur GLOBAL.
const { appelsGeocodage } = vi.hoisted(() => ({ appelsGeocodage: [] as string[] }));
vi.mock("@/lib/geocodage/ignClient", () => ({
  geocoderAdresse: vi.fn(async (adresse: string) => {
    appelsGeocodage.push(adresse);
    return undefined;
  }),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  visites: visitesTable,
  memoireContextuelle,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { materialiserVisite } = await import("@/lib/visiteRepository");
const { enregistrerValidationBien } = await import("@/actions/validationRendezVous");
const PreparerVisite = (await import("./page")).default;

const M = `Zv2d1${Date.now()}`;
const WORKSPACE_B = `ws-v2d1-${Date.now()}`;
const SOURCE = "google_calendar";

// Adresse et identité STRICTEMENT identiques des deux côtés : c'est le piège du matching textuel.
const ADRESSE = `${M} rue de la Frontiere`;
const VILLE = `${M}ville`;
const NOM_ACQ = `${M}Homonyme`;
const PRENOM_ACQ = "Camille";
// Ce qui distingue A de B dans le rendu : jamais l'adresse ni le nom, qui sont volontairement égaux.
const TITRE_BIEN_A = `${M} Bien du workspace A`;
const TITRE_BIEN_B = `${M} Bien confidentiel de B`;

const EVENT_ID = `${M}-event`;
const RDV_ID = `gcal-${EVENT_ID}`;
const EVENT_ID_B = `${M}-event-b`;
const RDV_ID_B = `gcal-${EVENT_ID_B}`;

function evenement(id: string) {
  return {
    id,
    status: "confirmed",
    summary: `Visite ${PRENOM_ACQ} ${NOM_ACQ}`,
    location: `${ADRESSE}, 00000 ${VILLE}`,
    start: { dateTime: "2026-09-01T10:00:00+02:00" },
    end: { dateTime: "2026-09-01T11:00:00+02:00" },
  };
}

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];

let bienA: Awaited<ReturnType<typeof creerBien>>;
let bienB: Awaited<ReturnType<typeof creerBien>>;
let acquereurA: Awaited<ReturnType<typeof creerAcquereur>>;
let acquereurB: Awaited<ReturnType<typeof creerAcquereur>>;

let compteur = 0;

async function unBien(workspaceId: string, titre: string) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] V2D1-${compteur}-${Date.now()}`,
      titre,
      type: "appartement",
      adresse: ADRESSE,
      ville: VILLE,
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

async function unAcquereur(workspaceId: string) {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: PRENOM_ACQ,
      nom: NOM_ACQ,
      email: `${M}.${compteur}@example.test`,
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

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] frontière preparer B" });
  bienA = await unBien(WORKSPACE_TEST, TITRE_BIEN_A);
  bienB = await unBien(WORKSPACE_B, TITRE_BIEN_B);
  acquereurA = await unAcquereur(WORKSPACE_TEST);
  acquereurB = await unAcquereur(WORKSPACE_B);
  evenementCourant.valeur = evenement(EVENT_ID);
  workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
});

afterAll(async () => {
  await getDb()
    .delete(memoireContextuelle)
    .where(inArray(memoireContextuelle.identifiantExterne, [RDV_ID, RDV_ID_B]));
  if (idsBiens.length > 0) await getDb().delete(visitesTable).where(inArray(visitesTable.bienId, idsBiens));
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, [WORKSPACE_B]));
});

function rendre(id: string) {
  return PreparerVisite({ params: Promise.resolve({ id }) }).then(renderToStaticMarkup);
}

async function ligneMemoire(workspaceId: string, identifiantExterne: string) {
  const [ligne] = await getDb()
    .select()
    .from(memoireContextuelle)
    .where(
      and(
        eq(memoireContextuelle.workspaceId, workspaceId),
        eq(memoireContextuelle.source, SOURCE),
        eq(memoireContextuelle.identifiantExterne, identifiantExterne)
      )
    );
  return ligne;
}

describe("T1/T3/T4/T10 — rapprochement borné au référentiel du workspace", () => {
  it("T1 + T3 + T4 + T10 — données homonymes des deux côtés : A résout normalement, B n'existe pas", async () => {
    evenementCourant.valeur = evenement(EVENT_ID);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

    const html = await rendre(RDV_ID);

    // Le contexte de A est RÉSOLU — c'est la contre-épreuve : avec un pool global, les deux biens
    // homonymes seraient à égalité de score, le résolveur les déclarerait ambigus et la page
    // afficherait « n'a pas pu identifier ». Voir aussi le cas de détection plus bas.
    expect(html).toContain(TITRE_BIEN_A);
    expect(html).not.toContain(TITRE_BIEN_B);
    expect(html).not.toContain(bienB.id);
    expect(html).not.toContain(acquereurB.id);
    expect(html).not.toContain("n&#x27;a pas pu identifier");
  });

  it("T5 — la mémoire est écrite sous le TRIPLET, avec le bien de A", async () => {
    evenementCourant.valeur = evenement(EVENT_ID);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    await rendre(RDV_ID);

    const ligneA = await ligneMemoire(WORKSPACE_TEST, RDV_ID);
    expect(ligneA).toBeDefined();
    expect(ligneA.bienId).toBe(bienA.id);
    expect(ligneA.workspaceId).toBe(WORKSPACE_TEST);

    // Le MÊME événement, vu depuis B, produit sa propre ligne — impossible avant la migration 0055
    // (UNIQUE(source, identifiant_externe) globale) : l'upsert de B aurait écrasé celle de A.
    workspaceCourantMock.mockResolvedValue(WORKSPACE_B);
    await rendre(RDV_ID);

    const ligneB = await ligneMemoire(WORKSPACE_B, RDV_ID);
    expect(ligneB).toBeDefined();
    expect(ligneB.bienId).toBe(bienB.id);

    // …et celle de A est INTACTE : deux lignes distinctes, aucune n'a écrasé l'autre.
    const ligneARelue = await ligneMemoire(WORKSPACE_TEST, RDV_ID);
    expect(ligneARelue.bienId).toBe(bienA.id);
    expect(ligneARelue.id).not.toBe(ligneB.id);

    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
  });
});

describe("T2/T9 — la Visite canonique comme preuve d'appartenance", () => {
  it("T9 — Visite de A existante : elle prouve l'appartenance, le contexte reste celui de A", async () => {
    const resultat = await materialiserVisite(
      { bienId: bienA.id, acquereurId: acquereurA.id, datePrevue: "2026-09-01", rendezVousCalendarId: RDV_ID },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("creee");

    evenementCourant.valeur = evenement(EVENT_ID);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    const html = await rendre(RDV_ID);

    expect(html).toContain(TITRE_BIEN_A);
    expect(html).not.toContain(TITRE_BIEN_B);
  });

  it("T2 — Visite matérialisée dans B : invisible depuis A, aucune donnée de B rendue", async () => {
    const resultat = await materialiserVisite(
      { bienId: bienB.id, acquereurId: acquereurB.id, datePrevue: "2026-09-01", rendezVousCalendarId: RDV_ID_B },
      WORKSPACE_B
    );
    expect(resultat.statut).toBe("creee");

    evenementCourant.valeur = evenement(EVENT_ID_B);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    const html = await rendre(RDV_ID_B);

    // La Visite de B n'est jamais la preuve d'appartenance de A : le rapprochement retombe sur le
    // référentiel de A, qui contient un bien homonyme légitime — rien de B n'apparaît.
    expect(html).not.toContain(TITRE_BIEN_B);
    expect(html).not.toContain(bienB.id);
    expect(html).not.toContain(acquereurB.id);
  });
});

describe("T8 — événement sans Visite canonique (cas nominal, ADR-063)", () => {
  it("la page fonctionne et propose la matérialisation, sans Visite préexistante", async () => {
    const EVENT_SANS_VISITE = `${M}-event-sans-visite`;
    evenementCourant.valeur = evenement(EVENT_SANS_VISITE);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

    const html = await rendre(`gcal-${EVENT_SANS_VISITE}`);

    expect(html).toContain("Rendez-vous résolu");
    expect(html).toContain("Enregistrer et préparer cette visite");
    expect(html).toContain(TITRE_BIEN_A);
    expect(html).not.toContain(TITRE_BIEN_B);

    await getDb()
      .delete(memoireContextuelle)
      .where(eq(memoireContextuelle.identifiantExterne, `gcal-${EVENT_SANS_VISITE}`));
  });
});

describe("T6 — écriture de mémoire depuis A avec un bien de B", () => {
  it("refus neutre : rien n'est écrit, ni pour B ni pour A", async () => {
    const EVENT_T6 = `${M}-event-t6`;
    const RDV_T6 = `gcal-${EVENT_T6}`;
    evenementCourant.valeur = evenement(EVENT_T6);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

    await enregistrerValidationBien(RDV_T6, "corrige", bienB.id);

    // Aucune décision enregistrée dans A pour un bien qu'elle ne possède pas…
    const ligneA = await ligneMemoire(WORKSPACE_TEST, RDV_T6);
    expect(ligneA?.statutValidation).not.toBe("corrige");
    expect(ligneA?.bienId).not.toBe(bienB.id);
    // …et rien n'a été écrit dans le périmètre de B non plus.
    expect(await ligneMemoire(WORKSPACE_B, RDV_T6)).toBeUndefined();

    // Contre-épreuve : le même geste avec un bien de A est bien enregistré.
    await enregistrerValidationBien(RDV_T6, "corrige", bienA.id);
    const apres = await ligneMemoire(WORKSPACE_TEST, RDV_T6);
    expect(apres.statutValidation).toBe("corrige");
    expect(apres.bienId).toBe(bienA.id);

    await getDb().delete(memoireContextuelle).where(eq(memoireContextuelle.identifiantExterne, RDV_T6));
  });
});

describe("Exfiltration vers des services tiers", () => {
  it("aucune adresse n'est géocodée tant que le bien n'est pas prouvé dans le workspace", async () => {
    // Un événement qui ne résout AUCUN bien dans le périmètre : la page s'arrête à l'écran honnête.
    // Avant ce lot, la résolution passait par un lecteur global — un bien étranger pouvait être
    // retenu, et son adresse partait vers l'IGN avant toute preuve d'appartenance.
    appelsGeocodage.length = 0;
    evenementCourant.valeur = {
      ...evenement(`${M}-event-inconnu`),
      summary: `${M} rendez-vous sans correspondance`,
      location: `${M} adresse totalement inconnue`,
    };
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

    await rendre(`gcal-${M}-event-inconnu`);

    expect(appelsGeocodage).toEqual([]);

    await getDb()
      .delete(memoireContextuelle)
      .where(eq(memoireContextuelle.identifiantExterne, `gcal-${M}-event-inconnu`));
  });
});
