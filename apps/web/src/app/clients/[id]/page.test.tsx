import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, like } from "drizzle-orm";

// Test d'intégration réel (même pattern que biens/page.test.tsx et biens/[id]/page.test.tsx,
// ADR-048) — vraie base Postgres, vraie page Server Component. La leçon du chantier Fiche Bien
// Premium s'applique ici aussi : un câblage correct en apparence (repository -> orchestration ->
// page -> composant) doit être vérifié de bout en bout, pas seulement composant par composant.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { ajouterSecteurRecherche } = await import("@/lib/secteurRechercheRepository");
const { materialiserVisite, marquerVisiteRealisee } = await import("@/lib/visiteRepository");
const { creerTache, terminerTache, getTacheById } = await import("@/lib/tacheRepository");
const FicheClient = (await import("./page")).default;

// Toutes les pages de ce fichier n'utilisent pas tacheTerminee : ce helper évite de le répéter à
// chaque appel existant.
function rendreFiche(id: string, tacheTerminee?: string) {
  return FicheClient({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tacheTerminee }) });
}

const REFERENCE_PREFIX = "[test réel] FICHE-ACQUEREUR";
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
});

async function bienDeTest(suffixe: string, overrides: Partial<Parameters<typeof creerBien>[0]> = {}) {
  const bien = await creerBien({
    reference: `${REFERENCE_PREFIX}-${suffixe}`,
    titre: `Bien de test fiche acquéreur ${suffixe}`,
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 60,
    pieces: 3,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...overrides,
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function acquereurDeTest(suffixe: string, overrides: Partial<Parameters<typeof creerAcquereur>[0]> = {}) {
  const acquereur = await creerAcquereur({
    prenom: "Julien",
    nom: `[test réel] Acquéreur ${suffixe}`,
    email: `test-réel-acquereur-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-15",
    ...overrides,
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

describe("/clients/[id] — Fiche Acquéreur Premium", () => {
  it("brief incomplet et aucun secteur : Hero réel, Non renseigné honnête, conséquence réelle expliquée", async () => {
    const acquereur = await acquereurDeTest("BRIEF-INCOMPLET");

    const element = await rendreFiche(acquereur.id);
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Julien");
    expect(html).toContain(acquereur.nom);
    expect(html).toContain("200");
    expect(html).toContain("400");
    // Brief : piecesMin, surfaceMin, exterieur, parking, accessibilité — 5 champs structurés
    // absents, chacun "Non renseigné", jamais une valeur fictive.
    expect(html.match(/Non renseigné/g)?.length).toBe(5);
    expect(html).not.toMatch(/type de bien/i);
    // Conséquence réelle du moteur (criteres.ts, evaluerSecteur) quand aucun secteur n'existe.
    expect(html).toContain("le critère géographique ne sera évalué pour aucun bien comparé");
  });

  it("bien réellement compatible (budget, secteur, pièces, surface, parking, extérieur, accessibilité) : carte réelle avec explication et lien vers la fiche", async () => {
    const acquereur = await acquereurDeTest("MATCH", {
      budgetMax: 500000,
      piecesMin: 3,
      surfaceMin: 50,
      necessiteParking: true,
      necessiteExterieur: true,
      accessibiliteRequise: true,
    });
    await ajouterSecteurRecherche(acquereur.id, {
      citycode: "69381",
      nom: "Lyon 1er Arrondissement",
      codePostal: "69001",
      contexte: "69, Rhône, Auvergne-Rhône-Alpes",
    });
    const bien = await bienDeTest("MATCH", {
      prix: 420000,
      pieces: 4,
      surface: 70,
      parking: true,
      exterieur: "balcon",
      etage: 2,
      ascenseur: true,
      codeInseeCommune: "69381",
    });

    const element = await rendreFiche(acquereur.id);
    const html = renderToStaticMarkup(element);

    expect(html).toContain(bien.titre);
    expect(html).toContain(`href="/biens/${bien.id}"`);
    expect(html).toContain("70 m²");
    expect(html).toContain("4 pièces");
    // Au moins une vraie explication produite par le moteur, jamais un score/pourcentage.
    expect(html).toMatch(/respecte le budget maximum|situé à Lyon 1er Arrondissement/);
    expect(html).not.toMatch(/%\s*compatib/i);
    expect(html).not.toMatch(/\bscore\b/i);
  });

  it("visite planifiée : CTA Préparer réel vers /visites/[id]/preparer ; une fois réalisée, CTA absent et jamais de compte rendu inventé", async () => {
    const acquereur = await acquereurDeTest("VISITE");
    const bien = await bienDeTest("VISITE");
    const visite = await materialiserVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      datePrevue: "2026-09-10",
      rendezVousCalendarId: `gcal-fiche-acquereur-${bien.id}`,
    });

    const avantRealisation = renderToStaticMarkup(
      await rendreFiche(acquereur.id)
    );
    expect(avantRealisation).toContain(`href="/visites/${visite.id}/preparer"`);
    expect(avantRealisation).toContain(bien.titre);

    await marquerVisiteRealisee(visite.id);

    const apresRealisation = renderToStaticMarkup(
      await rendreFiche(acquereur.id)
    );
    expect(apresRealisation).not.toContain(`href="/visites/${visite.id}/preparer"`);
    expect(apresRealisation).toContain("Réalisée");
    expect(apresRealisation).not.toMatch(/compte[\s-]?rendu/i);
  });
});

describe("/clients/[id] — feedback de complétion d'une tâche (correctif UX)", () => {
  it("tâche active : visible dans la liste, aucun encart de confirmation, section terminées absente", async () => {
    const acquereur = await acquereurDeTest("TACHE-ACTIVE");
    const tache = await creerTache({
      titre: "[test réel] Relancer avant vendredi",
      type: "appel",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "acquereur", id: acquereur.id },
    });

    const html = renderToStaticMarkup(await rendreFiche(acquereur.id));
    expect(html).toContain(tache.titre);
    expect(html).not.toMatch(/tâche terminée/i);
    expect(html).not.toMatch(/tâches? terminées? — afficher/i);
    // Contrôle interactif de complétion réellement présent (TacheItem), jamais un marqueur inerte.
    expect(html).toContain('aria-label="Marquer comme terminée"');
  });

  it("?tacheTerminee=<id> après complétion réelle : encart de confirmation, section terminées ouverte automatiquement, tâche réellement conservée (jamais supprimée)", async () => {
    const acquereur = await acquereurDeTest("TACHE-TERMINEE");
    const tache = await creerTache({
      titre: "[test réel] Envoyer les diagnostics",
      type: "document",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "acquereur", id: acquereur.id },
    });
    await terminerTache(tache.id);

    const html = renderToStaticMarkup(await rendreFiche(acquereur.id, tache.id));

    // Feedback explicite, jamais un simple silence après disparition de la liste active.
    expect(html).toContain(`Tâche terminée : « ${tache.titre} »`);
    // Section repliée ouverte automatiquement (attribut natif <details open>), et la tâche
    // apparaît bien à l'intérieur de cette section ouverte.
    const indexDetailsOuvert = html.indexOf('<details class="mt-2" open="">');
    expect(indexDetailsOuvert).toBeGreaterThan(-1);
    expect(html.indexOf(tache.titre, indexDetailsOuvert)).toBeGreaterThan(indexDetailsOuvert);
    // Liste active réellement vide désormais (seule tâche de cet acquéreur, maintenant terminée).
    expect(html).toContain("Aucune tâche en cours.");

    // Marqueur Check non interactif (correctif polish) — un carré vide ressemblait trop à la case
    // active. L'information ne dépend jamais uniquement de la couleur (aria-label), et la zone ne
    // contient aucun contrôle de réouverture (aucun <form>/<button> : aucune transition
    // terminée -> active n'existe côté modèle).
    const zoneTerminee = html.slice(indexDetailsOuvert);
    expect(zoneTerminee).toContain('aria-label="Tâche terminée"');
    expect(zoneTerminee).not.toContain("<form");
    expect(zoneTerminee).not.toContain("<button");

    // Jamais une suppression physique : la tâche existe toujours réellement en base.
    const tacheEnBase = await getTacheById(tache.id);
    expect(tacheEnBase).toBeDefined();
    expect(tacheEnBase?.termineeLe).toBeTruthy();
  });

  it("id de query param non lié à une vraie tâche terminée de cet acquéreur : aucun encart, jamais une fausse confirmation", async () => {
    const acquereur = await acquereurDeTest("TACHE-ID-INVALIDE");
    const html = renderToStaticMarkup(await rendreFiche(acquereur.id, "id-inexistant-ou-etranger"));
    expect(html).not.toMatch(/tâche terminée/i);
  });
});
