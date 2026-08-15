import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : base Postgres réelle, IGN mocké (ADR-035, section 8 — validation serveur
// obligatoire, jamais une confiance aveugle dans les valeurs soumises par le client).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  secteursRechercheAcquereur: secteursTable,
  compatibilitesARessynchroniser,
  compatibilitesBienAcquereurEtat,
  evenementsMetier,
} = await import("@/db/schema");
const { inArray } = await import("drizzle-orm");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { listerSecteursPourAcquereur } = await import("@/lib/secteurRechercheRepository");
const { ajouterSecteurRechercheAction, supprimerSecteurRechercheAction } = await import("./secteurRecherche");

const idsAcquereursCrees: string[] = [];

// ajouterSecteurRechercheAction/supprimerSecteurRechercheAction enqueue désormais une demande de
// resynchronisation (ADR-036) DANS LA MÊME transaction — mêmes lignes techniques à purger avant
// l'acquéreur, même ordre que evenementMetierRepository.test.ts.
afterAll(async () => {
  if (idsAcquereursCrees.length > 0) {
    await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.acquereurId, idsAcquereursCrees));
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(inArray(compatibilitesBienAcquereurEtat.acquereurId, idsAcquereursCrees));
    await getDb()
      .delete(compatibilitesARessynchroniser)
      .where(inArray(compatibilitesARessynchroniser.acquereurId, idsAcquereursCrees));
  }
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function reponseIgn(citycode: string, nom: string, postcode = "78800"): Response {
  return new Response(
    JSON.stringify({
      features: [
        {
          geometry: { coordinates: [2.18, 48.92] },
          properties: { score: 0.95, label: nom, citycode, city: nom, postcode, context: "78, Yvelines" },
        },
      ],
    }),
    { status: 200 }
  );
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

async function creerAcquereurDeTest(suffixe: string) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] SecteurAction ${suffixe}`,
    email: `test-réel-secteur-action-${suffixe}@example.com`,
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

describe("ajouterSecteurRechercheAction — validation serveur obligatoire (ADR-035, section 8)", () => {
  it("persiste le secteur avec les valeurs FRAÎCHEMENT vérifiées par l'IGN, pas les valeurs soumises", async () => {
    const acquereur = await creerAcquereurDeTest("001");
    // L'IGN, interrogé fraîchement, renvoie "Houilles" / "78800" — même si le client avait soumis
    // un nomCommune légèrement différent (ex. mise en cache obsolète côté navigateur), ce sont les
    // valeurs de la vérification serveur qui sont persistées, jamais celles soumises.
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn("78311", "Houilles", "78800")));

    const resultat = await ajouterSecteurRechercheAction(
      null,
      // Le client soumet volontairement un nomCommune légèrement différent de ce que l'IGN va
      // renvoyer — la vérification reste tolérante à cette différence de libellé (le filtre côté
      // IGN porte sur citycode, pas sur une correspondance exacte de texte), mais la valeur
      // PERSISTÉE doit être celle de l'IGN, jamais celle-ci.
      formData({ acquereurId: acquereur.id, codeInsee: "78311", nomCommune: "Houilles (soumis par le client)" })
    );

    expect(resultat.statut).toBe("succes");
    if (resultat.statut === "succes") {
      expect(resultat.secteur.nomCommune).toBe("Houilles");
      expect(resultat.secteur.nomCommune).not.toBe("Houilles (soumis par le client)");
      expect(resultat.secteur.codePostal).toBe("78800");
    }

    const secteurs = await listerSecteursPourAcquereur(acquereur.id);
    expect(secteurs).toHaveLength(1);
  });

  it("rejette (erreur actionnable, aucune écriture) si l'IGN ne confirme pas la sélection", async () => {
    const acquereur = await creerAcquereurDeTest("002");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }), { status: 200 })));

    const resultat = await ajouterSecteurRechercheAction(
      null,
      formData({ acquereurId: acquereur.id, codeInsee: "78311", nomCommune: "Houilles" })
    );

    expect(resultat.statut).toBe("erreur");
    const secteurs = await listerSecteursPourAcquereur(acquereur.id);
    expect(secteurs).toHaveLength(0);
  });

  it("rejette (erreur actionnable, aucune écriture) si l'IGN est indisponible (panne réseau)", async () => {
    const acquereur = await creerAcquereurDeTest("003");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const resultat = await ajouterSecteurRechercheAction(
      null,
      formData({ acquereurId: acquereur.id, codeInsee: "78311", nomCommune: "Houilles" })
    );

    expect(resultat.statut).toBe("erreur");
    const secteurs = await listerSecteursPourAcquereur(acquereur.id);
    expect(secteurs).toHaveLength(0);
  });

  it("rejette l'ajout à un acquéreur archivé", async () => {
    const acquereur = await creerAcquereurDeTest("004");
    await archiverAcquereur(acquereur.id);
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn("78311", "Houilles")));

    const resultat = await ajouterSecteurRechercheAction(
      null,
      formData({ acquereurId: acquereur.id, codeInsee: "78311", nomCommune: "Houilles" })
    );

    expect(resultat.statut).toBe("erreur");
  });

  it("rejette une sélection incomplète (codeInsee/nomCommune manquants) sans jamais appeler l'IGN", async () => {
    const acquereur = await creerAcquereurDeTest("005");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultat = await ajouterSecteurRechercheAction(null, formData({ acquereurId: acquereur.id }));

    expect(resultat.statut).toBe("erreur");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un doublon (même acquéreur, même citycode) est rejeté avec un message actionnable", async () => {
    const acquereur = await creerAcquereurDeTest("006");
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn("78311", "Houilles")));

    const premier = await ajouterSecteurRechercheAction(
      null,
      formData({ acquereurId: acquereur.id, codeInsee: "78311", nomCommune: "Houilles" })
    );
    expect(premier.statut).toBe("succes");

    const deuxieme = await ajouterSecteurRechercheAction(
      null,
      formData({ acquereurId: acquereur.id, codeInsee: "78311", nomCommune: "Houilles" })
    );
    expect(deuxieme.statut).toBe("erreur");
    if (deuxieme.statut === "erreur") {
      expect(deuxieme.message).toContain("déjà enregistrée");
    }

    const secteurs = await listerSecteursPourAcquereur(acquereur.id);
    expect(secteurs).toHaveLength(1);
  });
});

describe("supprimerSecteurRechercheAction", () => {
  it("supprime le secteur et redirige (NEXT_REDIRECT avalé par le test)", async () => {
    const acquereur = await creerAcquereurDeTest("007");
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn("78311", "Houilles")));
    const ajout = await ajouterSecteurRechercheAction(
      null,
      formData({ acquereurId: acquereur.id, codeInsee: "78311", nomCommune: "Houilles" })
    );
    if (ajout.statut !== "succes") throw new Error("setup: ajout attendu en succès");

    await supprimerSecteurRechercheAction(formData({ id: ajout.secteur.id, acquereurId: acquereur.id })).catch(
      () => {}
    );

    const secteurs = await listerSecteursPourAcquereur(acquereur.id);
    expect(secteurs).toHaveLength(0);
  });

  it("ne supprime jamais le secteur d'un autre acquéreur (scoping tenant)", async () => {
    const acquereurA = await creerAcquereurDeTest("008a");
    const acquereurB = await creerAcquereurDeTest("008b");
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn("78311", "Houilles")));
    const ajout = await ajouterSecteurRechercheAction(
      null,
      formData({ acquereurId: acquereurA.id, codeInsee: "78311", nomCommune: "Houilles" })
    );
    if (ajout.statut !== "succes") throw new Error("setup: ajout attendu en succès");

    await supprimerSecteurRechercheAction(formData({ id: ajout.secteur.id, acquereurId: acquereurB.id })).catch(
      () => {}
    );

    const secteursA = await listerSecteursPourAcquereur(acquereurA.id);
    expect(secteursA).toHaveLength(1);
  });

  it("rejette un identifiant manquant", async () => {
    await expect(supprimerSecteurRechercheAction(formData({}))).rejects.toThrow(/[Ii]dentifiant/);
  });
});
