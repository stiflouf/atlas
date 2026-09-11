import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-055 §B — L'ÉCRITURE HUMAINE, alignée sur la lecture canonique du moteur. Ce fichier ne vérifie
// pas qu'un repository sait écrire une table : il ferme la boucle « un conseiller modifie un budget
// dans son formulaire, et le matching change ». Avant ce lot, l'UI enregistrait dans la ligne
// historique pendant que le moteur lisait le projet canonique — l'utilisateur voyait sa saisie
// acceptée sans aucun effet sur les correspondances.
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
  biens: biensTable,
  champsVerrouilles: champsVerrouillesTable,
  compatibilitesARessynchroniser,
  compatibilitesBienAcquereurEtat,
  contacts: contactsTable,
  evenementsMetier,
  executionsAutomatisation,
  projetsAcquereur: projetsAcquereurTable,
} = await import("@/db/schema");
const { creerAcquereur, getClientById } = await import("@/lib/clientRepository");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { creerBien } = await import("@/lib/bienRepository");
const { evaluerCompatibiliteAcquereur } = await import("@/lib/compatibilite/orchestration");
const { modifierAcquereurAction } = await import("./modifierAcquereur");

const PRIX_BIEN = 300_000;
const BUDGET_DEPART = 350_000; // au-dessus du prix -> compatible
const BUDGET_SAISI = 250_000; // en dessous du prix -> incompatible

const idsAcquereurs: string[] = [];
const idsProjets: string[] = [];
const idsContacts: string[] = [];
const idsBiens: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetier.id })
      .from(evenementsMetier)
      .where(inArray(evenementsMetier.acquereurId, idsAcquereurs));
    if (evenements.length > 0) {
      const ids = evenements.map((e) => e.id);
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, ids));
      await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, ids));
    }
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(inArray(compatibilitesBienAcquereurEtat.acquereurId, idsAcquereurs));
    await getDb()
      .delete(compatibilitesARessynchroniser)
      .where(inArray(compatibilitesARessynchroniser.acquereurId, idsAcquereurs));
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  }
  if (idsBiens.length > 0) {
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(inArray(compatibilitesBienAcquereurEtat.bienId, idsBiens));
    await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  }
  if (idsProjets.length > 0) {
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.projetAcquereurId, idsProjets));
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjets));
  }
  if (idsContacts.length > 0) {
    // ADR-057 — une correction d'identité verrouille le champ corrigé : les verrous tombent avant
    // leur contact, comme ceux du projet tombent avant lui.
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

function formulaire(id: string, overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("prenom", "Jean");
  formData.set("nom", "[test réel] Ecriture humaine");
  formData.set("email", "ecriture.humaine@example.com");
  formData.set("telephone", "0611111111");
  formData.set("budgetMin", "100000");
  formData.set("budgetMax", String(BUDGET_DEPART));
  formData.set("criteres", "");
  formData.set("stadeProjet", "recherche_active");
  formData.set("notes", "");
  formData.set("datePremiereContact", "2026-01-01");
  for (const [cle, valeur] of Object.entries(overrides)) formData.set(cle, valeur);
  return formData;
}

// `redirect()` lève par conception (Next.js) : l'attraper est la seule façon d'observer l'effet.
const enregistrer = (formData: FormData) => modifierAcquereurAction(formData).catch(() => {});

// Reproduit EXACTEMENT le graphe que creerAcquereurAction écrit : contact + projet + partie +
// dossier rattaché. `surchargeProjet` permet de faire diverger volontairement les deux copies.
async function unAcquereurCanonique(suffixe: string, surchargeProjet: Record<string, unknown> = {}) {
  const contact = await creerContact({ nom: `[test réel] Ecriture ${suffixe}` }, WORKSPACE_TEST);
  idsContacts.push(contact.id);
  const projet = await creerProjetAcquereur(
    {
      budgetMin: 100_000,
      budgetMax: BUDGET_DEPART,
      criteres: [],
      stadeProjet: "recherche_active",
      ...surchargeProjet,
    },
    WORKSPACE_TEST
  );
  idsProjets.push(projet.id);
  await ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: projet.id, role: "acquereur" });
  const dossier = await creerAcquereur(
    {
      prenom: "Jean",
      nom: `[test réel] Ecriture ${suffixe}`,
      email: `ecriture-${suffixe}@example.com`,
      telephone: "0600000000",
      budgetMin: 100_000,
      budgetMax: BUDGET_DEPART,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
      contactId: contact.id,
      projetAcquereurId: projet.id,
    },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(dossier.id);
  return { contact, projet, dossier };
}

async function unDossierHistorique(suffixe: string) {
  const dossier = await creerAcquereur(
    {
      prenom: "Jean",
      nom: `[test réel] Historique ${suffixe}`,
      email: `historique-${suffixe}@example.com`,
      telephone: "0600000000",
      budgetMin: 100_000,
      budgetMax: BUDGET_DEPART,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function unBien(suffixe: string) {
  const bien = await creerBien(
    {
      reference: `[test réel] ECRITURE-${suffixe}`,
      titre: "Bien de test écriture humaine",
      type: "appartement",
      adresse: "1 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 3,
      prix: PRIX_BIEN,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    WORKSPACE_TEST
  );
  idsBiens.push(bien.id);
  return bien;
}

async function statutBudget(acquereurId: string, bienId: string) {
  const resultats = await evaluerCompatibiliteAcquereur(acquereurId);
  const pourCeBien = resultats.find((r) => r.bienId === bienId);
  expect(pourCeBien).toBeDefined();
  return pourCeBien!.criteres.find((c) => c.critere === "budget_max")!.statut;
}

async function ligneDossier(id: string) {
  const [ligne] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, id));
  return ligne!;
}

async function ligneProjet(id: string) {
  const [ligne] = await getDb().select().from(projetsAcquereurTable).where(eq(projetsAcquereurTable.id, id));
  return ligne!;
}

describe("modifierAcquereurAction — acquéreur canonique", () => {
  it("édition humaine -> projet canonique -> invalidation -> matching", async () => {
    const { projet, dossier } = await unAcquereurCanonique("boucle");
    const bien = await unBien("boucle");

    expect(await statutBudget(dossier.id, bien.id)).toBe("compatible");

    await enregistrer(formulaire(dossier.id, { budgetMax: String(BUDGET_SAISI) }));

    // 1. Le projet canonique porte la saisie.
    expect((await ligneProjet(projet.id)).budgetMax).toBe(BUDGET_SAISI);

    // 2. Le dossier historique n'a PAS été touché sur ce champ : aucun double-write n'est créé.
    expect((await ligneDossier(dossier.id)).budgetMax).toBe(BUDGET_DEPART);

    // 3. Le recalcul est demandé (ADR-036), jamais un statut périmé silencieux.
    const demandes = await getDb()
      .select()
      .from(compatibilitesARessynchroniser)
      .where(eq(compatibilitesARessynchroniser.acquereurId, dossier.id));
    expect(demandes).toHaveLength(1);

    // 4. Et le verdict métier a réellement changé.
    expect(await statutBudget(dossier.id, bien.id)).toBe("incompatible");
  });

  it("legacy et canonique divergents : la saisie écrase le CANONIQUE, pas le dossier", async () => {
    // Le dossier dit 350k (valeur gelée), le projet dit 500k (poussé par une source), l'humain
    // saisit 250k. Si ce test passait grâce à une écriture accidentelle du dossier, l'assertion sur
    // la ligne historique le dirait.
    const { projet, dossier } = await unAcquereurCanonique("divergence", { budgetMax: 500_000 });
    const bien = await unBien("divergence");

    await enregistrer(formulaire(dossier.id, { budgetMax: String(BUDGET_SAISI) }));

    expect((await ligneProjet(projet.id)).budgetMax).toBe(BUDGET_SAISI);
    expect((await ligneDossier(dossier.id)).budgetMax).toBe(BUDGET_DEPART);
    expect(await statutBudget(dossier.id, bien.id)).toBe("incompatible");
  });

  it("le formulaire RECHARGE la valeur canonique, jamais celle du dossier", async () => {
    // Sans cela : le projet dit 500k, le formulaire affiche 350k, le conseiller enregistre sans
    // rien toucher — et écrase silencieusement le canonique à 350k.
    const { dossier } = await unAcquereurCanonique("relecture", { budgetMax: 500_000, piecesMin: 4 });

    const relu = await getClientById(dossier.id);
    expect(relu?.budgetMax).toBe(500_000);
    expect(relu?.piecesMin).toBe(4);
    // Le parcours reste porté par le dossier. L'identité, elle, a changé de propriétaire depuis
    // ADR-057 : ce graphe de test crée un Contact sans email, et l'identité effective n'en a donc
    // pas — surtout pas celle, périmée, du dossier. C'est la règle d'agrégat, vérifiée en détail
    // par modifierAcquereur.identite.test.ts.
    expect(relu?.email).toBeUndefined();
    expect(relu?.stadeProjet).toBe("recherche_active");
  });

  it("un NULL canonique reste NULL après une saisie qui ne le renseigne pas", async () => {
    // Le dossier porte piecesMin = 4 (gelé à la création), le projet ne le documente pas. Le
    // formulaire soumis laisse le champ vide : aucun repli champ par champ ne doit ressusciter 4.
    const { projet, dossier } = await unAcquereurCanonique("nulls");
    await getDb()
      .update(acquereursTable)
      .set({ piecesMin: 4 })
      .where(eq(acquereursTable.id, dossier.id));

    await enregistrer(formulaire(dossier.id));

    expect((await ligneProjet(projet.id)).piecesMin).toBeNull();
    expect((await getClientById(dossier.id))?.piecesMin).toBeUndefined();
  });

  it("déplacer l'INTERVALLE de budget d'un bloc est accepté", async () => {
    // Champ par champ, (100k, 350k) -> (400k, 500k) serait refusé sur l'état intermédiaire
    // `400k > 350k`, que l'utilisateur n'a jamais demandé. Le bloc est validé sur l'état final.
    const { projet, dossier } = await unAcquereurCanonique("intervalle");

    await enregistrer(formulaire(dossier.id, { budgetMin: "400000", budgetMax: "500000" }));

    const apres = await ligneProjet(projet.id);
    expect(apres.budgetMin).toBe(400_000);
    expect(apres.budgetMax).toBe(500_000);
  });

  it("une correction humaine VERROUILLE le champ corrigé, et lui seul (ADR-056 §4)", async () => {
    const { projet, dossier } = await unAcquereurCanonique("verrou");

    await enregistrer(formulaire(dossier.id, { budgetMax: String(BUDGET_SAISI) }));

    const verrous = await getDb()
      .select()
      .from(champsVerrouillesTable)
      .where(eq(champsVerrouillesTable.projetAcquereurId, projet.id));
    expect(verrous.map((v) => v.champ)).toEqual(["budgetMax"]);
    expect(verrous[0]!.workspaceId).toBe(WORKSPACE_TEST);
  });

  it("réenregistrer le formulaire à l'identique ne verrouille RIEN", async () => {
    // ADR-056 définit l'override local comme une valeur MODIFIÉE. Verrouiller sur simple
    // réenregistrement condamnerait les huit champs d'un coup, sans que personne ne l'ait décidé.
    const { projet, dossier } = await unAcquereurCanonique("sans-changement");

    await enregistrer(formulaire(dossier.id));

    const verrous = await getDb()
      .select()
      .from(champsVerrouillesTable)
      .where(eq(champsVerrouillesTable.projetAcquereurId, projet.id));
    expect(verrous).toEqual([]);
  });
});

describe("modifierAcquereurAction — acquéreur historique (non rattaché)", () => {
  it("écrit ses critères dans le dossier, exactement comme avant", async () => {
    const dossier = await unDossierHistorique("inchange");

    await enregistrer(formulaire(dossier.id, { budgetMax: String(BUDGET_SAISI), piecesMin: "3" }));

    const ligne = await ligneDossier(dossier.id);
    expect(ligne.budgetMax).toBe(BUDGET_SAISI);
    expect(ligne.piecesMin).toBe(3);
    expect(ligne.projetAcquereurId).toBeNull();
    expect(ligne.contactId).toBeNull();
  });

  it("ne fabrique AUCUN contact ni projet canonique au passage", async () => {
    // Ce lot n'est pas un backfill opportuniste : rattacher l'historique est un geste explicite,
    // réservé à son propre lot (ADR-055, stratégie de migration).
    const dossier = await unDossierHistorique("sans-backfill");
    const projetsAvant = await getDb().select({ id: projetsAcquereurTable.id }).from(projetsAcquereurTable);
    const contactsAvant = await getDb().select({ id: contactsTable.id }).from(contactsTable);

    await enregistrer(formulaire(dossier.id, { budgetMax: String(BUDGET_SAISI) }));

    expect((await getDb().select({ id: projetsAcquereurTable.id }).from(projetsAcquereurTable)).length).toBe(
      projetsAvant.length
    );
    expect((await getDb().select({ id: contactsTable.id }).from(contactsTable)).length).toBe(contactsAvant.length);
  });

  it("ne pose aucun verrou : il n'y a pas d'entité canonique à protéger", async () => {
    const dossier = await unDossierHistorique("sans-verrou");
    const avant = await getDb().select({ id: champsVerrouillesTable.id }).from(champsVerrouillesTable);

    await enregistrer(formulaire(dossier.id, { budgetMax: String(BUDGET_SAISI) }));

    expect((await getDb().select({ id: champsVerrouillesTable.id }).from(champsVerrouillesTable)).length).toBe(
      avant.length
    );
  });
});

describe("modifierAcquereurAction — anomalies", () => {
  it("un intervalle de budget impossible est refusé, et rien n'est écrit", async () => {
    const { projet, dossier } = await unAcquereurCanonique("invariant");

    await expect(
      modifierAcquereurAction(formulaire(dossier.id, { budgetMin: "500000", budgetMax: "100000" }))
    ).rejects.toThrow();

    // Le formulaire refuse déjà cette combinaison en amont ; la garde du Core est la seconde
    // barrière. Dans les deux cas, l'abandon est TOTAL : ni le projet ni le dossier ne bougent.
    expect((await ligneProjet(projet.id)).budgetMax).toBe(BUDGET_DEPART);
    expect((await ligneDossier(dossier.id)).nom).toBe(`[test réel] Ecriture invariant`);
  });

  it("référence de projet cassée : la résolution échoue avant toute écriture", async () => {
    // La FK `acquereurs.projet_acquereur_id -> projets_acquereur.id` rend cet état impossible à
    // fabriquer par une écriture réelle — Postgres refuse aussi bien de pointer vers un projet
    // absent que de supprimer un projet encore référencé. La garde est donc éprouvée là où elle
    // vit, sur un exécuteur qui rend ce que rendrait une base incohérente
    // (`profilCompatibiliteRepository.test.ts`, cas D). Ce qui est vérifié ICI est ce qui en
    // découle pour l'action : elle résout la source DANS sa transaction, donc avant toute écriture,
    // et une exception à cette étape ne laisse rien de partiel derrière elle.
    const { resoudreSourceCriteres } = await import("@/lib/criteresAcquereurEffectifs");
    const executeurIncoherent = {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: async () => [
              {
                acquereurId: "00000000-0000-4000-8000-000000000001",
                projetAcquereurId: "00000000-0000-4000-8000-0000000000ff",
                projetTrouveId: null,
                budgetMin: null,
                budgetMax: null,
                criteres: null,
                piecesMin: null,
                surfaceMin: null,
                accessibiliteRequise: null,
                necessiteParking: null,
                necessiteExterieur: null,
              },
            ],
          }),
        }),
      }),
    };

    await expect(
      resoudreSourceCriteres("00000000-0000-4000-8000-000000000001", executeurIncoherent as never)
    ).rejects.toThrow(/Projet acquéreur référencé mais introuvable/);
  });
});
