import { afterAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";

// Test d'intégration réel (Postgres local) — couvre spécifiquement photoPrincipaleId sur
// listerBiens()/rechercherBiensPage() (ADR-052 §16, N+1). Un bug de qualification SQL dans la
// sous-requête corrélée (photoPrincipaleIdSubquery, photoBienRepository.ts) a d'abord fait
// échouer ce test — biens.id non qualifié se résolvait contre photos_bien.id à l'intérieur de la
// sous-requête, jamais contre le bien externe : photoPrincipaleId restait toujours NULL.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const REFERENCE_PREFIX = "[test réel] ADR052-BIEN-PHOTO-PRINCIPALE";
const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien, listerBiens, rechercherBiensPage } = await import("./bienRepository");
const { ajouterPhotoBien } = await import("./photoBienRepository");

afterAll(async () => {
  // ON DELETE CASCADE nettoie photos_bien.
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
});

async function bienTest(suffixe: string) {
  return creerBien({
    reference: `${REFERENCE_PREFIX}-${suffixe}`,
    titre: "Bien de test photoPrincipaleId",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
}

describe("bienRepository — photoPrincipaleId (ADR-052)", () => {
  it("rechercherBiensPage() : bien sans photo → photoPrincipaleId undefined ; bien avec photo → id de la photo", async () => {
    const sansPhoto = await bienTest("SANS");
    const avecPhoto = await bienTest("AVEC");
    const photo = await ajouterPhotoBien({
      bienId: avecPhoto.id,
      cleStockage: "cle-repo-test",
      nomFichierOriginal: "x.jpg",
      typeMimeOriginal: "image/jpeg",
      tailleOctetsOriginal: 10,
      hashSha256: "hash-repo-test",
    });

    const { lignes } = await rechercherBiensPage({ q: REFERENCE_PREFIX, archives: false, page: 1, parPage: 50 });

    const ligneSansPhoto = lignes.find((l) => l.id === sansPhoto.id);
    const ligneAvecPhoto = lignes.find((l) => l.id === avecPhoto.id);
    expect(ligneSansPhoto?.photoPrincipaleId).toBeUndefined();
    expect(ligneAvecPhoto?.photoPrincipaleId).toBe(photo.id);
  });

  it("rechercherBiensPage() : plusieurs photos → photoPrincipaleId désigne la même photo que getPhotoPrincipaleBien()", async () => {
    const { getPhotoPrincipaleBien } = await import("./photoBienRepository");
    const bien = await bienTest("PLUSIEURS");
    await ajouterPhotoBien({
      bienId: bien.id,
      cleStockage: "cle-repo-1",
      nomFichierOriginal: "1.jpg",
      typeMimeOriginal: "image/jpeg",
      tailleOctetsOriginal: 10,
      hashSha256: "h1",
    });
    const p2 = await ajouterPhotoBien({
      bienId: bien.id,
      cleStockage: "cle-repo-2",
      nomFichierOriginal: "2.jpg",
      typeMimeOriginal: "image/jpeg",
      tailleOctetsOriginal: 10,
      hashSha256: "h2",
    });
    void p2;

    const principaleAttendue = await getPhotoPrincipaleBien(bien.id);
    const { lignes } = await rechercherBiensPage({
      q: `${REFERENCE_PREFIX}-PLUSIEURS`,
      archives: false,
      page: 1,
      parPage: 10,
    });
    expect(lignes[0]?.photoPrincipaleId).toBe(principaleAttendue?.id);
  });

  it("listerBiens() (repli mock désactivé dès qu'un bien réel existe) : retourne aussi photoPrincipaleId pour les biens réels", async () => {
    const avecPhoto = await bienTest("LISTERBIENS");
    const photo = await ajouterPhotoBien({
      bienId: avecPhoto.id,
      cleStockage: "cle-repo-listerbiens",
      nomFichierOriginal: "x.jpg",
      typeMimeOriginal: "image/jpeg",
      tailleOctetsOriginal: 10,
      hashSha256: "hash-listerbiens",
    });

    const biens = await listerBiens();
    const ligne = biens.find((b) => b.id === avecPhoto.id);
    expect(ligne?.photoPrincipaleId).toBe(photo.id);
  });
});
