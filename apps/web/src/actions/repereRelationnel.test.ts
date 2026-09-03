import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";

// Comportement métier des Server Actions VALUE-06, session Atlas mockée valide — le refus anonyme
// est déjà garanti exhaustivement par src/actions/gardeSessionAtlas.structurel.test.ts.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable, reperesRelationnelsAcquereur: reperesTable } = await import("@/db/schema");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { archiverAcquereur } = await import("@/lib/clientRepository");
const {
  listerReperesRelationnelsAcquereur,
  listerReperesRelationnelsArchivesAcquereur,
} = await import("@/lib/repereRelationnelRepository");
const {
  ajouterRepereRelationnelAction,
  archiverRepereRelationnelAction,
  modifierRepereRelationnelAction,
  restaurerRepereRelationnelAction,
} = await import("./repereRelationnel");
const { LONGUEUR_MAX_LIBELLE_REPERE } = await import("@/types/repereRelationnel");

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
    nom: `[test réel] Action repères ${suffixe}`,
    email: `action.reperes.${suffixe.toLowerCase()}@example.com`,
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

function formulaire(champs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) formData.set(cle, valeur);
  return formData;
}

describe("ajouterRepereRelationnelAction — création", () => {
  it("crée le repère et le rend visible sur l'acquéreur", async () => {
    const acquereurId = await creerAcquereurDeTest("OK");
    const resultat = await ajouterRepereRelationnelAction(
      null,
      formulaire({
        acquereurId,
        categorie: "preference_contact",
        libelle: "  Préfère les échanges par email  ",
        provenance: "indique_par_le_client",
      })
    );

    expect(resultat.statut).toBe("succes");
    const actifs = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(actifs).toHaveLength(1);
    // `trim` seul : le texte du conseiller n'est jamais réécrit ni interprété.
    expect(actifs[0].libelle).toBe("Préfère les échanges par email");
  });

  it("case d'autorisation absente du formulaire : utilisableCommunication reste false", async () => {
    const acquereurId = await creerAcquereurDeTest("NON-COCHE");
    await ajouterRepereRelationnelAction(
      null,
      formulaire({
        acquereurId,
        categorie: "centre_interet",
        libelle: "Football",
        provenance: "observe_lors_d_un_echange",
      })
    );

    const [repere] = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(repere.utilisableCommunication).toBe(false);
  });

  it("case explicitement cochée : autorisation persistée à true", async () => {
    const acquereurId = await creerAcquereurDeTest("COCHE");
    await ajouterRepereRelationnelAction(
      null,
      formulaire({
        acquereurId,
        categorie: "preference_contact",
        libelle: "Préfère les échanges par email",
        provenance: "indique_par_le_client",
        utilisableCommunication: "on",
      })
    );

    const [repere] = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(repere.utilisableCommunication).toBe(true);
  });
});

describe("ajouterRepereRelationnelAction — validations, jamais d'écriture douteuse", () => {
  it("catégorie hors liste : refusée, aucune écriture", async () => {
    const acquereurId = await creerAcquereurDeTest("CAT-KO");
    const resultat = await ajouterRepereRelationnelAction(
      null,
      formulaire({ acquereurId, categorie: "sante", libelle: "x", provenance: "saisi_par_le_conseiller" })
    );

    expect(resultat).toMatchObject({ statut: "erreur" });
    expect(await listerReperesRelationnelsAcquereur(acquereurId)).toHaveLength(0);
  });

  it("provenance hors liste : refusée, aucune écriture", async () => {
    const acquereurId = await creerAcquereurDeTest("PROV-KO");
    const resultat = await ajouterRepereRelationnelAction(
      null,
      formulaire({ acquereurId, categorie: "autre", libelle: "x", provenance: "trouve_sur_internet" })
    );

    expect(resultat).toMatchObject({ statut: "erreur" });
    expect(await listerReperesRelationnelsAcquereur(acquereurId)).toHaveLength(0);
  });

  it("libellé vide ou uniquement des espaces : refusé", async () => {
    const acquereurId = await creerAcquereurDeTest("VIDE");
    const resultat = await ajouterRepereRelationnelAction(
      null,
      formulaire({ acquereurId, categorie: "autre", libelle: "   ", provenance: "saisi_par_le_conseiller" })
    );

    expect(resultat).toMatchObject({ statut: "erreur" });
    expect(await listerReperesRelationnelsAcquereur(acquereurId)).toHaveLength(0);
  });

  it("libellé au-delà de la limite : refusé, jamais tronqué silencieusement", async () => {
    const acquereurId = await creerAcquereurDeTest("LONG");
    const resultat = await ajouterRepereRelationnelAction(
      null,
      formulaire({
        acquereurId,
        categorie: "autre",
        libelle: "a".repeat(LONGUEUR_MAX_LIBELLE_REPERE + 1),
        provenance: "saisi_par_le_conseiller",
      })
    );

    expect(resultat).toMatchObject({ statut: "erreur" });
    expect(await listerReperesRelationnelsAcquereur(acquereurId)).toHaveLength(0);
  });

  it("acquéreur inexistant : refusé", async () => {
    const resultat = await ajouterRepereRelationnelAction(
      null,
      formulaire({
        acquereurId: "00000000-0000-0000-0000-000000000000",
        categorie: "autre",
        libelle: "x",
        provenance: "saisi_par_le_conseiller",
      })
    );

    expect(resultat).toMatchObject({ statut: "erreur" });
  });

  it("acquéreur archivé : aucun nouveau repère", async () => {
    const acquereurId = await creerAcquereurDeTest("ARCHIVE-CIBLE");
    await archiverAcquereur(acquereurId);

    const resultat = await ajouterRepereRelationnelAction(
      null,
      formulaire({ acquereurId, categorie: "autre", libelle: "x", provenance: "saisi_par_le_conseiller" })
    );

    expect(resultat).toMatchObject({ statut: "erreur" });
    expect(await listerReperesRelationnelsAcquereur(acquereurId)).toHaveLength(0);
  });
});

describe("modifierRepereRelationnelAction", () => {
  it("corrige les quatre champs et pose modifieLe", async () => {
    const acquereurId = await creerAcquereurDeTest("MODIF");
    await ajouterRepereRelationnelAction(
      null,
      formulaire({ acquereurId, categorie: "autre", libelle: "Préfère l'email", provenance: "saisi_par_le_conseiller" })
    );
    const [avant] = await listerReperesRelationnelsAcquereur(acquereurId);

    const resultat = await modifierRepereRelationnelAction(
      null,
      formulaire({
        id: avant.id,
        acquereurId,
        categorie: "preference_contact",
        libelle: "Préfère les échanges par email",
        provenance: "indique_par_le_client",
        utilisableCommunication: "on",
      })
    );

    expect(resultat.statut).toBe("succes");
    const [apres] = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(apres.categorie).toBe("preference_contact");
    expect(apres.libelle).toBe("Préfère les échanges par email");
    expect(apres.provenance).toBe("indique_par_le_client");
    expect(apres.utilisableCommunication).toBe(true);
    expect(apres.modifieLe).toBeDefined();
    expect(apres.creeLe).toBe(avant.creeLe);
  });

  it("retirer l'autorisation est possible : la case décochée repasse à false", async () => {
    const acquereurId = await creerAcquereurDeTest("RETRAIT");
    await ajouterRepereRelationnelAction(
      null,
      formulaire({
        acquereurId,
        categorie: "centre_interet",
        libelle: "Football",
        provenance: "observe_lors_d_un_echange",
        utilisableCommunication: "on",
      })
    );
    const [avant] = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(avant.utilisableCommunication).toBe(true);

    await modifierRepereRelationnelAction(
      null,
      formulaire({
        id: avant.id,
        acquereurId,
        categorie: "centre_interet",
        libelle: "Football",
        provenance: "observe_lors_d_un_echange",
      })
    );

    const [apres] = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(apres.utilisableCommunication).toBe(false);
  });
});

describe("archiverRepereRelationnelAction / restaurerRepereRelationnelAction", () => {
  it("archiver retire de la liste active, restaurer l'y ramène", async () => {
    const acquereurId = await creerAcquereurDeTest("CYCLE");
    await ajouterRepereRelationnelAction(
      null,
      formulaire({ acquereurId, categorie: "autre", libelle: "Rappel le matin", provenance: "indique_par_le_client" })
    );
    const [repere] = await listerReperesRelationnelsAcquereur(acquereurId);

    // redirect() attendu — jamais un succès silencieux sans navigation.
    await archiverRepereRelationnelAction(formulaire({ id: repere.id, acquereurId })).catch(() => {});
    expect(await listerReperesRelationnelsAcquereur(acquereurId)).toHaveLength(0);
    expect(await listerReperesRelationnelsArchivesAcquereur(acquereurId)).toHaveLength(1);

    await restaurerRepereRelationnelAction(formulaire({ id: repere.id, acquereurId })).catch(() => {});
    expect(await listerReperesRelationnelsAcquereur(acquereurId)).toHaveLength(1);
  });

  // Non-régression du scénario joué sur la demo (VALUE-06B) : la provenance affichée après
  // restauration avait été lue comme altérée. Vérifier la seule PRÉSENCE dans les listes ne dit
  // rien de ce qui est restauré — ce test compare la ligne champ par champ à chaque étape, et
  // n'accepte comme seule différence que `archiveLe`.
  it("cycle complet : archiver puis restaurer ne change que archiveLe, jamais provenance, autorisation ni horodatages", async () => {
    const acquereurId = await creerAcquereurDeTest("CYCLE-VALEURS");
    await ajouterRepereRelationnelAction(
      null,
      formulaire({
        acquereurId,
        categorie: "preference_contact",
        libelle: "Préfère les échanges par email",
        provenance: "indique_par_le_client",
      })
    );
    const [cree] = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(cree.utilisableCommunication).toBe(false);

    // Correction portant UNIQUEMENT sur l'autorisation : les trois autres champs sont resoumis à
    // l'identique, exactement comme le fait le formulaire de modification.
    await modifierRepereRelationnelAction(
      null,
      formulaire({
        id: cree.id,
        acquereurId,
        categorie: "preference_contact",
        libelle: "Préfère les échanges par email",
        provenance: "indique_par_le_client",
        utilisableCommunication: "on",
      })
    );
    const [modifie] = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(modifie.categorie).toBe("preference_contact");
    expect(modifie.libelle).toBe("Préfère les échanges par email");
    expect(modifie.provenance).toBe("indique_par_le_client");
    expect(modifie.utilisableCommunication).toBe(true);
    expect(modifie.creeLe).toBe(cree.creeLe);

    await archiverRepereRelationnelAction(formulaire({ id: cree.id, acquereurId })).catch(() => {});
    const [archive] = await listerReperesRelationnelsArchivesAcquereur(acquereurId);
    expect(archive.archiveLe).toBeDefined();
    // Archiver n'est pas corriger : `modifieLe` doit continuer à dater la dernière correction.
    expect({ ...archive, archiveLe: undefined }).toEqual({ ...modifie, archiveLe: undefined });

    await restaurerRepereRelationnelAction(formulaire({ id: cree.id, acquereurId })).catch(() => {});
    const actifs = await listerReperesRelationnelsAcquereur(acquereurId);
    expect(actifs).toHaveLength(1);
    expect(await listerReperesRelationnelsArchivesAcquereur(acquereurId)).toHaveLength(0);
    // Égalité stricte de la ligne entière : restaurer ne remet aucun défaut de formulaire.
    expect(actifs[0]).toEqual(modifie);
  });
});

describe("VALUE-06 — aucune intelligence, aucune extraction", () => {
  const source = readFileSync(join(__dirname, "repereRelationnel.ts"), "utf8");

  it("aucun appel à un modèle ni à un fournisseur lors de la création ou de la modification", () => {
    for (const interdit of ["redaction", "reformuler", "Mistral", "scaleway", "openai", "fetch("]) {
      expect(source.toLowerCase()).not.toContain(interdit.toLowerCase());
    }
  });

  it("aucun texte libre existant n'est lu : ni notes, ni critères, ni retour de visite, ni contexte de tâche", () => {
    // Références de CODE, jamais des mots en prose : les commentaires de ce fichier parlent
    // légitimement des notes du client sans jamais les lire.
    for (const interdit of ["acquereur.notes", ".criteres", "compteRendu", "comptesRendus", "tacheContexte"]) {
      expect(source).not.toContain(interdit);
    }
  });

  it("aucune migration implicite : la création d'un repère part uniquement du formulaire", () => {
    // Les seuls champs lus sont ceux que le conseiller a saisis, plus les identifiants d'écran.
    const champsLus = [...source.matchAll(/formData\.get\("([a-zA-Z]+)"\)/g)].map((m) => m[1]);
    expect([...new Set(champsLus)].sort()).toEqual([
      "acquereurId",
      "categorie",
      "id",
      "libelle",
      "provenance",
      "utilisableCommunication",
    ]);
  });
});
