import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  offres: offresTable,
  remuneration: remunerationTable,
  taches: tachesTable,
  prospectsVendeurs: prospectsVendeursTable,
  evenementsMetier,
  executionsAutomatisation,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { enregistrerOffre } = await import("@/lib/offreRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { enregistrerRemuneration } = await import("@/lib/remunerationRepository");
const { creerProspectVendeur, marquerRdvEstimationRealiseProspectVendeur, signerMandatProspectVendeur } = await import(
  "@/lib/prospectVendeurRepository"
);
const { creerTache, getTacheById } = await import("@/lib/tacheRepository");
const { emettreEvenementEtPreparerExecutions } = await import("@/lib/automatisations/evenementMetierRepository");
const { traiterExecutionsEnAttente } = await import("@/lib/automatisations/moteur");
const { definirActivationAutomatisation } = await import("@/lib/automatisations/configurationAutomatisationRepository");
const { getExecutionAutomatisationById } = await import("@/lib/automatisations/executionAutomatisationRepository");
type Interet = "interesse" | "a_reflechir" | "pas_interesse" | "inconnu";
const { resoudreContexteCommunicationDepuisTache, determinerIntentionParDefaut } = await import(
  "./resoudreContexteCommunicationDepuisTache"
);

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsCompromis: string[] = [];
const idsOffres: string[] = [];
const idsVisites: string[] = [];
const idsRemunerations: string[] = [];
const idsTaches: string[] = [];
const idsProspects: string[] = [];

afterAll(async () => {
  await definirActivationAutomatisation("retour_vendeur_apres_visite", false);

  // evenements_metier référence prospectVendeurId/bienId/compteRenduVisiteId en NO ACTION
  // (append-only, ADR-032) — purgé AVANT les entités source (signerMandatProspectVendeur émet
  // mandat_signe, les tests ADR-043 émettent visite_realisee via le vrai moteur), même patron que
  // catalogueRegles.nouveauMatch.test.ts / catalogueRegles.retourVendeur.test.ts.
  if (idsProspects.length > 0 || idsBiens.length > 0 || idsVisites.length > 0) {
    const filtre = or(
      inArray(evenementsMetier.prospectVendeurId, idsProspects),
      inArray(evenementsMetier.bienId, idsBiens),
      inArray(evenementsMetier.compteRenduVisiteId, idsVisites)
    );
    const evts = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtre);
    const idsEvts = evts.map((e) => e.id);
    if (idsEvts.length > 0) {
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvts));
      await getDb().delete(evenementsMetier).where(filtre);
    }
  }
  for (const id of idsTaches) await getDb().delete(tachesTable).where(eq(tachesTable.id, id));
  for (const id of idsRemunerations) await getDb().delete(remunerationTable).where(eq(remunerationTable.id, id));
  for (const id of idsOffres) await getDb().delete(offresTable).where(eq(offresTable.id, id));
  for (const id of idsVisites) await getDb().delete(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.id, id));
  for (const id of idsCompromis) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsProspects) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerBienTest(reference: string) {
  const bien = await creerBien({
    reference,
    titre: "Bien de test résolution",
    type: "appartement",
    adresse: "1 rue Test",
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
  return bien;
}

async function creerAcquereurTest(email: string) {
  const acquereur = await creerAcquereur({
    prenom: "Jean",
    nom: "Martin",
    email,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

// Fait passer une visite par le VRAI moteur (émission de l'événement + traitement synchrone de
// l'exécution, ADR-032) — jamais un appel direct à construireTache() ni une tâche fabriquée à la
// main : les tests de provenance exacte (ADR-043) doivent exercer la chaîne réelle
// tâche -> exécution -> événement, pas la simuler.
async function creerVisiteRealiseeEtTraiter(
  bienId: string,
  acquereurId: string,
  params: { dateVisite: string; interet: Interet; retour?: string; prochaineEtape?: string }
) {
  const cr = await enregistrerCompteRenduVisite({
    bienId,
    acquereurId,
    dateVisite: params.dateVisite,
    retour: params.retour ?? "Retour de test",
    interet: params.interet,
    prochaineEtape: params.prochaineEtape,
  });
  idsVisites.push(cr.id);

  const { idsExecutionsATraiter } = await getDb().transaction((tx) =>
    emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr.id }, tx)
  );
  await traiterExecutionsEnAttente(idsExecutionsATraiter);
  const [executionId] = idsExecutionsATraiter;
  const execution = executionId ? await getExecutionAutomatisationById(executionId) : undefined;
  if (!execution?.tacheId) throw new Error("Test ADR-043 : aucune tâche vendeur produite pour cette visite.");
  const tache = await getTacheById(execution.tacheId);
  if (!tache) throw new Error("Test ADR-043 : tâche introuvable après création.");
  idsTaches.push(tache.id);
  return { cr, tache };
}

describe("resoudreContexteCommunicationDepuisTache", () => {
  it("tâche sans rattachement -> aucun candidat", async () => {
    const tache = await creerTache({ titre: "Tâche générale", type: "autre", priorite: "normale", origine: "manuelle" });
    idsTaches.push(tache.id);
    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.candidats).toEqual([]);
    expect(resultat.cibleType).toBeUndefined();
  });

  it("tâche -> prospectVendeur : résolution directe, faits incluent le rdv d'estimation réalisé", async () => {
    const prospect = await creerProspectVendeur({ nom: "Dupont" });
    idsProspects.push(prospect.id);
    await marquerRdvEstimationRealiseProspectVendeur(prospect.id, new Date("2026-03-01T10:00:00.000Z"));

    const tache = await creerTache({
      titre: "Relancer Mme Dupont",
      type: "relance",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "prospectVendeur", id: prospect.id },
    });
    idsTaches.push(tache.id);

    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.candidats).toHaveLength(1);
    expect(resultat.candidats[0]).toMatchObject({ type: "prospectVendeur", nom: "Dupont" });
    expect(resultat.faits.dateRdvEstimation).toBeDefined();
  });

  it("tâche -> acquereur : résolution directe", async () => {
    const acquereur = await creerAcquereurTest("resol1@test.local");
    const tache = await creerTache({
      titre: "Suivre Jean Martin",
      type: "appel",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "acquereur", id: acquereur.id },
    });
    idsTaches.push(tache.id);

    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.candidats).toEqual([{ type: "acquereur", id: acquereur.id, nom: "Martin", prenom: "Jean", email: "resol1@test.local" }]);
  });

  it("tâche -> visite : suit visite -> acquéreur, faits incluent date et intérêt", async () => {
    const bien = await creerBienTest("[test réel] RESOL-VISITE");
    const acquereur = await creerAcquereurTest("resol2@test.local");
    const visite = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-03-05",
      retour: "Très intéressé",
      interet: "interesse",
    });
    idsVisites.push(visite.id);

    const tache = await creerTache({
      titre: "Suivi visite",
      type: "email",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "visite", id: visite.id },
    });
    idsTaches.push(tache.id);

    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.candidats).toHaveLength(1);
    expect(resultat.candidats[0].type).toBe("acquereur");
    expect(resultat.faits.dateVisite).toBeDefined();
    expect(resultat.faits.interetVisite).toBeDefined();
  });

  it("tâche -> offre : suit offre -> acquéreur, faits incluent le montant", async () => {
    const bien = await creerBienTest("[test réel] RESOL-OFFRE");
    const acquereur = await creerAcquereurTest("resol3@test.local");
    const offre = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 280000, dateOffre: "2026-03-01" });
    idsOffres.push(offre.id);

    const tache = await creerTache({
      titre: "Suivi offre",
      type: "email",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "offre", id: offre.id },
    });
    idsTaches.push(tache.id);

    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.candidats).toHaveLength(1);
    expect(resultat.faits.montantOffre).toBe(280000);
  });

  it("tâche -> compromis : suit compromis -> acquéreur, faits incluent le prix convenu", async () => {
    const bien = await creerBienTest("[test réel] RESOL-COMPROMIS");
    const acquereur = await creerAcquereurTest("resol4@test.local");
    const compromis = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 295000, dateSignature: "2026-03-01" });
    idsCompromis.push(compromis.id);

    const tache = await creerTache({
      titre: "Suivi compromis",
      type: "email",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "compromis", id: compromis.id },
    });
    idsTaches.push(tache.id);

    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.candidats).toHaveLength(1);
    expect(resultat.faits.prixConvenuCompromis).toBe(295000);
  });

  it("tâche -> bien sans aucun rattachement -> aucun candidat", async () => {
    const bien = await creerBienTest("[test réel] RESOL-BIEN-VIDE");
    const tache = await creerTache({
      titre: "Tâche générale sur le bien",
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "bien", id: bien.id },
    });
    idsTaches.push(tache.id);

    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.candidats).toEqual([]);
  });

  it("tâche -> prospectVendeur, origineCode retour_vendeur_apres_visite : sans provenance automatisation réelle, aucun fait de visite, jamais un repli (ADR-043)", async () => {
    // Tâche "automatique" fabriquée à la main (aucune exécution réelle ne la référence) — reproduit
    // le seul cas réaliste de provenance cassée compte tenu des FK NO ACTION (un événement/CR ne
    // peut pas être supprimé tant qu'une exécution le référence encore, §29). Fail-closed attendu :
    // aucun repli vers un autre compte rendu du bien, les faits de visite restent simplement absents.
    const prospect = await creerProspectVendeur({ nom: "[test réel] Vendeur ADR-043 sans provenance" });
    idsProspects.push(prospect.id);
    const resultatMandat = await signerMandatProspectVendeur(prospect.id, {
      reference: "[test réel] RESOL-RV-SANSPROV",
      titre: "Bien vendeur ADR-043",
      type: "appartement",
      adresse: "9 rue du Vendeur",
      ville: "Testville",
      codePostal: "00000",
      surface: 40,
      pieces: 2,
      prix: 250000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    });
    const bien = resultatMandat!.bien;
    idsBiens.push(bien.id);

    const acquereur = await creerAcquereurTest("resol6@test.local");
    const visite = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-03-10",
      retour: "Visite non liée à la tâche (aucune exécution ne pointe vers elle)",
      interet: "interesse",
    });
    idsVisites.push(visite.id);

    const tache = await creerTache({
      titre: "Faire le retour de visite au vendeur",
      type: "autre",
      priorite: "normale",
      origine: "automatique",
      origineCode: "retour_vendeur_apres_visite",
      cible: { type: "prospectVendeur", id: prospect.id },
    });
    idsTaches.push(tache.id);

    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.candidats).toHaveLength(1);
    expect(resultat.candidats[0].type).toBe("prospectVendeur");
    expect(resultat.faits.bienAdresse).toBe(bien.adresse);
    // Aucune provenance automatisation réelle -> aucun fait de visite, jamais le compte rendu du
    // bien pris "au hasard"/le plus récent.
    expect(resultat.faits.dateVisite).toBeUndefined();
    expect(resultat.faits.interetVisiteValeur).toBeUndefined();
  });

  it("tâche -> prospectVendeur, origineCode retour_vendeur_apres_visite : deux visites du même bien, chaque tâche garde EXACTEMENT le compte rendu qui l'a produite (ADR-043, test de régression principal)", async () => {
    const prospect = await creerProspectVendeur({ nom: "[test réel] Vendeur ADR-043 provenance exacte" });
    idsProspects.push(prospect.id);
    const resultatMandat = await signerMandatProspectVendeur(prospect.id, {
      reference: "[test réel] RESOL-RV-PROVEXACTE",
      titre: "Bien vendeur ADR-043",
      type: "appartement",
      adresse: "11 rue du Vendeur",
      ville: "Testville",
      codePostal: "00000",
      surface: 40,
      pieces: 2,
      prix: 250000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    });
    const bien = resultatMandat!.bien;
    idsBiens.push(bien.id);
    await definirActivationAutomatisation("retour_vendeur_apres_visite", true);

    // Visite A : plus ANCIENNE, acquéreur A, pas_interesse. Marqueurs internes distincts de B pour
    // le test de confidentialité ci-dessous.
    const acquereurA = await creerAcquereurTest("resol-provA@test.local");
    const { tache: TA } = await creerVisiteRealiseeEtTraiter(bien.id, acquereurA.id, {
      dateVisite: "2026-02-01",
      interet: "pas_interesse",
      retour: "[MARQUEUR_INTERNE_A_NE_DOIT_JAMAIS_SORTIR]",
      prochaineEtape: "[ETAPE_INTERNE_A_NE_DOIT_JAMAIS_SORTIR]",
    });

    // Visite B : plus RÉCENTE, même bien, même vendeur, acquéreur DIFFÉRENT, interesse — exactement
    // le scénario où l'ancien code (listerComptesRendusPourBien(bien.id)[0]) contaminait TA.
    const acquereurB = await creerAcquereurTest("resol-provB@test.local");
    const { tache: TB } = await creerVisiteRealiseeEtTraiter(bien.id, acquereurB.id, {
      dateVisite: "2026-03-10",
      interet: "interesse",
      retour: "[MARQUEUR_INTERNE_B_NE_DOIT_JAMAIS_SORTIR]",
      prochaineEtape: "[ETAPE_INTERNE_B_NE_DOIT_JAMAIS_SORTIR]",
    });

    expect(TA.id).not.toBe(TB.id);

    // TA, résolue APRÈS que B existe : doit rester reliée à A, jamais contaminée par B.
    const resultatTA = await resoudreContexteCommunicationDepuisTache(TA);
    expect(resultatTA.candidats).toHaveLength(1);
    expect(resultatTA.candidats[0].type).toBe("prospectVendeur");
    expect(resultatTA.faits.bienAdresse).toBe(bien.adresse);
    expect(resultatTA.faits.interetVisiteValeur).toBe("pas_interesse");
    expect(resultatTA.faits.dateVisite).toMatch(/février/); // date de A, jamais celle de B (mars)
    // Confidentialité : ni les notes internes de A, ni celles de B, ni les coordonnées des deux
    // acquéreurs ne sortent jamais dans les faits/candidats transmis.
    const empreinteTA = JSON.stringify({ faits: resultatTA.faits, candidats: resultatTA.candidats });
    expect(empreinteTA).not.toContain("MARQUEUR_INTERNE_A");
    expect(empreinteTA).not.toContain("ETAPE_INTERNE_A");
    expect(empreinteTA).not.toContain("MARQUEUR_INTERNE_B");
    expect(empreinteTA).not.toContain("ETAPE_INTERNE_B");
    expect(empreinteTA).not.toContain(acquereurA.email);
    expect(empreinteTA).not.toContain(acquereurB.email);
    expect(empreinteTA).not.toContain(acquereurA.prenom);
    expect(empreinteTA).not.toContain(acquereurB.prenom);

    // TB, symétriquement : reste reliée à B, jamais contaminée par A.
    const resultatTB = await resoudreContexteCommunicationDepuisTache(TB);
    expect(resultatTB.faits.interetVisiteValeur).toBe("interesse");
    expect(resultatTB.faits.dateVisite).toMatch(/mars|2026/);
    const empreinteTB = JSON.stringify({ faits: resultatTB.faits, candidats: resultatTB.candidats });
    expect(empreinteTB).not.toContain("MARQUEUR_INTERNE_A");
    expect(empreinteTB).not.toContain("MARQUEUR_INTERNE_B");
    expect(empreinteTB).not.toContain(acquereurA.email);
    expect(empreinteTB).not.toContain(acquereurB.email);

    await definirActivationAutomatisation("retour_vendeur_apres_visite", false);
  });

  it("tâche -> prospectVendeur, origineCode retour_vendeur_apres_visite : la résolution suit l'événement, jamais l'ordre d'insertion ni la date de visite la plus tardive (ADR-043 §25)", async () => {
    const prospect = await creerProspectVendeur({ nom: "[test réel] Vendeur ADR-043 ordre inversé" });
    idsProspects.push(prospect.id);
    const resultatMandat = await signerMandatProspectVendeur(prospect.id, {
      reference: "[test réel] RESOL-RV-ORDRE",
      titre: "Bien vendeur ADR-043 ordre",
      type: "appartement",
      adresse: "13 rue du Vendeur",
      ville: "Testville",
      codePostal: "00000",
      surface: 40,
      pieces: 2,
      prix: 250000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    });
    const bien = resultatMandat!.bien;
    idsBiens.push(bien.id);
    await definirActivationAutomatisation("retour_vendeur_apres_visite", true);

    // Première visite traitée par le moteur (creeLe le plus ancien), mais avec la date de visite la
    // plus TARDIVE dans le calendrier — inverse volontairement date/ordre d'insertion pour prouver
    // que ni l'un ni l'autre ne pilote la résolution, seul l'événement exact compte.
    const acquereur1 = await creerAcquereurTest("resol-ordre1@test.local");
    const { tache: premiereTache } = await creerVisiteRealiseeEtTraiter(bien.id, acquereur1.id, {
      dateVisite: "2026-05-01", // date de visite la plus tardive
      interet: "interesse",
    });

    const acquereur2 = await creerAcquereurTest("resol-ordre2@test.local");
    const { tache: secondeTache } = await creerVisiteRealiseeEtTraiter(bien.id, acquereur2.id, {
      dateVisite: "2026-01-15", // date de visite la plus ancienne, mais insérée/traitée en second
      interet: "a_reflechir",
    });

    const resultatPremiere = await resoudreContexteCommunicationDepuisTache(premiereTache);
    expect(resultatPremiere.faits.interetVisiteValeur).toBe("interesse");
    expect(resultatPremiere.faits.dateVisite).toMatch(/mai/);

    const resultatSeconde = await resoudreContexteCommunicationDepuisTache(secondeTache);
    expect(resultatSeconde.faits.interetVisiteValeur).toBe("a_reflechir");
    expect(resultatSeconde.faits.dateVisite).toMatch(/janvier/);

    await definirActivationAutomatisation("retour_vendeur_apres_visite", false);
  });

  it("tâche -> prospectVendeur sans origineCode retour_vendeur_apres_visite : comportement générique inchangé même si des visites existent", async () => {
    const prospect = await creerProspectVendeur({ nom: "[test réel] Vendeur générique ADR-042" });
    idsProspects.push(prospect.id);
    const resultatMandat2 = await signerMandatProspectVendeur(prospect.id, {
      reference: "[test réel] RESOL-RV-2",
      titre: "Bien vendeur générique",
      type: "appartement",
      adresse: "10 rue du Vendeur",
      ville: "Testville",
      codePostal: "00000",
      surface: 40,
      pieces: 2,
      prix: 250000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    });
    const bien = resultatMandat2!.bien;
    idsBiens.push(bien.id);
    const acquereur = await creerAcquereurTest("resol7@test.local");
    const visite = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-03-10",
      retour: "Visite",
      interet: "interesse",
    });
    idsVisites.push(visite.id);

    const tache = await creerTache({
      titre: "Tâche manuelle sur le prospect vendeur",
      type: "appel",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "prospectVendeur", id: prospect.id },
    });
    idsTaches.push(tache.id);

    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.faits.interetVisiteValeur).toBeUndefined();
    expect(resultat.faits.dateVisite).toBeUndefined();
  });

  it("tâche -> remuneration : aucune relation structurée câblée, jamais une erreur", async () => {
    const bien = await creerBienTest("[test réel] RESOL-REMUN");
    const acquereur = await creerAcquereurTest("resol5@test.local");
    const compromis = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-03-01" });
    idsCompromis.push(compromis.id);
    const remuneration = await enregistrerRemuneration({ compromisId: compromis.id, montantRemunerationConseillerCentimes: 500000 });
    idsRemunerations.push(remuneration.id);

    const tache = await creerTache({
      titre: "Suivi rémunération",
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "remuneration", id: remuneration.id },
    });
    idsTaches.push(tache.id);

    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.candidats).toEqual([]);
  });

  it("tâche -> acquereur (issue de suivi_apres_visite, ADR-041) : aucun fait de visite n'est jamais lu depuis une liste de comptes rendus, donc aucun bug de « CR le plus récent » possible (ADR-043 §26)", async () => {
    // Vérification demandée par ADR-043 §10/§26 : suivi_apres_visite cible l'acquéreur (ADR-041),
    // et le cas "acquereur" du resolver ne dérive aucun fait depuis une liste de comptes rendus —
    // il retourne uniquement `base` (tacheContexte). Il n'y a donc structurellement rien à corriger
    // ici : ce test documente/prouve ce constat plutôt que de le supposer, conformément à §11
    // ("si le code démontre que c'est déjà exact, ne rien changer, documenter la vérification").
    const bien = await creerBienTest("[test réel] RESOL-SUIVI-VISITE-PROVENANCE");
    const acquereur = await creerAcquereurTest("resol-suivivisite@test.local");
    await definirActivationAutomatisation("suivi_apres_visite", true);

    // Deux visites du même acquéreur sur le même bien, avec des faits bien distincts : si le moindre
    // fait de visite fuitait via une liste "la plus récente", ce test le détecterait.
    const crAncien = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-01-05",
      retour: "Première visite",
      interet: "a_reflechir",
    });
    idsVisites.push(crAncien.id);
    const { idsExecutionsATraiter: exec1 } = await getDb().transaction((tx) =>
      emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId: crAncien.id }, tx)
    );
    await traiterExecutionsEnAttente(exec1);

    const crRecent = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-04-20",
      retour: "[MARQUEUR_SUIVI_VISITE_NE_DOIT_JAMAIS_SORTIR]",
      interet: "interesse",
    });
    idsVisites.push(crRecent.id);
    const { idsExecutionsATraiter: exec2 } = await getDb().transaction((tx) =>
      emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId: crRecent.id }, tx)
    );
    await traiterExecutionsEnAttente(exec2);

    const executionAncienne = await getExecutionAutomatisationById(exec1[0]);
    const tacheAncienne = executionAncienne?.tacheId ? await getTacheById(executionAncienne.tacheId) : undefined;
    expect(tacheAncienne).toBeDefined();
    idsTaches.push(tacheAncienne!.id);

    const resultat = await resoudreContexteCommunicationDepuisTache(tacheAncienne!);
    expect(resultat.cibleType).toBe("acquereur");
    expect(resultat.candidats).toEqual([{ type: "acquereur", id: acquereur.id, nom: acquereur.nom, prenom: acquereur.prenom, email: acquereur.email }]);
    // Aucun fait de visite n'est jamais renvoyé pour une cible acquéreur — rien à contaminer.
    expect(resultat.faits.dateVisite).toBeUndefined();
    expect(resultat.faits.interetVisite).toBeUndefined();
    expect(JSON.stringify(resultat.faits)).not.toContain("MARQUEUR_SUIVI_VISITE");

    await definirActivationAutomatisation("suivi_apres_visite", false);
  });
});

describe("determinerIntentionParDefaut", () => {
  it("visite/offre/compromis imposent leur intention quel que soit le candidat", () => {
    expect(determinerIntentionParDefaut("visite", "acquereur", {})).toBe("suivi_visite");
    expect(determinerIntentionParDefaut("offre", "acquereur", {})).toBe("suivi_acquereur");
    expect(determinerIntentionParDefaut("compromis", "acquereur", {})).toBe("message_compromis");
  });

  it("candidat acquéreur (cible bien/prospectVendeur/acquereur) -> suivi_acquereur", () => {
    expect(determinerIntentionParDefaut("bien", "acquereur", {})).toBe("suivi_acquereur");
    expect(determinerIntentionParDefaut("acquereur", "acquereur", {})).toBe("suivi_acquereur");
  });

  it("candidat prospectVendeur sans rdv réalisé -> relance_prospect_vendeur ; avec rdv -> suivi_rdv_estimation", () => {
    expect(determinerIntentionParDefaut("prospectVendeur", "prospectVendeur", {})).toBe("relance_prospect_vendeur");
    expect(determinerIntentionParDefaut("bien", "prospectVendeur", { dateRdvEstimation: "3 mars 2026" })).toBe(
      "suivi_rdv_estimation"
    );
  });

  it("origineCode retour_vendeur_apres_visite (ADR-042) l'emporte sur tout le reste", () => {
    expect(determinerIntentionParDefaut("prospectVendeur", "prospectVendeur", {}, "retour_vendeur_apres_visite")).toBe(
      "retour_vendeur_apres_visite"
    );
    // Même avec un rdv d'estimation présent dans les faits, ou un autre cibleType : l'origineCode
    // reste prioritaire, jamais "toute tâche prospectVendeur" (ADR-042, §25).
    expect(
      determinerIntentionParDefaut("prospectVendeur", "prospectVendeur", { dateRdvEstimation: "3 mars 2026" }, "retour_vendeur_apres_visite")
    ).toBe("retour_vendeur_apres_visite");
  });

  it("un autre origineCode (ex. mandat_signe, inactivite_prospect_vendeur) ne déclenche jamais retour_vendeur_apres_visite", () => {
    expect(determinerIntentionParDefaut("prospectVendeur", "prospectVendeur", {}, "preparation_apres_mandat")).toBe(
      "relance_prospect_vendeur"
    );
    expect(determinerIntentionParDefaut("prospectVendeur", "prospectVendeur", {}, undefined)).toBe("relance_prospect_vendeur");
  });
});
