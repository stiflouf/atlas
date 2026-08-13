import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Garde-fous des Server Actions (ADR-027) : aucune séquence stricte entre jalons, mais perte et
// signature restent terminales — même style que actions/compromis.test.ts (seul le chemin de
// rejet est testable directement, redirect() lève NEXT_REDIRECT sur le chemin de succès).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, prospectsVendeurs: prospectsVendeursTable } = await import("@/db/schema");
const { creerProspectVendeur, marquerProspectVendeurPerdu, signerMandatProspectVendeur } = await import(
  "@/lib/prospectVendeurRepository"
);
const {
  qualifierProspectVendeurAction,
  enregistrerEstimationProspectVendeurAction,
  marquerProspectVendeurPerduAction,
  signerMandatProspectVendeurAction,
  ajouterNoteProspectVendeurAction,
} = await import("./prospectVendeur");

const idsProspectsCrees: string[] = [];
const idsBiensCrees: string[] = [];

afterAll(async () => {
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
