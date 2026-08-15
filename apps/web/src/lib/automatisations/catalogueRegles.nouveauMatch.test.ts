import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";

// Test d'intégration réel (ADR-037) : vraie base Postgres, comme evenementMetierRepository.test.ts/
// moteur.test.ts (ADR-032). Couvre la règle unique `nouveau_match_bien_acquereur` : activation
// figée/absence de rattrapage rétroactif, cible acquéreur, revalidation complète au moment de
// l'exécution (compatibilité courante, archivage, entité absente), relation commerciale déjà
// avancée, anti-spam inter-cycle (distinct de l'idempotence ADR-032), idempotence/concurrence.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  evenementsMetier,
  executionsAutomatisation,
  taches: tachesTable,
  compatibilitesBienAcquereurEtat,
  compatibilitesARessynchroniser,
} = await import("@/db/schema");
const { creerBien, archiverBien, desarchiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { enregistrerOffre } = await import("@/lib/offreRepository");
const { enregistrerCompromis, marquerCompromisAnnule } = await import("@/lib/compromisRepository");
const { emettreEvenementEtPreparerExecutions } = await import("./evenementMetierRepository");
const { traiterExecutionsEnAttente } = await import("./moteur");
const { definirActivationAutomatisation } = await import("./configurationAutomatisationRepository");
const { trouverRegle } = await import("./catalogueRegles");
const { getTacheById } = await import("@/lib/tacheRepository");
const { resoudreContexteCommunicationDepuisTache } = await import("@/lib/communications/resoudreContexteCommunicationDepuisTache");

const REGLE = "nouveau_match_bien_acquereur" as const;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  await definirActivationAutomatisation(REGLE, false);

  if (idsBiensCrees.length > 0 || idsAcquereursCrees.length > 0) {
    const filtreEvt = or(inArray(evenementsMetier.bienId, idsBiensCrees), inArray(evenementsMetier.acquereurId, idsAcquereursCrees));
    const sousRequeteEvts = getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtreEvt);
    await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, sousRequeteEvts));
    await getDb().delete(evenementsMetier).where(filtreEvt);
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(
        or(
          inArray(compatibilitesBienAcquereurEtat.bienId, idsBiensCrees),
          inArray(compatibilitesBienAcquereurEtat.acquereurId, idsAcquereursCrees)
        )
      );
    await getDb()
      .delete(compatibilitesARessynchroniser)
      .where(
        or(
          inArray(compatibilitesARessynchroniser.bienId, idsBiensCrees),
          inArray(compatibilitesARessynchroniser.acquereurId, idsAcquereursCrees)
        )
      );
  }
  // taches/offres/compromis référencés CASCADE depuis biens/acquereurs — nettoyés automatiquement.
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string, prix = 300000) {
  const bien = await creerBien({
    reference: `[test réel] NVMATCH-${suffixe}`,
    titre: "Bien de test nouveau match",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 3,
    prix,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerAcquereurDeTest(suffixe: string, budgetMax = 400000) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] NouveauMatch ${suffixe}`,
    email: `test-réel-nouveau-match-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

async function emettreNouveauMatch(bienId: string, acquereurId: string, cycleCompatibilite: number) {
  const { evenement, idsExecutionsATraiter } = await getDb().transaction((tx) =>
    emettreEvenementEtPreparerExecutions(
      { typeEvenement: "compatibilite_bien_acquereur_devenue_compatible", bienId, acquereurId, cycleCompatibilite },
      tx
    )
  );
  return { evenement: evenement!, idsExecutionsATraiter };
}

async function tachesPourAcquereur(acquereurId: string) {
  return getDb().select().from(tachesTable).where(eq(tachesTable.acquereurId, acquereurId));
}

describe("règle nouveau_match_bien_acquereur — activation figée, jamais de rattrapage rétroactif", () => {
  it("règle inactive : événement créé, 0 exécution préparée, 0 tâche même après activation ultérieure", async () => {
    await definirActivationAutomatisation(REGLE, false);
    const acquereur = await creerAcquereurDeTest("ACT1");
    const bien = await creerBienDeTest("ACT1");

    const { idsExecutionsATraiter } = await emettreNouveauMatch(bien.id, acquereur.id, 1);
    expect(idsExecutionsATraiter).toEqual([]);

    // Activation ultérieure — ne doit jamais traiter rétroactivement l'événement déjà survenu.
    await definirActivationAutomatisation(REGLE, true);
    const evenementsPourPaire = await getDb()
      .select({ id: evenementsMetier.id })
      .from(evenementsMetier)
      .where(and(eq(evenementsMetier.bienId, bien.id), eq(evenementsMetier.acquereurId, acquereur.id)));
    const executions = await getDb()
      .select()
      .from(executionsAutomatisation)
      .where(
        and(
          eq(executionsAutomatisation.regleCode, REGLE),
          inArray(
            executionsAutomatisation.evenementId,
            evenementsPourPaire.map((e) => e.id)
          )
        )
      );
    expect(executions).toHaveLength(0); // jamais rejoué, même après activation
    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false);
  });

  it("règle active : nouvel événement produit 1 tâche, cible acquéreur, titre/provenance corrects, aucune échéance", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const acquereur = await creerAcquereurDeTest("ACT2", 400000);
    const bien = await creerBienDeTest("ACT2", 300000);

    const { idsExecutionsATraiter } = await emettreNouveauMatch(bien.id, acquereur.id, 1);
    expect(idsExecutionsATraiter).toHaveLength(1);
    await traiterExecutionsEnAttente(idsExecutionsATraiter);

    const taches = await tachesPourAcquereur(acquereur.id);
    expect(taches).toHaveLength(1);
    const tache = taches[0];
    expect(tache.bienId).toBeNull(); // pas de double cible
    expect(tache.acquereurId).toBe(acquereur.id);
    expect(tache.origine).toBe("automatique");
    expect(tache.origineCode).toBe(REGLE);
    expect(tache.echeance).toBeNull();
    expect(tache.titre).toContain(acquereur.prenom);
    expect(tache.titre).toContain(acquereur.nom);
    expect(tache.titre).toContain(bien.reference);

    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("règle nouveau_match_bien_acquereur — « Préparer un email » cible le bon acquéreur", () => {
  it("resoudreContexteCommunicationDepuisTache() résout exactement l'acquéreur du match, aucun autre candidat", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const acquereur = await creerAcquereurDeTest("EMAIL1", 400000);
    const bien = await creerBienDeTest("EMAIL1", 300000);
    const { idsExecutionsATraiter } = await emettreNouveauMatch(bien.id, acquereur.id, 1);
    await traiterExecutionsEnAttente(idsExecutionsATraiter);

    const [ligneTache] = await tachesPourAcquereur(acquereur.id);
    const tache = await getTacheById(ligneTache.id);
    expect(tache).toBeDefined();

    const contexte = await resoudreContexteCommunicationDepuisTache(tache!);
    expect(contexte.cibleType).toBe("acquereur");
    expect(contexte.candidats).toHaveLength(1);
    expect(contexte.candidats[0]).toMatchObject({ type: "acquereur", id: acquereur.id });

    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("règle nouveau_match_bien_acquereur — idempotence et concurrence", () => {
  it("double traitement de la même exécution : 1 tâche maximum", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const acquereur = await creerAcquereurDeTest("IDEMP1");
    const bien = await creerBienDeTest("IDEMP1");
    const { idsExecutionsATraiter } = await emettreNouveauMatch(bien.id, acquereur.id, 1);

    await traiterExecutionsEnAttente(idsExecutionsATraiter);
    await traiterExecutionsEnAttente(idsExecutionsATraiter); // rejeu

    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(1);
    await definirActivationAutomatisation(REGLE, false);
  });

  it("traitement concurrent de la même exécution : 1 tâche maximum (verrou FOR UPDATE)", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const acquereur = await creerAcquereurDeTest("CONC1");
    const bien = await creerBienDeTest("CONC1");
    const { idsExecutionsATraiter } = await emettreNouveauMatch(bien.id, acquereur.id, 1);

    await Promise.all([traiterExecutionsEnAttente(idsExecutionsATraiter), traiterExecutionsEnAttente(idsExecutionsATraiter)]);

    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(1);
    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("règle nouveau_match_bien_acquereur — revalidation complète avant effet", () => {
  it("paire toujours compatible au moment du traitement : 1 tâche", async () => {
    const acquereur = await creerAcquereurDeTest("REVAL1", 400000);
    const bien = await creerBienDeTest("REVAL1", 300000);
    const evenement = { id: "n/a", typeEvenement: "compatibilite_bien_acquereur_devenue_compatible" as const, bienId: bien.id, acquereurId: acquereur.id, cycleCompatibilite: 1, survenuLe: new Date().toISOString() };

    const champs = await trouverRegle(REGLE)!.construireTache(evenement);
    expect(champs).toBeDefined();
    expect(champs?.cible).toEqual({ type: "acquereur", id: acquereur.id });
  });

  it("paire redevenue incompatible avant le traitement : aucune tâche (undefined, jamais une erreur)", async () => {
    const acquereur = await creerAcquereurDeTest("REVAL2", 200000);
    const bien = await creerBienDeTest("REVAL2", 900000); // > budgetMax → incompatible
    const evenement = { id: "n/a", typeEvenement: "compatibilite_bien_acquereur_devenue_compatible" as const, bienId: bien.id, acquereurId: acquereur.id, cycleCompatibilite: 1, survenuLe: new Date().toISOString() };

    const champs = await trouverRegle(REGLE)!.construireTache(evenement);
    expect(champs).toBeUndefined();
  });

  it("paire désormais à_vérifier avant le traitement : aucune tâche", async () => {
    const acquereur = await creerAcquereurDeTest("REVAL3", 400000);
    const bienAvecParkingInconnu = await creerBienDeTest("REVAL3", 300000);
    // Force l'acquéreur à exiger un parking, information inconnue côté bien -> a_verifier.
    const { modifierAcquereur } = await import("@/lib/clientRepository");
    await modifierAcquereur(acquereur.id, {
      prenom: acquereur.prenom,
      nom: acquereur.nom,
      email: acquereur.email,
      telephone: acquereur.telephone,
      budgetMin: acquereur.budgetMin,
      budgetMax: acquereur.budgetMax,
      criteres: acquereur.criteres,
      stadeProjet: acquereur.stadeProjet,
      notes: acquereur.notes,
      datePremiereContact: acquereur.datePremiereContact,
      necessiteParking: true,
    });
    const evenement = {
      id: "n/a",
      typeEvenement: "compatibilite_bien_acquereur_devenue_compatible" as const,
      bienId: bienAvecParkingInconnu.id,
      acquereurId: acquereur.id,
      cycleCompatibilite: 1,
      survenuLe: new Date().toISOString(),
    };
    const champs = await trouverRegle(REGLE)!.construireTache(evenement);
    expect(champs).toBeUndefined();
  });

  it("bien archivé avant le traitement : aucune tâche", async () => {
    const acquereur = await creerAcquereurDeTest("ARCH1", 400000);
    const bien = await creerBienDeTest("ARCH1", 300000);
    await archiverBien(bien.id);
    const evenement = { id: "n/a", typeEvenement: "compatibilite_bien_acquereur_devenue_compatible" as const, bienId: bien.id, acquereurId: acquereur.id, cycleCompatibilite: 1, survenuLe: new Date().toISOString() };

    const champs = await trouverRegle(REGLE)!.construireTache(evenement);
    expect(champs).toBeUndefined();
    await desarchiverBien(bien.id);
  });

  it("acquéreur archivé avant le traitement : aucune tâche", async () => {
    const acquereur = await creerAcquereurDeTest("ARCH2", 400000);
    const bien = await creerBienDeTest("ARCH2", 300000);
    await archiverAcquereur(acquereur.id);
    const evenement = { id: "n/a", typeEvenement: "compatibilite_bien_acquereur_devenue_compatible" as const, bienId: bien.id, acquereurId: acquereur.id, cycleCompatibilite: 1, survenuLe: new Date().toISOString() };

    const champs = await trouverRegle(REGLE)!.construireTache(evenement);
    expect(champs).toBeUndefined();
  });

  it("bien ou acquéreur introuvable (identifiant valide mais inexistant) : aucune tâche, jamais d'exception", async () => {
    const acquereur = await creerAcquereurDeTest("ABS1", 400000);
    const evenement = {
      id: "n/a",
      typeEvenement: "compatibilite_bien_acquereur_devenue_compatible" as const,
      bienId: "00000000-0000-0000-0000-000000000000",
      acquereurId: acquereur.id,
      cycleCompatibilite: 1,
      survenuLe: new Date().toISOString(),
    };
    await expect(trouverRegle(REGLE)!.construireTache(evenement)).resolves.toBeUndefined();
  });
});

describe("règle nouveau_match_bien_acquereur — relation commerciale déjà avancée", () => {
  it("offre en_cours sur la paire : aucune tâche", async () => {
    const acquereur = await creerAcquereurDeTest("OFFRE1", 400000);
    const bien = await creerBienDeTest("OFFRE1", 300000);
    await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 290000, dateOffre: "2026-01-01" });

    const evenement = { id: "n/a", typeEvenement: "compatibilite_bien_acquereur_devenue_compatible" as const, bienId: bien.id, acquereurId: acquereur.id, cycleCompatibilite: 1, survenuLe: new Date().toISOString() };
    await expect(trouverRegle(REGLE)!.construireTache(evenement)).resolves.toBeUndefined();
  });

  it("compromis en_cours sur la paire : aucune tâche", async () => {
    const acquereur = await creerAcquereurDeTest("COMPR1", 400000);
    const bien = await creerBienDeTest("COMPR1", 300000);
    await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-01-01" });

    const evenement = { id: "n/a", typeEvenement: "compatibilite_bien_acquereur_devenue_compatible" as const, bienId: bien.id, acquereurId: acquereur.id, cycleCompatibilite: 1, survenuLe: new Date().toISOString() };
    await expect(trouverRegle(REGLE)!.construireTache(evenement)).resolves.toBeUndefined();
  });

  it("compromis annulé sur la paire : ne bloque pas indéfiniment, la tâche reste créée", async () => {
    const acquereur = await creerAcquereurDeTest("COMPR2", 400000);
    const bien = await creerBienDeTest("COMPR2", 300000);
    const compromis = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-01-01" });
    await marquerCompromisAnnule(compromis.id, "2026-01-15", "financement_refuse");

    const evenement = { id: "n/a", typeEvenement: "compatibilite_bien_acquereur_devenue_compatible" as const, bienId: bien.id, acquereurId: acquereur.id, cycleCompatibilite: 1, survenuLe: new Date().toISOString() };
    const champs = await trouverRegle(REGLE)!.construireTache(evenement);
    expect(champs).toBeDefined();
  });
});

describe("règle nouveau_match_bien_acquereur — anti-spam inter-cycle (distinct de l'idempotence ADR-032)", () => {
  it("cycle 2 alors qu'une tâche du cycle 1 est encore ouverte : aucune nouvelle tâche, T1 intacte", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const acquereur = await creerAcquereurDeTest("CYC1", 400000);
    const bien = await creerBienDeTest("CYC1", 300000);

    const premier = await emettreNouveauMatch(bien.id, acquereur.id, 1);
    await traiterExecutionsEnAttente(premier.idsExecutionsATraiter);
    const tachesApresCycle1 = await tachesPourAcquereur(acquereur.id);
    expect(tachesApresCycle1).toHaveLength(1);
    const idT1 = tachesApresCycle1[0].id;

    const second = await emettreNouveauMatch(bien.id, acquereur.id, 2);
    await traiterExecutionsEnAttente(second.idsExecutionsATraiter);

    const tachesApresCycle2 = await tachesPourAcquereur(acquereur.id);
    expect(tachesApresCycle2).toHaveLength(1); // toujours une seule
    expect(tachesApresCycle2[0].id).toBe(idT1); // T1 jamais modifiée/remplacée
    expect(tachesApresCycle2[0].termineeLe).toBeNull();

    await definirActivationAutomatisation(REGLE, false);
  });

  it("cycle 2 alors que la tâche du cycle 1 est terminée : une nouvelle tâche T2 est créée", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const acquereur = await creerAcquereurDeTest("CYC2", 400000);
    const bien = await creerBienDeTest("CYC2", 300000);

    const premier = await emettreNouveauMatch(bien.id, acquereur.id, 1);
    await traiterExecutionsEnAttente(premier.idsExecutionsATraiter);
    const [t1] = await tachesPourAcquereur(acquereur.id);
    const { terminerTache } = await import("@/lib/tacheRepository");
    await terminerTache(t1.id);

    const second = await emettreNouveauMatch(bien.id, acquereur.id, 2);
    await traiterExecutionsEnAttente(second.idsExecutionsATraiter);

    const tachesFinales = await tachesPourAcquereur(acquereur.id);
    expect(tachesFinales).toHaveLength(2);
    expect(tachesFinales.some((t) => t.id !== t1.id)).toBe(true);

    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("règle nouveau_match_bien_acquereur — non-régression", () => {
  it("aucun nouvel événement métier créé par la règle, l'événement ADR-036 reste append-only", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const acquereur = await creerAcquereurDeTest("NOREG1", 400000);
    const bien = await creerBienDeTest("NOREG1", 300000);
    const { evenement, idsExecutionsATraiter } = await emettreNouveauMatch(bien.id, acquereur.id, 1);
    await traiterExecutionsEnAttente(idsExecutionsATraiter);

    const evenementsPourPaire = await getDb()
      .select()
      .from(evenementsMetier)
      .where(and(eq(evenementsMetier.bienId, bien.id), eq(evenementsMetier.acquereurId, acquereur.id)));
    expect(evenementsPourPaire).toHaveLength(1); // toujours celui d'origine, jamais un second créé par la règle
    expect(evenementsPourPaire[0].id).toBe(evenement.id);

    await definirActivationAutomatisation(REGLE, false);
  });
});
