import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray, or } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// Test d'intégration réel (ADR-041) : vraie base Postgres, AUCUNE connexion Google Calendar
// configurée dans cet environnement de test — la fiche doit rester pleinement consultable malgré
// cela (c'est précisément l'invariant central de cette ADR : le noyau de la fiche ne dépend jamais
// de Calendar). Aucun mock de `rendezVousContexte`/`getRendezVousAvecContexte` ici, volontairement :
// cette page ne les importe jamais.

// ADR-054 — le périmètre est résolu depuis la session, mocké ici sur le workspace de test.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: async () => "default",
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  visites: visitesTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  evenementsMetier,
  executionsAutomatisation,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerVisite, materialiserVisite, annulerVisite } = await import("@/lib/visiteRepository");
const { creerCompteRenduEtRealiserVisite } = await import("@/lib/compteRenduVisiteRepository");
const VisitePage = (await import("./page")).default;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  // evenements_metier référence visites/comptes_rendus_visite en NO ACTION (migration 0050) —
  // purgé avant la suppression cascade des biens, même patron que
  // catalogueRegles.nouveauMatch.test.ts.
  if (idsBiensCrees.length) {
    const visites = await getDb().select({ id: visitesTable.id }).from(visitesTable).where(inArray(visitesTable.bienId, idsBiensCrees));
    const comptesRendus = await getDb()
      .select({ id: comptesRendusVisiteTable.id })
      .from(comptesRendusVisiteTable)
      .where(inArray(comptesRendusVisiteTable.bienId, idsBiensCrees));
    const idsVisites = visites.map((v) => v.id);
    const idsComptesRendus = comptesRendus.map((c) => c.id);
    if (idsVisites.length || idsComptesRendus.length) {
      const filtre = or(
        idsVisites.length ? inArray(evenementsMetier.visiteId, idsVisites) : undefined,
        idsComptesRendus.length ? inArray(evenementsMetier.compteRenduVisiteId, idsComptesRendus) : undefined
      );
      const evenements = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtre);
      const idsEvenements = evenements.map((e) => e.id);
      if (idsEvenements.length) {
        await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvenements));
        await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, idsEvenements));
      }
    }
  }
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] FICHE-VISITE-${suffixe}`,
    titre: `Bien fiche visite ${suffixe}`,
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
  }, WORKSPACE_TEST);
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerAcquereurDeTest(suffixe: string) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Fiche visite ${suffixe}`,
    email: `test-réel-fiche-visite-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  }, WORKSPACE_TEST);
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

describe("Fiche Visite /visites/{id} — consultable sans Google Calendar (ADR-041)", () => {
  it("id inexistant : notFound()", async () => {
    await expect(
      VisitePage({ params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) })
    ).rejects.toThrow();
  });

  it("visite planifiee : statut, Bien/Acquéreur navigables, actions Annuler/Reporter, aucun compte rendu", async () => {
    const bien = await creerBienDeTest("PLAN1");
    const acquereur = await creerAcquereurDeTest("PLAN1");
    const resultat = await materialiserVisite(
      {
        bienId: bien.id,
        acquereurId: acquereur.id,
        datePrevue: "2026-09-10",
        rendezVousCalendarId: `gcal-fiche-${bien.id}`,
      },
      WORKSPACE_TEST
    );
    if (resultat.statut !== "creee") throw new Error("création de visite attendue");
    const visite = resultat.visite;

    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Planifiée");
    expect(html).toContain(bien.titre);
    expect(html).toContain(`href="/biens/${bien.id}"`);
    expect(html).toContain(`href="/clients/${acquereur.id}"`);
    expect(html).toContain(acquereur.prenom);
    expect(html).toContain("Préparer / renseigner le compte rendu");
    expect(html).toContain("Annuler la visite");
    expect(html).toContain("Reporter");
    expect(html).not.toContain("Compte rendu");
    // ADR-044 — aucun compte rendu tant que la visite n'est pas réalisée.
    expect(html).not.toContain("Créer une offre");
  });

  it("visite native (sans Calendar) planifiee : aucun lien Préparer, formulaire de compte rendu natif présent (VISIT_NATIVE_LIFECYCLE_V1/ADR-063)", async () => {
    const bien = await creerBienDeTest("NATIF1");
    const acquereur = await creerAcquereurDeTest("NATIF1");
    const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-10" }, WORKSPACE_TEST);
    if (resultat.statut !== "creee") throw new Error("création de visite attendue");
    const visite = resultat.visite;

    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Planifiée");
    expect(html).not.toContain("Préparer / renseigner le compte rendu");
    expect(html).not.toContain("Ouvrir la préparation");
    expect(html).toContain("Annuler la visite");
    expect(html).toContain("Enregistrer le compte rendu");
    expect(html).toContain(`value="${visite.id}"`);
  });

  it("visite realisee : compte rendu affiché avec intérêt, aucune action de planification", async () => {
    const bien = await creerBienDeTest("REAL1");
    const acquereur = await creerAcquereurDeTest("REAL1");
    const resultat = await materialiserVisite(
      {
        bienId: bien.id,
        acquereurId: acquereur.id,
        datePrevue: "2026-08-01",
        rendezVousCalendarId: `gcal-fiche-${bien.id}`,
      },
      WORKSPACE_TEST
    );
    if (resultat.statut !== "creee") throw new Error("création de visite attendue");
    const visite = resultat.visite;
    await creerCompteRenduEtRealiserVisite(
      {
        bienId: bien.id,
        acquereurId: acquereur.id,
        visiteId: visite.id,
        dateVisite: "2026-08-01",
        retour: "[test réel] Très bon retour, intéressé par une offre.",
        interet: "interesse",
        prochaineEtape: "Envoyer une contre-proposition",
      },
      WORKSPACE_TEST
    );

    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Réalisée");
    expect(html).toContain("Intéressé");
    expect(html).toContain("Très bon retour");
    expect(html).toContain("Envoyer une contre-proposition");
    expect(html).not.toContain("Annuler la visite");
    expect(html).not.toContain("Préparer / renseigner le compte rendu");

    // ADR-044 — lien contextuel "Créer une offre" vers la route canonique, préchargé avec les IDs
    // structurés exacts de cette visite (bien/acquéreur/compte rendu), jamais un texte parsé.
    expect(html).toContain("Créer une offre");
    expect(html).toMatch(
      new RegExp(`/offres/nouveau\\?bienId=${bien.id}&amp;acquereurId=${acquereur.id}&amp;compteRenduVisiteId=`)
    );
  });

  it("visite realisee, interet = pas_interesse : le lien Créer une offre reste affiché (ADR-044 §5, jamais conditionné à interet)", async () => {
    const bien = await creerBienDeTest("REALPASINT1");
    const acquereur = await creerAcquereurDeTest("REALPASINT1");
    const resultat = await materialiserVisite(
      {
        bienId: bien.id,
        acquereurId: acquereur.id,
        datePrevue: "2026-08-01",
        rendezVousCalendarId: `gcal-fiche-pasint-${bien.id}`,
      },
      WORKSPACE_TEST
    );
    if (resultat.statut !== "creee") throw new Error("création de visite attendue");
    const visite = resultat.visite;
    await creerCompteRenduEtRealiserVisite(
      {
        bienId: bien.id,
        acquereurId: acquereur.id,
        visiteId: visite.id,
        dateVisite: "2026-08-01",
        retour: "[test réel] Ne correspond pas, mais l'acquéreur a changé d'avis en repartant.",
        interet: "pas_interesse",
      },
      WORKSPACE_TEST
    );

    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Créer une offre");
  });

  it("visite annulee : statut affiché, aucun compte rendu, aucune action de planification", async () => {
    const bien = await creerBienDeTest("ANN1");
    const acquereur = await creerAcquereurDeTest("ANN1");
    const resultat = await materialiserVisite(
      {
        bienId: bien.id,
        acquereurId: acquereur.id,
        datePrevue: "2026-09-10",
        rendezVousCalendarId: `gcal-fiche-${bien.id}`,
      },
      WORKSPACE_TEST
    );
    if (resultat.statut !== "creee") throw new Error("création de visite attendue");
    const visite = resultat.visite;
    await annulerVisite(visite.id, WORKSPACE_TEST);

    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Annulée");
    expect(html).not.toContain("Compte rendu");
    expect(html).not.toContain("Annuler la visite");
    expect(html).not.toContain("Préparer / renseigner le compte rendu");
    // ADR-044 — aucun compte rendu, aucune provenance structurée : le lien n'a pas de sens ici.
    expect(html).not.toContain("Créer une offre");
  });
});

// DEMO_UX_HARDENING_V1 — l'action de retour vendeur rapportait ses refus par
// `?erreurRetourVendeur=`, que personne ne lisait : un refus ressemblait à un clic sans effet.
describe("Fiche Visite — refus de retour vendeur rapportés à l'écran", () => {
  async function visiteRealisee(suffixe: string) {
    const bien = await creerBienDeTest(suffixe);
    const acquereur = await creerAcquereurDeTest(suffixe);
    const resultat = await materialiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-08-01", rendezVousCalendarId: `gcal-fiche-${bien.id}` },
      WORKSPACE_TEST
    );
    if (resultat.statut !== "creee") throw new Error("création de visite attendue");
    await creerCompteRenduEtRealiserVisite(
      {
        bienId: bien.id,
        acquereurId: acquereur.id,
        visiteId: resultat.visite.id,
        dateVisite: "2026-08-01",
        retour: "[test réel] Retour de visite.",
        interet: "interesse",
        prochaineEtape: "",
      },
      WORKSPACE_TEST
    );
    return resultat.visite;
  }

  it("chacun des cinq statuts de refus du writer devient un message lisible en role=alert", async () => {
    const visite = await visiteRealisee("REFUS");
    const attendus: Array<[string, RegExp]> = [
      ["deja_enregistre", /déjà été enregistré/],
      ["introuvable", /introuvable/],
      ["visite_non_realisee", /visite réalisée/],
      ["aucun_vendeur_canonique", /mandant/],
      ["contact_fusionne", /fusionné/],
    ];
    for (const [code, attendu] of attendus) {
      const html = renderToStaticMarkup(
        await VisitePage({
          params: Promise.resolve({ id: visite.id }),
          searchParams: Promise.resolve({ erreurRetourVendeur: code }),
        })
      );
      expect(html, code).toContain('role="alert"');
      expect(html, code).toMatch(attendu);
    }
  });

  it("un code inconnu n'affiche RIEN : ni message arbitraire, ni valeur brute recopiée", async () => {
    const visite = await visiteRealisee("INCONNU");
    const html = renderToStaticMarkup(
      await VisitePage({
        params: Promise.resolve({ id: visite.id }),
        searchParams: Promise.resolve({ erreurRetourVendeur: "<script>bidon</script>" }),
      })
    );
    expect(html).not.toContain("bidon");
    expect(html).not.toContain('role="alert"');
  });

  it("sans paramètre, la fiche ne montre aucun refus", async () => {
    const visite = await visiteRealisee("SANS");
    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).not.toContain('role="alert"');
  });
});
