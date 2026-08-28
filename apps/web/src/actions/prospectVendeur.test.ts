import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
import { eq, inArray } from "drizzle-orm";

// Garde-fous des Server Actions (ADR-027) : aucune séquence stricte entre jalons, mais perte et
// signature restent terminales — même style que actions/compromis.test.ts (seul le chemin de
// rejet est testable directement, redirect() lève NEXT_REDIRECT sur le chemin de succès).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  prospectsVendeurs: prospectsVendeursTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
} = await import("@/db/schema");
const {
  creerProspectVendeur,
  getProspectVendeurById,
  marquerProspectVendeurPerdu,
  planifierRdvEstimationProspectVendeur,
  signerMandatProspectVendeur,
} = await import("@/lib/prospectVendeurRepository");
const {
  qualifierProspectVendeurAction,
  enregistrerEstimationProspectVendeurAction,
  marquerRdvEstimationRealiseProspectVendeurAction,
  marquerProspectVendeurPerduAction,
  signerMandatProspectVendeurAction,
  ajouterNoteProspectVendeurAction,
} = await import("./prospectVendeur");
const { deriverStatutProspectVendeur } = await import("@/types/prospectVendeur");

const idsProspectsCrees: string[] = [];
const idsBiensCrees: string[] = [];

afterAll(async () => {
  // signerMandatProspectVendeur émet un événement mandat_signe (ADR-032) — evenements_metier ne
  // cascade jamais depuis sa source (correction n°5, append-only) : à purger avant le prospect
  // lui-même, sinon la suppression échoue (violation de clé étrangère).
  if (idsProspectsCrees.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetierTable.id })
      .from(evenementsMetierTable)
      .where(inArray(evenementsMetierTable.prospectVendeurId, idsProspectsCrees));
    const idsEvenements = evenements.map((e) => e.id);
    if (idsEvenements.length > 0) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvenements));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvenements));
    }
  }
  for (const id of idsProspectsCrees) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerProspectDeTest(suffixe: string) {
  const prospect = await creerProspectVendeur({
    nom: `[test réel] Action prospect ${suffixe}`,
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
  });
  idsProspectsCrees.push(prospect.id);
  return prospect;
}

async function creerProspectSigneDeTest(suffixe: string) {
  const prospect = await creerProspectDeTest(suffixe);
  const resultat = await signerMandatProspectVendeur(prospect.id, {
    reference: `[test réel] ACTION-SIGNATURE-${suffixe}`,
    titre: "Bien signé de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-09-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(resultat!.bien.id);
  return prospect;
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

// Régression smoke (28/08/2026) : un rendez-vous prévu le lendemain a été marqué réalisé le jour
// même. Le formulaire proposait la date PRÉVUE en valeur par défaut et aucune garde ne bornait le
// futur : la base a persisté un rendez-vous « tenu » daté du lendemain, le statut est passé à
// `rendez_vous`, et dernier_contact_le a été posé à l'instant serveur — deux dates contradictoires
// pour un même fait. ADR-027 : « un rendez-vous planifié dans le futur n'est jamais un jalon
// commercial franchi ».
describe("marquerRdvEstimationRealiseProspectVendeurAction — aucun jalon franchi dans le futur", () => {
  it("refuse de marquer réalisé un rendez-vous encore à venir, et ne persiste rien", async () => {
    const prospect = await creerProspectDeTest("R01");
    const demain = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await planifierRdvEstimationProspectVendeur(prospect.id, demain);

    await expect(
      marquerRdvEstimationRealiseProspectVendeurAction(
        formData({ id: prospect.id, rdvEstimationRealiseLe: demain.toISOString() })
      )
    ).rejects.toThrow(/date future/);

    // La donnée reste intacte : ni jalon franchi, ni dernier contact avancé par une action refusée.
    const apres = await getProspectVendeurById(prospect.id);
    expect(apres?.rdvEstimationRealiseLe).toBeUndefined();
    expect(apres?.dernierContactLe).toBeUndefined();
    expect(deriverStatutProspectVendeur(apres!)).toBe("prospect");
  });

  it("refuse aussi une date future sans rendez-vous préalablement planifié", async () => {
    const prospect = await creerProspectDeTest("R02");
    const dansUneHeure = new Date(Date.now() + 60 * 60 * 1000);

    await expect(
      marquerRdvEstimationRealiseProspectVendeurAction(
        formData({ id: prospect.id, rdvEstimationRealiseLe: dansUneHeure.toISOString() })
      )
    ).rejects.toThrow(/date future/);
  });

  it("accepte un rendez-vous réellement tenu, même enregistré longtemps après", async () => {
    const prospect = await creerProspectDeTest("R03");
    const ilYaDeuxMois = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    // redirect() lève NEXT_REDIRECT sur le chemin de succès (même style que les autres actions).
    await expect(
      marquerRdvEstimationRealiseProspectVendeurAction(
        formData({ id: prospect.id, rdvEstimationRealiseLe: ilYaDeuxMois.toISOString() })
      )
    ).rejects.toThrow(/NEXT_REDIRECT/);

    const apres = await getProspectVendeurById(prospect.id);
    // La date persistée est exactement celle saisie, jamais l'instant serveur.
    expect(apres?.rdvEstimationRealiseLe).toBe(ilYaDeuxMois.toISOString());
    expect(deriverStatutProspectVendeur(apres!)).toBe("rendez_vous");
    // dernier_contact_le reste l'horodatage serveur de l'interaction (ADR-027), distinct de la
    // date déclarée du rendez-vous : il ne prend jamais la date saisie.
    expect(apres?.dernierContactLe).toBeDefined();
    expect(apres?.dernierContactLe).not.toBe(ilYaDeuxMois.toISOString());
  });

  it("tolère une dérive d'horloge cliente de quelques minutes", async () => {
    const prospect = await creerProspectDeTest("R04");
    const dansDeuxMinutes = new Date(Date.now() + 2 * 60 * 1000);

    await expect(
      marquerRdvEstimationRealiseProspectVendeurAction(
        formData({ id: prospect.id, rdvEstimationRealiseLe: dansDeuxMinutes.toISOString() })
      )
    ).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

describe("prospectVendeur Server Actions — gardes de transition", () => {
  it("qualifierProspectVendeurAction rejette un prospect déjà perdu", async () => {
    const prospect = await creerProspectDeTest("001");
    await marquerProspectVendeurPerdu(prospect.id, "autre", "2026-09-01");

    await expect(qualifierProspectVendeurAction(formData({ id: prospect.id }))).rejects.toThrow(/perdu/);
  });

  it("qualifierProspectVendeurAction rejette un prospect dont le mandat est déjà signé", async () => {
    const prospect = await creerProspectSigneDeTest("002");

    await expect(qualifierProspectVendeurAction(formData({ id: prospect.id }))).rejects.toThrow(/déjà signé/);
  });

  it("enregistrerEstimationProspectVendeurAction rejette un montant invalide", async () => {
    const prospect = await creerProspectDeTest("003");

    await expect(
      enregistrerEstimationProspectVendeurAction(
        formData({ id: prospect.id, estimationProposeeCentimes: "pas-un-nombre", estimationProposeeLe: "2026-09-01" })
      )
    ).rejects.toThrow(/montant/);
  });

  it("marquerProspectVendeurPerduAction rejette un mandat déjà signé", async () => {
    const prospect = await creerProspectSigneDeTest("004");

    await expect(
      marquerProspectVendeurPerduAction(formData({ id: prospect.id, motifPerte: "autre", datePerte: "2026-09-01" }))
    ).rejects.toThrow(/déjà signé/);
  });

  it("marquerProspectVendeurPerduAction rejette un motif manquant", async () => {
    const prospect = await creerProspectDeTest("005");

    await expect(marquerProspectVendeurPerduAction(formData({ id: prospect.id, datePerte: "2026-09-01" }))).rejects.toThrow(
      /motif/
    );
  });

  it("signerMandatProspectVendeurAction rejette un prospect déjà perdu", async () => {
    const prospect = await creerProspectDeTest("006");
    await marquerProspectVendeurPerdu(prospect.id, "autre", "2026-09-01");

    await expect(
      signerMandatProspectVendeurAction(
        formData({
          id: prospect.id,
          reference: "REF",
          titre: "Titre",
          type: "appartement",
          adresse: "1 rue",
          ville: "Ville",
          codePostal: "00000",
          surface: "50",
          pieces: "2",
          prix: "100000",
          statutMandat: "actif",
          dateMandat: "2026-09-01",
        })
      )
    ).rejects.toThrow(/perdu/);
  });

  it("ajouterNoteProspectVendeurAction rejette un type de note invalide", async () => {
    const prospect = await creerProspectDeTest("007");

    await expect(
      ajouterNoteProspectVendeurAction(formData({ id: prospect.id, type: "sms-groupe", contenu: "Contenu valide" }))
    ).rejects.toThrow(/[Tt]ype de note/);
  });

  it("ajouterNoteProspectVendeurAction rejette un contenu vide", async () => {
    const prospect = await creerProspectDeTest("008");

    await expect(
      ajouterNoteProspectVendeurAction(formData({ id: prospect.id, type: "note_interne", contenu: "   " }))
    ).rejects.toThrow(/vide/);
  });
});
