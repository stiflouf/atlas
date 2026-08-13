// ADR-024, correction obligatoire n° 4 : aucune division JS number sur une donnée monétaire ou
// fiscale, à aucune étape — `montant * jours / joursAnnee` produirait un flottant intermédiaire
// (imprécis, non déterministe entre implémentations). Toute division est effectuée exclusivement
// en BigInt (précision arbitraire, division entière exacte), avec un arrondi explicite documenté et
// testé : "moitié vers le haut" (reste >= moitié du dénominateur ⇒ on arrondit au-dessus). Les
// entrées sont toujours des entiers positifs ou nuls (centimes, points de base, jours) dans ce
// domaine — aucune gestion de signe n'est nécessaire.

// Division entière numerateur/denominateur arrondie "moitié vers le haut", entièrement en BigInt.
// BigInt(...) plutôt que des littéraux `2n`/`1n` : le target TS du projet (ES2017) n'autorise pas
// la syntaxe de littéral BigInt, seuls les appels de fonction BigInt(...) le sont.
function diviserArrondiDemiVersLeHaut(numerateur: bigint, denominateur: bigint): bigint {
  const deux = BigInt(2);
  const quotient = numerateur / denominateur;
  const reste = numerateur % denominateur;
  return reste * deux >= denominateur ? quotient + BigInt(1) : quotient;
}

// Applique un taux exprimé en points de base (1 % = 100, 25,6 % = 2560) à un montant en centimes.
// Ex. appliquerTauxPointsBase(1000000, 2560) = 256000 (10 000 € × 25,6 % = 2 560 €).
export function appliquerTauxPointsBase(montantCentimes: number, pointsBase: number): number {
  const numerateur = BigInt(montantCentimes) * BigInt(pointsBase);
  return Number(diviserArrondiDemiVersLeHaut(numerateur, BigInt(10000)));
}

// Prorata entier d'un montant (plafond, seuil...) au nombre de jours d'activité sur le nombre de
// jours de l'année. joursAnnee vaut 365 ou 366 (voir joursDansAnnee ci-dessous) — jamais recalculé
// par une division flottante.
export function prorataJours(montantCentimes: number, joursActivite: number, joursAnnee: number): number {
  const numerateur = BigInt(montantCentimes) * BigInt(joursActivite);
  return Number(diviserArrondiDemiVersLeHaut(numerateur, BigInt(joursAnnee)));
}

// Division entière générique arrondie "moitié vers le haut" (ex. un rapport RFR/part affiché à
// l'utilisateur) — même garantie qu'appliquerTauxPointsBase/prorataJours : jamais une division JS
// number, toujours BigInt en interne.
export function diviserEntier(numerateur: number, denominateur: number): number {
  return Number(diviserArrondiDemiVersLeHaut(BigInt(numerateur), BigInt(denominateur)));
}

export function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

export function joursDansAnnee(annee: number): number {
  return estBissextile(annee) ? 366 : 365;
}

// Nombre de jours inclus entre deux dates ISO 'YYYY-MM-DD' (bornes incluses). Utilise Date.UTC pour
// ne dépendre d'aucun fuseau horaire local ; la différence entre deux minuits UTC est toujours un
// multiple exact de 86 400 000 ms, cette division ne perd donc aucune précision (contrairement à la
// division monétaire ci-dessus, qui reste exclusivement en BigInt).
export function joursInclusEntre(dateDebutIso: string, dateFinIso: string): number {
  const debut = Date.UTC(...parseDateIso(dateDebutIso));
  const fin = Date.UTC(...parseDateIso(dateFinIso));
  return Math.round((fin - debut) / 86400000) + 1;
}

function parseDateIso(dateIso: string): [number, number, number] {
  const [annee, mois, jour] = dateIso.split("-").map(Number);
  return [annee, mois - 1, jour];
}
