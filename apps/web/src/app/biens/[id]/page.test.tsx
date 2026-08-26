import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { like } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { ajouterPhotoBien } = await import("@/lib/photoBienRepository");
const FicheBien = (await import("./page")).default;

// Test réel d'intégration (même pattern que biens/page.test.tsx, ADR-048) — un bug réel a échappé
// aux tests unitaires isolés de BienHero/BienGaleriePhotos car aucun test n'exerçait leur câblage
// RÉEL dans page.tsx (props effectivement transmises depuis getPhotoPrincipaleBien/listerPhotosBien).
// Celui-ci rend la vraie page Server Component sur un vrai Bien/de vraies photos en base.
const REFERENCE_PREFIX = "[test réel] FICHE-BIEN-PHOTOS";
const idsCrees: string[] = [];

afterAll(async () => {
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
});

function bienTest(suffixe: string) {
  return {
    reference: `${REFERENCE_PREFIX}-${suffixe}`,
    titre: "Bien de test fiche",
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
  };
}

describe("/biens/[id] — câblage réel du Hero et du filmstrip selon le nombre de photos (ADR-052)", () => {
  it("0 photo : fallback Visuel DOMIORA, CTA Ajouter des photos, pas de filmstrip", async () => {
    const bien = await creerBien(bienTest("0-PHOTO"));
    idsCrees.push(bien.id);

    const element = await FicheBien({ params: Promise.resolve({ id: bien.id }) });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain("/api/photos-bien/");
    expect(html).toContain("Visuel DOMIORA");
    expect(html).toContain("Ajouter des photos");
    expect(html).not.toContain("Gérer les photos");
  });

  it("1 photo : vraie photo principale, CTA Gérer les photos, jamais Visuel DOMIORA, pas de filmstrip", async () => {
    const bien = await creerBien(bienTest("1-PHOTO"));
    idsCrees.push(bien.id);
    const photo = await ajouterPhotoBien({
      bienId: bien.id,
      cleStockage: "cle-test-fiche-1",
      nomFichierOriginal: "photo-1.jpg",
      typeMimeOriginal: "image/jpeg",
      tailleOctetsOriginal: 1024,
      hashSha256: "hash-test-fiche-1",
    });

    const element = await FicheBien({ params: Promise.resolve({ id: bien.id }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain(`/api/photos-bien/${photo.id}`);
    expect(html).not.toContain("Visuel DOMIORA");
    expect(html).toContain("Gérer les photos");
    expect(html).not.toContain("Ajouter des photos");
    // Pas de filmstrip : le lien vers la gestion des photos n'apparaît qu'une seule fois (le CTA
    // du hero) — s'il y en avait un deuxième, ce serait la tuile finale du filmstrip.
    const liensGestion = html.match(new RegExp(`href="/biens/${bien.id}/photos"`, "g"));
    expect(liensGestion?.length).toBe(1);
  });

  it("2 photos : filmstrip réellement rendu (les deux vraies photos, dans l'ordre ADR-052), CTA Gérer les photos", async () => {
    const bien = await creerBien(bienTest("2-PHOTOS"));
    idsCrees.push(bien.id);
    const photoA = await ajouterPhotoBien({
      bienId: bien.id,
      cleStockage: "cle-test-fiche-2a",
      nomFichierOriginal: "photo-a.jpg",
      typeMimeOriginal: "image/jpeg",
      tailleOctetsOriginal: 1024,
      hashSha256: "hash-test-fiche-2a",
    });
    const photoB = await ajouterPhotoBien({
      bienId: bien.id,
      cleStockage: "cle-test-fiche-2b",
      nomFichierOriginal: "photo-b.png",
      typeMimeOriginal: "image/png",
      tailleOctetsOriginal: 2048,
      hashSha256: "hash-test-fiche-2b",
    });

    const element = await FicheBien({ params: Promise.resolve({ id: bien.id }) });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain("Visuel DOMIORA");
    expect(html).toContain("Gérer les photos");
    expect(html).not.toContain("Ajouter des photos");

    // photoA (principale, ordre=0) doit apparaître DEUX fois : une fois dans le hero, une fois
    // dans la vignette du filmstrip. photoB (ordre=1) ne peut apparaître QUE dans le filmstrip —
    // si le filmstrip n'était pas rendu (le bug observé), cette assertion échouerait à 0.
    const occurrencesPhotoA = html.match(new RegExp(`/api/photos-bien/${photoA.id}`, "g"));
    const occurrencesPhotoB = html.match(new RegExp(`/api/photos-bien/${photoB.id}`, "g"));
    expect(occurrencesPhotoA?.length).toBe(2);
    expect(occurrencesPhotoB?.length).toBe(1);

    // Ordre ADR-052 (ordre ASC, cree_le ASC, id ASC) préservé dans le filmstrip : la vignette de
    // photoA (sa deuxième occurrence, après celle du hero) précède celle de photoB.
    expect(html.lastIndexOf(`/api/photos-bien/${photoA.id}`)).toBeLessThan(
      html.indexOf(`/api/photos-bien/${photoB.id}`)
    );
    expect(html.match(/Principale/g)?.length).toBe(1);
  });
});
