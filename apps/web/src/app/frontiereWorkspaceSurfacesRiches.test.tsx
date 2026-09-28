import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2C2 (ADR-054) — les cinq dernières surfaces V2C : trois fiches riches par id
// et deux formulaires de création. Elles partagent le patron déjà verrouillé par V2C1 (périmètre
// d'abord, racine scopée, `notFound()` indistinguable), mais elles y ajoutent ce que V2C1 n'avait
// pas à traiter : des LISTES qui alimentent des MOTEURS. Une racine correctement scopée ne protège
// rien si le catalogue qu'on lui donne à croiser, lui, est global — la fuite change alors de forme
// (ce n'est plus « une fiche s'affiche », c'est « une personne d'ici se voit proposer un bien
// d'ailleurs, nommément »).
//
// Chaque refus a donc sa contre-épreuve positive ET, quand un moteur est en jeu, un JUMEAU dans A :
// un acquéreur de A aussi compatible que celui de B, un bien de A aussi compatible que celui de B.
// Sans ce jumeau, un moteur cassé (qui ne proposerait plus rien du tout) passerait tous les refus.
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  prospectsVendeurs: prospectsTable,
  taches: tachesTable,
  offres: offresTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { creerTache } = await import("@/lib/tacheRepository");
const { enregistrerOffre } = await import("@/lib/offreRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");

const FicheBien = (await import("./biens/[id]/page")).default;
const FicheClient = (await import("./clients/[id]/page")).default;
const FicheProspect = (await import("./prospects-vendeurs/[id]/page")).default;
const NouvelleOffrePage = (await import("./offres/nouveau/page")).default;
const NouveauCompromisPage = (await import("./compromis/nouveau/page")).default;

const M = `Zv2c2${Date.now()}`;
const WORKSPACE_B = `ws-v2c2-${Date.now()}`;

// Valeurs présentes d'UN SEUL côté de la frontière, et assez singulières pour qu'aucune collision
// avec le reste du jeu de test ne puisse rendre une assertion `not.toContain` vraie par accident.
const TITRE_BIEN_A = `${M} Loft temoin de A`;
const TITRE_BIEN_B = `${M} Manoir confidentiel de B`;
const NOM_ACQ_A = `${M}AcquereurTemoinA`;
const NOM_ACQ_B = `${M}AcquereurConfidentielB`;
const NOM_PROSPECT_A = `${M}ProspectA`;
const NOM_PROSPECT_B = `${M}ProspectB`;
const TITRE_TACHE_A = `${M} Tache temoin de A`;
const TITRE_TACHE_B = `${M} Tache confidentielle de B`;
const RETOUR_CR_B = `${M} Compte rendu confidentiel de B`;
const MONTANT_OFFRE_B = 987654;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsTaches: string[] = [];
const idsOffres: string[] = [];
const idsComptesRendus: string[] = [];

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] surfaces riches B" });
});

afterAll(async () => {
  if (idsTaches.length > 0) await getDb().delete(tachesTable).where(inArray(tachesTable.id, idsTaches));
  if (idsOffres.length > 0) await getDb().delete(offresTable).where(inArray(offresTable.id, idsOffres));
  if (idsComptesRendus.length > 0)
    await getDb().delete(comptesRendusVisiteTable).where(inArray(comptesRendusVisiteTable.id, idsComptesRendus));
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
      reference: `[test réel] V2C2-${compteur}-${Date.now()}`,
      titre,
      type: "appartement",
      adresse: `${compteur} rue de la Frontière`,
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

// Budget volontairement large : ces acquéreurs doivent être compatibles avec les DEUX biens, pour
// que l'absence de B dans un panneau de A ne puisse jamais s'expliquer par un simple « pas
// compatible ».
async function unAcquereur(workspaceId: string, nom: string) {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom,
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

async function uneTache(workspaceId: string, titre: string, cible: { type: "bien" | "acquereur"; id: string }) {
  const tache = await creerTache(
    { titre, contexte: undefined, type: "relance", priorite: "normale", echeance: "2026-12-01", origine: "manuelle", cible },
    workspaceId
  );
  idsTaches.push(tache.id);
  return tache;
}

async function refuse(rendu: Promise<unknown>) {
  await expect(rendu).rejects.toThrow();
}

type PropsFiche = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

function rendreFiche(Page: (props: PropsFiche) => Promise<React.ReactElement>, id: string) {
  return Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }).then(renderToStaticMarkup);
}

// Le markup statique ne suffit pas pour DEUX des surfaces : `BienTabs` et les panneaux de matching
// sont des composants CLIENT, dont `renderToStaticMarkup` ne rend que l'onglet actif — un
// `<select>` rempli d'acquéreurs étrangers n'y laisserait aucune trace. Or c'est précisément là que
// vivaient les fuites : dans la LISTE passée en props, avant tout rendu. On inspecte donc l'arbre
// React retourné par la page, c'est-à-dire la donnée elle-même, pas sa projection HTML.
function trouverProps(noeud: unknown, nomComposant: string): Record<string, unknown> | undefined {
  if (!noeud || typeof noeud !== "object") return undefined;
  if (Array.isArray(noeud)) {
    for (const enfant of noeud) {
      const trouve = trouverProps(enfant, nomComposant);
      if (trouve) return trouve;
    }
    return undefined;
  }
  const element = noeud as { type?: unknown; props?: Record<string, unknown> };
  const type = element.type;
  const nom =
    typeof type === "function" ? ((type as { displayName?: string; name?: string }).displayName ?? type.name) : undefined;
  if (nom === nomComposant) return element.props;
  return element.props ? trouverProps(element.props.children, nomComposant) : undefined;
}

type PropsCreation = { searchParams: Promise<Record<string, string | undefined>> };

function rendreCreation(
  Page: (props: PropsCreation) => Promise<React.ReactElement>,
  searchParams: Record<string, string | undefined>
) {
  return Page({ searchParams: Promise.resolve(searchParams) }).then(renderToStaticMarkup);
}

// ── Jeu commun. Construit UNE fois : les vingt et un cas ci-dessous lisent le même monde à deux
// workspaces, ce qui rend visible qu'aucun d'eux ne dépend d'un jeu taillé sur mesure.
let bienA: Awaited<ReturnType<typeof unBien>>;
let bienB: Awaited<ReturnType<typeof unBien>>;
let acquereurA: Awaited<ReturnType<typeof unAcquereur>>;
let acquereurB: Awaited<ReturnType<typeof unAcquereur>>;
let prospectA: Awaited<ReturnType<typeof unProspect>>;
let prospectB: Awaited<ReturnType<typeof unProspect>>;
let offreB: Awaited<ReturnType<typeof enregistrerOffre>>;

beforeAll(async () => {
  bienA = await unBien(WORKSPACE_TEST, TITRE_BIEN_A);
  bienB = await unBien(WORKSPACE_B, TITRE_BIEN_B);
  acquereurA = await unAcquereur(WORKSPACE_TEST, NOM_ACQ_A);
  acquereurB = await unAcquereur(WORKSPACE_B, NOM_ACQ_B);
  prospectA = await unProspect(WORKSPACE_TEST, NOM_PROSPECT_A);
  prospectB = await unProspect(WORKSPACE_B, NOM_PROSPECT_B);

  await uneTache(WORKSPACE_TEST, TITRE_TACHE_A, { type: "bien", id: bienA.id });
  await uneTache(WORKSPACE_B, TITRE_TACHE_B, { type: "bien", id: bienB.id });
  await uneTache(WORKSPACE_B, `${TITRE_TACHE_B} acquéreur`, { type: "acquereur", id: acquereurB.id });

  const crB = await enregistrerCompteRenduVisite({
    bienId: bienB.id,
    acquereurId: acquereurB.id,
    dateVisite: "2026-02-01",
    retour: RETOUR_CR_B,
    interet: "interesse",
  });
  idsComptesRendus.push(crB.id);

  offreB = await enregistrerOffre({
    bienId: bienB.id,
    acquereurId: acquereurB.id,
    montant: MONTANT_OFFRE_B,
    dateOffre: "2026-02-02",
  });
  idsOffres.push(offreB.id);

  workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);
});

describe("T1–T4 — /biens/[id]", () => {
  it("T1 — session A + bien B : introuvable, rien du bien B n'est rendu", async () => {
    await refuse(rendreFiche(FicheBien, bienB.id));
  });

  // La fiche Bien ne ré-affiche volontairement pas `bien.titre` (le hero porte l'adresse et la
  // référence) : la contre-épreuve s'appuie donc sur ce que la page rend RÉELLEMENT.
  it("T2 — contre-épreuve : session A + bien A rend la fiche complète", async () => {
    const html = await rendreFiche(FicheBien, bienA.id);
    expect(html).toContain(bienA.reference);
    expect(html).not.toContain(bienB.reference);
    expect(html).not.toContain(TITRE_BIEN_B);
  });

  it("T3 — acquéreur B aussi compatible que A : absent des panneaux ET des sélecteurs", async () => {
    const html = await rendreFiche(FicheBien, bienA.id);
    // Le jumeau de A est bien là : le moteur tourne, il n'est pas simplement vide.
    expect(html).toContain(NOM_ACQ_A);
    expect(html).not.toContain(NOM_ACQ_B);
    expect(html).not.toContain(acquereurB.id);

    // …et la même vérification sur la LISTE elle-même, celle qui alimente les <select> de BienTabs.
    // Le markup seul ne la voit pas : BienTabs ne rend que son onglet actif.
    const element = await FicheBien({ params: Promise.resolve({ id: bienA.id }), searchParams: Promise.resolve({}) });
    for (const composant of ["BienTabs", "BienAcquereursCompatibles"]) {
      const props = trouverProps(element, composant);
      expect(props, composant).toBeDefined();
      const ids = (props!.acquereursActifs as { id: string }[]).map((a) => a.id);
      expect(ids, composant).toContain(acquereurA.id);
      expect(ids, composant).not.toContain(acquereurB.id);
    }
  });

  it("T4 — tâche de B (portée par un autre bien) : jamais visible sur le bien A", async () => {
    const html = await rendreFiche(FicheBien, bienA.id);
    expect(html).toContain(TITRE_TACHE_A);
    expect(html).not.toContain(TITRE_TACHE_B);
  });
});

describe("T5–T9 — /clients/[id]", () => {
  it("T5 — session A + acquéreur B : introuvable", async () => {
    await refuse(rendreFiche(FicheClient, acquereurB.id));
  });

  it("T6 — contre-épreuve : session A + acquéreur A rend la fiche complète", async () => {
    const html = await rendreFiche(FicheClient, acquereurA.id);
    expect(html).toContain(NOM_ACQ_A);
    expect(html).not.toContain(NOM_ACQ_B);
  });

  it("T7/T8 — bien B aussi compatible que A : ni opportunité, ni reprise de contact, ni titre, ni id", async () => {
    const html = await rendreFiche(FicheClient, acquereurA.id);
    // Le jumeau de A traverse bien le moteur d'opportunités et la reprise de contact.
    expect(html).toContain(TITRE_BIEN_A);
    expect(html).not.toContain(TITRE_BIEN_B);
    expect(html).not.toContain(bienB.id);

    // Le cœur du cas : `biensActifs` est la MÊME liste qui entre dans chargerContexteOpportunites()
    // et dans construireRepriseContactAcquereur(). Vérifier le HTML ne prouverait que l'absence
    // d'une opportunité effectivement DÉCLENCHÉE ; ce qu'il faut prouver, c'est qu'aucun bien
    // étranger n'entre dans le croisement — une paire non retenue aujourd'hui par une règle le
    // serait demain par la suivante.
    const element = await FicheClient({
      params: Promise.resolve({ id: acquereurA.id }),
      searchParams: Promise.resolve({}),
    });
    const props = trouverProps(element, "AcquereurBiensCompatibles");
    expect(props).toBeDefined();
    const ids = (props!.biensActifs as { id: string }[]).map((b) => b.id);
    expect(ids).toContain(bienA.id);
    expect(ids).not.toContain(bienB.id);
  });

  it("T9 — tâche de B et compte rendu de B : absents de la fiche A", async () => {
    const html = await rendreFiche(FicheClient, acquereurA.id);
    expect(html).not.toContain(TITRE_TACHE_B);
    expect(html).not.toContain(RETOUR_CR_B);
  });
});

describe("T10–T12 — /prospects-vendeurs/[id]", () => {
  it("T10 — session A + prospect B : introuvable", async () => {
    await refuse(rendreFiche(FicheProspect, prospectB.id));
  });

  it("T11 — contre-épreuve : session A + prospect A rend le cockpit", async () => {
    const html = await rendreFiche(FicheProspect, prospectA.id);
    expect(html).toContain(NOM_PROSPECT_A);
    expect(html).not.toContain(NOM_PROSPECT_B);
  });

  it("T12 — aucun détail secondaire de B : ni bien, ni tâche, ni note, ni mandat", async () => {
    const html = await rendreFiche(FicheProspect, prospectA.id);
    expect(html).not.toContain(TITRE_BIEN_B);
    expect(html).not.toContain(TITRE_TACHE_B);
    expect(html).not.toContain(prospectB.id);
  });

  // `prospects_vendeurs.bien_id` référence `biens.id` SANS contrainte de workspace commun : la
  // dérivation « le bien d'un prospect de A est forcément dans A » n'est pas garantie par le
  // schéma. Ce cas fabrique exactement la ligne que le schéma autorise et vérifie que la page ne
  // rend rien du bien étranger — la preuve que la lecture est scopée, pas dérivée.
  it("T12 bis — un prospect de A pointant un bien de B ne révèle rien de ce bien", async () => {
    const prospectCroise = await unProspect(WORKSPACE_TEST, `${NOM_PROSPECT_A}Croise`);
    await getDb().update(prospectsTable).set({ bienId: bienB.id }).where(inArray(prospectsTable.id, [prospectCroise.id]));
    const html = await rendreFiche(FicheProspect, prospectCroise.id);
    expect(html).toContain(`${NOM_PROSPECT_A}Croise`);
    expect(html).not.toContain(TITRE_BIEN_B);
    expect(html).not.toContain(bienB.reference);

    // Contre-épreuve indispensable : le bloc « Bien créé » s'affiche bel et bien quand le bien est
    // dans le périmètre. Sans elle, un composant devenu muet ferait passer le cas ci-dessus.
    const prospectAvecBienA = await unProspect(WORKSPACE_TEST, `${NOM_PROSPECT_A}BienA`);
    await getDb().update(prospectsTable).set({ bienId: bienA.id }).where(inArray(prospectsTable.id, [prospectAvecBienA.id]));
    const htmlA = await rendreFiche(FicheProspect, prospectAvecBienA.id);
    expect(htmlA).toContain(TITRE_BIEN_A);
    expect(htmlA).toContain(bienA.reference);
  });
});

describe("T13–T16 — /offres/nouveau", () => {
  it("T13 — bienId de B : écran honnête, aucune donnée de B, aucun aveu d'existence", async () => {
    const html = await rendreCreation(NouvelleOffrePage, { bienId: bienB.id });
    expect(html).toContain("Aucun bien valide n&#x27;est associé à cette création");
    expect(html).not.toContain(TITRE_BIEN_B);
    // Indistinguable d'un id inexistant : le message ne dit jamais « autre workspace ».
    expect(html).not.toMatch(/workspace|périmètre|autre compte/i);
  });

  it("T14 — acquereurId de B sur un bien de A : aucune identité de B préremplie", async () => {
    const html = await rendreCreation(NouvelleOffrePage, { bienId: bienA.id, acquereurId: acquereurB.id });
    expect(html).toContain(TITRE_BIEN_A);
    expect(html).not.toContain(NOM_ACQ_B);
    expect(html).not.toContain(acquereurB.id);
  });

  it("T15 — sélecteur d'acquéreurs : uniquement ceux de A", async () => {
    const html = await rendreCreation(NouvelleOffrePage, { bienId: bienA.id });
    expect(html).toContain(NOM_ACQ_A);
    expect(html).not.toContain(NOM_ACQ_B);
  });

  it("T16 — contre-épreuve : ids de A valides, formulaire prérempli normalement", async () => {
    const html = await rendreCreation(NouvelleOffrePage, { bienId: bienA.id, acquereurId: acquereurA.id });
    expect(html).toContain(TITRE_BIEN_A);
    expect(html).toContain(NOM_ACQ_A);
  });
});

describe("T17–T21 — /compromis/nouveau", () => {
  it("T17 — bienId de B : écran honnête, aucune donnée de B", async () => {
    const html = await rendreCreation(NouveauCompromisPage, { bienId: bienB.id });
    expect(html).toContain("Aucun bien valide n&#x27;est associé à cette création");
    expect(html).not.toContain(TITRE_BIEN_B);
    expect(html).not.toMatch(/workspace|périmètre|autre compte/i);
  });

  it("T18 — acquereurId de B sur un bien de A : aucune identité de B", async () => {
    const html = await rendreCreation(NouveauCompromisPage, { bienId: bienA.id, acquereurId: acquereurB.id });
    expect(html).toContain(TITRE_BIEN_A);
    expect(html).not.toContain(NOM_ACQ_B);
  });

  it("T19 — offreId de B : refus du préremplissage, ni montant ni id de l'offre étrangère", async () => {
    const html = await rendreCreation(NouveauCompromisPage, {
      bienId: bienA.id,
      acquereurId: acquereurA.id,
      offreId: offreB.id,
    });
    expect(html).not.toContain(offreB.id);
    expect(html).not.toContain(String(MONTANT_OFFRE_B));
  });

  it("T20 — sélecteur d'acquéreurs : uniquement ceux de A", async () => {
    const html = await rendreCreation(NouveauCompromisPage, { bienId: bienA.id });
    expect(html).toContain(NOM_ACQ_A);
    expect(html).not.toContain(NOM_ACQ_B);
  });

  it("T21 — contre-épreuve : ids de A valides, formulaire normal", async () => {
    const html = await rendreCreation(NouveauCompromisPage, { bienId: bienA.id });
    expect(html).toContain(TITRE_BIEN_A);
    expect(html).toContain("Nouveau compromis");
  });
});
