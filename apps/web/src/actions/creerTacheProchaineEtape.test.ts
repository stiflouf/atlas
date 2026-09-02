import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
import { eq, inArray } from "drizzle-orm";

// VALUE-02 — test d'intégration réel (vraie base), même discipline que
// enregistrerCompteRenduVisite.test.ts : ce qui compte ici est qu'AUCUNE tâche ne soit créée
// silencieusement et qu'un second clic n'en crée jamais une deuxième.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, taches: tachesTable, comptesRendusVisite } =
  await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { materialiserVisite } = await import("@/lib/visiteRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { getTachesPourAcquereur } = await import("@/lib/tacheRepository");
const { creerTacheProchaineEtapeAction } = await import("./creerTacheProchaineEtape");

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];

afterAll(async () => {
  const db = getDb();
  if (idsAcquereurs.length > 0) {
    await db.delete(tachesTable).where(inArray(tachesTable.acquereurId, idsAcquereurs));
  }
  if (idsBiens.length > 0) {
    await db.delete(comptesRendusVisite).where(inArray(comptesRendusVisite.bienId, idsBiens));
    await db.delete(biensTable).where(inArray(biensTable.id, idsBiens));
  }
  if (idsAcquereurs.length > 0) {
    await db.delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  }
});

const PROCHAINE = "Recontacter Camille vendredi pour une seconde visite";

// `null` signifie explicitement « aucune prochaine étape » — un paramètre par défaut ne
// distinguerait pas ce cas d'un argument omis.
async function dossier(suffixe: string, prochaineEtape: string | null = PROCHAINE) {
  const bien = await creerBien({
    reference: `[test réel] VALUE02-${suffixe}`,
    titre: `[test réel] VALUE02 ${suffixe}`,
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
  idsBiens.push(bien.id);
  const acquereur = await creerAcquereur({
    prenom: "[test réel]",
    nom: `VALUE02-${suffixe}`,
    email: `value02-${suffixe}@test.local`,
    telephone: "0100000000",
    budgetMin: 100000,
    budgetMax: 500000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereurs.push(acquereur.id);
  const visite = await materialiserVisite({
    bienId: bien.id,
    acquereurId: acquereur.id,
    datePrevue: "2026-08-01",
    rendezVousCalendarId: `gcal-value02-${bien.id}`,
  });
  await enregistrerCompteRenduVisite({
    bienId: bien.id,
    acquereurId: acquereur.id,
    visiteId: visite!.id,
    dateVisite: "2026-08-01",
    retour: "Retour de visite.",
    interet: "interesse",
    prochaineEtape: prochaineEtape ?? undefined,
  });
  return { bien, acquereur, visite: visite! };
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("creerTacheProchaineEtapeAction — promotion explicite", () => {
  it("crée une tâche portant exactement la prochaine étape persistée, ciblant l'acquéreur", async () => {
    const { acquereur, visite } = await dossier("A");

    await creerTacheProchaineEtapeAction(formData({ visiteId: visite.id })).catch(() => {});

    const taches = await getTachesPourAcquereur(acquereur.id);
    expect(taches).toHaveLength(1);
    expect(taches[0].titre).toBe(PROCHAINE);
    expect(taches[0].acquereurId).toBe(acquereur.id);
    // Aucune échéance déduite du texte : « vendredi » n'est jamais interprété.
    expect(taches[0].echeance).toBeUndefined();
    expect(taches[0].origine).toBe("manuelle");
  });

  it("seconde soumission : aucune tâche en double", async () => {
    const { acquereur, visite } = await dossier("B");

    await creerTacheProchaineEtapeAction(formData({ visiteId: visite.id })).catch(() => {});
    await creerTacheProchaineEtapeAction(formData({ visiteId: visite.id })).catch(() => {});

    expect(await getTachesPourAcquereur(acquereur.id)).toHaveLength(1);
  });

  it("aucune prochaine étape renseignée : aucune tâche créée", async () => {
    const { acquereur, visite } = await dossier("C", null);

    await creerTacheProchaineEtapeAction(formData({ visiteId: visite.id })).catch(() => {});

    expect(await getTachesPourAcquereur(acquereur.id)).toHaveLength(0);
  });

  it("le libellé vient du compte rendu persisté, jamais d'un texte posté par le client", async () => {
    const { acquereur, visite } = await dossier("D");

    await creerTacheProchaineEtapeAction(
      formData({ visiteId: visite.id, titre: "TEXTE ARBITRAIRE INJECTÉ", prochaineEtape: "AUTRE TEXTE" })
    ).catch(() => {});

    const taches = await getTachesPourAcquereur(acquereur.id);
    expect(taches).toHaveLength(1);
    expect(taches[0].titre).toBe(PROCHAINE);
    expect(taches[0].titre).not.toContain("ARBITRAIRE");
  });

  it("visite inexistante : aucune tâche, aucune erreur métier", async () => {
    const avant = await getDb().select().from(tachesTable).where(eq(tachesTable.titre, PROCHAINE));
    await creerTacheProchaineEtapeAction(
      formData({ visiteId: "00000000-0000-4000-8000-000000000000" })
    ).catch(() => {});
    const apres = await getDb().select().from(tachesTable).where(eq(tachesTable.titre, PROCHAINE));
    expect(apres).toHaveLength(avant.length);
  });
});
