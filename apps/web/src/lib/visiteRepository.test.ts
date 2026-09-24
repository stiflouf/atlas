import { afterAll, describe, expect, it } from "vitest";
import { inArray, or } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// Test d'intégration réel (ADR-040, étendu par VISIT_NATIVE_LIFECYCLE_V1/ADR-063) : vraie base
// Postgres, même patron que catalogueRegles.nouveauMatch.test.ts. Couvre l'entité `visites`
// devenue workspace-safe et Calendar-optionnelle : création native (sans Calendar) ET Calendar
// (convergentes, même primitive), coexistence des deux chemins sur un même bien, gardes
// d'archivage, isolation stricte par workspace, transitions planifiee → realisee/annulee (gardées,
// jamais depuis un état terminal — matrice complète des 4 transitions interdites), report (même
// id, jamais annulée+recréée), plusieurs visites pour la même paire (autorisé), et le signal
// exploité par ADR-037 (existeVisitePlanifieePourPaire). La réalisation (planifiee → realisee)
// n'est plus posée par ce fichier — voir compteRenduVisiteRepository.test.ts pour
// `creerCompteRenduEtRealiserVisite`, seul writer désormais habilité à cette transition.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  workspaces: workspacesTable,
  visites: visitesTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  evenementsMetier,
  executionsAutomatisation,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { archiverBien } = await import("@/lib/bienRepository");
const { archiverAcquereur } = await import("@/lib/clientRepository");
const {
  creerVisite,
  materialiserVisite,
  getVisiteById,
  getVisiteParRendezVousCalendarId,
  listerVisitesPourBien,
  listerVisitesPourAcquereur,
  existeVisitePlanifieePourPaire,
  annulerVisite,
  modifierDatePrevueVisite,
} = await import("./visiteRepository");
const { creerCompteRenduEtRealiserVisite } = await import("./compteRenduVisiteRepository");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  // evenements_metier référence visites/comptes_rendus_visite en NO ACTION (append-only, ADR-032/
  // migration 0050) — doit être purgé AVANT la suppression cascade des biens, sinon la FK bloque le
  // DELETE (même patron que catalogueRegles.nouveauMatch.test.ts).
  if (idsBiensCrees.length) {
    const visites = await getDb().select({ id: visitesTable.id }).from(visitesTable).where(inArray(visitesTable.bienId, idsBiensCrees));
    const comptesRendus = await getDb()
      .select({ id: comptesRendusVisiteTable.id })
      .from(comptesRendusVisiteTable)
      .where(inArray(comptesRendusVisiteTable.bienId, idsBiensCrees));
    const idsVisites = visites.map((v) => v.id);
    const idsComptesRendus = comptesRendus.map((c) => c.id);
    if (idsVisites.length || idsComptesRendus.length) {
      const filtre = or(
        idsVisites.length ? inArray(evenementsMetier.visiteId, idsVisites) : undefined,
        idsComptesRendus.length ? inArray(evenementsMetier.compteRenduVisiteId, idsComptesRendus) : undefined
      );
      const evenements = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtre);
      const idsEvenements = evenements.map((e) => e.id);
      if (idsEvenements.length) {
        await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvenements));
        await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, idsEvenements));
      }
    }
  }
  // visites/comptes_rendus_visite référencées CASCADE depuis biens/acquereurs — nettoyées
  // automatiquement.
  if (idsBiensCrees.length) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiensCrees));
  if (idsAcquereursCrees.length) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereursCrees));
  if (idsWorkspaces.length) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

let compteur = 0;

async function creerBienDeTest(suffixe: string, workspaceId = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien({
    reference: `[test réel] VISITE-${suffixe}-${compteur}-${Date.now()}`,
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
  }, workspaceId);
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerAcquereurDeTest(suffixe: string, workspaceId = WORKSPACE_TEST) {
  compteur += 1;
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Visite ${suffixe}-${compteur}`,
    email: `test-réel-visite-${suffixe}-${compteur}-${Date.now()}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  }, workspaceId);
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-visite-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace visite" });
  idsWorkspaces.push(id);
  return id;
}

describe("creerVisite — création native, sans Calendar (VISIT_NATIVE_LIFECYCLE_V1/ADR-063)", () => {
  it("statut initial planifiee, rendezVousCalendarId undefined, realiseeLe/annuleeLe undefined", async () => {
    const bien = await creerBienDeTest("NATIF1");
    const acquereur = await creerAcquereurDeTest("NATIF1");

    const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("creee");
    if (resultat.statut !== "creee") return;
    expect(resultat.visite.statut).toBe("planifiee");
    expect(resultat.visite.rendezVousCalendarId).toBeUndefined();
    expect(resultat.visite.realiseeLe).toBeUndefined();
    expect(resultat.visite.annuleeLe).toBeUndefined();
  });

  it("aucun conflit possible entre deux visites natives successives : chacune sa propre ligne", async () => {
    const bien = await creerBienDeTest("NATIF2");
    const acquereur = await creerAcquereurDeTest("NATIF2");

    const a = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    const b = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-02" }, WORKSPACE_TEST);
    if (a.statut !== "creee" || b.statut !== "creee") throw new Error("création attendue");
    expect(a.visite.id).not.toBe(b.visite.id);
  });

  it("coexistence Calendar + natif sur le même bien×acquéreur (ADR-063 — Calendar reste facultatif, jamais nécessaire)", async () => {
    const bien = await creerBienDeTest("COEX1");
    const acquereur = await creerAcquereurDeTest("COEX1");

    const native = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    const calendar = await materialiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-05", rendezVousCalendarId: `gcal-coex-${bien.id}` },
      WORKSPACE_TEST
    );
    if (native.statut !== "creee" || calendar.statut !== "creee") throw new Error("création attendue");
    expect(native.visite.rendezVousCalendarId).toBeUndefined();
    expect(calendar.visite.rendezVousCalendarId).toBe(`gcal-coex-${bien.id}`);

    const visitesDuBien = await listerVisitesPourBien(bien.id, WORKSPACE_TEST);
    expect(visitesDuBien.map((v) => v.id).sort()).toEqual([native.visite.id, calendar.visite.id].sort());
  });

  it("bien archivé : bien_archive, aucune ligne créée", async () => {
    const bien = await creerBienDeTest("ARCHBIEN1");
    const acquereur = await creerAcquereurDeTest("ARCHBIEN1");
    await archiverBien(bien.id, WORKSPACE_TEST);

    const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("bien_archive");
    expect(await listerVisitesPourBien(bien.id, WORKSPACE_TEST)).toEqual([]);
  });

  it("acquéreur archivé : acquereur_archive, aucune ligne créée", async () => {
    const bien = await creerBienDeTest("ARCHACQ1");
    const acquereur = await creerAcquereurDeTest("ARCHACQ1");
    await archiverAcquereur(acquereur.id, WORKSPACE_TEST);

    const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("acquereur_archive");
    expect(await listerVisitesPourBien(bien.id, WORKSPACE_TEST)).toEqual([]);
  });

  it("bien inconnu : bien_introuvable ; acquéreur inconnu : acquereur_introuvable", async () => {
    const bien = await creerBienDeTest("INTROUV1");
    const acquereur = await creerAcquereurDeTest("INTROUV1");

    expect(
      (await creerVisite({ bienId: "00000000-0000-0000-0000-000000000000", acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST)).statut
    ).toBe("bien_introuvable");
    expect(
      (await creerVisite({ bienId: bien.id, acquereurId: "00000000-0000-0000-0000-000000000000", datePrevue: "2026-09-01" }, WORKSPACE_TEST)).statut
    ).toBe("acquereur_introuvable");
  });
});

describe("materialiserVisite — création et idempotence (ADR-040), convergée vers creerVisiteEnBase", () => {
  it("nouvelle visite : statut initial planifiee", async () => {
    const bien = await creerBienDeTest("CREA1");
    const acquereur = await creerAcquereurDeTest("CREA1");
    const resultat = await materialiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-test-${bien.id}` },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("creee");
    if (resultat.statut !== "creee") return;
    expect(resultat.visite.statut).toBe("planifiee");
    expect(resultat.visite.bienId).toBe(bien.id);
    expect(resultat.visite.acquereurId).toBe(acquereur.id);
  });

  it("même rendez-vous Calendar deux fois (double clic) : une seule ligne, même id", async () => {
    const bien = await creerBienDeTest("IDEMP1");
    const acquereur = await creerAcquereurDeTest("IDEMP1");
    const rendezVousCalendarId = `gcal-test-${bien.id}`;

    const premiere = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId }, WORKSPACE_TEST);
    const seconde = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId }, WORKSPACE_TEST);
    if (premiere.statut !== "creee" || seconde.statut !== "creee") throw new Error("création attendue");

    expect(seconde.visite.id).toBe(premiere.visite.id);
    const toutes = await getDb().select().from(visitesTable);
    expect(toutes.filter((v) => v.rendezVousCalendarId === rendezVousCalendarId)).toHaveLength(1);
  });

  it("deux appels réellement concurrents pour le même rendez-vous Calendar : une seule ligne (garantie DB)", async () => {
    const bien = await creerBienDeTest("CONC1");
    const acquereur = await creerAcquereurDeTest("CONC1");
    const rendezVousCalendarId = `gcal-test-${bien.id}`;

    const [a, b] = await Promise.all([
      materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId }, WORKSPACE_TEST),
      materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId }, WORKSPACE_TEST),
    ]);
    if (a.statut !== "creee" || b.statut !== "creee") throw new Error("création attendue");
    expect(a.visite.id).toBe(b.visite.id);
  });

  it("plusieurs visites pour la même paire bien×acquéreur : autorisé (pas de UNIQUE sur la paire)", async () => {
    const bien = await creerBienDeTest("PAIRE1");
    const acquereur = await creerAcquereurDeTest("PAIRE1");
    const r1 = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-1-${bien.id}` }, WORKSPACE_TEST);
    const r2 = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-10-01", rendezVousCalendarId: `gcal-2-${bien.id}` }, WORKSPACE_TEST);
    if (r1.statut !== "creee" || r2.statut !== "creee") throw new Error("création attendue");
    expect(r1.visite.id).not.toBe(r2.visite.id);

    const visitesDuBien = await listerVisitesPourBien(bien.id, WORKSPACE_TEST);
    expect(visitesDuBien.map((v) => v.id).sort()).toEqual([r1.visite.id, r2.visite.id].sort());
  });

  it("bien archivé (chemin Calendar) : bien_archive — même garde que le chemin natif (durcissement ADR-063)", async () => {
    const bien = await creerBienDeTest("ARCHBIENCAL1");
    const acquereur = await creerAcquereurDeTest("ARCHBIENCAL1");
    await archiverBien(bien.id, WORKSPACE_TEST);

    const resultat = await materialiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-arch-${bien.id}` },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("bien_archive");
  });
});

describe("transitions de statut — annulation (ADR-040, verrou central VISIT_NATIVE_LIFECYCLE_V1)", () => {
  it("planifiee → annulee : annuleeLe posé, événement visite_annulee émis (idsExecutionsATraiter typé)", async () => {
    const bien = await creerBienDeTest("ANN1");
    const acquereur = await creerAcquereurDeTest("ANN1");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");

    const resultat = await annulerVisite(cree.visite.id, WORKSPACE_TEST);
    expect(resultat.statut).toBe("annulee");
    if (resultat.statut !== "annulee") return;
    expect(resultat.visite.statut).toBe("annulee");
    expect(resultat.visite.annuleeLe).toBeDefined();
    expect(Array.isArray(resultat.idsExecutionsATraiter)).toBe(true);
    expect((await getVisiteById(cree.visite.id, WORKSPACE_TEST))?.statut).toBe("annulee");
  });

  it("id inconnu : introuvable", async () => {
    expect((await annulerVisite("00000000-0000-0000-0000-000000000000", WORKSPACE_TEST)).statut).toBe("introuvable");
  });

  it("deux annulations réellement concurrentes sur la même visite : une seule gagne, l'autre deja_finalisee", async () => {
    const bien = await creerBienDeTest("ANNCONC1");
    const acquereur = await creerAcquereurDeTest("ANNCONC1");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");

    const [a, b] = await Promise.all([
      annulerVisite(cree.visite.id, WORKSPACE_TEST),
      annulerVisite(cree.visite.id, WORKSPACE_TEST),
    ]);
    const statuts = [a.statut, b.statut].sort();
    expect(statuts).toEqual(["annulee", "deja_finalisee"]);
  });
});

describe("matrice des transitions interdites (ADR-040/063 — jamais de résurrection depuis un état terminal)", () => {
  async function visiteRealisee(suffixe: string) {
    const bien = await creerBienDeTest(suffixe);
    const acquereur = await creerAcquereurDeTest(suffixe);
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");
    const cr = await creerCompteRenduEtRealiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, visiteId: cree.visite.id, dateVisite: "2026-09-01", retour: "R.", interet: "inconnu" },
      WORKSPACE_TEST
    );
    if (cr.statut !== "cree" || !cr.visite) throw new Error("réalisation attendue");
    return cr.visite;
  }

  it("1. realisee → annulee : refusé, deja_finalisee, statut/realiseeLe inchangés", async () => {
    const visite = await visiteRealisee("INTERDIT1");
    const resultat = await annulerVisite(visite.id, WORKSPACE_TEST);
    expect(resultat.statut).toBe("deja_finalisee");
    const relue = await getVisiteById(visite.id, WORKSPACE_TEST);
    expect(relue?.statut).toBe("realisee");
    expect(relue?.realiseeLe).toBe(visite.realiseeLe);
  });

  it("2. realisee → report : refusé, deja_finalisee, datePrevue inchangée", async () => {
    const visite = await visiteRealisee("INTERDIT2");
    const resultat = await modifierDatePrevueVisite(visite.id, "2026-12-25", WORKSPACE_TEST);
    expect(resultat.statut).toBe("deja_finalisee");
    expect((await getVisiteById(visite.id, WORKSPACE_TEST))?.datePrevue).toBe(visite.datePrevue);
  });

  it("3. annulee → annulee (seconde annulation) : refusé, deja_finalisee, annuleeLe inchangé", async () => {
    const bien = await creerBienDeTest("INTERDIT3");
    const acquereur = await creerAcquereurDeTest("INTERDIT3");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");
    const premiere = await annulerVisite(cree.visite.id, WORKSPACE_TEST);
    if (premiere.statut !== "annulee") throw new Error("annulation attendue");

    const seconde = await annulerVisite(cree.visite.id, WORKSPACE_TEST);
    expect(seconde.statut).toBe("deja_finalisee");
    expect((await getVisiteById(cree.visite.id, WORKSPACE_TEST))?.annuleeLe).toBe(premiere.visite.annuleeLe);
  });

  it("4. annulee → report : refusé, deja_finalisee, datePrevue inchangée", async () => {
    const bien = await creerBienDeTest("INTERDIT4");
    const acquereur = await creerAcquereurDeTest("INTERDIT4");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");
    await annulerVisite(cree.visite.id, WORKSPACE_TEST);

    const resultat = await modifierDatePrevueVisite(cree.visite.id, "2026-12-25", WORKSPACE_TEST);
    expect(resultat.statut).toBe("deja_finalisee");
    expect((await getVisiteById(cree.visite.id, WORKSPACE_TEST))?.datePrevue).toBe("2026-09-01");
  });
});

describe("date passée sans transition explicite (ADR-040)", () => {
  it("reste planifiee : aucune inférence depuis le temps calendaire", async () => {
    const bien = await creerBienDeTest("PASSE1");
    const acquereur = await creerAcquereurDeTest("PASSE1");
    const resultat = await materialiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2020-01-01", rendezVousCalendarId: `gcal-${bien.id}` },
      WORKSPACE_TEST
    );
    if (resultat.statut !== "creee") throw new Error("création attendue");
    expect(resultat.visite.statut).toBe("planifiee");
    expect((await getVisiteById(resultat.visite.id, WORKSPACE_TEST))?.statut).toBe("planifiee");
  });
});

describe("report — même visite, même id (ADR-040, §11)", () => {
  it("modifierDatePrevueVisite change la date, jamais le statut ni l'id", async () => {
    const bien = await creerBienDeTest("REPORT1");
    const acquereur = await creerAcquereurDeTest("REPORT1");
    const cree = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-${bien.id}` }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");

    const reportee = await modifierDatePrevueVisite(cree.visite.id, "2026-09-05", WORKSPACE_TEST);
    expect(reportee.statut).toBe("reportee");
    if (reportee.statut !== "reportee") return;
    expect(reportee.visite.id).toBe(cree.visite.id);
    expect(reportee.visite.datePrevue).toBe("2026-09-05");
    expect(reportee.visite.statut).toBe("planifiee");
  });

  it("id inconnu : introuvable", async () => {
    expect((await modifierDatePrevueVisite("00000000-0000-0000-0000-000000000000", "2026-09-05", WORKSPACE_TEST)).statut).toBe("introuvable");
  });
});

describe("existeVisitePlanifieePourPaire — signal exploité par ADR-037/040", () => {
  it("vrai uniquement si une visite planifiee existe pour EXACTEMENT cette paire", async () => {
    const bien = await creerBienDeTest("PAIRE2");
    const acquereur = await creerAcquereurDeTest("PAIRE2");
    expect(await existeVisitePlanifieePourPaire(bien.id, acquereur.id, WORKSPACE_TEST)).toBe(false);

    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");
    expect(await existeVisitePlanifieePourPaire(bien.id, acquereur.id, WORKSPACE_TEST)).toBe(true);

    await creerCompteRenduEtRealiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, visiteId: cree.visite.id, dateVisite: "2026-09-01", retour: "R.", interet: "inconnu" },
      WORKSPACE_TEST
    );
    expect(await existeVisitePlanifieePourPaire(bien.id, acquereur.id, WORKSPACE_TEST)).toBe(false);
  });
});

describe("listerVisitesPourAcquereur — Fiche Acquéreur Premium", () => {
  it("retourne uniquement les visites de cet acquéreur, quel que soit le bien", async () => {
    const bienA = await creerBienDeTest("ACQ1-A");
    const bienB = await creerBienDeTest("ACQ1-B");
    const acquereur = await creerAcquereurDeTest("ACQ1");
    const autreAcquereur = await creerAcquereurDeTest("ACQ1-AUTRE");

    const r1 = await materialiserVisite({ bienId: bienA.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId: `gcal-acq1-a-${bienA.id}` }, WORKSPACE_TEST);
    const r2 = await materialiserVisite({ bienId: bienB.id, acquereurId: acquereur.id, datePrevue: "2026-09-02", rendezVousCalendarId: `gcal-acq1-b-${bienB.id}` }, WORKSPACE_TEST);
    await materialiserVisite({ bienId: bienA.id, acquereurId: autreAcquereur.id, datePrevue: "2026-09-03", rendezVousCalendarId: `gcal-acq1-autre-${bienA.id}` }, WORKSPACE_TEST);
    if (r1.statut !== "creee" || r2.statut !== "creee") throw new Error("création attendue");

    const visites = await listerVisitesPourAcquereur(acquereur.id, WORKSPACE_TEST);
    expect(visites.map((v) => v.id).sort()).toEqual([r1.visite.id, r2.visite.id].sort());
  });

  it("acquéreur sans aucune visite : tableau vide, jamais une erreur", async () => {
    const acquereur = await creerAcquereurDeTest("ACQ2-VIDE");
    expect(await listerVisitesPourAcquereur(acquereur.id, WORKSPACE_TEST)).toEqual([]);
  });

  it("id non-UUID (acquéreur mocké) : tableau vide", async () => {
    expect(await listerVisitesPourAcquereur("acquereur-mocke-001", WORKSPACE_TEST)).toEqual([]);
  });
});

describe("getVisiteParRendezVousCalendarId", () => {
  it("retrouve la visite par son identifiant Calendar d'origine", async () => {
    const bien = await creerBienDeTest("CAL1");
    const acquereur = await creerAcquereurDeTest("CAL1");
    const rendezVousCalendarId = `gcal-cal1-${bien.id}`;
    const cree = await materialiserVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01", rendezVousCalendarId }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");

    const retrouvee = await getVisiteParRendezVousCalendarId(rendezVousCalendarId, WORKSPACE_TEST);
    expect(retrouvee?.id).toBe(cree.visite.id);
  });

  it("id Calendar inconnu : undefined", async () => {
    expect(await getVisiteParRendezVousCalendarId("gcal-inexistant-xyz", WORKSPACE_TEST)).toBeUndefined();
  });
});

describe("isolation par workspace (ADR-054 — VISIT_NATIVE_LIFECYCLE_V1)", () => {
  it("lectures vides/undefined, écritures introuvable/bien_introuvable depuis un autre workspace ; aucune fuite", async () => {
    const bien = await creerBienDeTest("WS1");
    const acquereur = await creerAcquereurDeTest("WS1");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");
    const autre = await unAutreWorkspace("lecture");

    // Lectures — indistinguable d'un id inconnu depuis l'autre workspace.
    expect(await getVisiteById(cree.visite.id, autre)).toBeUndefined();
    expect(await listerVisitesPourBien(bien.id, autre)).toEqual([]);
    expect(await listerVisitesPourAcquereur(acquereur.id, autre)).toEqual([]);
    expect(await existeVisitePlanifieePourPaire(bien.id, acquereur.id, autre)).toBe(false);

    // Écritures — jamais un accès silencieux à une ligne d'un autre workspace.
    expect((await annulerVisite(cree.visite.id, autre)).statut).toBe("introuvable");
    expect((await modifierDatePrevueVisite(cree.visite.id, "2026-12-25", autre)).statut).toBe("introuvable");
    expect((await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, autre)).statut).toBe("bien_introuvable");

    // La ligne d'origine reste intacte, jamais altérée par les tentatives depuis l'autre workspace.
    const relue = await getVisiteById(cree.visite.id, WORKSPACE_TEST);
    expect(relue?.statut).toBe("planifiee");
    expect(relue?.datePrevue).toBe("2026-09-01");
  });

  it("deux workspaces, même bien/acquéreur par ailleurs identiques : chacun ne voit que ses propres visites", async () => {
    const autre = await unAutreWorkspace("paire");
    const bienA = await creerBienDeTest("WS2-A", WORKSPACE_TEST);
    const acquereurA = await creerAcquereurDeTest("WS2-A", WORKSPACE_TEST);
    const bienB = await creerBienDeTest("WS2-B", autre);
    const acquereurB = await creerAcquereurDeTest("WS2-B", autre);

    const a = await creerVisite({ bienId: bienA.id, acquereurId: acquereurA.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    const b = await creerVisite({ bienId: bienB.id, acquereurId: acquereurB.id, datePrevue: "2026-09-01" }, autre);
    if (a.statut !== "creee" || b.statut !== "creee") throw new Error("création attendue");

    expect(await listerVisitesPourBien(bienA.id, WORKSPACE_TEST)).toHaveLength(1);
    expect(await listerVisitesPourBien(bienA.id, autre)).toEqual([]);
    expect(await listerVisitesPourBien(bienB.id, autre)).toHaveLength(1);
    expect(await listerVisitesPourBien(bienB.id, WORKSPACE_TEST)).toEqual([]);
  });
});
