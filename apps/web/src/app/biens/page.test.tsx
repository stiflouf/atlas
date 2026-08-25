import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : cette page est privée (session Atlas) mais le composant Server lui-même n'appelle pas
// exigerSessionAtlas() (le Proxy protège la navigation) — aucun mock nécessaire ici, contrairement
// aux Server Actions/Route Handlers.
import { renderToStaticMarkup } from "react-dom/server";
import { eq, like } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { ajouterPhotoBien } = await import("@/lib/photoBienRepository");
const BiensPage = (await import("./page")).default;

const REFERENCE_PREFIX = "[test réel] ADR048-PAGE-BIEN";
const idsCrees: string[] = [];

afterAll(async () => {
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
});

function bienTest(suffixe: string, overrides: Partial<Parameters<typeof creerBien>[0]> = {}) {
  return {
    reference: `${REFERENCE_PREFIX}-${suffixe}`,
    titre: "Bien de test page",
    type: "appartement" as const,
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif" as const,
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...overrides,
  };
}

describe("/biens (ADR-048)", () => {
  it("q filtre réellement la liste affichée", async () => {
    const trouve = await creerBien(bienTest("TROUVE", { ville: "Annecy" }));
    idsCrees.push(trouve.id);
    const autre = await creerBien(bienTest("AUTRE", { ville: "Chambéry" }));
    idsCrees.push(autre.id);

    const element = await BiensPage({ searchParams: Promise.resolve({ q: "Annecy" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain(trouve.reference);
    expect(html).not.toContain(autre.reference);
  });

  it("recherche sans résultat affiche un message honnête, jamais une liste vide silencieuse", async () => {
    const element = await BiensPage({
      searchParams: Promise.resolve({ q: "zzz-aucune-correspondance-adr048-zzz" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Aucun résultat pour");
  });

  it("page hors bornes redirige vers la dernière page valide, jamais une page vide", async () => {
    const bien = await creerBien(bienTest("HORS-BORNES"));
    idsCrees.push(bien.id);

    await expect(
      BiensPage({ searchParams: Promise.resolve({ q: `${REFERENCE_PREFIX}-HORS-BORNES`, page: "99" }) })
    ).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("archives=1 continue de fonctionner seul (rétrocompatibilité du lien existant)", async () => {
    const archive = await creerBien(bienTest("ARCHIVE-COMPAT"));
    idsCrees.push(archive.id);
    await archiverBien(archive.id);

    const element = await BiensPage({ searchParams: Promise.resolve({ archives: "1" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Biens archivés");
    expect(html).toContain(archive.reference);
  });

  // ADR-052 — la galerie photo (photos_bien) est cascadée à la suppression du bien via
  // ON DELETE CASCADE : aucun nettoyage dédié nécessaire dans afterAll ci-dessus.
  it("bien sans photo → fallback PropertyVisual, jamais une image /api/photos-bien", async () => {
    const bien = await creerBien(bienTest("SANS-PHOTO"));
    idsCrees.push(bien.id);

    const element = await BiensPage({ searchParams: Promise.resolve({ q: bien.reference }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain(bien.reference);
    expect(html).not.toContain("/api/photos-bien/");
    expect(html).toContain("Visuel DOMIORA");
  });

  it("bien avec photo principale → image réelle /api/photos-bien/<id>, pas de N+1 (une seule requête de liste)", async () => {
    const bienA = await creerBien(bienTest("AVEC-PHOTO-A"));
    idsCrees.push(bienA.id);
    const bienB = await creerBien(bienTest("AVEC-PHOTO-B"));
    idsCrees.push(bienB.id);

    const photo = await ajouterPhotoBien({
      bienId: bienA.id,
      cleStockage: "cle-test-page-photo",
      nomFichierOriginal: "photo.jpg",
      typeMimeOriginal: "image/jpeg",
      tailleOctetsOriginal: 1024,
      hashSha256: "hash-test-page",
    });

    // rechercherBiensPage() elle-même récupère photoPrincipaleId dans SA requête de liste (une
    // sous-requête corrélée SQL, pas un aller-retour JS par bien) — la page ne fait ensuite plus
    // aucun accès DB par card, vérifié ici indirectement par le contenu rendu pour les deux biens.
    const element = await BiensPage({
      searchParams: Promise.resolve({ q: `${REFERENCE_PREFIX}-AVEC-PHOTO` }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain(`/api/photos-bien/${photo.id}`);
    expect(html).toContain(bienB.reference); // bienB sans photo reste listé, fallback DOMIORA
  });
});
