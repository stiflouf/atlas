import { validerReformulation } from "./gardeFous";
import type { ContexteRedactionAugmentee, RedacteurCommunication, ResultatRedaction } from "./contrat";

// VALUE-05 — orchestration : un appel au plus, garde-fous systématiques, repli sur le texte courant.
// Séparée de la Server Action pour être testable avec un rédacteur factice : aucun test ne doit
// jamais joindre un fournisseur réel ni consommer un jeton.

// Observabilité minimale et volontairement pauvre en données : fournisseur, durée, issue, motif.
// Jamais l'objet, jamais le corps, jamais les faits, jamais un identifiant de personne, jamais un
// fragment de clé. Diagnostiquer « pourquoi la reformulation n'a pas abouti » ne demande rien de
// plus.
function journaliser(nomProvider: string, dureeMs: number, statut: string, raison?: string): void {
  console.info(
    `[redaction] provider=${nomProvider} duree_ms=${dureeMs} statut=${statut}${raison ? ` raison=${raison}` : ""}`
  );
}

export async function reformulerBrouillon(
  redacteur: RedacteurCommunication | undefined,
  contexte: ContexteRedactionAugmentee
): Promise<ResultatRedaction> {
  // Fonctionnalité non configurée : ce n'est pas une panne, et rien n'est journalisé comme telle.
  if (!redacteur) return { type: "indisponible", raison: "non_configure" };

  const debut = Date.now();
  let resultat: ResultatRedaction;
  try {
    resultat = await redacteur.reformuler(contexte);
  } catch {
    // Un adaptateur ne devrait jamais lever, mais une exception ne doit en aucun cas remonter
    // jusqu'à l'écran : elle exposerait un détail technique et ferait perdre le brouillon.
    journaliser(redacteur.nom, Date.now() - debut, "indisponible", "exception_adaptateur");
    return { type: "indisponible", raison: "exception_adaptateur" };
  }
  const duree = Date.now() - debut;

  if (resultat.type === "indisponible") {
    journaliser(redacteur.nom, duree, "indisponible", resultat.raison);
    return resultat;
  }

  const objet = resultat.objet.trim();
  const corps = resultat.corps.trim();
  const validation = validerReformulation(contexte, objet, corps);
  if (!validation.valide) {
    // Rejet, jamais correction : une sortie douteuse est abandonnée entière. Le conseiller garde
    // son brouillon déterministe, qui reste vrai.
    journaliser(redacteur.nom, duree, "rejete", validation.motif);
    return { type: "indisponible", raison: `garde_fou_${validation.motif}` };
  }

  journaliser(redacteur.nom, duree, "reformule");
  return { type: "reformule", objet, corps };
}
