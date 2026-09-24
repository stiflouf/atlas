import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2A (ADR-054) — les mutations que le lot V1 avait laissées ouvertes : jalons du
// parcours vendeur, notes de prospect, repères relationnels, secteurs de recherche. Deux workspaces
// réels ; depuis une session de A, on soumet des identifiants de B. Rien ne doit être écrit — ni la
// ligne visée, ni le moindre effet de bord (dernier_contact_le, demande de resynchronisation,
// événement métier).
//
// Ces actions n'étaient visibles d'aucune des deux gardes structurelles de V1 : six d'entre elles
// écrivent sans jamais lire, donc sans importer le moindre reader.
const { sessionMock, workspaceMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  workspaceMock: vi.fn(),
}));
vi.mock("@/lib/auth/sessionAtlas", () => ({ exigerSessionAtlas: () => sessionMock() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: () => workspaceMock() }));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  compatibilitesARessynchroniser: resyncTable,
  evenementsMetier: evenementsMetierTable,
  notesProspectVendeur: notesTable,
  prospectsVendeurs: prospectsTable,
  reperesRelationnelsAcquereur: reperesTable,
  secteursRechercheAcquereur: secteursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur, getProspectVendeurById } = await import("@/lib/prospectVendeurRepository");
const { creerRepereRelationnelAcquereur } = await import("@/lib/repereRelationnelRepository");
const { ajouterSecteurRecherche } = await import("@/lib/secteurRechercheRepository");
const { ajouterNoteProspectVendeur } = await import("@/lib/noteProspectVendeurRepository");
const {
  ajouterRepereRelationnelAction,
  modifierRepereRelationnelAction,
  archiverRepereRelationnelAction,
  restaurerRepereRelationnelAction,
} = await import("./repereRelationnel");
const { ajouterSecteurRechercheAction, supprimerSecteurRechercheAction } = await import("./secteurRecherche");
const {
  qualifierProspectVendeurAction,
  enregistrerEstimationProspectVendeurAction,
  planifierRdvEstimationProspectVendeurAction,
  marquerRdvEstimationRealiseProspectVendeurAction,
  proposerMandatProspectVendeurAction,
  marquerProspectVendeurPerduAction,
  archiverProspectVendeurAction,
  desarchiverProspectVendeurAction,
  ajouterNoteProspectVendeurAction,
} = await import("./prospectVendeur");

const M = `Zv2a${Date.now()}`;
const WORKSPACE_B = `ws-v2a-${Date.now()}`;
let compteur = 0;
let workspaceBCree = false;
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];

beforeEach(() => {
  sessionMock.mockReset().mockResolvedValue({ sub: "v2a-sub", email: "conseiller@example.test" });
  // Session du workspace A, d'où partent toutes les tentatives.
  workspaceMock.mockReset().mockResolvedValue(WORKSPACE_TEST);
});

afterAll(async () => {
  if (idsAcquereurs.length > 0) {
    await getDb().delete(reperesTable).where(inArray(reperesTable.acquereurId, idsAcquereurs));
    await getDb().delete(secteursTable).where(inArray(secteursTable.acquereurId, idsAcquereurs));
    await getDb().delete(resyncTable).where(inArray(resyncTable.acquereurId, idsAcquereurs));
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  }
  if (idsProspects.length > 0) {
    await getDb().delete(notesTable).where(inArray(notesTable.prospectVendeurId, idsProspects));
    await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.prospectVendeurId, idsProspects));
    await getDb().delete(prospectsTable).where(inArray(prospectsTable.id, idsProspects));
  }
  if (workspaceBCree) await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
});

async function autreWorkspace() {
  if (!workspaceBCree) {
    await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] frontière V2A" });
    workspaceBCree = true;
  }
  return WORKSPACE_B;
}

async function unAcquereur(workspaceId: string) {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: "Frontière",
      nom: `${M} Acquereur ${compteur}`,
      email: `${M}.${compteur}@example.test`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "recherche_active" as const,
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

async function unProspect(workspaceId: string) {
  compteur += 1;
  const prospect = await creerProspectVendeur({ nom: `${M} Prospect ${compteur}` }, workspaceId);
  idsProspects.push(prospect.id);
  return prospect;
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

// Les actions à redirect()/notFound() lèvent par conception.
const soumettre = (p: Promise<unknown>) => p.catch(() => undefined);

const CHAMPS_REPERE = {
  categorie: "autre",
  provenance: "saisi_par_le_conseiller",
  libelle: "Repère indiscret",
};

describe("Frontière workspace — repères relationnels", () => {
  it("créer un repère sur un acquéreur de B depuis A : refus, aucune ligne", async () => {
    const acquereurB = await unAcquereur(await autreWorkspace());

    const etat = await ajouterRepereRelationnelAction(
      null,
      formulaire({ acquereurId: acquereurB.id, ...CHAMPS_REPERE })
    );

    expect(etat).toEqual({ statut: "erreur", message: "Acquéreur introuvable." });
    expect(await getDb().select().from(reperesTable).where(eq(reperesTable.acquereurId, acquereurB.id))).toEqual([]);
  });

  it("modifier un repère de B depuis A : libellé et autorisation de communication inchangés", async () => {
    const workspaceB = await autreWorkspace();
    const acquereurB = await unAcquereur(workspaceB);
    const repere = await creerRepereRelationnelAcquereur(
      { acquereurId: acquereurB.id, categorie: "autre", libelle: "Texte de B", provenance: "saisi_par_le_conseiller", utilisableCommunication: false },
      workspaceB
    );

    const etat = await modifierRepereRelationnelAction(
      null,
      formulaire({
        id: repere.id,
        acquereurId: acquereurB.id,
        categorie: "autre",
        provenance: "saisi_par_le_conseiller",
        libelle: "Texte réécrit depuis A",
        utilisableCommunication: "on",
      })
    );

    expect(etat).toEqual({ statut: "erreur", message: "Acquéreur introuvable." });
    const [relu] = await getDb().select().from(reperesTable).where(eq(reperesTable.id, repere.id));
    expect(relu.libelle).toBe("Texte de B");
    expect(relu.utilisableCommunication).toBe(false);
  });

  it("archiver puis restaurer un repère de B depuis A : aucune bascule", async () => {
    const workspaceB = await autreWorkspace();
    const acquereurB = await unAcquereur(workspaceB);
    const repere = await creerRepereRelationnelAcquereur(
      { acquereurId: acquereurB.id, categorie: "autre", libelle: "Repère de B", provenance: "saisi_par_le_conseiller", utilisableCommunication: false },
      workspaceB
    );

    await soumettre(archiverRepereRelationnelAction(formulaire({ id: repere.id, acquereurId: acquereurB.id })));
    const [apresArchivage] = await getDb().select().from(reperesTable).where(eq(reperesTable.id, repere.id));
    expect(apresArchivage.archiveLe).toBeNull();

    // Et dans l'autre sens, sur un repère réellement archivé dans B : A ne peut pas le ressusciter.
    await getDb().update(reperesTable).set({ archiveLe: new Date() }).where(eq(reperesTable.id, repere.id));
    await soumettre(restaurerRepereRelationnelAction(formulaire({ id: repere.id, acquereurId: acquereurB.id })));
    const [apresRestauration] = await getDb().select().from(reperesTable).where(eq(reperesTable.id, repere.id));
    expect(apresRestauration.archiveLe).not.toBeNull();
  });
});

// Contre-épreuves : sans elles, les refus ci-dessus prouveraient seulement que l'action échoue
// TOUJOURS. Ce sont ces trois cas qui établissent que c'est bien le périmètre qui décide.
describe("Frontière workspace — les mêmes gestes réussissent dans SON workspace", () => {
  it("créer puis archiver un repère sur un acquéreur de A : succès", async () => {
    const acquereurA = await unAcquereur(WORKSPACE_TEST);

    const etat = await ajouterRepereRelationnelAction(
      null,
      formulaire({ acquereurId: acquereurA.id, ...CHAMPS_REPERE })
    );
    expect(etat.statut).toBe("succes");

    const [cree] = await getDb().select().from(reperesTable).where(eq(reperesTable.acquereurId, acquereurA.id));
    expect(cree.libelle).toBe("Repère indiscret");

    await soumettre(archiverRepereRelationnelAction(formulaire({ id: cree.id, acquereurId: acquereurA.id })));
    const [archive] = await getDb().select().from(reperesTable).where(eq(reperesTable.id, cree.id));
    expect(archive.archiveLe).not.toBeNull();
  });

  it("poser un jalon sur un prospect de A : succès", async () => {
    const prospectA = await unProspect(WORKSPACE_TEST);

    await soumettre(qualifierProspectVendeurAction({ statut: "idle" }, formulaire({ id: prospectA.id })));

    expect((await getProspectVendeurById(prospectA.id))?.qualifieLe).toBeDefined();
  });

  it("ajouter une note à un prospect de A : la note existe et dernier_contact_le avance", async () => {
    const prospectA = await unProspect(WORKSPACE_TEST);

    await soumettre(
      ajouterNoteProspectVendeurAction(
        { statut: "idle" },
        formulaire({ id: prospectA.id, type: "appel", contenu: "Échange dans A." })
      )
    );

    const notes = await getDb().select().from(notesTable).where(eq(notesTable.prospectVendeurId, prospectA.id));
    expect(notes).toHaveLength(1);
    expect((await getProspectVendeurById(prospectA.id))?.dernierContactLe).toBeDefined();
  });
});

describe("Frontière workspace — secteurs de recherche", () => {
  it("ajouter un secteur à un acquéreur de B depuis A : aucun secteur, aucune resynchronisation", async () => {
    const acquereurB = await unAcquereur(await autreWorkspace());

    const etat = await ajouterSecteurRechercheAction(
      null,
      formulaire({ acquereurId: acquereurB.id, codeInsee: "78311", nomCommune: "Houilles" })
    );

    expect(etat.statut).toBe("erreur");
    expect(await getDb().select().from(secteursTable).where(eq(secteursTable.acquereurId, acquereurB.id))).toEqual([]);
    // §8 — l'effet de bord le plus insidieux : une demande de resynchronisation estampillée du
    // périmètre de A mais visant une personne de B.
    expect(await getDb().select().from(resyncTable).where(eq(resyncTable.acquereurId, acquereurB.id))).toEqual([]);
  });

  it("supprimer un secteur de B depuis A : secteur intact, aucune resynchronisation", async () => {
    const workspaceB = await autreWorkspace();
    const acquereurB = await unAcquereur(workspaceB);
    const secteur = await ajouterSecteurRecherche(
      acquereurB.id,
      { citycode: "78311", nom: "Houilles", codePostal: "78800", contexte: "78, Yvelines" },
      workspaceB
    );

    await soumettre(supprimerSecteurRechercheAction(formulaire({ id: secteur.id, acquereurId: acquereurB.id })));

    const restants = await getDb().select().from(secteursTable).where(eq(secteursTable.id, secteur.id));
    expect(restants).toHaveLength(1);
    expect(await getDb().select().from(resyncTable).where(eq(resyncTable.acquereurId, acquereurB.id))).toEqual([]);
  });
});

describe("Frontière workspace — jalons du prospect vendeur", () => {
  it("qualifier, estimer, planifier et proposer un mandat sur un prospect de B depuis A : aucun jalon posé", async () => {
    const prospectB = await unProspect(await autreWorkspace());

    await soumettre(qualifierProspectVendeurAction({ statut: "idle" }, formulaire({ id: prospectB.id })));
    await soumettre(
      enregistrerEstimationProspectVendeurAction(
        { statut: "idle" },
        formulaire({ id: prospectB.id, estimationProposeeCentimes: "40000000", estimationProposeeLe: "2026-02-01" })
      )
    );
    await soumettre(
      planifierRdvEstimationProspectVendeurAction(
        { statut: "idle" },
        formulaire({ id: prospectB.id, rdvEstimationPrevuLe: "2026-03-01T10:00" })
      )
    );
    await soumettre(proposerMandatProspectVendeurAction({ statut: "idle" }, formulaire({ id: prospectB.id })));

    const relu = await getProspectVendeurById(prospectB.id);
    expect(relu?.qualifieLe).toBeUndefined();
    expect(relu?.estimationProposeeCentimes).toBeUndefined();
    expect(relu?.rdvEstimationPrevuLe).toBeUndefined();
    expect(relu?.mandatProposeLe).toBeUndefined();
  });

  it("marquer réalisé un rendez-vous de B depuis A : aucun jalon, aucun événement métier", async () => {
    const prospectB = await unProspect(await autreWorkspace());

    await soumettre(
      marquerRdvEstimationRealiseProspectVendeurAction(
        { statut: "idle" },
        formulaire({ id: prospectB.id, rdvEstimationRealiseLe: "2026-02-01T10:00" })
      )
    );

    const relu = await getProspectVendeurById(prospectB.id);
    expect(relu?.rdvEstimationRealiseLe).toBeUndefined();
    expect(relu?.dernierContactLe).toBeUndefined();
    const evenements = await getDb()
      .select()
      .from(evenementsMetierTable)
      .where(eq(evenementsMetierTable.prospectVendeurId, prospectB.id));
    expect(evenements).toEqual([]);
  });

  it("marquer perdu un prospect de B depuis A : l'état terminal n'est jamais posé", async () => {
    const prospectB = await unProspect(await autreWorkspace());

    await soumettre(
      marquerProspectVendeurPerduAction(
        { statut: "idle" },
        formulaire({ id: prospectB.id, motifPerte: "mandat_concurrent", datePerte: "2026-02-01" })
      )
    );

    const relu = await getProspectVendeurById(prospectB.id);
    expect(relu?.motifPerte).toBeUndefined();
    expect(relu?.datePerte).toBeUndefined();
  });

  it("archiver puis désarchiver un prospect de B depuis A : aucune bascule", async () => {
    const workspaceB = await autreWorkspace();
    const prospectB = await unProspect(workspaceB);

    await soumettre(archiverProspectVendeurAction(formulaire({ id: prospectB.id })));
    expect((await getProspectVendeurById(prospectB.id))?.archiveLe).toBeUndefined();

    await getDb().update(prospectsTable).set({ archiveLe: new Date() }).where(eq(prospectsTable.id, prospectB.id));
    await soumettre(desarchiverProspectVendeurAction(formulaire({ id: prospectB.id })));
    expect((await getProspectVendeurById(prospectB.id))?.archiveLe).toBeDefined();
  });

  it("ajouter une note à un prospect de B depuis A : aucune note, et dernier_contact_le intact", async () => {
    const workspaceB = await autreWorkspace();
    const prospectB = await unProspect(workspaceB);
    // Une interaction réelle a déjà eu lieu dans B : c'est sa date que A ne doit pas pouvoir bouger,
    // puisque la repousser éteindrait les relances d'inactivité de B.
    await ajouterNoteProspectVendeur(prospectB.id, "appel", "Échange réel dans B.", workspaceB);
    const avant = (await getProspectVendeurById(prospectB.id))?.dernierContactLe;
    expect(avant).toBeDefined();

    await soumettre(
      ajouterNoteProspectVendeurAction(
        { statut: "idle" },
        formulaire({ id: prospectB.id, type: "appel", contenu: "Note écrite depuis A." })
      )
    );

    const notes = await getDb().select().from(notesTable).where(eq(notesTable.prospectVendeurId, prospectB.id));
    expect(notes).toHaveLength(1);
    expect(notes[0].contenu).toBe("Échange réel dans B.");
    expect((await getProspectVendeurById(prospectB.id))?.dernierContactLe).toEqual(avant);
  });
});
