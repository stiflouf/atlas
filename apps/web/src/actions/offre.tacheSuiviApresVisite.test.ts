import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";

// Test d'intégration réel (ADR-044 §25/§39/§44) : la création d'une Offre depuis le parcours
// contextuel Visite ne doit JAMAIS terminer automatiquement la tâche `suivi_apres_visite` déjà
// ouverte pour cette visite — aucun couplage automatique entre les deux gestes, cohérent avec le
// reste du produit (aucune tâche n'est jamais terminée par un autre geste dans tout le code
// actuel). Traverse le vrai moteur ADR-032 (émission + traitement) pour produire une tâche réelle,
// puis appelle la vraie Server Action ajouterOffreAction, exactement le parcours réel.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  offres: offresTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  evenementsMetier,
  executionsAutomatisation,
  taches: tachesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { emettreEvenementEtPreparerExecutions } = await import("@/lib/automatisations/evenementMetierRepository");
const { traiterExecutionsEnAttente } = await import("@/lib/automatisations/moteur");
const { definirActivationAutomatisation } = await import("@/lib/automatisations/configurationAutomatisationRepository");
const { ajouterOffreAction } = await import("./offre");
const { listerOffresPourBien } = await import("@/lib/offreRepository");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsComptesRendusCrees: string[] = [];
const idsOffresCrees: string[] = [];

afterAll(async () => {
  await definirActivationAutomatisation("suivi_apres_visite", false);

  if (idsComptesRendusCrees.length > 0) {
    const filtre = or(
      inArray(evenementsMetier.compteRenduVisiteId, idsComptesRendusCrees),
      inArray(evenementsMetier.bienId, idsBiensCrees),
      inArray(evenementsMetier.acquereurId, idsAcquereursCrees)
    );
    const evts = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtre);
    const idsEvts = evts.map((e) => e.id);
    if (idsEvts.length > 0) {
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvts));
      await getDb().delete(evenementsMetier).where(filtre);
    }
  }
  for (const id of idsOffresCrees) await getDb().delete(offresTable).where(eq(offresTable.id, id));
  for (const id of idsComptesRendusCrees) await getDb().delete(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("ajouterOffreAction — non-régression tâche suivi_apres_visite (ADR-044 §25/§44)", () => {
  it("la tâche suivi_apres_visite reste ouverte après création d'une offre depuis le contexte de la visite qui l'a produite", async () => {
    await definirActivationAutomatisation("suivi_apres_visite", true);

    const bien = await creerBien({
      reference: "[test réel] OFFRE-SUIVI-TACHE-1",
      titre: "Bien de test",
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
    idsBiensCrees.push(bien.id);
    const acquereur = await creerAcquereur({
      prenom: "Test",
      nom: "[test réel] Offre Suivi Tache",
      email: "test-réel-offre-suivi-tache@example.com",
      telephone: "0600000000",
      budgetMin: 200000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "offre",
      notes: "",
      datePremiereContact: "2026-01-01",
    });
    idsAcquereursCrees.push(acquereur.id);

    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "[test réel] Très intéressé.",
      interet: "interesse",
    });
    idsComptesRendusCrees.push(cr.id);

    const { idsExecutionsATraiter } = await getDb().transaction((tx) =>
      emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId: cr.id }, tx)
    );
    await traiterExecutionsEnAttente(idsExecutionsATraiter);

    const tachesAvant = await getDb().select().from(tachesTable).where(eq(tachesTable.acquereurId, acquereur.id));
    expect(tachesAvant).toHaveLength(1);
    expect(tachesAvant[0].origineCode).toBe("suivi_apres_visite");
    expect(tachesAvant[0].termineeLe).toBeNull();
    expect(tachesAvant[0].annuleeLe).toBeNull();

    const fd = formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "320000", dateOffre: "2026-08-10" });
    fd.append("compteRenduVisiteIds", cr.id);
    await ajouterOffreAction(fd).catch(() => {});

    const offres = await listerOffresPourBien(bien.id);
    idsOffresCrees.push(...offres.map((o) => o.id));
    expect(offres).toHaveLength(1);

    const tachesApres = await getDb().select().from(tachesTable).where(eq(tachesTable.acquereurId, acquereur.id));
    expect(tachesApres).toHaveLength(1);
    expect(tachesApres[0].id).toBe(tachesAvant[0].id);
    // Ni terminée ni annulée automatiquement — aucun couplage.
    expect(tachesApres[0].termineeLe).toBeNull();
    expect(tachesApres[0].annuleeLe).toBeNull();
  });
});
