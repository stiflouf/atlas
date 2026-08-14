// Construction du message brut envoyé à l'API Gmail (ADR-031-bis). Le destinataire/objet/corps
// proviennent d'un texte ÉDITÉ par le conseiller juste avant confirmation — jamais dignes de
// confiance sans validation, contrairement à une donnée strictement structurée non modifiable.

export class ErreurConstructionEmail extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurConstructionEmail";
  }
}

// Volontairement simple (pas une validation RFC 5322 complète) : suffisant pour rejeter une saisie
// manifestement invalide sans construire un valideur email exhaustif hors périmètre.
const EMAIL_REGEX = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;

function validerAdresseEmail(email: string): void {
  if (!EMAIL_REGEX.test(email)) {
    throw new ErreurConstructionEmail("Adresse email invalide.");
  }
}

// Rejet strict de \r/\n dans un en-tête — jamais un simple retrait silencieux : une valeur
// contenant un retour à la ligne pourrait injecter un en-tête supplémentaire (ex. Bcc:) dans le
// message brut si elle était insérée telle quelle. Le corps du message n'est PAS concerné par
// cette règle (texte libre autorisé à contenir des retours à la ligne, ADR-031-bis).
function rejeterRetourLigne(valeur: string, nomChamp: string): void {
  if (/[\r\n]/.test(valeur)) {
    throw new ErreurConstructionEmail(`${nomChamp} ne peut pas contenir de retour à la ligne.`);
  }
}

// Toujours encodé (RFC 2047), y compris pour un objet purement ASCII — évite de distinguer un cas
// particulier et élimine toute la classe d'erreurs liées à un encodage conditionnel.
function encoderSujet(objet: string): string {
  return `=?UTF-8?B?${Buffer.from(objet, "utf8").toString("base64")}?=`;
}

// Message RFC 5322 minimal (texte brut, UTF-8) encodé en base64url (RFC 4648 §5 — jamais du
// base64 standard, que l'API Gmail rejette pour le champ `raw`). Aucun en-tête additionnel
// construit depuis une entrée utilisateur non validée : seuls To/Subject dérivent de
// destinataireEmail/objet, tous deux passés par les gardes ci-dessus.
export function construireMessageRaw(destinataireEmail: string, objet: string, corps: string): string {
  validerAdresseEmail(destinataireEmail);
  rejeterRetourLigne(destinataireEmail, "Le destinataire");
  rejeterRetourLigne(objet, "L'objet");

  const entetes = [`To: ${destinataireEmail}`, `Subject: ${encoderSujet(objet)}`, `Content-Type: text/plain; charset="UTF-8"`];
  const message = [...entetes, "", corps].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}
