import { LABEL_TON_MESSAGE } from "@/lib/communications/contexteCommunication";
import type { ContexteRedactionAugmentee } from "./contrat";

// VALUE-05 — prompt métier, court et strict. Il ne remplace AUCUN garde-fou : la sortie du modèle
// est revalidée de façon déterministe (gardeFous.ts) quoi qu'il ait compris de ces consignes. Un
// prompt est une demande, jamais une garantie.

const CONSIGNE_TON: Record<string, string> = {
  professionnel: "précis, naturel et sobre",
  cordial: "chaleureux, sans familiarité excessive",
  court: "réellement court : deux ou trois phrases au maximum",
  relance_douce: "sans aucune pression ni reproche, jamais un rappel de non-réponse",
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
  "Conserve la salutation, la signature et le vouvoiement.",
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

export function construirePromptUtilisateur(contexte: ContexteRedactionAugmentee): string {
  return [
    `Ton demandé : ${LABEL_TON_MESSAGE[contexte.ton]} — ${CONSIGNE_TON[contexte.ton]}.`,
    "",
    "Faits autorisés (liste exhaustive) :",
    listerFaits(contexte),
    "",
    `Objet actuel :\n${contexte.objetActuel}`,
    "",
    `Corps actuel :\n${contexte.corpsActuel}`,
  ].join("\n");
}
