// Normalisation de texte partagée par toutes les règles de correspondance :
// minuscules, accents retirés, ponctuation neutralisée, espaces compressés.
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Vérifie la présence d'un mot (ou groupe de mots) entier dans un texte déjà normalisé —
// évite qu'un nom comme "Marti" ne matche à tort "Martin".
export function contientMot(texteNormalise: string, mot: string): boolean {
  if (!mot) return false;
  const motsTexte = texteNormalise.split(" ");
  return mot.split(" ").every((partie) => motsTexte.includes(partie));
}
