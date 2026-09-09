import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

// ADR-055 §B — COEXISTENCE : une création réelle alimente désormais le modèle canonique complet
// (personne, projet, participation) sans que rien du comportement historique ne change. Ces tests
// vérifient les deux moitiés de cette phrase, et le rollback qui les rend sûres.
//
// Session et workspace mockés comme dans tous les tests de Server Actions (ADR-047/054) : ce qui
// est testé ici est le modèle canonique, pas la garde d'authentification.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  compatibilitesARessynchroniser,
  compatibilitesBienAcquereurEtat,
  contacts: contactsTable,
  evenementsMetier,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
} = await import("@/db/schema");
const { creerAcquereurAction } = await import("./creerAcquereur");
const { getProjetAcquereurById, listerPartiesDuProjet } = await import("@/lib/projetAcquereurRepository");

const MARQUEUR = "[test réel] PROJET-COEXISTENCE";

afterAll(async () => {
  const acquereurs = await getDb().select().from(acquereursTable).where(like(acquereursTable.nom, `%${MARQUEUR}%`));
  const ids = acquereurs.map((a) => a.id);
  if (ids.length > 0) {
    await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.acquereurId, ids));
    await getDb().delete(compatibilitesBienAcquereurEtat).where(inArray(compatibilitesBienAcquereurEtat.acquereurId, ids));
    await getDb().delete(compatibilitesARessynchroniser).where(inArray(compatibilitesARessynchroniser.acquereurId, ids));
  }
  const projets = acquereurs.map((a) => a.projetAcquereurId).filter((id): id is string => id !== null);
  await getDb().delete(acquereursTable).where(like(acquereursTable.nom, `%${MARQUEUR}%`));
  // Les parties tombent avec leur projet (CASCADE) ; les contacts ne sont supprimables qu'ensuite.
  if (projets.length > 0) {
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, projets));
  }
  await getDb().delete(contactsTable).where(like(contactsTable.nom, `%${MARQUEUR}%`));
});

function formulaire(nom: string, surcharges: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("prenom", "Camille");
  formData.set("nom", nom);
  formData.set("email", "projet.coexistence@example.test");
  formData.set("telephone", "0611111111");
  formData.set("budgetMin", "150000");
  formData.set("budgetMax", "450000");
  formData.set("criteres", "jardin");
  formData.set("stadeProjet", "recherche_active");
  formData.set("notes", "");
  formData.set("datePremiereContact", "2026-02-01");
  formData.set("piecesMin", "4");
  for (const [cle, valeur] of Object.entries(surcharges)) formData.set(cle, valeur);
  return formData;
}

describe("ADR-055 §B — une création acquéreur alimente le modèle canonique complet", () => {
  it("crée Contact + BuyerProject + partie + ligne historique, tous reliés", async () => {
    const nom = `${MARQUEUR} NOMINAL`;
    await creerAcquereurAction(formulaire(nom)).catch(() => {}); // redirect() attendu

    // 1. Comportement historique intact : la ligne `acquereurs` existe avec exactement les champs
    //    soumis. C'est elle qui pilote encore matching, visites, offres et UI.
    const [acquereur] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.nom, nom));
    expect(acquereur).toBeDefined();
    expect(acquereur.prenom).toBe("Camille");
    expect(acquereur.budgetMax).toBe(450_000);
    expect(acquereur.stadeProjet).toBe("recherche_active");

    // 2. Les deux ponts sont posés.
    expect(acquereur.contactId).not.toBeNull();
    expect(acquereur.projetAcquereurId).not.toBeNull();

    // 3. Le projet canonique porte la moitié « projet », et RIEN de l'identité.
    const projet = await getProjetAcquereurById(acquereur.projetAcquereurId!);
    expect(projet).toBeDefined();
    expect(projet!.budgetMin).toBe(150_000);
    expect(projet!.budgetMax).toBe(450_000);
    expect(projet!.criteres).toEqual(["jardin"]);
    expect(projet!.stadeProjet).toBe("recherche_active");
    expect(projet!.piecesMin).toBe(4);
    expect(projet).not.toHaveProperty("nom");
    expect(projet).not.toHaveProperty("email");

    // 4. Le rôle est porté par la participation, jamais par la personne.
    const parties = await listerPartiesDuProjet(projet!.id);
    expect(parties).toHaveLength(1);
    expect(parties[0].contactId).toBe(acquereur.contactId);
    expect(parties[0].role).toBe("acquereur");

    // 5. Le matching historique a tourné exactement comme avant, sur `acquereurs` : la demande de
    //    resynchronisation est indexée par acquereur_id, jamais par projet.
    const [demande] = await getDb()
      .select()
      .from(compatibilitesARessynchroniser)
      .where(eq(compatibilitesARessynchroniser.acquereurId, acquereur.id));
    expect(demande, "la resynchronisation ADR-036 doit rester déclenchée par la ligne historique").toBeDefined();
  });

  it("un échec en fin de transaction ne laisse ni contact, ni projet, ni partie orphelins", async () => {
    // Panne réaliste et non simulée : une date invalide traverse le parsing et n'est rejetée que
    // par Postgres, à l'insertion de `acquereurs` — donc APRÈS que le contact, le projet et la
    // partie ont déjà été écrits dans la transaction. C'est exactement le scénario où une
    // implémentation en plusieurs transactions laisserait une personne sans dossier.
    const nom = `${MARQUEUR} ROLLBACK`;
    await expect(creerAcquereurAction(formulaire(nom, { datePremiereContact: "pas-une-date" }))).rejects.toThrow();

    expect(await getDb().select().from(acquereursTable).where(eq(acquereursTable.nom, nom))).toEqual([]);
    expect(await getDb().select().from(contactsTable).where(eq(contactsTable.nom, nom))).toEqual([]);

    // Aucune partie ne subsiste : sans elle, un projet rescapé serait un dossier sans porteur.
    const partiesRestantes = await getDb()
      .select()
      .from(partiesProjetTable)
      .innerJoin(contactsTable, eq(partiesProjetTable.contactId, contactsTable.id))
      .where(eq(contactsTable.nom, nom));
    expect(partiesRestantes).toEqual([]);
  });
});
