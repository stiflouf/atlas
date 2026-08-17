import { randomUUID } from "node:crypto";
import { access, constants, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Racine du stockage local (voir docs/adr/013, ADR-050). Hors de public/ : jamais servi
// statiquement, uniquement via le Route Handler /api/documents/[id] qui contrôle l'accès.
//
// ADR-050 : le répertoire racine est désormais résolu via ATLAS_DOCUMENT_STORAGE_DIR — SEUL point
// de lecture de cette variable dans tout le projet (jamais process.env.ATLAS_DOCUMENT_STORAGE_DIR
// ailleurs). En production, absence/chemin relatif/inexistant/non accessible refuse explicitement
// l'opération plutôt que de masquer silencieusement un volume non monté.

// Erreur dédiée (ADR-050 §7) : distincte d'un document précis absent (undefined, comportement
// 404 existant). Couvre à la fois une mauvaise configuration (variable absente/relative en
// production) et une indisponibilité runtime (répertoire manquant, non lisible/inscriptible) — une
// seule classe, les deux catégories partagent le même traitement côté appelant (refus honnête,
// jamais un "document introuvable").
export class ErreurStockageDocumentsIndisponible extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurStockageDocumentsIndisponible";
  }
}

function estProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// Résolution SYNCHRONE du chemin configuré — ne vérifie que la forme (présence, caractère absolu),
// jamais l'existence réelle sur disque (I/O, voir verifierDisponibiliteStockageDocuments). En
// production, ATLAS_DOCUMENT_STORAGE_DIR est obligatoire et doit être un chemin absolu : c'est la
// seule façon de garantir qu'Atlas pointe vers un volume explicitement désigné par l'exploitant,
// jamais une supposition implicite basée sur process.cwd(). Hors production, la variable reste
// optionnelle — repli sur le comportement historique (process.cwd()/stockage-documents) pour ne pas
// complexifier le poste d'un développeur qui n'a rien configuré.
export function resoudreRepertoireStockageDocuments(): string {
  const configure = process.env.ATLAS_DOCUMENT_STORAGE_DIR;

  if (estProduction()) {
    if (!configure) {
      throw new ErreurStockageDocumentsIndisponible(
        "ATLAS_DOCUMENT_STORAGE_DIR doit être défini en production (chemin absolu vers un volume persistant)."
      );
    }
    if (!path.isAbsolute(configure)) {
      throw new ErreurStockageDocumentsIndisponible(
        `ATLAS_DOCUMENT_STORAGE_DIR doit être un chemin absolu en production (reçu : "${configure}").`
      );
    }
    return configure;
  }

  return configure && configure.length > 0 ? configure : path.join(process.cwd(), "stockage-documents");
}

// Fonction centrale et testable (ADR-050 §9) : futur point de réutilisation pour un readiness-check
// (pas de nouvelle route HTTP créée dans cette passe). Jamais de cache définitif du résultat (§10) —
// réévaluée à chaque appel, coût I/O négligeable à l'échelle d'un pilote mono-conseiller ; ce qui
// compte est qu'un volume démonté/une permission perdue en cours de vie du process soit détecté à
// l'opération suivante, jamais masqué par un résultat figé au démarrage.
//
// PRODUCTION : jamais de création automatique de la racine (§32) — un répertoire configuré mais
// absent signifie très probablement un volume non monté ; le créer masquerait exactement l'erreur
// que cette ADR doit rendre visible. Seules les vérifications (existence, type directory, lecture,
// écriture si demandée) sont effectuées.
// HORS PRODUCTION : comportement historique préservé — le répertoire (configuré ou de repli) est
// créé si nécessaire (mkdir récursif), pour ne jamais bloquer un poste de développement.
export async function verifierDisponibiliteStockageDocuments(options: { ecriture?: boolean } = {}): Promise<string> {
  const repertoire = resoudreRepertoireStockageDocuments();

  if (!estProduction()) {
    await mkdir(repertoire, { recursive: true });
    return repertoire;
  }

  let infos;
  try {
    infos = await stat(repertoire);
  } catch {
    throw new ErreurStockageDocumentsIndisponible(`Répertoire de stockage documentaire introuvable : ${repertoire}`);
  }
  if (!infos.isDirectory()) {
    throw new ErreurStockageDocumentsIndisponible(
      `Le chemin configuré (ATLAS_DOCUMENT_STORAGE_DIR) n'est pas un répertoire : ${repertoire}`
    );
  }
  try {
    await access(repertoire, options.ecriture ? constants.W_OK : constants.R_OK);
  } catch {
    throw new ErreurStockageDocumentsIndisponible(
      options.ecriture
        ? `Répertoire de stockage documentaire non inscriptible : ${repertoire}`
        : `Répertoire de stockage documentaire non lisible : ${repertoire}`
    );
  }
  return repertoire;
}

// Identifiant opaque généré ici uniquement — jamais dérivé d'un nom ou chemin fourni par
// l'utilisateur. C'est le seul nom utilisé physiquement sur disque (pas d'extension : le type
// MIME reste en métadonnée DB, restitué au téléchargement).
export function genererCleStockage(): string {
  return randomUUID();
}

export async function ecrireDocument(cleStockage: string, contenu: Buffer): Promise<void> {
  const repertoire = await verifierDisponibiliteStockageDocuments({ ecriture: true });
  await writeFile(path.join(repertoire, cleStockage), contenu);
}

// undefined UNIQUEMENT si le fichier précis est absent (ENOENT sur ce fichier, métadonnée DB
// orpheline) — le Route Handler appelant peut alors répondre 404 proprement, comme avant ADR-050.
// Si la racine elle-même est indisponible/mal configurée, l'erreur remonte honnêtement
// (ErreurStockageDocumentsIndisponible) plutôt que d'être confondue avec un document manquant —
// distinction volontaire (ADR-050 §12) : un volume démonté n'est pas la même situation qu'un
// document jamais uploadé.
export async function lireDocument(cleStockage: string): Promise<Buffer | undefined> {
  const repertoire = await verifierDisponibiliteStockageDocuments();
  try {
    return await readFile(path.join(repertoire, cleStockage));
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw erreur;
  }
}
