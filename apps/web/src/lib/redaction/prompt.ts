import { LABEL_TON_MESSAGE } from "@/lib/communications/contexteCommunication";
import type { ContexteRedactionAugmentee } from "./contrat";

// VALUE-05 — prompt métier, court et strict. Il ne remplace AUCUN garde-fou : la sortie du modèle
// est revalidée de façon déterministe (gardeFous.ts) quoi qu'il ait compris de ces consignes. Un
// prompt est une demande, jamais une garantie.
//
// VALUE-05B — calibrage stylistique. Les premières sorties réelles étaient exactes mais
// administratives, pour deux raisons visibles dans le prompt d'origine : (1) aucune consigne de
// STYLE n'existait, seulement des interdits factuels — le modèle produisait donc le registre neutre
// par défaut (« examiner notre proposition ») ; (2) les faits autorisés étaient présentés comme une
// liste à honorer, ce qui poussait à tous les caser, y compris l'adresse que le brouillon
// déterministe omet volontairement pour certaines intentions (« Retour sur l'estimation du 8 rue du
// Clos Fictif » comme objet). Les consignes ci-dessous corrigent ces deux points sans rien changer
// aux données transmises ni aux protections.

const CONSIGNE_TON: Record<string, string> = {
  professionnel:
    "précis, naturel et direct — professionnel ne veut pas dire administratif : phrases courtes, vocabulaire simple",
  cordial: "légèrement plus chaleureux, sans familiarité, sans exclamation ni flatterie",
  court:
    "réellement court : deux à quatre phrases utiles au maximum, hors salutation et formule finale ; ne garde que ce qui est indispensable à l'intention du message",
  relance_douce:
    "aucune pression, aucun reproche, jamais un rappel du silence ; préfère « je me permets de revenir vers vous », « avez-vous eu le temps de prendre connaissance de… », « si vous souhaitez que nous en reparlions » ; évite « examiner », « sans réponse », « toujours pas », « rapidement », « décision »",
};

export const PROMPT_SYSTEME = [
  "Tu reformules des courriels professionnels d'un conseiller immobilier français à son client.",
  "Tu ne fais que reformuler : tu n'ajoutes, ne supprimes et ne modifies aucun fait.",
  "La liste de faits fournie est EXHAUSTIVE. Aucun autre fait n'existe.",
  "N'invente jamais une date, un prix, un chiffre, un rendez-vous, une disponibilité, une caractéristique du bien, un nom de personne ou de lieu.",
  "Ne prête aucun sentiment, aucune intention ni aucune réponse au client.",
  "N'ajoute ni urgence, ni promesse, ni superlatif : jamais « parfait », « idéal » ou « à ne pas manquer ».",
  "Les notes internes du conseiller ne te sont pas fournies : ne déduis rien de ce qui n'est pas écrit.",
  "Ne donne aucun conseil juridique, fiscal ni financier.",
  "N'invente ni le nom, ni la signature, ni les coordonnées du conseiller.",
  "Conserve la salutation, la signature et le vouvoiement.",
  // --- Style (VALUE-05B) ---
  "Écris comme un conseiller immobilier expérimenté : naturel, sobre, chaleureux et direct, jamais administratif.",
  "Évite le jargon et les tournures lourdes : préfère « prendre connaissance de » à « examiner », « en reparler » à « en discuter ».",
  "La liste de faits n'est pas une liste à remplir : n'utilise que ceux qui servent réellement la phrase, laisse les autres de côté.",
  "Ne mentionne l'adresse du bien que si elle est nécessaire pour identifier le dossier ; si la date d'un rendez-vous suffit, l'adresse est inutile.",
  "Termine par UNE seule ouverture à l'échange : jamais deux formules qui disent la même chose.",
  "L'objet doit être une phrase courte et grammaticale, jamais une juxtaposition d'informations.",
  "Bon objet : « Suite à l'estimation de votre bien », « Retour sur notre rendez-vous d'estimation ».",
  "Mauvais objet : « Retour sur l'estimation du 8 rue du Clos Fictif » — l'adresse y est collée sans syntaxe.",
  // --- Format ---
  'Réponds UNIQUEMENT par un objet JSON de la forme {"objet": "...", "corps": "..."}.',
  "Aucune explication, aucun commentaire, aucun markdown, aucun bloc de code.",
].join("\n");

// Les faits sont rendus en clair et nommés : le modèle doit pouvoir constater qu'ils sont peu
// nombreux et bornés. Un fait absent n'est jamais remplacé par un espace réservé.
function listerFaits(contexte: ContexteRedactionAugmentee): string {
  const { faitsAutorises } = contexte;
  const lignes: string[] = [];
  if (faitsAutorises.destinatairePrenom) lignes.push(`- prénom du destinataire : ${faitsAutorises.destinatairePrenom}`);
  if (faitsAutorises.bienAdresse) lignes.push(`- adresse du bien : ${faitsAutorises.bienAdresse}`);
  if (faitsAutorises.dateVisite) lignes.push(`- date de la visite : ${faitsAutorises.dateVisite}`);
  if (faitsAutorises.interetVisite) lignes.push(`- retour de visite enregistré : ${faitsAutorises.interetVisite}`);
  if (faitsAutorises.criteresCompatibles?.length) {
    lignes.push(`- correspond à : ${faitsAutorises.criteresCompatibles.join(", ")}`);
  }
  return lignes.length > 0 ? lignes.join("\n") : "- aucun fait supplémentaire";
}

// La relation de propriété n'est JAMAIS déduite par le modèle : elle lui est dite, à partir du type
// de destinataire déjà résolu côté serveur. Sans cette consigne, « votre bien » adressé à un
// acquéreur affirmerait une propriété qui n'existe pas — d'où une instruction explicite dans les
// deux sens plutôt qu'un silence.
function consigneRelation(contexte: ContexteRedactionAugmentee): string {
  return contexte.destinataireEstProprietaire
    ? "Le destinataire est le propriétaire du bien concerné : écris « votre bien » plutôt que « le bien »."
    : "Le destinataire n'est pas propriétaire du bien concerné : n'écris jamais « votre bien ».";
}

export function construirePromptUtilisateur(contexte: ContexteRedactionAugmentee): string {
  return [
    `Ton demandé : ${LABEL_TON_MESSAGE[contexte.ton]} — ${CONSIGNE_TON[contexte.ton]}.`,
    consigneRelation(contexte),
    "",
    "Faits autorisés (liste exhaustive) :",
    listerFaits(contexte),
    "",
    `Objet actuel :\n${contexte.objetActuel}`,
    "",
    `Corps actuel :\n${contexte.corpsActuel}`,
  ].join("\n");
}
