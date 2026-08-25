import { afterAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";

// Test d'intégration réel (Postgres local) — la FK photos_bien -> biens impose un bienId réel.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, photosBien: photosBienTable } = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const {
  ajouterPhotoBien,
  ErreurLimitePhotosAtteinte,
  getPhotoPrincipaleBien,
  listerPhotosBien,
  reordonnerPhotosBien,
  supprimerPhotoBien,
} = await import("./photoBienRepository");
const { NOMBRE_MAX_PHOTOS_PAR_BIEN } = await import("@/types/photoBien");

const REFERENCE_PREFIX = "[test réel] ADR052-PHOTO-BIEN";
const idsBiensCrees: string[] = [];

afterAll(async () => {
  // ON DELETE CASCADE (bienId -> biens.id) nettoie photos_bien automatiquement.
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
});

async function creerBienTest(suffixe: string) {
  const bien = await creerBien({
    reference: `${REFERENCE_PREFIX}-${suffixe}`,
    titre: "Bien de test photos",
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
  idsBiensCrees.push(bien.id);
  return bien;
}

function nouvellePhoto(bienId: string, suffixe: string) {
  return {
    bienId,
    cleStockage: `cle-test-${suffixe}-${Math.random().toString(36).slice(2)}`,
    nomFichierOriginal: `photo-${suffixe}.jpg`,
    typeMimeOriginal: "image/jpeg",
    tailleOctetsOriginal: 1024,
    hashSha256: `hash-${suffixe}`,
  };
}

describe("photoBienRepository (intégration Postgres) — ADR-052", () => {
  it("listerPhotosBien() retourne [] pour une galerie vide et pour un id non-UUID", async () => {
    const bien = await creerBienTest("VIDE");
    await expect(listerPhotosBien(bien.id)).resolves.toEqual([]);
    await expect(listerPhotosBien("bien-mocke")).resolves.toEqual([]);
    await expect(getPhotoPrincipaleBien(bien.id)).resolves.toBeUndefined();
  });

  it("ajouterPhotoBien() place toujours en fin de galerie : 0 si vide, MAX(ordre)+1 sinon", async () => {
    const bien = await creerBienTest("ORDRE-FIN");
    const p1 = await ajouterPhotoBien(nouvellePhoto(bien.id, "1"));
    expect(p1.ordre).toBe(0);
    const p2 = await ajouterPhotoBien(nouvellePhoto(bien.id, "2"));
    expect(p2.ordre).toBe(1);
    const p3 = await ajouterPhotoBien(nouvellePhoto(bien.id, "3"));
    expect(p3.ordre).toBe(2);

    const galerie = await listerPhotosBien(bien.id);
    expect(galerie.map((p) => p.id)).toEqual([p1.id, p2.id, p3.id]);
  });

  it("getPhotoPrincipaleBien() = premier élément du tri total (ordre ASC, creeLe ASC, id ASC)", async () => {
    const bien = await creerBienTest("PRINCIPALE");
    const p1 = await ajouterPhotoBien(nouvellePhoto(bien.id, "1"));
    await ajouterPhotoBien(nouvellePhoto(bien.id, "2"));

    const principale = await getPhotoPrincipaleBien(bien.id);
    expect(principale?.id).toBe(p1.id);
  });

  it("collision d'ordre (état exceptionnel) : la principale reste déterministe via creeLe puis id", async () => {
    const bien = await creerBienTest("COLLISION-ORDRE");
    // Insertion directe (hors repository) pour forcer deux lignes au même ordre=0 — situation que
    // le repository ne produit jamais lui-même (MAX+1 sous verrou), mais que le tri total doit
    // départager sans ambiguïté si elle survenait.
    const [a, b] = await getDb()
      .insert(photosBienTable)
      .values([
        { ...nouvellePhoto(bien.id, "a"), ordre: 0 },
        { ...nouvellePhoto(bien.id, "b"), ordre: 0 },
      ])
      .returning();

    const galerie = await listerPhotosBien(bien.id);
    expect(galerie).toHaveLength(2);
    // Même tri (creeLe ASC puis id ASC) appliqué deux fois de suite : résultat stable.
    const principale1 = await getPhotoPrincipaleBien(bien.id);
    const principale2 = await getPhotoPrincipaleBien(bien.id);
    expect(principale1?.id).toBe(principale2?.id);
    expect([a.id, b.id]).toContain(principale1?.id);
    expect(galerie[0].id).toBe(principale1?.id);
  });

  it(`limite de ${NOMBRE_MAX_PHOTOS_PAR_BIEN} photos par bien : la ${NOMBRE_MAX_PHOTOS_PAR_BIEN + 1}e est rejetée`, async () => {
    const bien = await creerBienTest("LIMITE");
    for (let i = 0; i < NOMBRE_MAX_PHOTOS_PAR_BIEN; i++) {
      await ajouterPhotoBien(nouvellePhoto(bien.id, `l${i}`));
    }
    await expect(listerPhotosBien(bien.id)).resolves.toHaveLength(NOMBRE_MAX_PHOTOS_PAR_BIEN);
    await expect(ajouterPhotoBien(nouvellePhoto(bien.id, "l-trop"))).rejects.toThrow(ErreurLimitePhotosAtteinte);
    // La tentative rejetée n'a rien inséré : toujours exactement la limite, pas la limite + 1.
    await expect(listerPhotosBien(bien.id)).resolves.toHaveLength(NOMBRE_MAX_PHOTOS_PAR_BIEN);
  });

  it("concurrence : plusieurs ajouts simultanés ne dépassent jamais la limite (verrou de ligne)", async () => {
    const bien = await creerBienTest("CONCURRENCE");
    const dejaLa = NOMBRE_MAX_PHOTOS_PAR_BIEN - 2;
    for (let i = 0; i < dejaLa; i++) {
      await ajouterPhotoBien(nouvellePhoto(bien.id, `c${i}`));
    }

    // 5 ajouts lancés en parallèle pour 2 places restantes : exactement 2 doivent réussir.
    const resultats = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => ajouterPhotoBien(nouvellePhoto(bien.id, `race${i}`)))
    );

    const succes = resultats.filter((r) => r.status === "fulfilled");
    const echecs = resultats.filter((r) => r.status === "rejected");
    expect(succes).toHaveLength(2);
    expect(echecs).toHaveLength(3);
    for (const echec of echecs) {
      if (echec.status === "rejected") expect(echec.reason).toBeInstanceOf(ErreurLimitePhotosAtteinte);
    }
    await expect(listerPhotosBien(bien.id)).resolves.toHaveLength(NOMBRE_MAX_PHOTOS_PAR_BIEN);
  });

  it("supprimerPhotoBien() est idempotent : id absent/déjà supprimé → undefined, jamais une erreur", async () => {
    const bien = await creerBienTest("SUPPRESSION");
    const photo = await ajouterPhotoBien(nouvellePhoto(bien.id, "s1"));

    const premiere = await supprimerPhotoBien(photo.id);
    expect(premiere?.id).toBe(photo.id);

    await expect(supprimerPhotoBien(photo.id)).resolves.toBeUndefined();
    await expect(supprimerPhotoBien("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
    await expect(listerPhotosBien(bien.id)).resolves.toEqual([]);
  });

  it("reordonnerPhotosBien() réécrit 0..N-1 ; la première de la liste devient mécaniquement la principale", async () => {
    const bien = await creerBienTest("REORDER-OK");
    const p1 = await ajouterPhotoBien(nouvellePhoto(bien.id, "1"));
    const p2 = await ajouterPhotoBien(nouvellePhoto(bien.id, "2"));
    const p3 = await ajouterPhotoBien(nouvellePhoto(bien.id, "3"));

    const resultat = await reordonnerPhotosBien(bien.id, [p3.id, p1.id, p2.id]);
    expect(resultat).toBe("ok");

    const galerie = await listerPhotosBien(bien.id);
    expect(galerie.map((p) => p.id)).toEqual([p3.id, p1.id, p2.id]);
    expect(galerie.map((p) => p.ordre)).toEqual([0, 1, 2]);

    const principale = await getPhotoPrincipaleBien(bien.id);
    expect(principale?.id).toBe(p3.id);
  });

  it("reordonnerPhotosBien() rejette l'opération ENTIÈRE : doublon, omission, ou photo d'un autre bien", async () => {
    const bien = await creerBienTest("REORDER-INVALIDE");
    const autreBien = await creerBienTest("REORDER-AUTRE-BIEN");
    const p1 = await ajouterPhotoBien(nouvellePhoto(bien.id, "1"));
    const p2 = await ajouterPhotoBien(nouvellePhoto(bien.id, "2"));
    const pAutre = await ajouterPhotoBien(nouvellePhoto(autreBien.id, "autre"));

    await expect(reordonnerPhotosBien(bien.id, [p1.id, p1.id])).resolves.toBe("invalide"); // doublon
    await expect(reordonnerPhotosBien(bien.id, [p1.id])).resolves.toBe("invalide"); // omission de p2
    await expect(reordonnerPhotosBien(bien.id, [p1.id, p2.id, pAutre.id])).resolves.toBe("invalide"); // photo étrangère
    await expect(reordonnerPhotosBien(bien.id, ["id-invalide"])).resolves.toBe("invalide"); // pas un UUID

    // Rien n'a été écrit : l'ordre initial est intact.
    const galerie = await listerPhotosBien(bien.id);
    expect(galerie.map((p) => p.id)).toEqual([p1.id, p2.id]);
  });
});
