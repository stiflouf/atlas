import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// ADR-055 §F — COEXISTENCE : la signature réelle d'un mandat alimente désormais le mandat canonique
// sans que rien du comportement historique ne change. Les deux moitiés de cette phrase sont
// vérifiées ici, ainsi que le rollback qui les rend sûres.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  mandats: mandatsTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerProspectVendeur, getProspectVendeurById, signerMandatProspectVendeur } = await import(
  "./prospectVendeurRepository"
);
const { creerProjetVendeur } = await import("./projetVendeurRepository");
const { creerBien } = await import("./bienRepository");
const { creerMandat, listerMandatsDuBien } = await import("./mandatRepository");

const MARQUEUR = "[test réel] MANDAT-COEXISTENCE";
const idsProspects: string[] = [];
const idsBiens: string[] = [];
const idsProjets: string[] = [];
const idsWorkspaces: string[] = [];

function donneesBien(suffixe: string, dateMandat = "2026-05-04") {
  return {
    reference: `${MARQUEUR} ${suffixe}`,
    titre: "Bien de test mandat",
    type: "maison" as const,
    adresse: "1 rue du Mandat",
    ville: "Testville",
    codePostal: "00000",
    surface: 100,
    pieces: 4,
    prix: 400000,
    statutMandat: "actif" as const,
    dateMandat,
    caracteristiques: [],
    description: "",
  };
}

afterAll(async () => {
  // Les événements métier ne cascadent jamais depuis leur source (append-only, ADR-011).
  if (idsProspects.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetierTable.id })
      .from(evenementsMetierTable)
      .where(inArray(evenementsMetierTable.prospectVendeurId, idsProspects));
    const idsEvenements = evenements.map((evenement) => evenement.id);
    if (idsEvenements.length > 0) {
      await getDb()
        .delete(executionsAutomatisationTable)
        .where(inArray(executionsAutomatisationTable.evenementId, idsEvenements));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvenements));
    }
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  }
  if (idsBiens.length > 0) {
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens));
    await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  }
  if (idsProjets.length > 0) {
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjets));
  }
  if (idsWorkspaces.length > 0) {
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
  }
});

describe("ADR-055 §F — signer un mandat crée le mandat canonique, sans rien changer d'autre", () => {
  it("depuis une opportunité canonique : mandat rattaché au bien ET au projet vendeur", async () => {
    const projet = await creerProjetVendeur({ origineLead: "recommandation" }, WORKSPACE_TEST);
    idsProjets.push(projet.id);
    const prospect = await creerProspectVendeur(
      { nom: `${MARQUEUR} CANONIQUE`, projetVendeurId: projet.id },
      WORKSPACE_TEST
    );
    idsProspects.push(prospect.id);

    const resultat = await signerMandatProspectVendeur(prospect.id, donneesBien("CANONIQUE"), WORKSPACE_TEST, { type: "exclusif", numero: " M-2026-001 " });
    if (resultat.statut !== "signe") throw new Error(resultat.statut);
    idsBiens.push(resultat.bien.id);

    // Comportement historique STRICTEMENT inchangé : le bien est créé avec son statut de mandat, le
    // jalon est posé, et l'événement mandat_signe est émis comme avant.
    expect(resultat.bien.statutMandat).toBe("actif");
    expect(resultat.bien.dateMandat).toBe("2026-05-04");
    expect(resultat.prospect.bienId).toBe(resultat.bien.id);
    expect(resultat.prospect.mandatSigneLe).toBeDefined();
    const evenements = await getDb()
      .select()
      .from(evenementsMetierTable)
      .where(eq(evenementsMetierTable.prospectVendeurId, prospect.id));
    expect(evenements.map((evenement) => evenement.typeEvenement)).toContain("mandat_signe");

    // Et le mandat canonique existe, rattaché des deux côtés.
    const mandats = await listerMandatsDuBien(resultat.bien.id, WORKSPACE_TEST);
    expect(mandats).toHaveLength(1);
    expect(mandats[0].projetVendeurId).toBe(projet.id);
    // La prise d'effet vient de la seule date que la signature saisisse.
    expect(mandats[0].dateDebut).toBe("2026-05-04");
    // ADR-060 : les faits saisis, et rien de plus — ni terme ni résiliation inventés.
    expect(mandats[0].type).toBe("exclusif");
    expect(mandats[0].numero, "numéro normalisé (trim)").toBe("M-2026-001");
    expect(mandats[0].dateFin).toBeUndefined();
    expect(mandats[0].resilieLe).toBeUndefined();
    expect(mandats[0].statut).toBe("actif");
    expect(resultat.mandat.id).toBe(mandats[0].id);
  });

  it("depuis une opportunité HISTORIQUE sans projet canonique : le mandat existe quand même", async () => {
    // Toutes les opportunités antérieures au modèle canonique sont dans ce cas. Qu'un mandat ait
    // été signé sur ce bien à cette date reste un fait ; le projet, lui, n'a jamais existé en base.
    const prospect = await creerProspectVendeur({ nom: `${MARQUEUR} HISTORIQUE` }, WORKSPACE_TEST);
    idsProspects.push(prospect.id);
    expect(prospect.bienId).toBeUndefined();

    const resultat = await signerMandatProspectVendeur(prospect.id, donneesBien("HISTORIQUE"), WORKSPACE_TEST, { type: "simple" });
    if (resultat.statut !== "signe") throw new Error(resultat.statut);
    idsBiens.push(resultat.bien.id);

    const mandats = await listerMandatsDuBien(resultat.bien.id, WORKSPACE_TEST);
    expect(mandats).toHaveLength(1);
    expect(mandats[0].projetVendeurId, "aucun projet n'est deviné").toBeUndefined();
    // Le workflow historique fonctionne exactement comme avant.
    expect(resultat.prospect.mandatSigneLe).toBeDefined();
  });

  it("aucun backfill : les biens antérieurs n'ont pas de mandat canonique", async () => {
    // Un bien créé hors du flux de signature n'en reçoit aucun. C'est l'état de tout l'historique :
    // fabriquer un mandat par bien inventerait une prise d'effet et une durée.
    const bien = await creerBien(donneesBien("SANS-SIGNATURE"), WORKSPACE_TEST);
    idsBiens.push(bien.id);
    expect(await listerMandatsDuBien(bien.id, WORKSPACE_TEST)).toEqual([]);
  });
});

describe("ADR-055 §F — rien ne survit à un échec de la transaction de signature", () => {
  it("un échec AU moment du mandat annule le bien et le jalon", async () => {
    // Panne réelle et non simulée : le projet vendeur du prospect appartient à un autre workspace,
    // la garde de `creerMandat` refuse. À cet instant, le bien a déjà été inséré et le jalon posé
    // dans la transaction — les deux doivent disparaître.
    const [autreWorkspace] = await getDb()
      .insert(workspacesTable)
      .values({ id: "workspace-test-mandat-coexistence", nom: "[test réel] autre workspace" })
      .returning();
    idsWorkspaces.push(autreWorkspace.id);
    const projetAilleurs = await creerProjetVendeur({ origineLead: "panneau" }, autreWorkspace.id);
    idsProjets.push(projetAilleurs.id);

    const prospect = await creerProspectVendeur(
      { nom: `${MARQUEUR} ROLLBACK`, projetVendeurId: projetAilleurs.id },
      WORKSPACE_TEST
    );
    idsProspects.push(prospect.id);

    await expect(
      signerMandatProspectVendeur(prospect.id, donneesBien("ROLLBACK"), WORKSPACE_TEST, { type: "simple" })
    ).rejects.toThrow(/workspaces différents/);

    expect(
      await getDb().select().from(biensTable).where(eq(biensTable.reference, `${MARQUEUR} ROLLBACK`))
    ).toEqual([]);
    const relu = await getProspectVendeurById(prospect.id);
    expect(relu!.mandatSigneLe, "le jalon ne doit pas avoir été posé").toBeUndefined();
    expect(relu!.bienId).toBeUndefined();
  });

  it("un échec APRÈS le mandat ne laisse aucun mandat orphelin", async () => {
    // Même séquence que `signerMandatProspectVendeur`, avec une panne Postgres réelle sur la
    // dernière écriture (événement métier visant un workspace inexistant : violation de FK). Joué
    // sur les repositories parce qu'aucune donnée d'entrée de la signature ne peut faire échouer
    // l'émission de l'événement — le mandat est bien créé avant que la panne ne survienne.
    const reference = `${MARQUEUR} ROLLBACK-APRES`;

    await expect(
      getDb().transaction(async (tx) => {
        const bien = await creerBien({ ...donneesBien("ROLLBACK-APRES"), reference }, WORKSPACE_TEST, tx);
        await creerMandat({ bienId: bien.id, dateDebut: "2026-05-04", type: "simple" }, tx);
        return tx
          .insert(evenementsMetierTable)
          .values({ typeEvenement: "mandat_signe", workspaceId: "workspace-inexistant" })
          .returning();
      })
    ).rejects.toThrow();

    const biensRestants = await getDb().select().from(biensTable).where(eq(biensTable.reference, reference));
    expect(biensRestants).toEqual([]);
    // Aucun mandat ne subsiste : sans son bien, il ne décrirait de contrat sur rien.
    const mandatsOrphelins = await getDb()
      .select()
      .from(mandatsTable)
      .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
      .where(eq(biensTable.reference, reference));
    expect(mandatsOrphelins).toEqual([]);
  });
});
