import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : exerce la vraie base Postgres locale.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable, secteursRechercheAcquereur: secteursTable } = await import("@/db/schema");
const { creerAcquereur } = await import("./clientRepository");
const {
  listerSecteursPourAcquereur,
  listerSecteursPourAcquereurs,
  ajouterSecteurRecherche,
  supprimerSecteurRecherche,
} = await import("./secteurRechercheRepository");

const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

async function creerAcquereurDeTest(suffixe: string) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Secteur ${suffixe}`,
    email: `test-réel-secteur-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

const HOUILLES = { citycode: "78311", nom: "Houilles", codePostal: "78800", contexte: "78, Yvelines" };
const CARRIERES = { citycode: "78124", nom: "Carrières-sur-Seine", codePostal: "78420", contexte: "78, Yvelines" };

describe("secteurRechercheRepository (intégration Postgres)", () => {
  it("ajouterSecteurRecherche() persiste un secteur pour un acquéreur", async () => {
    const acquereur = await creerAcquereurDeTest("001");
    const secteur = await ajouterSecteurRecherche(acquereur.id, HOUILLES);
    expect(secteur.acquereurId).toBe(acquereur.id);
    expect(secteur.codeInsee).toBe("78311");
    expect(secteur.nomCommune).toBe("Houilles");
    expect(secteur.codePostal).toBe("78800");
  });

  it("listerSecteursPourAcquereur() retourne les secteurs de cet acquéreur uniquement", async () => {
    const acquereurA = await creerAcquereurDeTest("002a");
    const acquereurB = await creerAcquereurDeTest("002b");
    await ajouterSecteurRecherche(acquereurA.id, HOUILLES);
    await ajouterSecteurRecherche(acquereurB.id, CARRIERES);

    const secteursA = await listerSecteursPourAcquereur(acquereurA.id);
    expect(secteursA).toHaveLength(1);
    expect(secteursA[0].codeInsee).toBe("78311");
  });

  it("un acquéreur peut avoir plusieurs secteurs", async () => {
    const acquereur = await creerAcquereurDeTest("003");
    await ajouterSecteurRecherche(acquereur.id, HOUILLES);
    await ajouterSecteurRecherche(acquereur.id, CARRIERES);

    const secteurs = await listerSecteursPourAcquereur(acquereur.id);
    expect(secteurs.map((s) => s.codeInsee).sort()).toEqual(["78124", "78311"]);
  });

  it("contrainte UNIQUE(acquereur_id, code_insee) : un doublon échoue", async () => {
    const acquereur = await creerAcquereurDeTest("004");
    await ajouterSecteurRecherche(acquereur.id, HOUILLES);
    await expect(ajouterSecteurRecherche(acquereur.id, HOUILLES)).rejects.toThrow();
  });

  it("le même citycode reste ajoutable pour deux acquéreurs différents (unicité scoped par acquéreur)", async () => {
    const acquereurA = await creerAcquereurDeTest("005a");
    const acquereurB = await creerAcquereurDeTest("005b");
    await ajouterSecteurRecherche(acquereurA.id, HOUILLES);
    await expect(ajouterSecteurRecherche(acquereurB.id, HOUILLES)).resolves.toBeDefined();
  });

  it("supprimerSecteurRecherche() retire le secteur quand il appartient bien à l'acquéreur", async () => {
    const acquereur = await creerAcquereurDeTest("006");
    const secteur = await ajouterSecteurRecherche(acquereur.id, HOUILLES);

    const supprime = await supprimerSecteurRecherche(secteur.id, acquereur.id);
    expect(supprime?.id).toBe(secteur.id);

    const restants = await listerSecteursPourAcquereur(acquereur.id);
    expect(restants).toHaveLength(0);
  });

  it("supprimerSecteurRecherche() ne retire jamais un secteur appartenant à un autre acquéreur (scoping tenant)", async () => {
    const acquereurA = await creerAcquereurDeTest("007a");
    const acquereurB = await creerAcquereurDeTest("007b");
    const secteurDeA = await ajouterSecteurRecherche(acquereurA.id, HOUILLES);

    const resultat = await supprimerSecteurRecherche(secteurDeA.id, acquereurB.id);
    expect(resultat).toBeUndefined();

    const secteursDeA = await listerSecteursPourAcquereur(acquereurA.id);
    expect(secteursDeA).toHaveLength(1);
  });

  it("suppression de l'acquéreur (CASCADE) supprime ses secteurs — vérifie la FK ON DELETE CASCADE", async () => {
    const acquereur = await creerAcquereurDeTest("008");
    await ajouterSecteurRecherche(acquereur.id, HOUILLES);

    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, acquereur.id));
    idsAcquereursCrees.splice(idsAcquereursCrees.indexOf(acquereur.id), 1);

    const lignesRestantes = await getDb().select().from(secteursTable).where(eq(secteursTable.acquereurId, acquereur.id));
    expect(lignesRestantes).toHaveLength(0);
  });

  it("listerSecteursPourAcquereurs() charge plusieurs acquéreurs en une seule requête groupée", async () => {
    const acquereurA = await creerAcquereurDeTest("009a");
    const acquereurB = await creerAcquereurDeTest("009b");
    const acquereurC = await creerAcquereurDeTest("009c");
    await ajouterSecteurRecherche(acquereurA.id, HOUILLES);
    await ajouterSecteurRecherche(acquereurB.id, CARRIERES);
    // acquereurC n'a aucun secteur.

    const groupe = await listerSecteursPourAcquereurs([acquereurA.id, acquereurB.id, acquereurC.id]);
    expect(groupe.get(acquereurA.id)?.map((s) => s.codeInsee)).toEqual(["78311"]);
    expect(groupe.get(acquereurB.id)?.map((s) => s.codeInsee)).toEqual(["78124"]);
    expect(groupe.get(acquereurC.id)).toBeUndefined();
  });

  it("listerSecteursPourAcquereurs([]) retourne une Map vide sans requête", async () => {
    const groupe = await listerSecteursPourAcquereurs([]);
    expect(groupe.size).toBe(0);
  });
});
