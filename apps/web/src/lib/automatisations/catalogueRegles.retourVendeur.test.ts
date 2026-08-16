import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";

// Test d'intégration réel (ADR-042), même patron que catalogueRegles.nouveauMatch.test.ts /
// catalogueRegles.suiviApresVisite.test.ts. Couvre la règle unique `retour_vendeur_apres_visite` :
// résolution vendeur stricte (jamais resoudreDestinatairesDepuisBien), aucun fallback si le vendeur
// n'est pas résolvable, politique par intérêt (les 4 valeurs produisent une tâche, contrairement à
// suivi_apres_visite), garde archivage, activation figée, idempotence/concurrence, reprise ADR-038.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  prospectsVendeurs: prospectsVendeursTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  evenementsMetier,
  executionsAutomatisation,
  taches: tachesTable,
} = await import("@/db/schema");
const { creerBien, archiverBien, desarchiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur, archiverProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { emettreEvenementEtPreparerExecutions } = await import("./evenementMetierRepository");
const { traiterExecutionsEnAttente } = await import("./moteur");
const { definirActivationAutomatisation } = await import("./configurationAutomatisationRepository");
const { getExecutionAutomatisationById } = await import("./executionAutomatisationRepository");
const { trouverRegle } = await import("./catalogueRegles");
const { resoudreContexteCommunicationDepuisTache } = await import("@/lib/communications/resoudreContexteCommunicationDepuisTache");

const REGLE = "retour_vendeur_apres_visite" as const;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsProspectsCrees: string[] = [];

afterAll(async () => {
  await definirActivationAutomatisation(REGLE, false);

  // evenements_metier.compte_rendu_visite_id référence aussi comptes_rendus_visite en NO ACTION —
  // les comptes rendus créés pour idsBiensCrees doivent être inclus dans le filtre, sans quoi la
  // suppression des biens échoue (violation de clé étrangère depuis evenements_metier).
  const comptesRendusDesBiens =
    idsBiensCrees.length > 0
      ? await getDb().select({ id: comptesRendusVisiteTable.id }).from(comptesRendusVisiteTable).where(inArray(comptesRendusVisiteTable.bienId, idsBiensCrees))
      : [];
  const idsComptesRendus = comptesRendusDesBiens.map((c) => c.id);

  if (idsBiensCrees.length > 0 || idsAcquereursCrees.length > 0 || idsProspectsCrees.length > 0 || idsComptesRendus.length > 0) {
    const filtreEvt = or(
      inArray(evenementsMetier.bienId, idsBiensCrees),
      inArray(evenementsMetier.acquereurId, idsAcquereursCrees),
      inArray(evenementsMetier.prospectVendeurId, idsProspectsCrees),
      idsComptesRendus.length > 0 ? inArray(evenementsMetier.compteRenduVisiteId, idsComptesRendus) : undefined
    );
    const evts = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtreEvt);
    const idsEvts = evts.map((e) => e.id);
    if (idsEvts.length > 0) {
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvts));
      await getDb().delete(evenementsMetier).where(filtreEvt);
    }
  }
  // taches/comptes_rendus_visite/offres référencés CASCADE depuis biens/acquereurs/prospects —
  // nettoyés automatiquement.
  for (const id of idsProspectsCrees) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] RETVEND-${suffixe}`,
    titre: "Bien de test retour vendeur",
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
    nom: `[test réel] RetourVendeur ${suffixe}`,
    email: `test-réel-retour-vendeur-${suffixe}@example.com`,
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

// Vendeur ET bien créés dans le même geste (bien_id UNIQUE, ADR-027) — reproduit la relation 0..1
// réelle, jamais une hypothèse de cardinalité "exactement 1".
async function creerBienAvecVendeurDeTest(suffixe: string) {
  const bien = await creerBienDeTest(suffixe);
  const prospect = await creerProspectVendeur({
    nom: `[test réel] Vendeur ${suffixe}`,
    prenom: "Marc",
    email: `test-réel-vendeur-${suffixe}@example.com`,
  });
  idsProspectsCrees.push(prospect.id);
  await getDb().update(prospectsVendeursTable).set({ bienId: bien.id }).where(eq(prospectsVendeursTable.id, prospect.id));
  return { bien, prospect };
}

async function creerCompteRenduDeTest(
  bienId: string,
  acquereurId: string,
  interet: "interesse" | "a_reflechir" | "pas_interesse" | "inconnu"
) {
  return enregistrerCompteRenduVisite({
    bienId,
    acquereurId,
    dateVisite: "2026-08-01",
    retour: "[test réel] Retour de visite",
    interet,
  });
}

function evenementDeTest(compteRenduVisiteId: string) {
  return {
    id: "n/a",
    typeEvenement: "visite_realisee" as const,
    compteRenduVisiteId,
    survenuLe: new Date().toISOString(),
  };
}

async function tachesPourProspect(prospectVendeurId: string) {
  return getDb().select().from(tachesTable).where(eq(tachesTable.prospectVendeurId, prospectVendeurId));
}

describe("règle retour_vendeur_apres_visite — politique par intérêt (ADR-042)", () => {
  it("interesse : tâche vendeur créée, cible prospectVendeur exclusivement", async () => {
    const { bien, prospect } = await creerBienAvecVendeurDeTest("INT1");
    const acquereur = await creerAcquereurDeTest("INT1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "interesse");

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeDefined();
    expect(champs?.cible).toEqual({ type: "prospectVendeur", id: prospect.id });
    expect(champs?.titre).toBe(`Faire le retour de visite à ${prospect.prenom} ${prospect.nom} pour ${bien.reference}`);
    expect(champs?.contexte).toBe("La visite a suscité un intérêt. Faire le retour au vendeur.");
    expect(champs?.type).toBe("autre");
  });

  it("a_reflechir : tâche vendeur créée", async () => {
    const { bien, prospect } = await creerBienAvecVendeurDeTest("REFL1");
    const acquereur = await creerAcquereurDeTest("REFL1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "a_reflechir");

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeDefined();
    expect(champs?.cible).toEqual({ type: "prospectVendeur", id: prospect.id });
    expect(champs?.contexte).toBe("L'acquéreur souhaite prendre le temps de réfléchir. Faire le retour au vendeur.");
  });

  it("pas_interesse : tâche vendeur créée QUAND MÊME — différence assumée avec suivi_apres_visite (acquéreur)", async () => {
    const { bien, prospect } = await creerBienAvecVendeurDeTest("PASINT1");
    const acquereur = await creerAcquereurDeTest("PASINT1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "pas_interesse");

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeDefined();
    expect(champs?.cible).toEqual({ type: "prospectVendeur", id: prospect.id });
    expect(champs?.contexte).toBe("L'acquéreur ne souhaite pas donner suite à cette visite. Faire le retour au vendeur.");
  });

  it("inconnu : tâche vendeur créée, formulation prudente jamais affirmative", async () => {
    const { bien, prospect } = await creerBienAvecVendeurDeTest("INCONNU1");
    const acquereur = await creerAcquereurDeTest("INCONNU1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "inconnu");

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeDefined();
    expect(champs?.cible).toEqual({ type: "prospectVendeur", id: prospect.id });
    expect(champs?.contexte).toBe("La visite a eu lieu, mais le retour précis de l'acquéreur n'est pas encore établi.");
    expect(champs?.contexte).not.toMatch(/intéress|réfléch/i);
  });
});

describe("règle retour_vendeur_apres_visite — aucun fallback (ADR-042)", () => {
  it("bien sans prospect vendeur structuré : aucune tâche, undefined, jamais une erreur", async () => {
    const bien = await creerBienDeTest("SANSVENDEUR1");
    const acquereur = await creerAcquereurDeTest("SANSVENDEUR1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "interesse");

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeUndefined();
  });

  it("bien archivé au moment du traitement : aucune tâche", async () => {
    const { bien } = await creerBienAvecVendeurDeTest("ARCHBIEN1");
    const acquereur = await creerAcquereurDeTest("ARCHBIEN1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "interesse");
    await archiverBien(bien.id);

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeUndefined();
    await desarchiverBien(bien.id);
  });

  it("prospect vendeur archivé au moment du traitement : aucune tâche", async () => {
    const { bien, prospect } = await creerBienAvecVendeurDeTest("ARCHVENDEUR1");
    const acquereur = await creerAcquereurDeTest("ARCHVENDEUR1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "interesse");
    await archiverProspectVendeur(prospect.id);

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs).toBeUndefined();
  });

  it("compte rendu introuvable (identifiant valide mais inexistant) : aucune tâche, jamais d'exception", async () => {
    await expect(
      trouverRegle(REGLE)!.construireTache(evenementDeTest("00000000-0000-0000-0000-000000000000"))
    ).resolves.toBeUndefined();
  });
});

describe("règle retour_vendeur_apres_visite — jamais l'acquéreur, même en présence d'un compromis (ADR-042 §40)", () => {
  it("bien avec vendeur structuré ET acquéreur en compromis en_cours : la tâche cible exclusivement le vendeur, Préparer un email ne résout jamais l'acquéreur", async () => {
    const { bien, prospect } = await creerBienAvecVendeurDeTest("COMPROMIS1");
    const acquereur = await creerAcquereurDeTest("COMPROMIS1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "interesse");
    // Un compromis en_cours sur ce bien, avec un acquéreur distinct — exactement le scénario où
    // resoudreDestinatairesDepuisBien() résoudrait AUSSI l'acquéreur comme candidat (§3 de l'audit).
    const { enregistrerCompromis } = await import("@/lib/compromisRepository");
    const compromis = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-01" });

    const champs = await trouverRegle(REGLE)!.construireTache(evenementDeTest(cr.id));
    expect(champs?.cible).toEqual({ type: "prospectVendeur", id: prospect.id });

    // Résolution complète "Préparer un email" sur la tâche produite — jamais l'acquéreur.
    const { creerTache } = await import("@/lib/tacheRepository");
    const tache = await creerTache({
      titre: champs!.titre,
      contexte: champs!.contexte,
      type: champs!.type,
      priorite: champs!.priorite,
      origine: "automatique",
      origineCode: REGLE,
      cible: champs!.cible,
    });
    const resultat = await resoudreContexteCommunicationDepuisTache(tache);
    expect(resultat.candidats).toHaveLength(1);
    expect(resultat.candidats[0].type).toBe("prospectVendeur");
    expect(resultat.candidats.some((c) => c.type === "acquereur")).toBe(false);
    expect(JSON.stringify(resultat.candidats)).not.toContain(acquereur.email);

    await getDb().delete((await import("@/db/schema")).compromis).where(eq((await import("@/db/schema")).compromis.id, compromis.id));
    await getDb().delete(tachesTable).where(eq(tachesTable.id, tache.id));
  });
});

describe("règle retour_vendeur_apres_visite — activation figée (ADR-032)", () => {
  it("règle inactive : événement créé, 0 exécution ; activation ultérieure : ancien événement toujours 0 tâche ; nouvel événement : 1 tâche", async () => {
    await definirActivationAutomatisation(REGLE, false);
    const { bien } = await creerBienAvecVendeurDeTest("ACT1");
    const acquereur = await creerAcquereurDeTest("ACT1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "interesse");

    const { evenement, idsExecutionsATraiter } = await getDb().transaction((tx) =>
      emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr.id }, tx)
    );
    expect(idsExecutionsATraiter).toEqual([]);

    await definirActivationAutomatisation(REGLE, true);
    const executionsAncien = await getDb()
      .select()
      .from(executionsAutomatisation)
      .where(and(eq(executionsAutomatisation.regleCode, REGLE), eq(executionsAutomatisation.evenementId, evenement!.id)));
    expect(executionsAncien).toHaveLength(0); // jamais rejoué rétroactivement

    // Nouvel événement (nouvelle visite) après activation : produit bien une tâche.
    const acquereur2 = await creerAcquereurDeTest("ACT1-bis");
    const cr2 = await creerCompteRenduDeTest(bien.id, acquereur2.id, "interesse");
    const second = await getDb().transaction((tx) =>
      emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr2.id }, tx)
    );
    expect(second.idsExecutionsATraiter).toHaveLength(1);
    await traiterExecutionsEnAttente(second.idsExecutionsATraiter);
    const executionsNouveau = await getExecutionAutomatisationById(second.idsExecutionsATraiter[0]);
    expect(executionsNouveau?.tacheId).toBeDefined();

    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("règle retour_vendeur_apres_visite — idempotence et concurrence (ADR-032)", () => {
  it("double traitement de la même exécution : 1 tâche maximum", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const { bien, prospect } = await creerBienAvecVendeurDeTest("IDEMP1");
    const acquereur = await creerAcquereurDeTest("IDEMP1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "interesse");
    const { idsExecutionsATraiter } = await getDb().transaction((tx) =>
      emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr.id }, tx)
    );

    await traiterExecutionsEnAttente(idsExecutionsATraiter);
    await traiterExecutionsEnAttente(idsExecutionsATraiter); // rejeu

    expect(await tachesPourProspect(prospect.id)).toHaveLength(1);
    await definirActivationAutomatisation(REGLE, false);
  });

  it("traitement concurrent de la même exécution : 1 tâche maximum (verrou FOR UPDATE)", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const { bien, prospect } = await creerBienAvecVendeurDeTest("CONC1");
    const acquereur = await creerAcquereurDeTest("CONC1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "interesse");
    const { idsExecutionsATraiter } = await getDb().transaction((tx) =>
      emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr.id }, tx)
    );

    await Promise.all([traiterExecutionsEnAttente(idsExecutionsATraiter), traiterExecutionsEnAttente(idsExecutionsATraiter)]);

    expect(await tachesPourProspect(prospect.id)).toHaveLength(1);
    await definirActivationAutomatisation(REGLE, false);
  });

  it("reprise ADR-038 : une exécution laissée à_traiter pour cette règle est reprise sans dupliquer la tâche", async () => {
    // Scénario représentatif (ADR-042 §45) : rejoue le MÊME chemin que reprendreExecutionsBloquees()
    // (traiterExecutionsEnAttente sur une exécution encore a_traiter) sans appeler la fonction
    // globale elle-même — reprendreExecutionsBloquees() balaie TOUTES les exécutions bloquées de la
    // base partagée (jusqu'à 200), un appel non scopé ici pourrait traiter des exécutions
    // préexistantes sans rapport avec ce test. Le mécanisme générique de reprise (verrou FOR UPDATE,
    // compteur de tentatives, plafond) est déjà entièrement couvert par reprise.test.ts — non
    // spécifique à une règle, rien à re-tester ici au-delà du comportement de CETTE règle une fois
    // rejouée par ce chemin.
    await definirActivationAutomatisation(REGLE, true);
    const { bien, prospect } = await creerBienAvecVendeurDeTest("REPRISE1");
    const acquereur = await creerAcquereurDeTest("REPRISE1");
    const cr = await creerCompteRenduDeTest(bien.id, acquereur.id, "a_reflechir");
    // Événement + exécution posés (comme dans la transaction métier), jamais traité juste après —
    // exactement l'état laissé par un crash entre le COMMIT et le traitement synchrone.
    const { idsExecutionsATraiter } = await getDb().transaction((tx) =>
      emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr.id }, tx)
    );
    const [executionId] = idsExecutionsATraiter;

    const avant = await getExecutionAutomatisationById(executionId);
    expect(avant?.reussieLe).toBeUndefined();

    // Reprise (même chemin que reprendreExecutionsBloquees -> traiterExecutionsEnAttente).
    await traiterExecutionsEnAttente([executionId]);
    expect(await tachesPourProspect(prospect.id)).toHaveLength(1);

    // Un second passage sur la même exécution déjà résolue ne doit jamais dupliquer.
    await traiterExecutionsEnAttente([executionId]);
    expect(await tachesPourProspect(prospect.id)).toHaveLength(1);

    await definirActivationAutomatisation(REGLE, false);
  });
});
