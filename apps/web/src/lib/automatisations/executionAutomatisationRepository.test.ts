import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Tests d'intégration réels (ADR-043) — couvre getExecutionAutomatisationParTacheId() : lecture
// fail-closed de la provenance d'une tâche automatique (tache.id -> execution exacte). 0 ligne,
// exactement 1 ligne, plus d'1 ligne (incohérence construite artificiellement, puisqu'aucun
// UNIQUE(tache_id) n'existe en base — décision explicite ADR-043).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  prospectsVendeurs: prospectsVendeursTable,
  evenementsMetier,
  executionsAutomatisation,
  taches: tachesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { creerTache } = await import("@/lib/tacheRepository");
const { emettreEvenementEtPreparerExecutions } = await import("./evenementMetierRepository");
const { traiterExecutionsEnAttente } = await import("./moteur");
const { definirActivationAutomatisation } = await import("./configurationAutomatisationRepository");
const { getExecutionAutomatisationParTacheId, getExecutionAutomatisationById } = await import(
  "./executionAutomatisationRepository"
);

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsVisites: string[] = [];
const idsTaches: string[] = [];
const idsEvenements: string[] = [];
const idsExecutions: string[] = [];

afterAll(async () => {
  await definirActivationAutomatisation("retour_vendeur_apres_visite", false);

  if (idsExecutions.length > 0) await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.id, idsExecutions));
  if (idsEvenements.length > 0) {
    // Peut déjà avoir été purgé ci-dessus par id direct, mais toute exécution restante créée par le
    // moteur réel (test "exactement 1 ligne") référence aussi ces événements — purge par
    // evenementId en complément, avant les CR (NO ACTION).
    await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvenements));
    await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, idsEvenements));
  }
  for (const id of idsTaches) await getDb().delete(tachesTable).where(eq(tachesTable.id, id));
  for (const id of idsVisites) await getDb().delete(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] EXECPROV-${suffixe}`,
    titre: "Bien de test provenance exécution",
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
  idsBiens.push(bien.id);
  return bien;
}

async function creerAcquereurDeTest(suffixe: string) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] ExecProv ${suffixe}`,
    email: `test-réel-exec-prov-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

describe("getExecutionAutomatisationParTacheId (ADR-043)", () => {
  it("0 ligne : aucune exécution ne référence cette tâche -> undefined, jamais une erreur", async () => {
    const tache = await creerTache({ titre: "Tâche manuelle sans provenance", type: "autre", priorite: "normale", origine: "manuelle" });
    idsTaches.push(tache.id);

    const resultat = await getExecutionAutomatisationParTacheId(tache.id);
    expect(resultat).toBeUndefined();
  });

  it("exactement 1 ligne : retourne l'exécution exacte produite par le vrai moteur", async () => {
    await definirActivationAutomatisation("retour_vendeur_apres_visite", true);
    const bien = await creerBienDeTest("UNIQUE1");
    const acquereur = await creerAcquereurDeTest("UNIQUE1");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-03-01",
      retour: "Visite de test",
      interet: "interesse",
    });
    idsVisites.push(cr.id);

    // Vendeur structuré requis pour que retour_vendeur_apres_visite produise réellement une tâche
    // (sans vendeur, construireTache() renvoie undefined — aucune exécution "réussie avec tâche").
    const prospect = await creerProspectVendeur({ nom: "[test réel] Vendeur ExecProv" });
    await getDb().update(prospectsVendeursTable).set({ bienId: bien.id }).where(eq(prospectsVendeursTable.id, prospect.id));

    const { idsExecutionsATraiter } = await getDb().transaction((tx) =>
      emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr.id }, tx)
    );
    idsEvenements.push(
      ...(await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(eq(evenementsMetier.compteRenduVisiteId, cr.id))).map(
        (e) => e.id
      )
    );
    await traiterExecutionsEnAttente(idsExecutionsATraiter);

    const executionAttendue = await getExecutionAutomatisationById(idsExecutionsATraiter[0]);
    expect(executionAttendue?.tacheId).toBeDefined();
    idsTaches.push(executionAttendue!.tacheId!);

    const resultat = await getExecutionAutomatisationParTacheId(executionAttendue!.tacheId!);
    expect(resultat?.id).toBe(executionAttendue!.id);
    expect(resultat?.evenementId).toBe(executionAttendue!.evenementId);
    expect(resultat?.regleCode).toBe("retour_vendeur_apres_visite");

    await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, prospect.id));
    await definirActivationAutomatisation("retour_vendeur_apres_visite", false);
  });

  // ADR-047 : UNIQUE(tache_id) a été ajoutée en défense en profondeur avant exposition Internet — le
  // scénario "plus d'1 ligne" que ce test vérifiait auparavant côté lecture (rejeté explicitement par
  // getExecutionAutomatisationParTacheId) est désormais rejeté plus tôt encore, dès l'écriture, par la
  // contrainte elle-même. Le test est réécrit pour vérifier cette garantie plus forte plutôt que
  // supprimé : la lecture fail-closed (getExecutionAutomatisationParTacheId) reste un filet légitime
  // pour toute donnée antérieure à cette migration, mais ne peut plus être déclenchée par une nouvelle
  // écriture normale.
  it("UNIQUE(tache_id) empêche désormais qu'une deuxième exécution cible la même tâche (ADR-047)", async () => {
    const bien = await creerBienDeTest("MULTI1");
    const acquereur = await creerAcquereurDeTest("MULTI1");
    const cr1 = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-03-01",
      retour: "Visite 1",
      interet: "interesse",
    });
    idsVisites.push(cr1.id);
    const cr2 = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-03-15",
      retour: "Visite 2",
      interet: "a_reflechir",
    });
    idsVisites.push(cr2.id);

    const [evt1] = await getDb()
      .insert(evenementsMetier)
      .values({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr1.id })
      .returning();
    const [evt2] = await getDb()
      .insert(evenementsMetier)
      .values({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr2.id })
      .returning();
    idsEvenements.push(evt1.id, evt2.id);

    const tache = await creerTache({ titre: "Tâche ciblée par deux exécutions (test d'incohérence)", type: "autre", priorite: "normale", origine: "manuelle" });
    idsTaches.push(tache.id);

    const [exec1] = await getDb()
      .insert(executionsAutomatisation)
      .values({ regleCode: "retour_vendeur_apres_visite", evenementId: evt1.id, tacheId: tache.id, reussieLe: new Date() })
      .returning();
    idsExecutions.push(exec1.id);

    // drizzle-orm/postgres-js enveloppe l'erreur Postgres d'origine dans `cause` — le message de
    // haut niveau ne contient jamais le nom de la contrainte (même observation que
    // secteurRecherche.ts, ADR-028).
    let erreurCapturee: unknown;
    try {
      await getDb()
        .insert(executionsAutomatisation)
        .values({ regleCode: "retour_vendeur_apres_visite", evenementId: evt2.id, tacheId: tache.id, reussieLe: new Date() });
    } catch (erreur) {
      erreurCapturee = erreur;
    }
    expect(erreurCapturee).toBeInstanceOf(Error);
    const cause = (erreurCapturee as Error).cause as { constraint_name?: string } | undefined;
    expect(cause?.constraint_name).toBe("executions_automatisation_tache_id_unique");

    // La première exécution reste lisible normalement — la contrainte a bloqué la seconde écriture,
    // jamais corrompu la première.
    const resultat = await getExecutionAutomatisationParTacheId(tache.id);
    expect(resultat?.id).toBe(exec1.id);
  });

  it("plusieurs exécutions avec tache_id NULL coexistent sans violation (ADR-047)", async () => {
    const bien = await creerBienDeTest("NULLTACHE");
    const acquereur = await creerAcquereurDeTest("NULLTACHE");
    const cr1 = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-03-01",
      retour: "Visite 1",
      interet: "interesse",
    });
    idsVisites.push(cr1.id);
    const cr2 = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-03-15",
      retour: "Visite 2",
      interet: "a_reflechir",
    });
    idsVisites.push(cr2.id);

    const [evt1] = await getDb()
      .insert(evenementsMetier)
      .values({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr1.id })
      .returning();
    const [evt2] = await getDb()
      .insert(evenementsMetier)
      .values({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr2.id })
      .returning();
    idsEvenements.push(evt1.id, evt2.id);

    // Deux exécutions distinctes (evenementId différent), toutes deux sans tache_id — la contrainte
    // UNIQUE(tache_id) ajoutée par ADR-047 ne doit jamais empêcher plusieurs NULL de coexister
    // (comportement standard PostgreSQL, vérifié explicitement ici plutôt que seulement supposé).
    const [exec1] = await getDb()
      .insert(executionsAutomatisation)
      .values({ regleCode: "retour_vendeur_apres_visite", evenementId: evt1.id, reussieLe: new Date() })
      .returning();
    const [exec2] = await getDb()
      .insert(executionsAutomatisation)
      .values({ regleCode: "retour_vendeur_apres_visite", evenementId: evt2.id, reussieLe: new Date() })
      .returning();
    idsExecutions.push(exec1.id, exec2.id);

    expect(exec1.tacheId).toBeNull();
    expect(exec2.tacheId).toBeNull();
  });
});
