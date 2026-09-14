import { sql, type SQL } from "drizzle-orm";

// ADR-055 §H — normalisation pour le RAPPROCHEMENT de deux Contacts, et rien d'autre. Elle ne
// réécrit jamais une valeur stockée, ne sert ni au formulaire (contactFormulaire.ts refuse toute
// normalisation à la saisie) ni à la recherche (qui cherche une ressemblance, pas une égalité).
//
// Les clés email et téléphone sont des expressions SQL : la même expression calcule la clé du
// Contact source et filtre les candidats, il n'existe donc qu'une seule définition de « même
// email » et de « même téléphone ». Une version JavaScript en double finirait par diverger.

// Email : trim + minuscules, et c'est tout. Aucune règle de fournisseur (points ou `+tag` Gmail,
// alias) : ce serait une heuristique sur un domaine précis, et elle produirait des faux positifs
// sur tous les autres.
export function cleEmailSql(colonne: SQL | { getSQL(): SQL }): SQL<string | null> {
  return sql<string | null>`nullif(lower(btrim(${colonne})), '')`;
}

// Téléphone : un numéro trop court n'est jamais une clé — « 0 », « + » ou un numéro partiel
// rapprocheraient des personnes sans rapport. Huit chiffres est le plancher retenu : en dessous
// aucun numéro national ou international complet n'existe dans les saisies du produit.
export const MIN_CHIFFRES_TELEPHONE = 8;

// Ponctuation et espaces retirés ; seul un `+` de tête est conservé. Le préfixe international
// `00` devient `+` (convention universelle), puis la forme française `+33 (0)X` devient `0X` —
// « 06 12 34 56 78 », « +33 6 12 34 56 78 » et « 0033 6 12 34 56 78 » ont la même clé. Un numéro
// étranger reste sous sa forme `+CC…`, comparable après retrait de ponctuation, sans autre
// interprétation.
export function cleTelephoneSql(colonne: SQL | { getSQL(): SQL }): SQL<string | null> {
  const chiffres = sql`regexp_replace(${colonne}, '[^0-9]', '', 'g')`;
  const avecIndicatif = sql`case when btrim(${colonne}) like '+%' then '+' || ${chiffres} else ${chiffres} end`;
  const international = sql`regexp_replace(${avecIndicatif}, '^00', '+')`;
  const francais = sql`regexp_replace(${international}, '^\\+330?', '0')`;
  return sql<string | null>`case when length(${chiffres}) >= ${MIN_CHIFFRES_TELEPHONE} then ${francais} else null end`;
}

// Nom + prénom : corroboration calculée en mémoire sur les candidats déjà retenus, jamais en SQL
// — elle n'entre dans aucun WHERE. Accents neutralisés sans extension de base, tirets et
// apostrophes ramenés à un espace : « Jean-Pierre D'Arc » et « jean pierre d arc » se corroborent.
// Les DEUX parties sont requises : un nom seul ne corrobore rien.
export function cleNomPrenom(nom: string, prenom: string | undefined): string | undefined {
  const n = normaliserTexte(nom);
  const p = normaliserTexte(prenom ?? "");
  return n && p ? `${p} ${n}` : undefined;
}

function normaliserTexte(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
