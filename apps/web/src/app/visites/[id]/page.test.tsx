import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";

// Test d'intégration réel (ADR-041) : vraie base Postgres, AUCUNE connexion Google Calendar
// configurée dans cet environnement de test — la fiche doit rester pleinement consultable malgré
// cela (c'est précisément l'invariant central de cette ADR : le noyau de la fiche ne dépend jamais
// de Calendar). Aucun mock de `rendezVousContexte`/`getRendezVousAvecContexte` ici, volontairement :
// cette page ne les importe jamais.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { materialiserVisite, marquerVisiteRealisee, annulerVisite } = await import("@/lib/visiteRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const VisitePage = (await import("./page")).default;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
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
  });
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
  });
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
    const visite = await materialiserVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      datePrevue: "2026-09-10",
      rendezVousCalendarId: `gcal-fiche-${bien.id}`,
    });

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
  });

  it("visite realisee : compte rendu affiché avec intérêt, aucune action de planification", async () => {
    const bien = await creerBienDeTest("REAL1");
    const acquereur = await creerAcquereurDeTest("REAL1");
    const visite = await materialiserVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      datePrevue: "2026-08-01",
      rendezVousCalendarId: `gcal-fiche-${bien.id}`,
    });
    await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      visiteId: visite.id,
      dateVisite: "2026-08-01",
      retour: "[test réel] Très bon retour, intéressé par une offre.",
      interet: "interesse",
      prochaineEtape: "Envoyer une contre-proposition",
    });
    await marquerVisiteRealisee(visite.id);

    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Réalisée");
    expect(html).toContain("Intéressé");
    expect(html).toContain("Très bon retour");
    expect(html).toContain("Envoyer une contre-proposition");
    expect(html).not.toContain("Annuler la visite");
    expect(html).not.toContain("Préparer / renseigner le compte rendu");
  });

  it("visite annulee : statut affiché, aucun compte rendu, aucune action de planification", async () => {
    const bien = await creerBienDeTest("ANN1");
    const acquereur = await creerAcquereurDeTest("ANN1");
    const visite = await materialiserVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      datePrevue: "2026-09-10",
      rendezVousCalendarId: `gcal-fiche-${bien.id}`,
    });
    await annulerVisite(visite.id);

    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Annulée");
    expect(html).not.toContain("Compte rendu");
    expect(html).not.toContain("Annuler la visite");
    expect(html).not.toContain("Préparer / renseigner le compte rendu");
  });
});
