// ADR-031 : mécanisme d'envoi V1 unique — aucun envoi serveur, aucune dépendance, aucune pièce
// jointe possible (limitation structurelle du schéma `mailto:`, pas une règle appliquée
// manuellement). Le lien doit toujours être reconstruit depuis le texte ACTUELLEMENT ÉDITÉ par le
// conseiller (correction n°3) — jamais mémorisé depuis le brouillon initial.
export function construireLienMailto(destinataireEmail: string | undefined, objet: string, corps: string): string {
  // encodeURIComponent (RFC 3986), jamais URLSearchParams : un mailto: n'est pas un corps
  // application/x-www-form-urlencoded — URLSearchParams encoderait les espaces en "+", invalide
  // ici (RFC 6068 attend "%20"). L'adresse elle-même n'est jamais pourcent-encodée (une adresse
  // email valide ne contient aucun caractère nécessitant un échappement dans cette position).
  const params = `subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(corps)}`;
  return `mailto:${destinataireEmail ?? ""}?${params}`;
}
