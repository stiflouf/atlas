import { creerRedacteurCompatibleOpenAI } from "./adaptateurCompatibleOpenAI";
import type { RedacteurCommunication } from "./contrat";

// VALUE-05 — configuration et fabrique. Lecture PARESSEUSE de l'environnement (jamais au niveau
// module) : c'est la convention de tout le produit, et c'est elle qui permet à l'application de
// démarrer, de se construire et de servir Communications sans aucune variable IA.
//
// Aucun secret n'est jamais préfixé NEXT_PUBLIC_ : ces trois variables restent strictement côté
// serveur, lues uniquement depuis une Server Action.

const VARIABLE_BASE_URL = "DOMIORA_REDACTION_BASE_URL";
const VARIABLE_MODELE = "DOMIORA_REDACTION_MODELE";
const VARIABLE_CLE_API = "DOMIORA_REDACTION_CLE_API";

// `cleApi` est volontairement facultative : un modèle auto-hébergé sur le réseau privé (Ollama,
// vLLM) n'en demande aucune. Exiger une clé interdirait ce déploiement sans rien sécuriser de plus.
function lireConfiguration() {
  const baseUrl = process.env[VARIABLE_BASE_URL]?.trim();
  const modele = process.env[VARIABLE_MODELE]?.trim();
  if (!baseUrl || !modele) return undefined;
  return { baseUrl, modele, cleApi: process.env[VARIABLE_CLE_API]?.trim() || undefined };
}

// `undefined` = fonctionnalité non configurée. Ce n'est PAS une erreur : c'est l'état par défaut du
// produit, et Communications doit rester entièrement utilisable dans cet état.
export function resoudreRedacteur(): RedacteurCommunication | undefined {
  const configuration = lireConfiguration();
  return configuration ? creerRedacteurCompatibleOpenAI(configuration) : undefined;
}

// Lue par la page pour n'afficher l'action que lorsqu'elle peut réellement aboutir — jamais un
// bouton mort. Ne révèle que l'existence d'une configuration, jamais sa valeur.
export function redactionAssisteeDisponible(): boolean {
  return lireConfiguration() !== undefined;
}
