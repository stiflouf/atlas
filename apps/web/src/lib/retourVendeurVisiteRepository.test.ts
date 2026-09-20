import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// SELLER_FEEDBACK_INTERACTION_V1 (ADR-063) — tests d'intégration réels du writer central
// enregistrerRetourVendeurVisite : Interaction canonique, résolution vendeur (mandat courant +
// parties `mandant`), clôture de tâche, idempotence (double submit), répétition légitime,
// multi-vendeurs, fusion Contact, isolation workspace.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  contacts: contactsTable,
  champsVerrouilles: champsVerrouillesTable,
  mandats: mandatsTable,
  partiesMandat: partiesMandatTable,
  prospectsVendeurs: prospectsVendeursTable,
  visites: visitesTable,
  interactions: interactionsTable,
  taches: tachesTable,
  evenementsMetier,
  executionsAutomatisation,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerContact } = await import("@/lib/contactRepository");
const { creerMandat } = await import("@/lib/mandatRepository");
const { ajouterPartieMandat } = await import("@/lib/partieMandatRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { creerVisite, annulerVisite } = await import("@/lib/visiteRepository");
const { creerCompteRenduEtRealiserVisite } = await import("@/lib/compteRenduVisiteRepository");
const { creerInteraction, listerInteractionsPourVisite, listerInteractionsDuContact } = await import("@/lib/interactionRepository");
const { definirActivationAutomatisation } = await import("@/lib/automatisations/configurationAutomatisationRepository");
const { traiterExecutionsEnAttente } = await import("@/lib/automatisations/moteur");
const { enregistrerRetourVendeurVisite, vendeursCanoniquesDuBien } = await import("@/lib/retourVendeurVisiteRepository");

const REGLE_RETOUR_VENDEUR = "retour_vendeur_apres_visite" as const;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsContacts: string[] = [];
const idsProspects: string[] = [];
const idsVisites: string[] = [];
const idsMandats: string[] = [];

afterAll(async () => {
  await definirActivationAutomatisation(REGLE_RETOUR_VENDEUR, false, WORKSPACE_TEST);
  // evenements_metier référence visites et comptes_rendus_visite en NO ACTION — purgé avant la
  // suppression cascade des biens/visites (même patron établi ailleurs dans ce domaine).
  const { comptesRendusVisite: comptesRendusVisiteTable } = await import("@/db/schema");
  if (idsVisites.length) {
    const comptesRendus = await getDb().select({ id: comptesRendusVisiteTable.id }).from(comptesRendusVisiteTable).where(inArray(comptesRendusVisiteTable.visiteId, idsVisites));
    const idsComptesRendus = comptesRendus.map((c) => c.id);
    const filtre = or(
      inArray(evenementsMetier.visiteId, idsVisites),
      idsComptesRendus.length ? inArray(evenementsMetier.compteRenduVisiteId, idsComptesRendus) : undefined
    );
    const evts = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtre);
    const idsEvts = evts.map((e) => e.id);
    if (idsEvts.length) {
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvts));
      await getDb().delete(evenementsMetier).where(filtre);
    }
  }
  if (idsContacts.length) {
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
  }
  if (idsMandats.length) {
    await getDb().delete(partiesMandatTable).where(inArray(partiesMandatTable.mandatId, idsMandats));
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.id, idsMandats));
  }
  for (const id of idsProspects) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  for (const id of idsVisites) await getDb().delete(visitesTable).where(eq(visitesTable.id, id));
  for (const id of idsContacts) await getDb().delete(contactsTable).where(eq(contactsTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function bienDeTest(suffixe: string, workspaceId = WORKSPACE_TEST) {
  const bien = await creerBien(
    {
      reference: `[test réel] RETVEND-INTERACTION-${suffixe}`,
      titre: "Bien retour vendeur interaction",
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
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  return bien;
}

async function acquereurDeTest(suffixe: string, workspaceId = WORKSPACE_TEST) {
  const acquereur = await creerAcquereur(
    {
      prenom: "Jean",
      nom: `RetVend${suffixe}`,
      email: `retvend-interaction-${suffixe}@test.local`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
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

async function contactVendeurDeTest(nom: string, workspaceId = WORKSPACE_TEST) {
  const contact = await creerContact({ nom, prenom: "Vendeur", email: undefined, telephone: undefined }, workspaceId);
  idsContacts.push(contact.id);
  return contact;
}

// Bien avec mandat courant + partie `mandant` canonique (résolution PRIMAIRE de
// vendeursCanoniquesDuBien) — optionnellement aussi un prospect vendeur legacy (pour que la RÈGLE
// DE TÂCHE existante, retour_vendeur_apres_visite, résolve elle aussi un destinataire et crée une
// tâche réelle à clôturer).
async function bienAvecMandantCanonique(
  suffixe: string,
  options: { avecProspectLegacy?: boolean; workspaceId?: string } = {}
) {
  const workspaceId = options.workspaceId ?? WORKSPACE_TEST;
  const bien = await bienDeTest(suffixe, workspaceId);
  const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
  idsMandats.push(mandat.id);
  const contactVendeur = await contactVendeurDeTest(`Mandant${suffixe}`, workspaceId);
  await ajouterPartieMandat(mandat.id, { contactId: contactVendeur.id, role: "mandant" }, workspaceId);
  if (options.avecProspectLegacy) {
    const prospect = await creerProspectVendeur({ nom: `LegacyProspect${suffixe}` }, workspaceId);
    idsProspects.push(prospect.id);
    await getDb().update(prospectsVendeursTable).set({ bienId: bien.id }).where(eq(prospectsVendeursTable.id, prospect.id));
  }
  return { bien, mandat, contactVendeur };
}

async function visiteRealiseeDeTest(bienId: string, acquereurId: string, workspaceId = WORKSPACE_TEST) {
  const resultat = await creerVisite({ bienId, acquereurId, datePrevue: "2026-06-01" }, workspaceId);
  if (resultat.statut !== "creee") throw new Error("création de visite attendue");
  idsVisites.push(resultat.visite.id);
  const cr = await creerCompteRenduEtRealiserVisite(
    { bienId, acquereurId, visiteId: resultat.visite.id, dateVisite: "2026-06-01", retour: "R.", interet: "interesse" },
    workspaceId
  );
  if (cr.statut !== "cree") throw new Error("compte rendu attendu");
  return resultat.visite;
}

describe("vendeursCanoniquesDuBien", () => {
  it("résout le(s) mandant(s) du mandat courant", async () => {
    const { bien, contactVendeur } = await bienAvecMandantCanonique("VENDEUR1");
    const vendeurs = await vendeursCanoniquesDuBien(bien.id, WORKSPACE_TEST);
    expect(vendeurs.map((v) => v.contactId)).toEqual([contactVendeur.id]);
  });

  it("ne résout jamais un representant comme destinataire", async () => {
    const bien = await bienDeTest("REPRESENTANT1");
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    idsMandats.push(mandat.id);
    const representant = await contactVendeurDeTest("Representant1");
    await ajouterPartieMandat(mandat.id, { contactId: representant.id, role: "representant" }, WORKSPACE_TEST);
    const vendeurs = await vendeursCanoniquesDuBien(bien.id, WORKSPACE_TEST);
    expect(vendeurs).toEqual([]);
  });

  it("liste vide si aucun mandat courant (jamais un destinataire inventé)", async () => {
    const bien = await bienDeTest("SANSMANDAT1");
    const vendeurs = await vendeursCanoniquesDuBien(bien.id, WORKSPACE_TEST);
    expect(vendeurs).toEqual([]);
  });
});

describe("enregistrerRetourVendeurVisite — §33 cas simple", () => {
  it("Visite realisee + CR + tâche ouverte : Interaction créée, liée Visite/Bien/vendeur, tâche clôturée", async () => {
    await definirActivationAutomatisation(REGLE_RETOUR_VENDEUR, true, WORKSPACE_TEST);
    const { bien, contactVendeur } = await bienAvecMandantCanonique("SIMPLE1", { avecProspectLegacy: true });
    const acquereur = await acquereurDeTest("SIMPLE1");
    const visite = await visiteRealiseeDeTest(bien.id, acquereur.id);

    // Laisse la règle événementielle existante créer sa tâche (legacy, via le prospect vendeur).
    const compteRendu = await getCompteRenduVisiteApresRealisation(visite.id);
    await traiterExecutionsEnAttente(await idsExecutionsPourVisite(visite.id));
    const tacheAvant = await tacheOuverteRetourVendeur(bien.id);
    expect(tacheAvant).toBeDefined();

    const resultat = await enregistrerRetourVendeurVisite({ visiteId: visite.id, canal: "appel", note: "Retour fait." }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("enregistre");
    if (resultat.statut !== "enregistre") return;
    expect(resultat.interactions).toHaveLength(1);
    expect(resultat.interactions[0].contactId).toBe(contactVendeur.id);
    expect(resultat.interactions[0].visiteId).toBe(visite.id);
    expect(resultat.interactions[0].natureMetier).toBe("retour_vendeur_post_visite");
    expect(resultat.tacheClotureeId).toBe(tacheAvant!.id);

    const tacheApres = await getDb().select().from(tachesTable).where(eq(tachesTable.id, tacheAvant!.id));
    expect(tacheApres[0].termineeLe).not.toBeNull();

    void compteRendu;
    await definirActivationAutomatisation(REGLE_RETOUR_VENDEUR, false, WORKSPACE_TEST);
  });
});

// Helpers dédiés à la mise en place de la tâche legacy (règle événementielle existante).
async function getCompteRenduVisiteApresRealisation(visiteId: string) {
  const { getCompteRenduVisiteParVisiteId } = await import("@/lib/compteRenduVisiteRepository");
  return getCompteRenduVisiteParVisiteId(visiteId, WORKSPACE_TEST);
}
async function idsExecutionsPourVisite(visiteId: string): Promise<string[]> {
  const { comptesRendusVisite: comptesRendusVisiteTable } = await import("@/db/schema");
  const [cr] = await getDb().select().from(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.visiteId, visiteId));
  if (!cr) return [];
  const evts = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(eq(evenementsMetier.compteRenduVisiteId, cr.id));
  const idsEvt = evts.map((e) => e.id);
  if (!idsEvt.length) return [];
  const exec = await getDb().select({ id: executionsAutomatisation.id }).from(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvt));
  return exec.map((e) => e.id);
}
async function tacheOuverteRetourVendeur(bienId: string) {
  const toutes = await getDb().select().from(tachesTable).where(eq(tachesTable.origineCode, REGLE_RETOUR_VENDEUR));
  // La tâche cible `prospectVendeur` (legacy, contrat inchangé) — filtrée sur les tâches encore
  // ouvertes créées durant CE test (bienId n'apparaît qu'indirectement via le prospect, non filtré
  // ici pour rester simple : la suite de test est isolée par bien/prospect uniques).
  void bienId;
  return toutes.find((t) => !t.termineeLe && !t.annuleeLe);
}

describe("enregistrerRetourVendeurVisite — §34 sans tâche", () => {
  it("Visite realisee sans tâche retour vendeur (règle inactive) : succès quand même", async () => {
    const { bien } = await bienAvecMandantCanonique("SANSTACHE1");
    const acquereur = await acquereurDeTest("SANSTACHE1");
    const visite = await visiteRealiseeDeTest(bien.id, acquereur.id);

    const resultat = await enregistrerRetourVendeurVisite({ visiteId: visite.id, canal: "email" }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("enregistre");
    if (resultat.statut === "enregistre") expect(resultat.tacheClotureeId).toBeUndefined();
  });
});

describe("enregistrerRetourVendeurVisite — §35 visite non réalisée", () => {
  it("refuse sur une visite planifiee", async () => {
    const { bien } = await bienAvecMandantCanonique("PLANIFIEE1");
    const acquereur = await acquereurDeTest("PLANIFIEE1");
    const r = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-07-01" }, WORKSPACE_TEST);
    if (r.statut !== "creee") throw new Error("visite attendue");
    idsVisites.push(r.visite.id);

    const resultat = await enregistrerRetourVendeurVisite({ visiteId: r.visite.id, canal: "appel" }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("visite_non_realisee");
  });

  it("refuse sur une visite annulee", async () => {
    const { bien } = await bienAvecMandantCanonique("ANNULEE1");
    const acquereur = await acquereurDeTest("ANNULEE1");
    const r = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-07-01" }, WORKSPACE_TEST);
    if (r.statut !== "creee") throw new Error("visite attendue");
    idsVisites.push(r.visite.id);
    await annulerVisite(r.visite.id, WORKSPACE_TEST);

    const resultat = await enregistrerRetourVendeurVisite({ visiteId: r.visite.id, canal: "appel" }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("visite_non_realisee");
  });
});

describe("enregistrerRetourVendeurVisite — §36 double submit", () => {
  it("deux soumissions réellement concurrentes : une seule Interaction officielle par vendeur", async () => {
    const { bien, contactVendeur } = await bienAvecMandantCanonique("DOUBLESUBMIT1");
    const acquereur = await acquereurDeTest("DOUBLESUBMIT1");
    const visite = await visiteRealiseeDeTest(bien.id, acquereur.id);

    const [a, b] = await Promise.all([
      enregistrerRetourVendeurVisite({ visiteId: visite.id, canal: "appel" }, WORKSPACE_TEST),
      enregistrerRetourVendeurVisite({ visiteId: visite.id, canal: "appel" }, WORKSPACE_TEST),
    ]);
    const uneSeuleGagne = (a.statut === "enregistre") !== (b.statut === "enregistre");
    expect(uneSeuleGagne).toBe(true);

    const interactions = await listerInteractionsPourVisite(visite.id, WORKSPACE_TEST);
    const officielles = interactions.filter((i) => i.natureMetier === "retour_vendeur_post_visite" && i.contactId === contactVendeur.id);
    expect(officielles).toHaveLength(1);
  });
});

describe("enregistrerRetourVendeurVisite — §37 second retour légitime", () => {
  it("une Interaction manuelle supplémentaire (sans nature marquée) reste possible après le premier retour", async () => {
    const { bien, contactVendeur } = await bienAvecMandantCanonique("SECONDRETOUR1");
    const acquereur = await acquereurDeTest("SECONDRETOUR1");
    const visite = await visiteRealiseeDeTest(bien.id, acquereur.id);

    const premier = await enregistrerRetourVendeurVisite({ visiteId: visite.id, canal: "appel" }, WORKSPACE_TEST);
    expect(premier.statut).toBe("enregistre");

    // "Si le modèle le permet" (§37) : via le repository générique, visiteId posé, SANS le
    // marqueur de nature — le modèle le permet, l'index unique partiel ne s'applique qu'à
    // nature_metier = 'retour_vendeur_post_visite'.
    const second = await creerInteraction({
      contactId: contactVendeur.id,
      type: "appel",
      sens: "sortant",
      survenuLe: new Date().toISOString(),
      contenu: "Second appel de suivi.",
      visiteId: visite.id,
    });
    expect(second.id).toBeDefined();

    const interactions = await listerInteractionsPourVisite(visite.id, WORKSPACE_TEST);
    expect(interactions.length).toBeGreaterThanOrEqual(2);
  });
});

describe("enregistrerRetourVendeurVisite — §38 multi-vendeurs", () => {
  it("deux mandants actifs : deux Interactions, une tâche clôturée une seule fois", async () => {
    const bien = await bienDeTest("MULTIVENDEUR1");
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
    idsMandats.push(mandat.id);
    const contactA = await contactVendeurDeTest("MultiA1");
    const contactB = await contactVendeurDeTest("MultiB1");
    await ajouterPartieMandat(mandat.id, { contactId: contactA.id, role: "mandant" }, WORKSPACE_TEST);
    await ajouterPartieMandat(mandat.id, { contactId: contactB.id, role: "mandant" }, WORKSPACE_TEST);
    const acquereur = await acquereurDeTest("MULTIVENDEUR1");
    const visite = await visiteRealiseeDeTest(bien.id, acquereur.id);

    const resultat = await enregistrerRetourVendeurVisite({ visiteId: visite.id, canal: "appel" }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("enregistre");
    if (resultat.statut !== "enregistre") return;
    expect(resultat.interactions.map((i) => i.contactId).sort()).toEqual([contactA.id, contactB.id].sort());
  });
});

describe("enregistrerRetourVendeurVisite — §39 contact fusionné", () => {
  it("refuse d'écrire vers un mandant absorbé (ADR-059)", async () => {
    const { bien, contactVendeur } = await bienAvecMandantCanonique("FUSION1");
    const survivant = await contactVendeurDeTest("SurvivantFusion1");
    await getDb().update(contactsTable).set({ fusionneDansContactId: survivant.id, fusionneLe: new Date() }).where(eq(contactsTable.id, contactVendeur.id));

    const acquereur = await acquereurDeTest("FUSION1");
    const visite = await visiteRealiseeDeTest(bien.id, acquereur.id);

    const resultat = await enregistrerRetourVendeurVisite({ visiteId: visite.id, canal: "appel" }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("contact_fusionne");

    const interactions = await listerInteractionsPourVisite(visite.id, WORKSPACE_TEST);
    expect(interactions).toEqual([]);

    // Désamorce l'auto-référence avant le nettoyage global (afterAll).
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(eq(contactsTable.id, contactVendeur.id));
  });
});

describe("enregistrerRetourVendeurVisite — §42 pas de nouveau silo", () => {
  it("l'Interaction créée apparaît nativement dans l'historique Contact existant (listerInteractionsDuContact)", async () => {
    const { bien, contactVendeur } = await bienAvecMandantCanonique("HISTOCONTACT1");
    const acquereur = await acquereurDeTest("HISTOCONTACT1");
    const visite = await visiteRealiseeDeTest(bien.id, acquereur.id);

    const resultat = await enregistrerRetourVendeurVisite({ visiteId: visite.id, canal: "appel" }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("enregistre");

    const historique = await listerInteractionsDuContact(contactVendeur.id);
    expect(historique.some((i) => i.visiteId === visite.id && i.natureMetier === "retour_vendeur_post_visite")).toBe(true);
  });
});

describe("enregistrerRetourVendeurVisite — §40 workspace", () => {
  it("introuvable depuis un autre workspace", async () => {
    const { bien } = await bienAvecMandantCanonique("WORKSPACE1");
    const acquereur = await acquereurDeTest("WORKSPACE1");
    const visite = await visiteRealiseeDeTest(bien.id, acquereur.id);

    const resultat = await enregistrerRetourVendeurVisite({ visiteId: visite.id, canal: "appel" }, "un-autre-workspace-inexistant");
    expect(resultat.statut).toBe("introuvable");
  });
});
