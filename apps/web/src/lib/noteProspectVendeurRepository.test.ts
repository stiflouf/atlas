import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { prospectsVendeurs: prospectsVendeursTable, notesProspectVendeur: notesTable } = await import("@/db/schema");
const { creerProspectVendeur, getProspectVendeurById } = await import("./prospectVendeurRepository");
const { ajouterNoteProspectVendeur, listerNotesProspectVendeur } = await import("./noteProspectVendeurRepository");

const idsProspectsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsProspectsCrees) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
});

async function creerProspectDeTest(suffixe: string) {
  const prospect = await creerProspectVendeur({
    nom: `[test réel] Note prospect ${suffixe}`,
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

describe("noteProspectVendeurRepository (intégration Postgres)", () => {
  it("liste [] pour un id non-UUID, sans erreur de cast", async () => {
    await expect(listerNotesProspectVendeur("prospect-mock")).resolves.toEqual([]);
  });

  it("une note de type 'note_interne' n'avance JAMAIS dernier_contact_le (correction n° 2)", async () => {
    const prospect = await creerProspectDeTest("001");
    await ajouterNoteProspectVendeur(prospect.id, "note_interne", "Remarque interne sans interaction réelle.");

    const relu = await getProspectVendeurById(prospect.id);
    expect(relu?.dernierContactLe).toBeUndefined();
  });

  it("une note d'interaction ('appel') avance dernier_contact_le", async () => {
    const prospect = await creerProspectDeTest("002");
    await ajouterNoteProspectVendeur(prospect.id, "appel", "Appel téléphonique avec le vendeur.");

    const relu = await getProspectVendeurById(prospect.id);
    expect(relu?.dernierContactLe).toBeDefined();
  });

  it("chaque type d'interaction (email, sms, rendez_vous, autre_interaction) avance dernier_contact_le", async () => {
    for (const type of ["email", "sms", "rendez_vous", "autre_interaction"] as const) {
      const prospect = await creerProspectDeTest(`003-${type}`);
      await ajouterNoteProspectVendeur(prospect.id, type, `Interaction de type ${type}.`);
      const relu = await getProspectVendeurById(prospect.id);
      expect(relu?.dernierContactLe, `type=${type}`).toBeDefined();
    }
  });

  it("listerNotesProspectVendeur() retourne les notes triées par date décroissante", async () => {
    const prospect = await creerProspectDeTest("004");
    const premiere = await ajouterNoteProspectVendeur(prospect.id, "note_interne", "Première note.");
    const seconde = await ajouterNoteProspectVendeur(prospect.id, "appel", "Seconde note, un appel.");

    const notes = await listerNotesProspectVendeur(prospect.id);
    expect(notes.map((n) => n.id)).toEqual([seconde.id, premiere.id]);
    expect(notes[1].type).toBe("note_interne");
    expect(notes[0].type).toBe("appel");
  });

  it("insère bien la ligne en base (table notes_prospect_vendeur), pas seulement en mémoire", async () => {
    const prospect = await creerProspectDeTest("005");
    const note = await ajouterNoteProspectVendeur(prospect.id, "note_interne", "Vérification directe.");

    const [ligne] = await getDb().select().from(notesTable).where(eq(notesTable.id, note.id));
    expect(ligne).toBeDefined();
    expect(ligne.contenu).toBe("Vérification directe.");
  });
});
