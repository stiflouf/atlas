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
const { creerTache } = await import("@/lib/tacheRepository");
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
  // evenements_metier référence prospectVendeurId/bienId en NO ACTION (append-only, ADR-032) —
  // purgé AVANT les entités source (signerMandatProspectVendeur émet mandat_signe), même patron
  // que catalogueRegles.nouveauMatch.test.ts.
  if (idsProspects.length > 0 || idsBiens.length > 0) {
    const filtre = or(inArray(evenementsMetier.prospectVendeurId, idsProspects), inArray(evenementsMetier.bienId, idsBiens));
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

  it("tâche -> prospectVendeur, origineCode retour_vendeur_apres_visite : faits de la visite la plus récente, jamais l'acquéreur comme candidat (ADR-042)", async () => {
    const prospect = await creerProspectVendeur({ nom: "[test réel] Vendeur ADR-042" });
    idsProspects.push(prospect.id);
    const resultatMandat = await signerMandatProspectVendeur(prospect.id, {
      reference: "[test réel] RESOL-RV-1",
      titre: "Bien vendeur ADR-042",
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
    const ancienneVisite = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-02-01",
      retour: "Ancienne visite",
      interet: "pas_interesse",
    });
    idsVisites.push(ancienneVisite.id);
    const visiteRecente = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-03-10",
      retour: "[MARQUEUR_INTERNE_NE_DOIT_JAMAIS_SORTIR]",
      interet: "interesse",
      prochaineEtape: "[PROCHAINE_ETAPE_INTERNE_NE_DOIT_JAMAIS_SORTIR]",
    });
    idsVisites.push(visiteRecente.id);

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
    expect(resultat.faits.dateVisite).toBeDefined();
    expect(resultat.faits.interetVisiteValeur).toBe("interesse"); // celle de la visite la PLUS RÉCENTE
    // Jamais les notes internes ni l'acquéreur dans les faits transmis.
    expect(JSON.stringify(resultat.faits)).not.toContain("MARQUEUR_INTERNE");
    expect(JSON.stringify(resultat.faits)).not.toContain("PROCHAINE_ETAPE_INTERNE");
    expect(JSON.stringify(resultat.candidats)).not.toContain(acquereur.email);
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
