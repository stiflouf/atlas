import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";

// Test d'intégration réel (ADR-045) — route canonique de création de Compromis. Vraie base
// Postgres, même patron que src/app/offres/nouveau/page.test.tsx : aucune query param n'est jamais
// traitée comme un fait métier, chaque scénario vérifie la revalidation serveur.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, offres: offresTable, compromis: compromisTable } =
  await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { enregistrerOffre, changerStatutOffre } = await import("@/lib/offreRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const NouveauCompromisPage = (await import("./page")).default;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsOffresCrees: string[] = [];
const idsCompromisCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsOffresCrees) await getDb().delete(offresTable).where(eq(offresTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] COMPROMIS-NOUVEAU-${suffixe}`,
    titre: `Bien compromis nouveau ${suffixe}`,
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
    nom: `[test réel] Compromis Nouveau ${suffixe}`,
    email: `test-réel-compromis-nouveau-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

async function creerOffreAccepteeDeTest(bienId: string, acquereurId: string, montant: number) {
  const offre = await enregistrerOffre({ bienId, acquereurId, montant, dateOffre: "2026-08-01" });
  idsOffresCrees.push(offre.id);
  await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-02" });
  return offre;
}

describe("/compromis/nouveau — route canonique de création (ADR-045)", () => {
  it("sans bienId : état honnête, aucun formulaire, lien vers /biens", async () => {
    const html = renderToStaticMarkup(await NouveauCompromisPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Aucun bien valide");
    expect(html).toContain('href="/biens"');
    expect(html).not.toContain("Ajouter le compromis");
  });

  it("bienId inexistant : état honnête, jamais une erreur non gérée", async () => {
    const html = renderToStaticMarkup(
      await NouveauCompromisPage({ searchParams: Promise.resolve({ bienId: "00000000-0000-0000-0000-000000000000" }) })
    );
    expect(html).toContain("Aucun bien valide");
  });

  it("bienId archivé : état honnête, jamais un formulaire menant à un échec garanti", async () => {
    const bien = await creerBienDeTest("ARCHIVE1");
    await archiverBien(bien.id);

    const html = renderToStaticMarkup(await NouveauCompromisPage({ searchParams: Promise.resolve({ bienId: bien.id }) }));
    expect(html).toContain("Aucun bien valide");
  });

  it("compromis déjà en_cours pour le bien : état honnête, formulaire jamais affiché", async () => {
    const bien = await creerBienDeTest("ENCOURS1");
    const acquereur = await creerAcquereurDeTest("ENCOURS1");
    const compromisExistant = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 280000,
      dateSignature: "2026-07-01",
    });
    idsCompromisCrees.push(compromisExistant.id);

    const html = renderToStaticMarkup(await NouveauCompromisPage({ searchParams: Promise.resolve({ bienId: bien.id }) }));
    expect(html).toContain("Un compromis est déjà en cours pour ce bien");
    expect(html).not.toContain("Ajouter le compromis");
  });

  it("compromis historique (realise/annule) : ne bloque jamais une nouvelle création", async () => {
    const bien = await creerBienDeTest("HISTORIQUE1");
    const acquereur = await creerAcquereurDeTest("HISTORIQUE1");
    const compromisAncien = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 280000,
      dateSignature: "2026-06-01",
    });
    idsCompromisCrees.push(compromisAncien.id);
    const { marquerCompromisAnnule } = await import("@/lib/compromisRepository");
    await marquerCompromisAnnule(compromisAncien.id, "2026-06-10", "desaccord_prix");

    const html = renderToStaticMarkup(await NouveauCompromisPage({ searchParams: Promise.resolve({ bienId: bien.id }) }));
    expect(html).not.toContain("Un compromis est déjà en cours");
    expect(html).toContain(bien.titre);
  });

  it("bienId seul, valide : Bien affiché, Acquéreur/Offre en sélection libre (parcours normal)", async () => {
    const bien = await creerBienDeTest("BIENSEUL1");
    const acquereur = await creerAcquereurDeTest("BIENSEUL1");

    const html = renderToStaticMarkup(await NouveauCompromisPage({ searchParams: Promise.resolve({ bienId: bien.id }) }));
    expect(html).toContain(bien.titre);
    expect(html).toContain("Aucune (compromis direct)");
    expect(html).toContain(`${acquereur.prenom} ${acquereur.nom}`);
  });

  it("contexte complet et cohérent (Offre acceptée) : Bien/Acquéreur/Offre verrouillés, montant affiché", async () => {
    const bien = await creerBienDeTest("CTXVALIDE1");
    const acquereur = await creerAcquereurDeTest("CTXVALIDE1");
    const offre = await creerOffreAccepteeDeTest(bien.id, acquereur.id, 340000);

    const html = renderToStaticMarkup(
      await NouveauCompromisPage({
        searchParams: Promise.resolve({ bienId: bien.id, acquereurId: acquereur.id, offreId: offre.id }),
      })
    );
    expect(html).toContain(bien.titre);
    expect(html).toContain(`${acquereur.prenom} ${acquereur.nom}`);
    expect(html).toMatch(/340\s000/); // espace insécable Intl.NumberFormat fr-FR
    expect(html).toContain("Offre acceptée");
    // Verrouillé : aucun <select> (ni Acquéreur, ni Offre) ne doit apparaître.
    expect(html).not.toContain("<option");
    // Le montant de l'offre n'est jamais préempli dans le champ prixConvenu.
    expect(html).not.toMatch(/name="prixConvenu"[^>]*value="340000"/);
  });

  it("acquereurId inexistant/archivé : préremplissage ignoré, retombe sur la sélection libre", async () => {
    const bien = await creerBienDeTest("ACQINVALIDE1");
    const acquereurArchive = await creerAcquereurDeTest("ACQINVALIDE1");
    await archiverAcquereur(acquereurArchive.id);

    const html = renderToStaticMarkup(
      await NouveauCompromisPage({ searchParams: Promise.resolve({ bienId: bien.id, acquereurId: acquereurArchive.id }) })
    );
    expect(html).toContain(bien.titre);
    expect(html).toContain("<option");
    expect(html).not.toContain("Offre acceptée");
  });

  it("offreId d'un autre bien : ignoré silencieusement, jamais une substitution", async () => {
    const bien = await creerBienDeTest("OFFREAUTREBIEN-A");
    const autreBien = await creerBienDeTest("OFFREAUTREBIEN-B");
    const acquereur = await creerAcquereurDeTest("OFFREAUTREBIEN1");
    const offreAutreBien = await creerOffreAccepteeDeTest(autreBien.id, acquereur.id, 350000);

    const html = renderToStaticMarkup(
      await NouveauCompromisPage({
        searchParams: Promise.resolve({ bienId: bien.id, acquereurId: acquereur.id, offreId: offreAutreBien.id }),
      })
    );
    // Acquéreur verrouillé (valide indépendamment), mais aucune offre associée.
    expect(html).toContain(`${acquereur.prenom} ${acquereur.nom}`);
    expect(html).not.toContain("Offre acceptée");
    expect(html).toContain("<option"); // retombe sur le select Offre libre
  });

  it("offreId non acceptée (en_cours) : ignoré silencieusement, jamais verrouillé", async () => {
    const bien = await creerBienDeTest("OFFREENCOURS1");
    const acquereur = await creerAcquereurDeTest("OFFREENCOURS1");
    const offreEnCours = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre: "2026-08-01" });
    idsOffresCrees.push(offreEnCours.id);

    const html = renderToStaticMarkup(
      await NouveauCompromisPage({
        searchParams: Promise.resolve({ bienId: bien.id, acquereurId: acquereur.id, offreId: offreEnCours.id }),
      })
    );
    expect(html).not.toContain("Offre acceptée");
  });

  it("offre déjà associée à un compromis : état honnête, formulaire jamais affiché, jamais un lien vers une fiche Compromis inexistante", async () => {
    const bien = await creerBienDeTest("OFFREUTILISEE1");
    const acquereur = await creerAcquereurDeTest("OFFREUTILISEE1");
    const offre = await creerOffreAccepteeDeTest(bien.id, acquereur.id, 320000);
    const compromisExistant = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      offreId: offre.id,
      prixConvenu: 320000,
      dateSignature: "2026-08-05",
    });
    idsCompromisCrees.push(compromisExistant.id);
    // Passé à 'realise' pour isoler la garde offre-déjà-utilisée de la garde "en_cours par bien".
    const { marquerCompromisRealise } = await import("@/lib/compromisRepository");
    await marquerCompromisRealise(compromisExistant.id, "2026-09-01");

    const html = renderToStaticMarkup(
      await NouveauCompromisPage({
        searchParams: Promise.resolve({ bienId: bien.id, acquereurId: acquereur.id, offreId: offre.id }),
      })
    );
    expect(html).toContain("Cette offre est déjà associée à un compromis");
    expect(html).not.toContain("Ajouter le compromis");
    expect(html).not.toContain("/compromis/" + compromisExistant.id);
  });
});
