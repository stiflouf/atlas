import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";

// Test d'intégration réel (ADR-044) — route canonique de création d'Offre. Vraie base Postgres,
// même patron que src/app/visites/[id]/page.test.tsx : aucune query param n'est jamais traitée
// comme un fait métier, chaque scénario vérifie la revalidation serveur (id inexistant, id
// archivé, correspondance bien/acquéreur/CR) plutôt que de supposer le préremplissage fiable.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, offres: offresTable, comptesRendusVisite: comptesRendusVisiteTable } =
  await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { enregistrerOffre } = await import("@/lib/offreRepository");
const NouvelleOffrePage = (await import("./page")).default;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsComptesRendusCrees: string[] = [];
const idsOffresCrees: string[] = [];

afterAll(async () => {
  for (const id of idsOffresCrees) await getDb().delete(offresTable).where(eq(offresTable.id, id));
  for (const id of idsComptesRendusCrees) await getDb().delete(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] OFFRE-NOUVEAU-${suffixe}`,
    titre: `Bien offre nouveau ${suffixe}`,
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
    nom: `[test réel] Offre Nouveau ${suffixe}`,
    email: `test-réel-offre-nouveau-${suffixe}@example.com`,
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

describe("/offres/nouveau — route canonique de création (ADR-044)", () => {
  it("sans bienId : état honnête, aucun formulaire, lien vers /biens", async () => {
    const html = renderToStaticMarkup(await NouvelleOffrePage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Aucun bien valide");
    expect(html).toContain('href="/biens"');
    expect(html).not.toContain("Ajouter l'offre");
  });

  it("bienId inexistant : état honnête, jamais une erreur non gérée", async () => {
    const html = renderToStaticMarkup(
      await NouvelleOffrePage({ searchParams: Promise.resolve({ bienId: "00000000-0000-0000-0000-000000000000" }) })
    );
    expect(html).toContain("Aucun bien valide");
  });

  it("bienId archivé : état honnête, jamais un formulaire menant à un échec garanti", async () => {
    const bien = await creerBienDeTest("ARCHIVE1");
    await archiverBien(bien.id);

    const html = renderToStaticMarkup(await NouvelleOffrePage({ searchParams: Promise.resolve({ bienId: bien.id }) }));
    expect(html).toContain("Aucun bien valide");
  });

  it("bienId seul, valide : Bien affiché, Acquéreur en sélection libre (parcours normal)", async () => {
    const bien = await creerBienDeTest("BIENSEUL1");
    const acquereur = await creerAcquereurDeTest("BIENSEUL1");

    const html = renderToStaticMarkup(await NouvelleOffrePage({ searchParams: Promise.resolve({ bienId: bien.id }) }));
    expect(html).toContain(bien.titre);
    expect(html).toContain("Prix du bien");
    // Acquéreur en <select>, jamais verrouillé, car acquereurId absent des query params.
    expect(html).toContain(`<option`);
    expect(html).toContain(`${acquereur.prenom} ${acquereur.nom}`);
  });

  it("contexte complet et cohérent (Visite) : Bien/Acquéreur verrouillés, compte rendu pré-associé", async () => {
    const bien = await creerBienDeTest("CTXVALIDE1");
    const acquereur = await creerAcquereurDeTest("CTXVALIDE1");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "[test réel] Très intéressé.",
      interet: "interesse",
    });
    idsComptesRendusCrees.push(cr.id);

    const html = renderToStaticMarkup(
      await NouvelleOffrePage({
        searchParams: Promise.resolve({ bienId: bien.id, acquereurId: acquereur.id, compteRenduVisiteId: cr.id }),
      })
    );
    expect(html).toContain(bien.titre);
    // Acquéreur affiché en texte verrouillé, jamais un <select> (aucune option acquéreur listée).
    expect(html).toContain(`${acquereur.prenom} ${acquereur.nom}`);
    expect(html).not.toContain("<option");
    // Visite associée pré-remplie (hidden input avec l'id exact du CR).
    expect(html).toContain(`value="${cr.id}"`);
    expect(html).toContain("Visite associée");
  });

  it("acquereurId inexistant/archivé : préremplissage ignoré, retombe sur la sélection libre — jamais une erreur", async () => {
    const bien = await creerBienDeTest("ACQINVALIDE1");
    const acquereurArchive = await creerAcquereurDeTest("ACQINVALIDE1");
    await archiverAcquereur(acquereurArchive.id);

    const html = renderToStaticMarkup(
      await NouvelleOffrePage({ searchParams: Promise.resolve({ bienId: bien.id, acquereurId: acquereurArchive.id }) })
    );
    expect(html).toContain(bien.titre);
    // Retombe en mode non verrouillé : un <select> apparaît (acquéreur archivé exclu de la
    // logique de verrouillage, jamais affiché comme "l'acquéreur" figé de ce parcours).
    expect(html).toContain("<option");
    expect(html).not.toContain("Visite associée");
  });

  it("compteRenduVisiteId incohérent (autre acquéreur) : ignoré silencieusement, jamais une substitution", async () => {
    const bien = await creerBienDeTest("CRINCOHERENT1");
    const acquereur = await creerAcquereurDeTest("CRINCOHERENT1");
    const autreAcquereur = await creerAcquereurDeTest("CRINCOHERENT1-B");
    const crAutreAcquereur = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: autreAcquereur.id,
      dateVisite: "2026-08-01",
      retour: "[test réel] Visite d'un autre acquéreur.",
      interet: "interesse",
    });
    idsComptesRendusCrees.push(crAutreAcquereur.id);

    const html = renderToStaticMarkup(
      await NouvelleOffrePage({
        searchParams: Promise.resolve({ bienId: bien.id, acquereurId: acquereur.id, compteRenduVisiteId: crAutreAcquereur.id }),
      })
    );
    // Acquéreur verrouillé (il était valide indépendamment), mais aucune visite associée —
    // jamais la visite de l'autre acquéreur substituée silencieusement.
    expect(html).toContain(`${acquereur.prenom} ${acquereur.nom}`);
    expect(html).not.toContain("Visite associée");
    expect(html).not.toContain(`value="${crAutreAcquereur.id}"`);
  });

  it("offre en_cours déjà existante pour la paire : avertissement affiché", async () => {
    const bien = await creerBienDeTest("OFFREENCOURS1");
    const acquereur = await creerAcquereurDeTest("OFFREENCOURS1");
    const offre = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre: "2026-08-01" });
    idsOffresCrees.push(offre.id);

    const html = renderToStaticMarkup(
      await NouvelleOffrePage({ searchParams: Promise.resolve({ bienId: bien.id, acquereurId: acquereur.id }) })
    );
    expect(html).toContain("Une offre en cours existe déjà");
    expect(html).toContain("Créer tout de même une nouvelle offre");
  });

  it("aucune offre en_cours pour la paire : aucun avertissement", async () => {
    const bien = await creerBienDeTest("SANSOFFREENCOURS1");
    const acquereur = await creerAcquereurDeTest("SANSOFFREENCOURS1");

    const html = renderToStaticMarkup(
      await NouvelleOffrePage({ searchParams: Promise.resolve({ bienId: bien.id, acquereurId: acquereur.id }) })
    );
    expect(html).not.toContain("Une offre en cours existe déjà");
  });
});
