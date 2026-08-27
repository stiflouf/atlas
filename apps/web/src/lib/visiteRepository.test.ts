import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration réel (ADR-040) : vraie base Postgres, même patron que
// catalogueRegles.nouveauMatch.test.ts. Couvre l'entité minimale `visites` : matérialisation
// idempotente (garantie DB, pas seulement find-before-insert), statut initial, transitions
// planifiee → realisee/annulee (gardées, jamais depuis un état terminal), report (même id, jamais
// annulée+recréée), plusieurs visites pour la même paire (autorisé), et le signal exploité par
// ADR-037 (existeVisitePlanifieePourPaire).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const {
  materialiserVisite,
  getVisiteById,
  getVisiteParRendezVousCalendarId,
  listerVisitesPourBien,
  listerVisitesPourAcquereur,
  existeVisitePlanifieePourPaire,
  marquerVisiteRealisee,
  annulerVisite,
  modifierDatePrevueVisite,
} = await import("./visiteRepository");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  // visites référencées CASCADE depuis biens/acquereurs — nettoyées automatiquement.
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] VISITE-${suffixe}`,
    titre: "Bien de test visite",
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
    nom: `[test réel] Visite ${suffixe}`,
    email: `test-réel-visite-${suffixe}@example.com`,
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

describe("materialiserVisite — création et idempotence (ADR-040)", () => {
  it("nouvelle visite : statut initial planifiee", async () => {
    const bien = await creerBienDeTest("CREA1");
    const acquereur = await creerAcquereurDeTest("CREA1");
    const visite = await materialiserVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      datePrevue: "2026-09-01",
      rendezVousCalendarId: `gcal-test-${bien.id}`,
    });
    expect(visite.statut).toBe("planifiee");
    expect(visite.bienId).toBe(bien.id);
    expect(visite.acquereurId).toBe(acquereur.id);
  });

  it("même rendez-vous Calendar deux fois (double clic) : une seule ligne, même id", async () => {
    const bien = await creerBienDeTest("IDEMP1");
    const acquereur = await creerAcquereurDeTest("IDEMP1");
    const rendezVousCalendarId = `gcal-test-${bien.id}`;

    const premiere = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId });
    const seconde = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId });

    expect(seconde.id).toBe(premiere.id);
    const toutes = await getDb().select().from((await import("@/db/schema")).visites);
    expect(toutes.filter((v) => v.rendezVousCalendarId === rendezVousCalendarId)).toHaveLength(1);
  });

  it("deux appels réellement concurrents pour le même rendez-vous Calendar : une seule ligne (garantie DB)", async () => {
    const bien = await creerBienDeTest("CONC1");
    const acquereur = await creerAcquereurDeTest("CONC1");
    const rendezVousCalendarId = `gcal-test-${bien.id}`;

    const [a, b] = await Promise.all([
      materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId }),
      materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId }),
    ]);
    expect(a.id).toBe(b.id);
  });

  it("plusieurs visites pour la même paire bien×acquéreur : autorisé (pas de UNIQUE sur la paire)", async () => {
    const bien = await creerBienDeTest("PAIRE1");
    const acquereur = await creerAcquereurDeTest("PAIRE1");
    const v1 = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-1-${bien.id}` });
    const v2 = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-10-01", rendezVousCalendarId: `gcal-2-${bien.id}` });
    expect(v1.id).not.toBe(v2.id);

    const visitesDuBien = await listerVisitesPourBien(bien.id);
    expect(visitesDuBien.map((v) => v.id).sort()).toEqual([v1.id, v2.id].sort());
  });
});

describe("transitions de statut (ADR-040)", () => {
  it("planifiee → realisee", async () => {
    const bien = await creerBienDeTest("REAL1");
    const acquereur = await creerAcquereurDeTest("REAL1");
    const visite = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-${bien.id}` });

    const realisee = await marquerVisiteRealisee(visite.id);
    expect(realisee?.statut).toBe("realisee");
    expect((await getVisiteById(visite.id))?.statut).toBe("realisee");
  });

  it("seconde tentative de réalisation sur une visite déjà realisee : aucun effet, undefined", async () => {
    const bien = await creerBienDeTest("REAL2");
    const acquereur = await creerAcquereurDeTest("REAL2");
    const visite = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-${bien.id}` });
    await marquerVisiteRealisee(visite.id);

    const secondeTentative = await marquerVisiteRealisee(visite.id);
    expect(secondeTentative).toBeUndefined();
  });

  it("planifiee → annulee", async () => {
    const bien = await creerBienDeTest("ANN1");
    const acquereur = await creerAcquereurDeTest("ANN1");
    const visite = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-${bien.id}` });

    const annulee = await annulerVisite(visite.id);
    expect(annulee?.statut).toBe("annulee");
  });

  it("annulation d'une visite déjà realisee : aucun effet, undefined (jamais realisee → annulee)", async () => {
    const bien = await creerBienDeTest("ANN2");
    const acquereur = await creerAcquereurDeTest("ANN2");
    const visite = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-${bien.id}` });
    await marquerVisiteRealisee(visite.id);

    const tentativeAnnulation = await annulerVisite(visite.id);
    expect(tentativeAnnulation).toBeUndefined();
    expect((await getVisiteById(visite.id))?.statut).toBe("realisee");
  });

  it("date passée sans transition explicite : reste planifiee (aucune inférence depuis le temps calendaire)", async () => {
    const bien = await creerBienDeTest("PASSE1");
    const acquereur = await creerAcquereurDeTest("PASSE1");
    const visite = await materialiserVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      datePrevue: "2020-01-01", // très largement passée
      rendezVousCalendarId: `gcal-${bien.id}`,
    });
    expect(visite.statut).toBe("planifiee");
    expect((await getVisiteById(visite.id))?.statut).toBe("planifiee");
  });
});

describe("report — même visite, même id (ADR-040, §11)", () => {
  it("modifierDatePrevueVisite change la date, jamais le statut ni l'id", async () => {
    const bien = await creerBienDeTest("REPORT1");
    const acquereur = await creerAcquereurDeTest("REPORT1");
    const visite = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-${bien.id}` });

    const reportee = await modifierDatePrevueVisite(visite.id, "2026-09-05");
    expect(reportee?.id).toBe(visite.id);
    expect(reportee?.datePrevue).toBe("2026-09-05");
    expect(reportee?.statut).toBe("planifiee");
  });

  it("report impossible sur une visite déjà annulee : aucun effet", async () => {
    const bien = await creerBienDeTest("REPORT2");
    const acquereur = await creerAcquereurDeTest("REPORT2");
    const visite = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-${bien.id}` });
    await annulerVisite(visite.id);

    const tentative = await modifierDatePrevueVisite(visite.id, "2026-09-05");
    expect(tentative).toBeUndefined();
    expect((await getVisiteById(visite.id))?.datePrevue).toBe("2026-09-01");
  });
});

describe("existeVisitePlanifieePourPaire — signal exploité par ADR-037/040", () => {
  it("vrai uniquement si une visite planifiee existe pour EXACTEMENT cette paire", async () => {
    const bien = await creerBienDeTest("PAIRE2");
    const acquereur = await creerAcquereurDeTest("PAIRE2");
    expect(await existeVisitePlanifieePourPaire(bien.id, acquereur.id)).toBe(false);

    const visite = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-${bien.id}` });
    expect(await existeVisitePlanifieePourPaire(bien.id, acquereur.id)).toBe(true);

    await marquerVisiteRealisee(visite.id);
    expect(await existeVisitePlanifieePourPaire(bien.id, acquereur.id)).toBe(false);
  });
});

describe("listerVisitesPourAcquereur — Fiche Acquéreur Premium", () => {
  it("retourne uniquement les visites de cet acquéreur, quel que soit le bien", async () => {
    const bienA = await creerBienDeTest("ACQ1-A");
    const bienB = await creerBienDeTest("ACQ1-B");
    const acquereur = await creerAcquereurDeTest("ACQ1");
    const autreAcquereur = await creerAcquereurDeTest("ACQ1-AUTRE");

    const v1 = await materialiserVisite({ bienId: bienA.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-acq1-a-${bienA.id}` });
    const v2 = await materialiserVisite({ bienId: bienB.id, acquereurId: acquereur.id, datePrevue: "2026-09-02", rendezVousCalendarId: `gcal-acq1-b-${bienB.id}` });
    await materialiserVisite({ bienId: bienA.id, acquereurId: autreAcquereur.id, datePrevue: "2026-09-03", rendezVousCalendarId: `gcal-acq1-autre-${bienA.id}` });

    const visites = await listerVisitesPourAcquereur(acquereur.id);
    expect(visites.map((v) => v.id).sort()).toEqual([v1.id, v2.id].sort());
  });

  it("acquéreur sans aucune visite : tableau vide, jamais une erreur", async () => {
    const acquereur = await creerAcquereurDeTest("ACQ2-VIDE");
    expect(await listerVisitesPourAcquereur(acquereur.id)).toEqual([]);
  });

  it("id non-UUID (acquéreur mocké) : tableau vide", async () => {
    expect(await listerVisitesPourAcquereur("acquereur-mocke-001")).toEqual([]);
  });
});

describe("getVisiteParRendezVousCalendarId", () => {
  it("retrouve la visite par son identifiant Calendar d'origine", async () => {
    const bien = await creerBienDeTest("CAL1");
    const acquereur = await creerAcquereurDeTest("CAL1");
    const rendezVousCalendarId = `gcal-cal1-${bien.id}`;
    const visite = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId });

    const retrouvee = await getVisiteParRendezVousCalendarId(rendezVousCalendarId);
    expect(retrouvee?.id).toBe(visite.id);
  });

  it("id Calendar inconnu : undefined", async () => {
    expect(await getVisiteParRendezVousCalendarId("gcal-inexistant-xyz")).toBeUndefined();
  });
});
