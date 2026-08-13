import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, prospectsVendeurs: prospectsVendeursTable } = await import("@/db/schema");
const {
  creerProspectVendeur,
  getProspectVendeurById,
  qualifierProspectVendeur,
  enregistrerEstimationProspectVendeur,
  planifierRdvEstimationProspectVendeur,
  marquerRdvEstimationRealiseProspectVendeur,
  proposerMandatProspectVendeur,
  signerMandatProspectVendeur,
  marquerProspectVendeurPerdu,
  archiverProspectVendeur,
  desarchiverProspectVendeur,
  listerProspectsVendeurs,
  listerProspectsVendeursPerdus,
  listerProspectsVendeursConvertis,
  listerProspectsVendeursArchives,
} = await import("./prospectVendeurRepository");
const { deriverStatutProspectVendeur } = await import("@/types/prospectVendeur");

const idsProspectsCrees: string[] = [];
const idsBiensCrees: string[] = [];

afterAll(async () => {
  for (const id of idsProspectsCrees) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerProspectDeTest(suffixe: string) {
  const prospect = await creerProspectVendeur({
    nom: `[test réel] Prospect ${suffixe}`,
    prenom: "Jean",
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

describe("prospectVendeurRepository (intégration Postgres)", () => {
  it("creerProspectVendeur() accepte l'absence totale d'email et de téléphone (correction n° 4)", async () => {
    const prospect = await creerProspectDeTest("001");
    expect(prospect.email).toBeUndefined();
    expect(prospect.telephone).toBeUndefined();
    expect(deriverStatutProspectVendeur(prospect)).toBe("prospect");
  });

  it("qualifierProspectVendeur() pose qualifieLe, jamais dernierContactLe (bookkeeping interne)", async () => {
    const prospect = await creerProspectDeTest("002");
    const qualifie = await qualifierProspectVendeur(prospect.id);
    expect(qualifie?.qualifieLe).toBeDefined();
    expect(qualifie?.dernierContactLe).toBeUndefined();
  });

  it("planifierRdvEstimationProspectVendeur() ne fait jamais avancer le statut, marquerRdvEstimationRealise() si", async () => {
    const prospect = await creerProspectDeTest("003");
    const planifie = await planifierRdvEstimationProspectVendeur(prospect.id, new Date("2026-09-10T14:30:00Z"));
    expect(deriverStatutProspectVendeur(planifie!)).toBe("prospect");
    expect(planifie?.dernierContactLe).toBeUndefined();

    const realise = await marquerRdvEstimationRealiseProspectVendeur(prospect.id, new Date("2026-09-10T15:00:00Z"));
    expect(deriverStatutProspectVendeur(realise!)).toBe("rendez_vous");
    // Un rendez-vous réalisé EST une vraie interaction (correction n° 4).
    expect(realise?.dernierContactLe).toBeDefined();
  });

  it("enregistrerEstimationProspectVendeur() pose le montant et la date atomiquement, jamais dernierContactLe", async () => {
    const prospect = await creerProspectDeTest("004");
    const estime = await enregistrerEstimationProspectVendeur(prospect.id, 35_000_00, "2026-09-01");
    expect(estime?.estimationProposeeCentimes).toBe(35_000_00);
    expect(estime?.estimationProposeeLe).toBe("2026-09-01");
    expect(estime?.dernierContactLe).toBeUndefined();
    expect(deriverStatutProspectVendeur(estime!)).toBe("estimation");
  });

  it("proposerMandatProspectVendeur() pose mandatProposeLe", async () => {
    const prospect = await creerProspectDeTest("005");
    const propose = await proposerMandatProspectVendeur(prospect.id);
    expect(deriverStatutProspectVendeur(propose!)).toBe("mandat_propose");
  });

  it("marquerProspectVendeurPerdu() pose motifPerte et datePerte atomiquement", async () => {
    const prospect = await creerProspectDeTest("006");
    const perdu = await marquerProspectVendeurPerdu(prospect.id, "injoignable", "2026-09-05");
    expect(perdu?.motifPerte).toBe("injoignable");
    expect(perdu?.datePerte).toBe("2026-09-05");
    expect(deriverStatutProspectVendeur(perdu!)).toBe("perdu");
  });

  it("archiverProspectVendeur()/desarchiverProspectVendeur() sont orthogonaux au statut dérivé (correction n° 5)", async () => {
    const prospect = await creerProspectDeTest("007");
    await qualifierProspectVendeur(prospect.id);
    const archive = await archiverProspectVendeur(prospect.id);
    expect(archive?.archiveLe).toBeDefined();
    expect(deriverStatutProspectVendeur(archive!)).toBe("qualification");

    const desarchive = await desarchiverProspectVendeur(prospect.id);
    expect(desarchive?.archiveLe).toBeUndefined();
  });

  it("signerMandatProspectVendeur() crée le bien et pose mandatSigneLe+bienId dans une seule transaction", async () => {
    const prospect = await creerProspectDeTest("008");

    const resultat = await signerMandatProspectVendeur(prospect.id, {
      reference: `[test réel] SIGNATURE-008`,
      titre: "Maison de test",
      type: "maison",
      adresse: "1 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 100,
      pieces: 4,
      prix: 400000,
      statutMandat: "actif",
      dateMandat: "2026-09-10",
      caracteristiques: [],
      description: "",
    });
    expect(resultat).toBeDefined();
    idsBiensCrees.push(resultat!.bien.id);

    expect(resultat!.prospect.bienId).toBe(resultat!.bien.id);
    expect(resultat!.prospect.mandatSigneLe).toBeDefined();
    expect(deriverStatutProspectVendeur(resultat!.prospect)).toBe("mandat_signe");

    const relu = await getProspectVendeurById(prospect.id);
    expect(relu?.bienId).toBe(resultat!.bien.id);
  });

  it("bienId porte une contrainte unique : un bien ne peut être la conversion que d'une seule opportunité", async () => {
    const prospectA = await creerProspectDeTest("009a");
    const prospectB = await creerProspectDeTest("009b");

    const resultatA = await signerMandatProspectVendeur(prospectA.id, {
      reference: `[test réel] SIGNATURE-009`,
      titre: "Bien partagé",
      type: "appartement",
      adresse: "9 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 60,
      pieces: 3,
      prix: 250000,
      statutMandat: "actif",
      dateMandat: "2026-09-10",
      caracteristiques: [],
      description: "",
    });
    idsBiensCrees.push(resultatA!.bien.id);

    // Tentative de faire pointer un second prospect vers le même bien directement en base
    // (contournant signerMandatProspectVendeur, qui crée toujours un nouveau bien) : la
    // contrainte unique doit rejeter, jamais laisser deux opportunités partager un bien.
    await expect(
      getDb().update(prospectsVendeursTable).set({ bienId: resultatA!.bien.id, mandatSigneLe: new Date() }).where(eq(prospectsVendeursTable.id, prospectB.id))
    ).rejects.toThrow();
  });

  it("listerProspectsVendeurs()/Perdus()/Convertis()/Archives() filtrent correctement par statut et archivage", async () => {
    const enCours = await creerProspectDeTest("010a");
    const perdu = await creerProspectDeTest("010b");
    await marquerProspectVendeurPerdu(perdu.id, "autre", "2026-09-05");
    const archive = await creerProspectDeTest("010c");
    await archiverProspectVendeur(archive.id);

    const [listeEnCours, listePerdus, listeArchives] = await Promise.all([
      listerProspectsVendeurs(),
      listerProspectsVendeursPerdus(),
      listerProspectsVendeursArchives(),
    ]);

    expect(listeEnCours.map((p) => p.id)).toContain(enCours.id);
    expect(listeEnCours.map((p) => p.id)).not.toContain(perdu.id);
    expect(listeEnCours.map((p) => p.id)).not.toContain(archive.id);

    expect(listePerdus.map((p) => p.id)).toContain(perdu.id);
    expect(listeArchives.map((p) => p.id)).toContain(archive.id);

    const listeConvertis = await listerProspectsVendeursConvertis();
    expect(listeConvertis.map((p) => p.id)).not.toContain(enCours.id);
  });
});
