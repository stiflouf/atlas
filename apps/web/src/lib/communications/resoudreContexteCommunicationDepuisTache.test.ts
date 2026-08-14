import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

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
});
