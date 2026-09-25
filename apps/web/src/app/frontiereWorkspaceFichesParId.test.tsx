import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2C1 (ADR-054) — les cinq surfaces par ID que ce lot referme. Elles avaient
// toutes exactement le même défaut : la racine était lue par un reader GLOBAL, donc un identifiant
// d'un autre workspace rendait la page complète. Deux d'entre elles n'avaient même aucune notion
// de périmètre.
//
// Un seul fichier plutôt que cinq : ces surfaces ne partagent pas un domaine métier mais un
// PATRON — workspace d'abord, racine scopée, `notFound()` indistinguable d'un id inexistant. Les
// tester ensemble rend ce patron visible, et rend visible aussi le jour où l'une d'elles s'en
// écarte.
//
// Chaque cas a sa contre-épreuve positive : une garde qui ferait échouer les deux workspaces
// passerait tous les refus sans rien protéger.
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));

// `PhotosUploader` est un composant CLIENT (`useRouter`) : rendu hors d'un router monté, il lève
// « invariant expected app router to be mounted » et masquerait le seul comportement testé ici.
// Neutralisé, et lui seul : `notFound()` reste le vrai, les lectures de la page restent les vraies,
// et les identifiants de photos que ce test vérifie sont rendus par la page elle-même, jamais par
// l'uploader.
vi.mock("@/components/bien/PhotosUploader", () => ({
  default: ({ bienId }: { bienId: string }) => <div data-uploader={bienId} />,
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  prospectsVendeurs: prospectsTable,
  photosBien: photosBienTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { ajouterPhotoBien } = await import("@/lib/photoBienRepository");

const ModifierBienPage = (await import("./biens/[id]/modifier/page")).default;
const PhotosBienPage = (await import("./biens/[id]/photos/page")).default;
const ModifierAcquereurPage = (await import("./clients/[id]/modifier/page")).default;
const ModifierProspectPage = (await import("./prospects-vendeurs/[id]/modifier/page")).default;
const SignerMandatPage = (await import("./prospects-vendeurs/[id]/signer-mandat/page")).default;

const M = `Zv2c1${Date.now()}`;
const WORKSPACE_B = `ws-v2c1-${Date.now()}`;

// Valeurs présentes d'UN SEUL côté de la frontière : un test qui compte des lignes ne verrait pas
// un mélange entre deux jeux qui se ressemblent.
const TITRE_A = `${M} Villa du workspace A`;
const TITRE_B = `${M} Manoir confidentiel de B`;
const NOM_ACQ_A = `${M}AcquereurA`;
const NOM_ACQ_B = `${M}AcquereurB`;
const NOM_PROSPECT_A = `${M}ProspectA`;
const NOM_PROSPECT_B = `${M}ProspectB`;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsPhotos: string[] = [];

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] fiches par id B" });
});

afterAll(async () => {
  if (idsPhotos.length > 0) await getDb().delete(photosBienTable).where(inArray(photosBienTable.id, idsPhotos));
  if (idsProspects.length > 0) await getDb().delete(prospectsTable).where(inArray(prospectsTable.id, idsProspects));
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, [WORKSPACE_B]));
});

let compteur = 0;

async function unBien(workspaceId: string, titre: string) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] V2C1-${compteur}-${Date.now()}`,
      titre,
      type: "appartement",
      adresse: `${compteur} rue de la Frontière`,
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
  return bien;
}

async function unAcquereur(workspaceId: string, nom: string) {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom,
      email: `${M}.${compteur}@example.test`,
      telephone: "0600000000",
      budgetMin: 200000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "decouverte",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

async function unProspect(workspaceId: string, nom: string) {
  const prospect = await creerProspectVendeur(
    {
      nom,
      prenom: undefined,
      email: undefined,
      telephone: undefined,
      origineLead: undefined,
      origineLeadDetail: undefined,
      adresseBienPotentiel: undefined,
      secteurBienPotentiel: undefined,
      ville: undefined,
      codePostal: undefined,
      typeBien: undefined,
    },
    workspaceId
  );
  idsProspects.push(prospect.id);
  return prospect;
}

// `ordre` n'est jamais fourni par l'appelant (ADR-052 §11) : le repository le calcule sous verrou.
async function unePhoto(bienId: string, workspaceId: string, rang: number) {
  const photo = await ajouterPhotoBien(
    {
      bienId,
      cleStockage: `${M}/photo-${bienId}-${rang}.jpg`,
      nomFichierOriginal: `${M}-photo-${rang}.jpg`,
      typeMimeOriginal: "image/jpeg",
      tailleOctetsOriginal: 1024,
      hashSha256: `${M}${bienId}${rang}`.padEnd(64, "0").slice(0, 64),
    },
    workspaceId
  );
  idsPhotos.push(photo.id);
  return photo;
}

// `rejects.toThrow()` sans motif : Next.js signale `notFound()` par une exception dont le message
// a déjà changé d'une version à l'autre (NEXT_NOT_FOUND, puis NEXT_HTTP_ERROR_FALLBACK;404).
// Ce qui compte ici n'est pas le libellé mais le fait que RIEN ne soit rendu.
async function refuse(rendu: Promise<unknown>) {
  await expect(rendu).rejects.toThrow();
}

function rendreAvecId(Page: (props: { params: Promise<{ id: string }> }) => Promise<React.ReactElement>, id: string) {
  return Page({ params: Promise.resolve({ id }) }).then(renderToStaticMarkup);
}

describe("S1 — /biens/[id]/modifier", () => {
  it("session A + bien B : introuvable, aucun fragment du bien B rendu", async () => {
    const bienB = await unBien(WORKSPACE_B, TITRE_B);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    await refuse(rendreAvecId(ModifierBienPage, bienB.id));
  });

  it("contre-épreuve — session A + bien A : formulaire normal, titre présent", async () => {
    const bienA = await unBien(WORKSPACE_TEST, TITRE_A);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    const html = await rendreAvecId(ModifierBienPage, bienA.id);
    expect(html).toContain("Modifier le bien");
    expect(html).toContain(TITRE_A);
    expect(html).not.toContain(TITRE_B);
  });
});

describe("S2 — /biens/[id]/photos", () => {
  it("session A + bien B : introuvable AVANT tout rendu — ni titre, ni compteur, ni id de photo", async () => {
    const bienB = await unBien(WORKSPACE_B, TITRE_B);
    const photoB1 = await unePhoto(bienB.id, WORKSPACE_B, 0);
    const photoB2 = await unePhoto(bienB.id, WORKSPACE_B, 1);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

    await refuse(rendreAvecId(PhotosBienPage, bienB.id));

    // Les métadonnées existent bel et bien : c'est la page, pas l'absence de données, qui refuse.
    const lignes = await getDb().select().from(photosBienTable).where(inArray(photosBienTable.id, [photoB1.id, photoB2.id]));
    expect(lignes).toHaveLength(2);
  });

  it("contre-épreuve — session A + bien A : titre, compteur et ids de photos rendus", async () => {
    const bienA = await unBien(WORKSPACE_TEST, TITRE_A);
    const photoA = await unePhoto(bienA.id, WORKSPACE_TEST, 0);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

    const html = await rendreAvecId(PhotosBienPage, bienA.id);
    expect(html).toContain(TITRE_A);
    expect(html).toContain("Gérer les photos");
    expect(html).toContain(photoA.id);
    expect(html).not.toContain(TITRE_B);
  });
});

describe("S3 — /clients/[id]/modifier", () => {
  it("session A + acquéreur B : introuvable, identité de B jamais préremplie", async () => {
    const acquereurB = await unAcquereur(WORKSPACE_B, NOM_ACQ_B);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    await refuse(rendreAvecId(ModifierAcquereurPage, acquereurB.id));
  });

  it("contre-épreuve — session A + acquéreur A : formulaire prérempli", async () => {
    const acquereurA = await unAcquereur(WORKSPACE_TEST, NOM_ACQ_A);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    const html = await rendreAvecId(ModifierAcquereurPage, acquereurA.id);
    expect(html).toContain("Modifier l&#x27;acquéreur");
    expect(html).toContain(NOM_ACQ_A);
    expect(html).not.toContain(NOM_ACQ_B);
  });
});

describe("S4 — /prospects-vendeurs/[id]/modifier", () => {
  it("session A + prospect B : introuvable, identité de B jamais préremplie", async () => {
    const prospectB = await unProspect(WORKSPACE_B, NOM_PROSPECT_B);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    await refuse(rendreAvecId(ModifierProspectPage, prospectB.id));
  });

  it("contre-épreuve — session A + prospect A : formulaire prérempli", async () => {
    const prospectA = await unProspect(WORKSPACE_TEST, NOM_PROSPECT_A);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    const html = await rendreAvecId(ModifierProspectPage, prospectA.id);
    expect(html).toContain("Modifier le prospect vendeur");
    expect(html).toContain(NOM_PROSPECT_A);
    expect(html).not.toContain(NOM_PROSPECT_B);
  });
});

describe("S5 — /prospects-vendeurs/[id]/signer-mandat", () => {
  // Le point sensible de cette page : elle a DEUX `notFound()`, l'un pour l'absence, l'autre pour
  // un statut non éligible. Tant que le refus de périmètre passait après le contrôle de statut,
  // l'état d'un prospect étranger restait observable — « perdu » et « éligible » ne rendaient pas
  // la même chose. Les deux cas ci-dessous doivent être INDISTINGUABLES vus de A.
  it("session A + prospect B éligible : introuvable", async () => {
    const prospectB = await unProspect(WORKSPACE_B, `${NOM_PROSPECT_B}Eligible`);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    await refuse(rendreAvecId(SignerMandatPage, prospectB.id));
  });

  it("session A + prospect B NON éligible (perdu) : introuvable, le statut ne fuit pas", async () => {
    const prospectB = await unProspect(WORKSPACE_B, `${NOM_PROSPECT_B}Perdu`);
    await getDb()
      .update(prospectsTable)
      .set({ datePerte: "2026-01-15", motifPerte: "autre" })
      .where(inArray(prospectsTable.id, [prospectB.id]));
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    await refuse(rendreAvecId(SignerMandatPage, prospectB.id));
  });

  it("contre-épreuve — session A + prospect A éligible : formulaire de signature", async () => {
    const prospectA = await unProspect(WORKSPACE_TEST, `${NOM_PROSPECT_A}Signature`);
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    const html = await rendreAvecId(SignerMandatPage, prospectA.id);
    expect(html).toContain("Signer le mandat");
    expect(html).toContain(`${NOM_PROSPECT_A}Signature`);
  });

  it("contre-épreuve — session A + prospect A perdu : introuvable AUSSI (règle métier inchangée)", async () => {
    const prospectA = await unProspect(WORKSPACE_TEST, `${NOM_PROSPECT_A}Perdu`);
    await getDb()
      .update(prospectsTable)
      .set({ datePerte: "2026-01-15", motifPerte: "autre" })
      .where(inArray(prospectsTable.id, [prospectA.id]));
    workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
    await refuse(rendreAvecId(SignerMandatPage, prospectA.id));
  });
});
