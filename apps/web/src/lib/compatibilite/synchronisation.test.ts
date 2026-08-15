import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";

// Test d'intégration réel (ADR-036) : vraie base Postgres, comme orchestration.test.ts
// (ADR-034/035). Couvre la matrice de transitions, les cycles, l'isolation par paire, la
// concurrence, l'absence d'appel réseau et l'absence de tout effet commercial (tâche/email).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compatibilitesBienAcquereurEtat,
  evenementsMetier,
  executionsAutomatisation,
} = await import("@/db/schema");
const { creerBien, modifierBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { ajouterSecteurRecherche, supprimerSecteurRecherche } = await import("@/lib/secteurRechercheRepository");
const { synchroniserCompatibilitesPourBien, synchroniserCompatibilitesPourAcquereur } = await import("./synchronisation");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

// La synchronisation d'UN bien de test évalue TOUS les acquéreurs actifs persistés (et
// réciproquement) — pas seulement ceux créés par ce fichier. Le nettoyage doit donc purger toute
// ligne technique référençant SOIT un bien SOIT un acquéreur créé ici, jamais seulement un côté,
// avant de supprimer les entités elles-mêmes (même ordre imposé par FK que
// evenementMetierRepository.test.ts).
afterAll(async () => {
  if (idsBiensCrees.length > 0 || idsAcquereursCrees.length > 0) {
    const filtre = or(inArray(evenementsMetier.bienId, idsBiensCrees), inArray(evenementsMetier.acquereurId, idsAcquereursCrees));
    await getDb().delete(evenementsMetier).where(filtre);
    const filtreEtat = or(
      inArray(compatibilitesBienAcquereurEtat.bienId, idsBiensCrees),
      inArray(compatibilitesBienAcquereurEtat.acquereurId, idsAcquereursCrees)
    );
    await getDb().delete(compatibilitesBienAcquereurEtat).where(filtreEtat);
  }
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function creerBienDeTest(suffixe: string, surcharge: Partial<Parameters<typeof creerBien>[0]> = {}) {
  const bien = await creerBien({
    reference: `[test réel] SYNCHRO-${suffixe}`,
    titre: "Bien de test synchronisation",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 3,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...surcharge,
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerAcquereurDeTest(suffixe: string, surcharge: Partial<Parameters<typeof creerAcquereur>[0]> = {}) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Synchro ${suffixe}`,
    email: `test-réel-synchro-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
    ...surcharge,
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

async function lireEtat(bienId: string, acquereurId: string) {
  const [ligne] = await getDb()
    .select()
    .from(compatibilitesBienAcquereurEtat)
    .where(and(eq(compatibilitesBienAcquereurEtat.bienId, bienId), eq(compatibilitesBienAcquereurEtat.acquereurId, acquereurId)));
  return ligne;
}

async function lireEvenements(bienId: string, acquereurId: string) {
  return getDb()
    .select()
    .from(evenementsMetier)
    .where(
      and(
        eq(evenementsMetier.typeEvenement, "compatibilite_bien_acquereur_devenue_compatible"),
        eq(evenementsMetier.bienId, bienId),
        eq(evenementsMetier.acquereurId, acquereurId)
      )
    )
    .orderBy(evenementsMetier.cycleCompatibilite);
}

describe("synchroniserCompatibilitesPourBien — matrice de transitions", () => {
  it("incompatible → compatible : cycle 1, 1 événement", async () => {
    const acquereur = await creerAcquereurDeTest("T1", { budgetMax: 400000 });
    const bien = await creerBienDeTest("T1", { prix: 500000 }); // > budgetMax → incompatible

    await synchroniserCompatibilitesPourBien(bien.id);
    expect((await lireEtat(bien.id, acquereur.id))?.dernierStatut).toBe("incompatible");
    expect((await lireEtat(bien.id, acquereur.id))?.cycleCompatibilite).toBe(0);
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(0);

    await modifierBien(bien.id, { ...donneesBase(bien), prix: 350000 }); // <= budgetMax → compatible
    await synchroniserCompatibilitesPourBien(bien.id);

    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.dernierStatut).toBe("compatible");
    expect(etat?.cycleCompatibilite).toBe(1);
    const evenements = await lireEvenements(bien.id, acquereur.id);
    expect(evenements).toHaveLength(1);
    expect(evenements[0].cycleCompatibilite).toBe(1);
  });

  it("a_verifier → compatible : cycle 1, 1 événement", async () => {
    // necessiteParking=true + bien.parking non renseigné (undefined) → critère parking a_verifier,
    // aucun critère incompatible → statut global a_verifier.
    const acquereur = await creerAcquereurDeTest("T2", { budgetMax: 400000, necessiteParking: true });
    const bien = await creerBienDeTest("T2", { prix: 300000 }); // parking non renseigné

    await synchroniserCompatibilitesPourBien(bien.id);
    expect((await lireEtat(bien.id, acquereur.id))?.dernierStatut).toBe("a_verifier");
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(0);

    await modifierBien(bien.id, { ...donneesBase(bien), parking: true }); // devient compatible
    await synchroniserCompatibilitesPourBien(bien.id);
    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.dernierStatut).toBe("compatible");
    expect(etat?.cycleCompatibilite).toBe(1);
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);
  });

  it("compatible → compatible : aucun nouvel événement, cycle inchangé", async () => {
    const acquereur = await creerAcquereurDeTest("T3", { budgetMax: 400000 });
    const bien = await creerBienDeTest("T3", { prix: 300000 }); // compatible dès la première observation

    await synchroniserCompatibilitesPourBien(bien.id);
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);

    await synchroniserCompatibilitesPourBien(bien.id);

    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.cycleCompatibilite).toBe(1);
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);
  });

  it("compatible → incompatible : aucun événement, état mis à jour", async () => {
    const acquereur = await creerAcquereurDeTest("T4", { budgetMax: 400000 });
    const bien = await creerBienDeTest("T4", { prix: 300000 });
    await synchroniserCompatibilitesPourBien(bien.id); // compatible, cycle 1

    await modifierBien(bien.id, { ...donneesBase(bien), prix: 500000 }); // devient incompatible
    await synchroniserCompatibilitesPourBien(bien.id);

    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.dernierStatut).toBe("incompatible");
    expect(etat?.cycleCompatibilite).toBe(1); // jamais réinitialisé à la sortie
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1); // toujours celui de l'entrée
  });

  it("compatible → a_verifier : aucun événement, état mis à jour", async () => {
    const acquereur = await creerAcquereurDeTest("T5", { budgetMax: 400000, necessiteParking: true });
    const bien = await creerBienDeTest("T5", { prix: 300000, parking: true }); // compatible dès le départ
    await synchroniserCompatibilitesPourBien(bien.id);

    await modifierBien(bien.id, { ...donneesBase(bien), parking: undefined }); // parking devient inconnu → a_verifier
    await synchroniserCompatibilitesPourBien(bien.id);
    expect((await lireEtat(bien.id, acquereur.id))?.dernierStatut).toBe("a_verifier");
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1); // toujours celui de l'entrée
  });

  it("compatible → incompatible → compatible : second cycle, second événement", async () => {
    const acquereur = await creerAcquereurDeTest("T6", { budgetMax: 400000 });
    const bien = await creerBienDeTest("T6", { prix: 300000 });
    await synchroniserCompatibilitesPourBien(bien.id); // cycle 1
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);

    await modifierBien(bien.id, { ...donneesBase(bien), prix: 500000 });
    await synchroniserCompatibilitesPourBien(bien.id);
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1); // toujours 1, aucun événement de sortie

    await modifierBien(bien.id, { ...donneesBase(bien), prix: 300000 });
    await synchroniserCompatibilitesPourBien(bien.id); // cycle 2

    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.cycleCompatibilite).toBe(2);
    const evenements = await lireEvenements(bien.id, acquereur.id);
    expect(evenements).toHaveLength(2);
    expect(evenements.map((e) => e.cycleCompatibilite)).toEqual([1, 2]);
  });

  it("première observation compatible dès la création (hors baseline) : cycle 1, 1 événement — une vraie opportunité", async () => {
    const acquereur = await creerAcquereurDeTest("T7", { budgetMax: 400000 });
    const bien = await creerBienDeTest("T7", { prix: 300000 });

    await synchroniserCompatibilitesPourBien(bien.id);
    expect((await lireEtat(bien.id, acquereur.id))?.cycleCompatibilite).toBe(1);
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);
  });

  it("retry exact de la même mutation (rejeu du même statut) : aucun événement supplémentaire", async () => {
    const acquereur = await creerAcquereurDeTest("T8", { budgetMax: 400000 });
    const bien = await creerBienDeTest("T8", { prix: 300000 });
    await synchroniserCompatibilitesPourBien(bien.id);
    await synchroniserCompatibilitesPourBien(bien.id);
    await synchroniserCompatibilitesPourBien(bien.id);

    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);
  });

  it("deux synchronisations concurrentes de la même paire : un seul cycle, un seul événement", async () => {
    const acquereur = await creerAcquereurDeTest("T9", { budgetMax: 400000 });
    const bien = await creerBienDeTest("T9", { prix: 500000 });
    await synchroniserCompatibilitesPourBien(bien.id); // incompatible, cycle 0

    await modifierBien(bien.id, { ...donneesBase(bien), prix: 300000 }); // devient compatible
    await Promise.all([synchroniserCompatibilitesPourBien(bien.id), synchroniserCompatibilitesPourBien(bien.id)]);

    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.cycleCompatibilite).toBe(1);
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);
  });

  it("mutation d'un bien affectant plusieurs acquéreurs : chacun évalué, événements uniquement pour les transitions réelles", async () => {
    const bien = await creerBienDeTest("T10", { prix: 300000 });
    const compatible1 = await creerAcquereurDeTest("T10a", { budgetMax: 400000 });
    const compatible2 = await creerAcquereurDeTest("T10b", { budgetMax: 350000 });
    const incompatible = await creerAcquereurDeTest("T10c", { budgetMax: 100000 });

    const resultat = await synchroniserCompatibilitesPourBien(bien.id);
    expect(resultat.pairesTraitees).toBeGreaterThanOrEqual(3);
    expect(resultat.evenementsEmis).toBeGreaterThanOrEqual(2);

    expect((await lireEtat(bien.id, compatible1.id))?.dernierStatut).toBe("compatible");
    expect((await lireEtat(bien.id, compatible2.id))?.dernierStatut).toBe("compatible");
    expect((await lireEtat(bien.id, incompatible.id))?.dernierStatut).toBe("incompatible");
  });
});

describe("synchroniserCompatibilitesPourAcquereur — symétrie et secteurs (ADR-035)", () => {
  it("mutation d'un acquéreur affectant plusieurs biens : chacun évalué", async () => {
    const acquereur = await creerAcquereurDeTest("T11", { budgetMax: 350000 });
    const bienCompatible = await creerBienDeTest("T11a", { prix: 300000 });
    const bienIncompatible = await creerBienDeTest("T11b", { prix: 500000 });

    await synchroniserCompatibilitesPourAcquereur(acquereur.id);
    expect((await lireEtat(bienCompatible.id, acquereur.id))?.dernierStatut).toBe("compatible");
    expect((await lireEtat(bienIncompatible.id, acquereur.id))?.dernierStatut).toBe("incompatible");
    expect(await lireEvenements(bienCompatible.id, acquereur.id)).toHaveLength(1);
    expect(await lireEvenements(bienIncompatible.id, acquereur.id)).toHaveLength(0);
  });

  it("ajout de secteur crée un nouveau match ; suppression en sort ; réajout crée un nouveau cycle", async () => {
    const bien = await creerBienDeTest("T12", { prix: 300000, codeInseeCommune: "78311" });
    const acquereur = await creerAcquereurDeTest("T12", { budgetMax: 400000 });

    // Secteur non correspondant : le critère géographique est incompatible → global incompatible.
    await ajouterSecteurRecherche(acquereur.id, { citycode: "75056", nom: "Paris", codePostal: "75001", contexte: "" });
    await synchroniserCompatibilitesPourAcquereur(acquereur.id);
    expect((await lireEtat(bien.id, acquereur.id))?.dernierStatut).toBe("incompatible");
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(0);

    // Ajout du secteur correspondant : devient compatible → nouveau match, cycle 1.
    const secteurCorrespondant = await ajouterSecteurRecherche(acquereur.id, {
      citycode: "78311",
      nom: "Houilles",
      codePostal: "78800",
      contexte: "",
    });
    await synchroniserCompatibilitesPourAcquereur(acquereur.id);
    expect((await lireEtat(bien.id, acquereur.id))?.cycleCompatibilite).toBe(1);
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1);

    // Suppression du secteur correspondant : redevient incompatible (le secteur Paris reste seul).
    await supprimerSecteurRecherche(secteurCorrespondant.id, acquereur.id);
    await synchroniserCompatibilitesPourAcquereur(acquereur.id);
    expect((await lireEtat(bien.id, acquereur.id))?.dernierStatut).toBe("incompatible");
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(1); // toujours celui de l'entrée

    // Réajout : nouveau cycle, nouvel événement.
    await ajouterSecteurRecherche(acquereur.id, { citycode: "78311", nom: "Houilles", codePostal: "78800", contexte: "" });
    await synchroniserCompatibilitesPourAcquereur(acquereur.id);
    const etatFinal = await lireEtat(bien.id, acquereur.id);
    expect(etatFinal?.cycleCompatibilite).toBe(2);
    expect(await lireEvenements(bien.id, acquereur.id)).toHaveLength(2);
  });
});

describe("synchronisation — hors périmètre commercial (ADR-036, aucun effet secondaire)", () => {
  it("aucun appel réseau (IGN ou autre) pendant la synchronisation", async () => {
    const acquereur = await creerAcquereurDeTest("T13", { budgetMax: 400000 });
    const bien = await creerBienDeTest("T13", { prix: 300000 });
    const fetchMock = vi.fn(() => {
      throw new Error("aucun appel réseau ne devrait jamais avoir lieu ici");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(synchroniserCompatibilitesPourBien(bien.id)).resolves.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un nouveau match ne prépare aucune exécution d'automatisation (aucune règle ADR-032 ne référence encore ce type d'événement)", async () => {
    const acquereur = await creerAcquereurDeTest("T14", { budgetMax: 400000 });
    const bien = await creerBienDeTest("T14", { prix: 300000 });
    await synchroniserCompatibilitesPourBien(bien.id);

    const [evenement] = await lireEvenements(bien.id, acquereur.id);
    expect(evenement).toBeDefined();
    const executions = await getDb()
      .select()
      .from(executionsAutomatisation)
      .where(eq(executionsAutomatisation.evenementId, evenement.id));
    expect(executions).toHaveLength(0); // donc : aucune tâche, aucun email possible pour cet événement
  });

  it("l'événement ne porte que des identifiants — aucune donnée texte libre ni PII (budget/nom/email absents du schéma de la table)", async () => {
    const acquereur = await creerAcquereurDeTest("T15", { budgetMax: 400000 });
    const bien = await creerBienDeTest("T15", { prix: 300000 });
    await synchroniserCompatibilitesPourBien(bien.id);

    const [evenement] = await lireEvenements(bien.id, acquereur.id);
    expect(evenement.bienId).toBe(bien.id);
    expect(evenement.acquereurId).toBe(acquereur.id);
    expect(evenement.cycleCompatibilite).toBe(1);
    expect(evenement.compteRenduVisiteId).toBeNull();
    expect(evenement.prospectVendeurId).toBeNull();
    expect(evenement.compromisId).toBeNull();
  });
});

// Reconstruit les champs requis de NouveauBien à partir du Bien retourné par creerBien/creerBienDeTest.
function donneesBase(bien: Awaited<ReturnType<typeof creerBien>>): Parameters<typeof modifierBien>[1] {
  return {
    reference: bien.reference,
    titre: bien.titre,
    type: bien.type,
    adresse: bien.adresse,
    ville: bien.ville,
    codePostal: bien.codePostal,
    surface: bien.surface,
    pieces: bien.pieces,
    prix: bien.prix,
    statutMandat: bien.statutMandat,
    dateMandat: bien.dateMandat,
    caracteristiques: bien.caracteristiques,
    description: bien.description,
    etage: bien.etage,
    ascenseur: bien.ascenseur,
    parking: bien.parking,
    exterieur: bien.exterieur,
    codeInseeCommune: bien.codeInseeCommune,
    nomCopropriete: bien.nomCopropriete,
    chargeHonoraires: bien.chargeHonoraires,
  };
}
