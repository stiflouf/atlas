import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { ecrireDocument, genererCleStockage } from "../stockageDocuments";
import { ecrirePhotoOptimisee, ecrirePhotoOriginale } from "../stockagePhotosBien";
import {
  ErreurCheminHorsRacineStockage,
  ErreurCleStockageInvalide,
  ErreurSuppressionFichierRefusee,
  fichierStockeExiste,
  nomFichierStocke,
  supprimerFichierStocke,
} from "./suppressionFichier";

// ADR-067 : isolation stricte, jamais le dossier de dev réel `stockage-documents/`, jamais un
// répertoire partagé entre tests — la primitive testée est la seule du produit qui efface.
const tmpDirsCrees: string[] = [];

async function creerTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "atlas-suppression-fichier-test-"));
  tmpDirsCrees.push(dir);
  return dir;
}

async function racineIsolee(): Promise<string> {
  const dir = await creerTmpDir();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of tmpDirsCrees.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("supprimerFichierStocke — suppression d'un fichier légitime", () => {
  it("supprime réellement un document présent sous la racine", async () => {
    const dir = await racineIsolee();
    const cle = genererCleStockage();
    await ecrireDocument(cle, Buffer.from("document de test ADR-067"));
    await expect(stat(path.join(dir, cle))).resolves.toBeDefined();

    const resultat = await supprimerFichierStocke({ genre: "document", cleStockage: cle });

    expect(resultat).toEqual({ statut: "supprime" });
    await expect(stat(path.join(dir, cle))).rejects.toThrow();
  });

  it("supprime l'original d'une photo sans toucher à sa version optimisée", async () => {
    const dir = await racineIsolee();
    const cle = genererCleStockage();
    await ecrirePhotoOriginale(cle, Buffer.from("original"));
    await ecrirePhotoOptimisee(cle, Buffer.from("optimisee"));

    await expect(supprimerFichierStocke({ genre: "photo_originale", cleStockage: cle })).resolves.toEqual({
      statut: "supprime",
    });

    await expect(stat(path.join(dir, "photos", "originaux", cle))).rejects.toThrow();
    await expect(stat(path.join(dir, "photos", "optimisees", `${cle}.webp`))).resolves.toBeDefined();
  });

  it("supprime la version optimisée via son nom réel, suffixé .webp", async () => {
    const dir = await racineIsolee();
    const cle = genererCleStockage();
    await ecrirePhotoOptimisee(cle, Buffer.from("optimisee"));

    await expect(supprimerFichierStocke({ genre: "photo_optimisee", cleStockage: cle })).resolves.toEqual({
      statut: "supprime",
    });
    await expect(stat(path.join(dir, "photos", "optimisees", `${cle}.webp`))).rejects.toThrow();
  });

  it("ne supprime QUE le fichier visé : les autres fichiers de la racine restent intacts", async () => {
    const dir = await racineIsolee();
    const cleVisee = genererCleStockage();
    const cleVoisine = genererCleStockage();
    await ecrireDocument(cleVisee, Buffer.from("a supprimer"));
    await ecrireDocument(cleVoisine, Buffer.from("a conserver"));

    await supprimerFichierStocke({ genre: "document", cleStockage: cleVisee });

    await expect(stat(path.join(dir, cleVoisine))).resolves.toBeDefined();
  });
});

describe("supprimerFichierStocke — fichier déjà absent", () => {
  it("renvoie deja_absent sans lever : l'état visé est déjà atteint", async () => {
    await racineIsolee();
    const resultat = await supprimerFichierStocke({ genre: "document", cleStockage: genererCleStockage() });
    expect(resultat).toEqual({ statut: "deja_absent" });
  });

  it("est idempotente : deux appels de suite ne lèvent jamais", async () => {
    await racineIsolee();
    const cle = genererCleStockage();
    await ecrireDocument(cle, Buffer.from("x"));

    await expect(supprimerFichierStocke({ genre: "document", cleStockage: cle })).resolves.toEqual({
      statut: "supprime",
    });
    await expect(supprimerFichierStocke({ genre: "document", cleStockage: cle })).resolves.toEqual({
      statut: "deja_absent",
    });
  });
});

describe("supprimerFichierStocke — refus de toute cible non légitime (fail-closed)", () => {
  // Chaque valeur refusée est une tentative d'exprimer autre chose qu'« un fichier d'Atlas » : la
  // primitive ne doit offrir AUCUN chemin pour y parvenir.
  const clesRefusees: Array<[string, string]> = [
    ["traversée simple", "../secret"],
    ["traversée profonde", "../../../../etc/passwd"],
    ["traversée encadrée par un UUID valide", "550e8400-e29b-41d4-a716-446655440000/../../secret"],
    ["chemin absolu externe", "/etc/passwd"],
    ["sous-chemin sous la racine", "photos/originaux/550e8400-e29b-41d4-a716-446655440000"],
    ["chaîne vide", ""],
    ["point", "."],
    ["point-point seul", ".."],
    ["nom non UUID", "document.pdf"],
    ["UUID avec séparateur ajouté", "550e8400-e29b-41d4-a716-446655440000/x"],
    ["UUID avec extension ajoutée", "550e8400-e29b-41d4-a716-446655440000.pdf"],
    ["UUID en majuscules", "550E8400-E29B-41D4-A716-446655440000"],
  ];

  it.each(clesRefusees)("refuse la clé (%s) sans toucher au disque", async (_libelle, cle) => {
    const dir = await racineIsolee();
    const temoin = genererCleStockage();
    await ecrireDocument(temoin, Buffer.from("temoin"));

    await expect(supprimerFichierStocke({ genre: "document", cleStockage: cle })).rejects.toThrow(
      ErreurCleStockageInvalide
    );

    await expect(stat(path.join(dir, temoin))).resolves.toBeDefined();
  });

  it("refuse un genre de ressource inconnu", async () => {
    await racineIsolee();
    await expect(
      // @ts-expect-error — vérifie la garde à l'exécution, pas seulement le typage.
      supprimerFichierStocke({ genre: "coffre_fort", cleStockage: genererCleStockage() })
    ).rejects.toThrow(ErreurSuppressionFichierRefusee);
  });

  it("ne recopie jamais la valeur refusée dans le message d'erreur", async () => {
    await racineIsolee();
    const valeurSensible = "secret-a-ne-pas-journaliser";

    await expect(
      supprimerFichierStocke({ genre: "document", cleStockage: `../../${valeurSensible}` })
    ).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(valeurSensible) })
    );
  });

  it("refuse un lien symbolique, même pointant à l'intérieur de la racine", async () => {
    const dir = await racineIsolee();
    const cibleReelle = genererCleStockage();
    const lien = genererCleStockage();
    await ecrireDocument(cibleReelle, Buffer.from("cible legitime"));
    await symlink(path.join(dir, cibleReelle), path.join(dir, lien));

    await expect(supprimerFichierStocke({ genre: "document", cleStockage: lien })).rejects.toThrow(
      ErreurSuppressionFichierRefusee
    );

    // Ni le lien ni sa cible n'ont été touchés : le refus est total, pas partiel.
    await expect(stat(path.join(dir, cibleReelle))).resolves.toBeDefined();
  });

  it("refuse une cible qui n'est pas un fichier régulier (répertoire portant une clé valide)", async () => {
    const dir = await racineIsolee();
    const cle = genererCleStockage();
    await mkdir(path.join(dir, cle));

    await expect(supprimerFichierStocke({ genre: "document", cleStockage: cle })).rejects.toThrow(
      ErreurSuppressionFichierRefusee
    );
    await expect(stat(path.join(dir, cle))).resolves.toBeDefined();
  });

  it("refuse l'opération quand la racine de stockage est indisponible en production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", "");

    await expect(
      supprimerFichierStocke({ genre: "document", cleStockage: genererCleStockage() })
    ).rejects.toThrow(/ATLAS_DOCUMENT_STORAGE_DIR/);
  });
});

describe("résolution du nom physique et vérification d'existence", () => {
  it("nomFichierStocke reflète le nom réellement écrit par le stockage", () => {
    const cle = genererCleStockage();
    expect(nomFichierStocke({ genre: "document", cleStockage: cle })).toBe(cle);
    expect(nomFichierStocke({ genre: "photo_originale", cleStockage: cle })).toBe(cle);
    expect(nomFichierStocke({ genre: "photo_optimisee", cleStockage: cle })).toBe(`${cle}.webp`);
  });

  it("fichierStockeExiste distingue présent et absent sans rien modifier", async () => {
    const dir = await racineIsolee();
    const present = genererCleStockage();
    const absent = genererCleStockage();
    await ecrireDocument(present, Buffer.from("x"));

    await expect(fichierStockeExiste({ genre: "document", cleStockage: present })).resolves.toBe(true);
    await expect(fichierStockeExiste({ genre: "document", cleStockage: absent })).resolves.toBe(false);

    // Lecture seule : le fichier présent est toujours là après interrogation.
    await expect(stat(path.join(dir, present))).resolves.toBeDefined();
  });

  it("fichierStockeExiste refuse une clé invalide plutôt que de répondre « absent »", async () => {
    await racineIsolee();
    await expect(fichierStockeExiste({ genre: "document", cleStockage: "../x" })).rejects.toThrow(
      ErreurCleStockageInvalide
    );
  });
});

describe("garanties structurelles de la primitive (ADR-067)", () => {
  it("le module ne contient aucun accès à la base de données", async () => {
    const { readFile } = await import("node:fs/promises");
    const code = await readFile(path.join(process.cwd(), "src/lib/stockage/suppressionFichier.ts"), "utf8");

    expect(code).not.toMatch(/getDb|drizzle|\.delete\(|\.insert\(|\.update\(/);
  });

  it("le module ne supprime jamais récursivement", async () => {
    const { readFile } = await import("node:fs/promises");
    const code = await readFile(path.join(process.cwd(), "src/lib/stockage/suppressionFichier.ts"), "utf8");

    expect(code).not.toMatch(/recursive:\s*true/);
    expect(code).not.toMatch(/\brmdir\b|\brimraf\b/);
  });

  it("ErreurCheminHorsRacineStockage reste exportée pour les appelants qui distinguent les refus", () => {
    expect(new ErreurCheminHorsRacineStockage("x").name).toBe("ErreurCheminHorsRacineStockage");
  });
});
