import type { ContexteRedactionAugmentee } from "./contrat";

// VALUE-05 — validations DÉTERMINISTES appliquées après le modèle. Le prompt ne suffit pas : ce
// qui protège réellement le conseiller est ce qui est vérifié ici, sur le texte rendu, sans aucune
// confiance accordée à ce que le modèle a répondu.
//
// Principe de correction : on ne corrige JAMAIS silencieusement une sortie douteuse. Un seul motif
// de rejet suffit à abandonner la reformulation ; le brouillon déterministe courant reste alors
// intégralement utilisable. Un faux rejet coûte une reformulation perdue, un faux passage coûte un
// mensonge envoyé à un client — l'asymétrie est assumée en faveur du rejet.

export type MotifRejetRedaction =
  | "objet_vide"
  | "corps_vide"
  | "objet_trop_long"
  | "corps_trop_long"
  | "markdown"
  | "url_inattendue"
  | "secret_apparent"
  | "pourcentage_invente"
  | "nombre_inconnu"
  | "date_inconnue"
  | "entite_inconnue";

export const LONGUEUR_MAX_OBJET = 150;
// Les brouillons déterministes tiennent en ~500 caractères ; ce plafond laisse de la marge à une
// reformulation sans jamais laisser passer un pavé.
export const LONGUEUR_MAX_CORPS = 3_000;

export type ResultatValidation = { valide: true } | { valide: false; motif: MotifRejetRedaction };

// Les milliers français s'écrivent avec une espace (fine insécable ou normale) : « 730 000 » et
// « 730000 » désignent le même nombre. Sans cette normalisation, une reformulation parfaitement
// fidèle serait rejetée pour un simple changement de séparateur.
function normaliserNombres(texte: string): string {
  return texte.replace(/(\d)[\s  ](?=\d)/g, "$1");
}

function corpusAutorise(contexte: ContexteRedactionAugmentee): string {
  const { faitsAutorises } = contexte;
  const morceaux = [
    contexte.objetActuel,
    contexte.corpsActuel,
    faitsAutorises.destinatairePrenom,
    faitsAutorises.bienAdresse,
    faitsAutorises.dateVisite,
    faitsAutorises.interetVisite,
    ...(faitsAutorises.criteresCompatibles ?? []),
  ].filter((m): m is string => typeof m === "string");
  return normaliserNombres(morceaux.join("\n"));
}

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

// Un mot capitalisé en MILIEU de phrase : en français, c'est un nom propre (personne, ville, rue,
// enseigne). Deux positions sont exclues parce qu'elles produisent une capitale GRAMMATICALE et non
// un nom propre : après une ponctuation de fin de phrase, et en début de ligne. Sans la seconde,
// « Bonjour Camille,\n\nSouhaitez-vous… » ferait de « Souhaitez » un nom propre inconnu.
//
// L'inspection se fait sur le caractère précédent RÉEL, jamais par une capture de regex : un motif
// consommant le mot d'avant manquerait toute paire de capitales consécutives (« Bonjour Sophie »),
// c'est-à-dire précisément le cas à détecter.
//
// Règle volontairement étroite : elle capte l'hallucination évidente, elle n'est pas un analyseur
// syntaxique.
function nomsPropresProbables(texte: string): string[] {
  const trouves: string[] = [];
  const motif = /[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ][\p{L}'-]{2,}/gu;
  for (const correspondance of texte.matchAll(motif)) {
    let i = (correspondance.index ?? 0) - 1;
    let debutDeLigne = false;
    while (i >= 0 && /\s/.test(texte[i])) {
      if (texte[i] === "\n") debutDeLigne = true;
      i -= 1;
    }
    if (debutDeLigne || i < 0) continue;
    if (/[.!?:;]/.test(texte[i])) continue;
    trouves.push(correspondance[0]);
  }
  return trouves;
}

// Frontières de MOT plutôt qu'une simple inclusion : « semaine » contient « mai », « jamais »
// aussi. Une comparaison par sous-chaîne rejetterait des reformulations parfaitement fidèles.
function contientMot(texte: string, mot: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${mot}([^\\p{L}]|$)`, "iu").test(texte);
}

function jetonsNumeriques(texte: string): string[] {
  return [...normaliserNombres(texte).matchAll(/\d+/g)].map((m) => m[0]);
}

// `source` = objet + corps soumis au modèle, plus les faits autorisés. Toute information de la
// sortie doit s'y retrouver : le modèle a le droit de reformuler, jamais d'apporter.
export function validerReformulation(
  contexte: ContexteRedactionAugmentee,
  objet: string,
  corps: string
): ResultatValidation {
  const objetNet = objet.trim();
  const corpsNet = corps.trim();

  if (objetNet === "") return { valide: false, motif: "objet_vide" };
  if (corpsNet === "") return { valide: false, motif: "corps_vide" };
  if (objetNet.length > LONGUEUR_MAX_OBJET) return { valide: false, motif: "objet_trop_long" };
  if (corpsNet.length > LONGUEUR_MAX_CORPS) return { valide: false, motif: "corps_trop_long" };

  const sortie = `${objetNet}\n${corpsNet}`;

  // Balisage : un email professionnel n'en contient pas. Sa présence signale un modèle qui a
  // répondu en document plutôt qu'en message.
  if (/```|^#{1,6}\s|\[[^\]]+\]\([^)]*\)|<\/?[a-z][^>]*>/im.test(sortie)) {
    return { valide: false, motif: "markdown" };
  }

  const source = corpusAutorise(contexte);
  const sortieNormalisee = normaliserNombres(sortie);
  const sourceMinuscule = source.toLowerCase();

  // Toute URL doit déjà figurer dans la source : DOMIORA n'insère aucun lien dans ses messages.
  for (const url of sortie.match(/(https?:\/\/|www\.)[^\s<>"]+/gi) ?? []) {
    if (!sourceMinuscule.includes(url.toLowerCase())) return { valide: false, motif: "url_inattendue" };
  }

  // Chaîne à l'allure de secret : préfixes usuels, ou longue suite de caractères d'encodage qu'un
  // texte français ne produit jamais.
  if (/\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|api[_-]?key|access[_-]?token)\b/i.test(sortie)) {
    return { valide: false, motif: "secret_apparent" };
  }
  if (/[A-Za-z0-9+/_-]{32,}/.test(sortie.replace(/\s/g, " "))) {
    return { valide: false, motif: "secret_apparent" };
  }

  if (sortie.includes("%") && !source.includes("%")) return { valide: false, motif: "pourcentage_invente" };

  const nombresSource = new Set(jetonsNumeriques(source));
  for (const nombre of jetonsNumeriques(sortieNormalisee)) {
    if (!nombresSource.has(nombre)) return { valide: false, motif: "nombre_inconnu" };
  }

  for (const mois of MOIS) {
    if (contientMot(sortie, mois) && !contientMot(source, mois)) {
      return { valide: false, motif: "date_inconnue" };
    }
  }

  const nomsSource = new Set(nomsPropresProbables(source).map((n) => n.toLowerCase()));
  for (const nom of nomsPropresProbables(sortie)) {
    // Comparaison sur la source ENTIÈRE et non sur les seuls noms propres détectés : un prénom
    // fourni isolément dans les faits autorisés n'est précédé d'aucun mot, il ne serait donc jamais
    // capté par la détection ci-dessus.
    if (nomsSource.has(nom.toLowerCase()) || sourceMinuscule.includes(nom.toLowerCase())) continue;
    return { valide: false, motif: "entite_inconnue" };
  }

  return { valide: true };
}
