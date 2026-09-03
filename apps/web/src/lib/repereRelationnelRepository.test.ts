import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Test d'intégration réel (VALUE-06) : vraie base Postgres, même patron que
// secteurRechercheRepository / noteBienRepository. Couvre le refus par défaut de l'usage
// communicationnel, l'ordre déterministe, l'archivage réversible et la cascade FK.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable, reperesRelationnelsAcquereur: reperesTable } = await import("@/db/schema");
const { creerAcquereur } = await import("@/lib/clientRepository");
const {
  archiverRepereRelationnelAcquereur,
  creerRepereRelationnelAcquereur,
  listerReperesRelationnelsAcquereur,
  listerReperesRelationnelsArchivesAcquereur,
  modifierRepereRelationnelAcquereur,
  restaurerRepereRelationnelAcquereur,
} = await import("./repereRelationnelRepository");

const idsAcquereurs: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) {
    await getDb().delete(reperesTable).where(inArray(reperesTable.acquereurId, idsAcquereurs));
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  }
});

async function creerAcquereurDeTest(suffixe: string): Promise<string> {
  const acquereur = await creerAcquereur({
    prenom: "Camille",
    nom: `[test réel] Repères ${suffixe}`,
    email: `reperes.${suffixe.toLowerCase()}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereurs.push(acquereur.id);
  return acquereur.id;
}

describe("repereRelationnelRepository — création et refus par défaut", () => {
  it("un repère créé est visible dans la liste active de son acquéreur", async () => {
    const acquereurId = await creerAcquereurDeTest("CREATION");
    const cree = await creerRepereRelationnelAcquereur({
      acquereurId,
      categorie: "preference_contact",
      libelle: "Préfère les échanges par email",
      provenance: "indique_par_le_client",
      utilisableCommunication: false,
    });

    const actifs = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(actifs).toHaveLength(1);
    expect(actifs[0].id).toBe(cree.id);
    expect(actifs[0].libelle).toBe("Préfère les échanges par email");
    expect(actifs[0].provenance).toBe("indique_par_le_client");
    expect(actifs[0].archiveLe).toBeUndefined();
    expect(actifs[0].modifieLe).toBeUndefined();
  });

  it("l'usage communicationnel vaut false quand il n'a pas été explicitement autorisé", async () => {
    const acquereurId = await creerAcquereurDeTest("DEFAUT");
    await creerRepereRelationnelAcquereur({
      acquereurId,
      categorie: "centre_interet",
      libelle: "Football",
      provenance: "observe_lors_d_un_echange",
      utilisableCommunication: false,
    });

    const [repere] = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(repere.utilisableCommunication).toBe(false);
  });

  it("la colonne elle-même porte le refus : une insertion sans la valeur reste à false", async () => {
    // Vérifie le DEFAULT false de la base, pas seulement la valeur passée par le repository — la
    // garantie doit tenir même si un futur chemin d'écriture oubliait le champ.
    const acquereurId = await creerAcquereurDeTest("DEFAUT-SQL");
    await getDb().insert(reperesTable).values({
      acquereurId,
      categorie: "autre",
      libelle: "Souhaite être rappelé plutôt le matin",
      provenance: "saisi_par_le_conseiller",
    });

    const [repere] = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(repere.utilisableCommunication).toBe(false);
  });

  it("l'autorisation explicite est persistée telle quelle", async () => {
    const acquereurId = await creerAcquereurDeTest("AUTORISE");
    await creerRepereRelationnelAcquereur({
      acquereurId,
      categorie: "preference_contact",
      libelle: "Préfère être appelé en fin de journée",
      provenance: "indique_par_le_client",
      utilisableCommunication: true,
    });

    const [repere] = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(repere.utilisableCommunication).toBe(true);
  });
});

describe("repereRelationnelRepository — correction", () => {
  it("modifier met à jour la valeur courante, pose modifieLe et ne touche jamais creeLe", async () => {
    const acquereurId = await creerAcquereurDeTest("MODIF");
    const cree = await creerRepereRelationnelAcquereur({
      acquereurId,
      categorie: "autre",
      libelle: "Préfère l'email",
      provenance: "saisi_par_le_conseiller",
      utilisableCommunication: false,
    });

    const modifie = await modifierRepereRelationnelAcquereur(cree.id, acquereurId, {
      categorie: "preference_contact",
      libelle: "Préfère les échanges par email",
      provenance: "indique_par_le_client",
      utilisableCommunication: true,
    });

    expect(modifie?.categorie).toBe("preference_contact");
    expect(modifie?.libelle).toBe("Préfère les échanges par email");
    expect(modifie?.provenance).toBe("indique_par_le_client");
    expect(modifie?.utilisableCommunication).toBe(true);
    expect(modifie?.modifieLe).toBeDefined();
    expect(modifie?.creeLe).toBe(cree.creeLe);
  });

  it("un repère appartenant à un autre acquéreur n'est jamais modifiable depuis cette fiche", async () => {
    const proprietaire = await creerAcquereurDeTest("SCOPE-A");
    const autre = await creerAcquereurDeTest("SCOPE-B");
    const cree = await creerRepereRelationnelAcquereur({
      acquereurId: proprietaire,
      categorie: "centre_interet",
      libelle: "Randonnée",
      provenance: "observe_lors_d_un_echange",
      utilisableCommunication: false,
    });

    const tentative = await modifierRepereRelationnelAcquereur(cree.id, autre, {
      categorie: "autre",
      libelle: "Modifié depuis une autre fiche",
      provenance: "saisi_par_le_conseiller",
      utilisableCommunication: true,
    });

    expect(tentative).toBeUndefined();
    const [inchange] = await listerReperesRelationnelsAcquereur(proprietaire);
    expect(inchange.libelle).toBe("Randonnée");
    expect(inchange.utilisableCommunication).toBe(false);
  });
});

describe("repereRelationnelRepository — archivage", () => {
  it("un repère archivé quitte la liste active, sans jamais être supprimé", async () => {
    const acquereurId = await creerAcquereurDeTest("ARCHIVE");
    const cree = await creerRepereRelationnelAcquereur({
      acquereurId,
      categorie: "centre_interet",
      libelle: "Football",
      provenance: "observe_lors_d_un_echange",
      // Même autorisé, un repère archivé n'alimente plus rien : l'archivage prime.
      utilisableCommunication: true,
    });

    const archive = await archiverRepereRelationnelAcquereur(cree.id, acquereurId);
    expect(archive?.archiveLe).toBeDefined();

    expect(await listerReperesRelationnelsAcquereur(acquereurId)).toHaveLength(0);
    const archives = await listerReperesRelationnelsArchivesAcquereur(acquereurId);
    expect(archives).toHaveLength(1);
    expect(archives[0].id).toBe(cree.id);
  });

  it("restaurer ramène le repère dans la liste active", async () => {
    const acquereurId = await creerAcquereurDeTest("RESTAURE");
    const cree = await creerRepereRelationnelAcquereur({
      acquereurId,
      categorie: "autre",
      libelle: "Souhaite être rappelé plutôt le matin",
      provenance: "indique_par_le_client",
      utilisableCommunication: false,
    });
    await archiverRepereRelationnelAcquereur(cree.id, acquereurId);

    const restaure = await restaurerRepereRelationnelAcquereur(cree.id, acquereurId);
    expect(restaure?.archiveLe).toBeUndefined();
    expect(await listerReperesRelationnelsAcquereur(acquereurId)).toHaveLength(1);
    expect(await listerReperesRelationnelsArchivesAcquereur(acquereurId)).toHaveLength(0);
  });
});

describe("repereRelationnelRepository — ordre et intégrité", () => {
  it("plusieurs repères sortent dans un ordre stable d'une lecture à l'autre", async () => {
    const acquereurId = await creerAcquereurDeTest("ORDRE");
    for (const libelle of ["Premier", "Deuxième", "Troisième", "Quatrième"]) {
      await creerRepereRelationnelAcquereur({
        acquereurId,
        categorie: "autre",
        libelle,
        provenance: "saisi_par_le_conseiller",
        utilisableCommunication: false,
      });
    }

    const premiereLecture = (await listerReperesRelationnelsAcquereur(acquereurId)).map((r) => r.id);
    const secondeLecture = (await listerReperesRelationnelsAcquereur(acquereurId)).map((r) => r.id);
    expect(premiereLecture).toHaveLength(4);
    expect(secondeLecture).toEqual(premiereLecture);
  });

  it("un acquéreur supprimé emporte ses repères (FK CASCADE), jamais de ligne orpheline", async () => {
    const acquereurId = await creerAcquereurDeTest("CASCADE");
    await creerRepereRelationnelAcquereur({
      acquereurId,
      categorie: "centre_interet",
      libelle: "Randonnée",
      provenance: "observe_lors_d_un_echange",
      utilisableCommunication: false,
    });

    // La suppression n'existe jamais dans le produit (archivage seulement, ADR-012) — vérifiée ici
    // parce que la FK doit rester correcte si une purge technique a lieu un jour.
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, acquereurId));

    const restantes = await getDb().select().from(reperesTable).where(eq(reperesTable.acquereurId, acquereurId));
    expect(restantes).toHaveLength(0);
  });

  it("une catégorie ou une provenance hors liste est refusée par la base elle-même", async () => {
    const acquereurId = await creerAcquereurDeTest("CHECK");
    await expect(
      getDb()
        .insert(reperesTable)
        .values({ acquereurId, categorie: "sante", libelle: "x", provenance: "saisi_par_le_conseiller" })
    ).rejects.toThrow();
    await expect(
      getDb()
        .insert(reperesTable)
        .values({ acquereurId, categorie: "autre", libelle: "x", provenance: "trouve_sur_internet" })
    ).rejects.toThrow();
  });
});
