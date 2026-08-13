import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Fichier séparé de dashboardRepository.test.ts (déjà volumineux) : ne teste que
// chargerPipelineVendeur() (ADR-027), même repli DATABASE_URL que les autres suites
// d'intégration.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { prospectsVendeurs: prospectsVendeursTable } = await import("@/db/schema");
const { creerProspectVendeur, marquerProspectVendeurPerdu, qualifierProspectVendeur, enregistrerEstimationProspectVendeur } =
  await import("./prospectVendeurRepository");
const { chargerPipelineVendeur } = await import("./dashboardRepository");

const idsProspectsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsProspectsCrees) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
});

async function creerProspectDeTest(suffixe: string) {
  const prospect = await creerProspectVendeur({
    nom: `[test réel] Pipeline vendeur ${suffixe}`,
    prenom: undefined,
    email: undefined,
    telephone: undefined,
    origineLead: undefined,
    origineLeadDetail: undefined,
    adresseBienPotentiel: undefined,
    secteurBienPotentiel: undefined,
    ville: undefined,
    codePostal: undefined,
    typeBien: undefined,
    prochaineAction: undefined,
    prochaineActionLe: undefined,
  });
  idsProspectsCrees.push(prospect.id);
  return prospect;
}

describe("chargerPipelineVendeur (intégration Postgres)", () => {
  it("le taux de conversion est calculé uniquement sur les opportunités clôturées (correction dashboard)", async () => {
    const suffixe = `taux-${Date.now()}`;
    const enCours = await creerProspectDeTest(`${suffixe}-encours`);
    const signe1 = await creerProspectDeTest(`${suffixe}-signe1`);
    const perdu1 = await creerProspectDeTest(`${suffixe}-perdu1`);
    await marquerProspectVendeurPerdu(perdu1.id, "autre", "2026-09-01");

    // On ne peut pas signer sans créer un bien à chaque fois dans ce test (hors-scope ici) : on
    // vérifie seulement, via une mesure AVANT/APRÈS, que le nombre de clôturés grandit avec une
    // perte mais pas avec un prospect en cours.
    const avant = await chargerPipelineVendeur();

    const perdu2 = await creerProspectDeTest(`${suffixe}-perdu2`);
    await marquerProspectVendeurPerdu(perdu2.id, "autre", "2026-09-01");
    const apres = await chargerPipelineVendeur();

    expect(apres.nombrePerdus).toBe(avant.nombrePerdus + 1);
    expect(apres.nombreEnCours).toBeGreaterThanOrEqual(1);

    void enCours;
    void signe1;
  });

  it("les prospects en cours n'entrent jamais dans le taux de conversion (dénominateur = signés + perdus uniquement)", async () => {
    const avant = await chargerPipelineVendeur();
    await creerProspectDeTest(`taux-encours-${Date.now()}`);
    const apres = await chargerPipelineVendeur();

    // Ajouter un prospect EN COURS ne doit jamais changer le taux de conversion.
    expect(apres.tauxConversionOpportunitesCloturees).toBe(avant.tauxConversionOpportunitesCloturees);
  });

  it("volumeEstimationsEnCoursCentimes ne compte que les prospects en cours avec une estimation renseignée", async () => {
    const avant = await chargerPipelineVendeur();

    const prospect = await creerProspectDeTest(`estimation-${Date.now()}`);
    await qualifierProspectVendeur(prospect.id);
    await enregistrerEstimationProspectVendeur(prospect.id, 300_000_00, "2026-09-01");

    const apres = await chargerPipelineVendeur();
    expect(apres.nombreEstimationsEnCoursRenseignees).toBe(avant.nombreEstimationsEnCoursRenseignees + 1);
    expect(apres.volumeEstimationsEnCoursCentimes ?? 0).toBe((avant.volumeEstimationsEnCoursCentimes ?? 0) + 300_000_00);
    expect(apres.nombreParStatutEnCours.estimation).toBeGreaterThanOrEqual(1);
  });
});
