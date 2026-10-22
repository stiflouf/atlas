import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { verifierDisponibiliteStockageDocuments } from "../stockageDocuments";
import {
  ErreurCheminHorsRacineStockage,
  resoudreCheminSousRepertoire,
  validerCleStockage,
} from "./cheminStocke";

// FILE_DELETION_PRIMITIVE_V1 (ADR-067) — primitive de suppression d'UN fichier du stockage
// documentaire. Capacité technique uniquement : aucun chemin métier ne l'appelle dans ce lot,
// aucune règle de cycle de vie n'est changée, aucun moteur de purge n'existe.
//
// L'API n'accepte JAMAIS un chemin. Elle accepte un genre de ressource connu d'Atlas et une clé de
// stockage au format genererCleStockage(). C'est ce qui rend la suppression d'un chemin arbitraire
// impossible par construction, et non par vigilance de l'appelant : il n'existe pas de paramètre
// par lequel exprimer « supprime /etc/passwd ».
//
// Aucune écriture en base ici, dans aucun cas. Le couple ligne/fichier est volontairement laissé à
// l'appelant : le stockage n'a pas à décider du sort d'une donnée métier, et une primitive qui
// ferait les deux serait impossible à utiliser dans le seul ordre sûr (fichier après commit DB,
// comme le fait déjà gererPhotosBien pour les photos).

const SOUS_REPERTOIRE_PAR_GENRE = {
  // Documents de bien, PDF de bon de visite signé et PNG de signature partagent la racine : un
  // seul espace de noms à plat, voir la cartographie de l'ADR-067.
  document: "",
  photo_originale: "photos/originaux",
  photo_optimisee: "photos/optimisees",
} as const;

export type GenreFichierStocke = keyof typeof SOUS_REPERTOIRE_PAR_GENRE;

export type RessourceFichierStocke = {
  genre: GenreFichierStocke;
  cleStockage: string;
};

// « deja_absent » n'est pas une erreur : c'est l'état visé, déjà atteint. Un appelant qui rejoue une
// suppression interrompue doit pouvoir le faire sans traiter d'exception, et un inventaire
// d'orphelins doit pouvoir être soldé sans distinguer les deux cas.
export type ResultatSuppressionFichier = { statut: "supprime" | "deja_absent" };

export class ErreurSuppressionFichierRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurSuppressionFichierRefusee";
  }
}

export function nomFichierStocke(ressource: RessourceFichierStocke): string {
  const cle = validerCleStockage(ressource.cleStockage);
  // L'extension .webp n'est pas décorative : c'est le nom réellement écrit par
  // ecrirePhotoOptimisee. Elle est ajoutée ici, après validation, jamais prise d'un appelant.
  return ressource.genre === "photo_optimisee" ? `${cle}.webp` : cle;
}

async function resoudreCheminFichier(ressource: RessourceFichierStocke): Promise<string> {
  if (!(ressource.genre in SOUS_REPERTOIRE_PAR_GENRE)) {
    throw new ErreurSuppressionFichierRefusee(`Genre de fichier stocké inconnu : ${String(ressource.genre)}`);
  }
  const nom = nomFichierStocke(ressource);
  // ecriture: true — la suppression modifie le répertoire : exiger W_OK fait échouer honnêtement sur
  // un volume monté en lecture seule, au lieu de laisser rm() produire une erreur moins lisible.
  const racine = await verifierDisponibiliteStockageDocuments({ ecriture: true });
  const sousRepertoire = SOUS_REPERTOIRE_PAR_GENRE[ressource.genre];
  const repertoire = sousRepertoire === "" ? racine : path.join(racine, sousRepertoire);
  return resoudreCheminSousRepertoire(repertoire, nom);
}

export async function supprimerFichierStocke(
  ressource: RessourceFichierStocke
): Promise<ResultatSuppressionFichier> {
  const chemin = await resoudreCheminFichier(ressource);

  let infos;
  try {
    infos = await lstat(chemin);
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return { statut: "deja_absent" };
    throw erreur;
  }

  // lstat et non stat : un lien symbolique doit être vu comme un lien, pas comme sa cible. Supprimer
  // le lien lui-même resterait sous la racine, mais Atlas n'en crée jamais — sa présence signale un
  // stockage manipulé hors du produit, cas où l'on refuse plutôt que de deviner l'intention.
  if (infos.isSymbolicLink()) {
    throw new ErreurSuppressionFichierRefusee(
      "Suppression refusée : la cible est un lien symbolique, jamais produit par Atlas."
    );
  }
  if (!infos.isFile()) {
    throw new ErreurSuppressionFichierRefusee("Suppression refusée : la cible n'est pas un fichier régulier.");
  }

  // Jamais de suppression récursive — la primitive ne supprime qu'un fichier ; l'option force absorbe la course
  // avec une suppression concurrente entre le lstat et le rm (le résultat voulu est atteint).
  await rm(chemin, { force: true });
  return { statut: "supprime" };
}

// Lecture seule : sert à l'inventaire d'orphelins et à tout futur contrôle avant purge. Les refus de
// forme (clé invalide, chemin hors racine) remontent comme pour une suppression — un fichier dont le
// chemin ne peut pas être construit sûrement n'est pas « absent », il est non vérifiable.
export async function fichierStockeExiste(ressource: RessourceFichierStocke): Promise<boolean> {
  const chemin = await resoudreCheminFichier(ressource);
  try {
    const infos = await lstat(chemin);
    return infos.isFile();
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw erreur;
  }
}

export { ErreurCheminHorsRacineStockage };
export { ErreurCleStockageInvalide } from "./cheminStocke";
