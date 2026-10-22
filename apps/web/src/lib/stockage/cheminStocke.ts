import path from "node:path";

// FILE_DELETION_PRIMITIVE_V1 (ADR-067) — résolution SÛRE d'un chemin sous la racine de stockage.
//
// État constaté avant ce lot : ecrireDocument/lireDocument/cheminOriginal/cheminOptimisee font un
// path.join(racine, cleStockage) brut avec une valeur venue de la base. La sûreté reposait
// entièrement sur l'invariant « une clé est toujours un randomUUID() généré par Atlas ». Cet
// invariant suffit pour lire et écrire — il ne suffit pas pour SUPPRIMER : une clé corrompue en
// base, un futur appelant moins prudent, et `rm` sortirait de la racine. La suppression est la
// seule opération irréversible du stockage : elle exige une garde propre, pas un invariant implicite.
//
// Deux refus distincts et explicites plutôt qu'un booléen : le message dit laquelle des deux
// garanties a sauté, ce qui est ce qu'on veut lire dans un log d'incident.

export class ErreurCleStockageInvalide extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurCleStockageInvalide";
  }
}

export class ErreurCheminHorsRacineStockage extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurCheminHorsRacineStockage";
  }
}

// Forme exacte de genererCleStockage() = randomUUID() : UUID v4 en minuscules. Volontairement plus
// strict qu'« un nom de fichier sans séparateur » — accepter davantage reviendrait à accepter des
// noms qu'Atlas ne produit jamais, donc à élargir la surface de suppression sans aucun besoin réel.
const CLE_STOCKAGE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validerCleStockage(cleStockage: unknown): string {
  if (typeof cleStockage !== "string" || !CLE_STOCKAGE_REGEX.test(cleStockage)) {
    // La valeur refusée n'est jamais interpolée dans le message : une clé vient de la base ou, en
    // cas d'erreur d'appel, d'une entrée externe — on ne la recopie pas dans les journaux.
    throw new ErreurCleStockageInvalide(
      "Clé de stockage invalide : un UUID généré par genererCleStockage() est exigé (jamais un nom ou un chemin)."
    );
  }
  return cleStockage;
}

// Vérifie que le chemin construit reste strictement SOUS le répertoire attendu. path.resolve
// neutralise déjà « .. » et un éventuel chemin absolu ; path.relative sert à le prouver, au lieu
// de faire confiance à la neutralisation.
export function resoudreCheminSousRepertoire(repertoire: string, nomFichier: string): string {
  const repertoireResolu = path.resolve(repertoire);
  const cheminResolu = path.resolve(repertoireResolu, nomFichier);
  const relatif = path.relative(repertoireResolu, cheminResolu);

  if (relatif === "" || relatif.startsWith("..") || path.isAbsolute(relatif)) {
    throw new ErreurCheminHorsRacineStockage(
      "Chemin de stockage refusé : la cible sort du répertoire de stockage configuré."
    );
  }
  // Un seul segment attendu : la cible est un fichier directement dans ce répertoire, jamais dans
  // un sous-arbre. Empêche une clé du genre « a/b » d'atteindre un fichier légitime d'un autre
  // genre de ressource tout en restant sous la racine.
  if (relatif.split(path.sep).length !== 1) {
    throw new ErreurCheminHorsRacineStockage(
      "Chemin de stockage refusé : la cible doit être un fichier direct du répertoire attendu."
    );
  }
  return cheminResolu;
}
