import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// VISIT_NATIVE_ENTRY_V1 — LE test d'intégration critique du lot (brief §47) : le tunnel vendeur
// complet passe par les Server Actions réelles, SANS Google Calendar et SANS ajout manuel de partie
// au mandat :
//   Prospect vendeur (action) → signer Mandat (action) → partie mandant canonique posée
//   → planifier Visite native (action) → compte rendu (action) → Visite realisee
//   → retour vendeur (action) → vendeur canonique résolu automatiquement.
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
  comptesRendusVisite: comptesRendusVisiteTable,
  contacts: contactsTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  interactions: interactionsTable,
  mandats: mandatsTable,
  partiesMandat: partiesMandatTable,
  partiesProjet: partiesProjetTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  visites: visitesTable,
} = await import("@/db/schema");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { listerPartiesMandat } = await import("@/lib/partieMandatRepository");
const { mandatCourantDuBien } = await import("@/lib/mandatRepository");
const { getVisiteById } = await import("@/lib/visiteRepository");
const { listerInteractionsPourVisite } = await import("@/lib/interactionRepository");
const { vendeursCanoniquesDuBien } = await import("@/lib/retourVendeurVisiteRepository");
const { creerProspectVendeurAction, signerMandatProspectVendeurAction } = await import("./prospectVendeur");
const { creerVisiteAction } = await import("./creerVisite");
const { enregistrerCompteRenduVisiteAction } = await import("./enregistrerCompteRenduVisite");
const { enregistrerRetourVendeurVisiteAction } = await import("./retourVendeurVisite");

const M = `[test réel] TUNNEL-VENDEUR-VISITE-NATIVE ${Date.now()}`;
const idsAcquereurs: string[] = [];

afterAll(async () => {
  const contacts = await getDb().select({ id: contactsTable.id }).from(contactsTable).where(like(contactsTable.nom, `%${M}%`));
  const idsContacts = contacts.map((c) => c.id);
  const prospects = await getDb().select({ id: prospectsVendeursTable.id, bienId: prospectsVendeursTable.bienId }).from(prospectsVendeursTable).where(like(prospectsVendeursTable.nom, `%${M}%`));
  const idsProspects = prospects.map((p) => p.id);
  const idsBiens = prospects.map((p) => p.bienId).filter((id): id is string => id !== null);
  const visites = idsBiens.length ? await getDb().select({ id: visitesTable.id }).from(visitesTable).where(inArray(visitesTable.bienId, idsBiens)) : [];
  const idsVisites = visites.map((v) => v.id);
  const comptesRendus = idsBiens.length ? await getDb().select({ id: comptesRendusVisiteTable.id }).from(comptesRendusVisiteTable).where(inArray(comptesRendusVisiteTable.bienId, idsBiens)) : [];
  const idsComptesRendus = comptesRendus.map((c) => c.id);

  if (idsContacts.length) await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));

  // Purge ciblée des événements liés à ce tunnel (prospect, visite, compte rendu) — NO ACTION partout.
  const evtsTunnel = (
    await Promise.all([
      idsProspects.length ? getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(inArray(evenementsMetierTable.prospectVendeurId, idsProspects)) : [],
      idsVisites.length ? getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(inArray(evenementsMetierTable.visiteId, idsVisites)) : [],
      idsComptesRendus.length ? getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(inArray(evenementsMetierTable.compteRenduVisiteId, idsComptesRendus)) : [],
    ])
  )
    .flat()
    .map((e) => e.id);
  if (evtsTunnel.length) {
    await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, evtsTunnel));
    await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, evtsTunnel));
  }

  if (idsComptesRendus.length) await getDb().delete(comptesRendusVisiteTable).where(inArray(comptesRendusVisiteTable.id, idsComptesRendus));
  if (idsVisites.length) await getDb().delete(visitesTable).where(inArray(visitesTable.id, idsVisites));
  if (idsBiens.length) {
    const mandats = await getDb().select({ id: mandatsTable.id }).from(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens));
    const idsMandats = mandats.map((m) => m.id);
    // parties_mandat référence mandats en NO ACTION : parties avant mandats.
    if (idsMandats.length) await getDb().delete(partiesMandatTable).where(inArray(partiesMandatTable.mandatId, idsMandats));
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens));
  }
  if (idsProspects.length) await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsBiens.length) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsContacts.length) {
    const parties = await getDb().select({ projetVendeurId: partiesProjetTable.projetVendeurId }).from(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    const idsProjets = [...new Set(parties.map((p) => p.projetVendeurId).filter((id): id is string => id !== null))];
    if (idsProjets.length) await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjets));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

// Chaque action réussie termine par redirect() (digest NEXT_REDIRECT) ; on le capture pour lire la
// route atteinte — même patron que les autres tests d'actions du dépôt.
async function executer(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
    return "aucune";
  } catch (erreur) {
    return String((erreur as { digest?: string }).digest ?? (erreur as Error).message);
  }
}

describe("tunnel vendeur — Prospect → Mandat → Visite native → CR → retour vendeur", () => {
  it("le vendeur canonique est résolu automatiquement, sans Calendar ni ajout manuel de partie", async () => {
    // 1. Prospect vendeur créé par l'action réelle : Contact canonique + projet + prospect.
    const redirectionProspect = await executer(() =>
      creerProspectVendeurAction(formulaire({ nom: `${M} Vendeur`, prenom: "Camille", email: "tunnel@example.test", telephone: "0611111111" }))
    );
    const prospectId = redirectionProspect.match(/\/prospects-vendeurs\/([0-9a-f-]{36})/)?.[1];
    expect(prospectId).toBeDefined();
    const [prospect] = await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, prospectId!));
    expect(prospect.contactId).toBeTruthy();

    // 2. Signature du mandat par l'action réelle → bien + mandat + partie mandant.
    const redirectionSignature = await executer(() =>
      signerMandatProspectVendeurAction(
        formulaire({
          id: prospectId!,
          reference: `${M} ref`,
          titre: `${M} Bien`,
          type: "appartement",
          adresse: "1 rue du Tunnel",
          ville: "Testville",
          codePostal: "00000",
          surface: "60",
          pieces: "3",
          prix: "320000",
          statutMandat: "actif",
          dateMandat: "2026-09-01",
          typeMandat: "simple",
        })
      )
    );
    const bienId = redirectionSignature.match(/\/biens\/([0-9a-f-]{36})/)?.[1];
    expect(bienId).toBeDefined();
    const mandat = await mandatCourantDuBien(bienId!, WORKSPACE_TEST);
    expect(mandat).toBeDefined();
    const parties = await listerPartiesMandat(mandat!.id, WORKSPACE_TEST);
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({ contactId: prospect.contactId, role: "mandant" });
    expect((await vendeursCanoniquesDuBien(bienId!, WORKSPACE_TEST)).map((v) => v.contactId)).toEqual([prospect.contactId]);

    // 3. Visite native planifiée par l'action réelle — aucun Calendar.
    const acquereur = await creerAcquereur(
      {
        prenom: "Alex",
        nom: `${M} Acquéreur`,
        email: "tunnel-acq@example.test",
        telephone: "0622222222",
        budgetMin: 200000,
        budgetMax: 400000,
        criteres: [],
        stadeProjet: "recherche_active",
        notes: "",
        datePremiereContact: "2026-01-01",
      },
      WORKSPACE_TEST
    );
    idsAcquereurs.push(acquereur.id);
    const redirectionVisite = await executer(() =>
      creerVisiteAction({ statut: "idle" }, formulaire({ bienId: bienId!, acquereurId: acquereur.id, datePrevue: "2026-09-15", retour: "bien" }))
    );
    const visiteId = redirectionVisite.match(/\/visites\/([0-9a-f-]{36})/)?.[1];
    expect(visiteId).toBeDefined();
    expect(redirectionVisite).not.toContain("/preparer");
    expect(await getVisiteById(visiteId!, WORKSPACE_TEST)).toMatchObject({ statut: "planifiee", rendezVousCalendarId: undefined });

    // 4. Compte rendu par l'action réelle → Visite realisee.
    await executer(() =>
      enregistrerCompteRenduVisiteAction(
        formulaire({ bienId: bienId!, acquereurId: acquereur.id, visiteId: visiteId!, dateVisite: "2026-09-15", retour: "Très bonne visite.", interet: "interesse" })
      )
    );
    expect((await getVisiteById(visiteId!, WORKSPACE_TEST))?.statut).toBe("realisee");

    // 5. Retour vendeur par l'action réelle → Interaction vers le mandant résolu automatiquement.
    const redirectionRetour = await executer(() =>
      enregistrerRetourVendeurVisiteAction(formulaire({ visiteId: visiteId!, canal: "appel", note: "Vendeur rassuré." }))
    );
    expect(redirectionRetour).toContain(`/visites/${visiteId}`);
    expect(redirectionRetour).not.toContain("erreurRetourVendeur");
    const interactions = (await listerInteractionsPourVisite(visiteId!, WORKSPACE_TEST)).filter((i) => i.natureMetier === "retour_vendeur_post_visite");
    expect(interactions).toHaveLength(1);
    expect(interactions[0].contactId).toBe(prospect.contactId);
  });
});
