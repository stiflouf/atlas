import { PROMPT_SYSTEME, construirePromptUtilisateur } from "./prompt";
import type { ContexteRedactionAugmentee, RedacteurCommunication, ResultatRedaction } from "./contrat";

// VALUE-05 — adaptateur unique, écrit en `fetch` brut sur le même patron que gmailClient.ts
// (AbortController + timeout + erreurs catégorielles). AUCUN SDK n'est installé : une dépendance
// fournisseur dans le package.json est un choix d'architecture, et ce lot n'en fait aucun.
//
// Le protocole visé est `POST {baseUrl}/chat/completions` au format OpenAI — choisi comme PROTOCOLE
// et non comme fournisseur : il est servi à l'identique par plusieurs opérateurs européens, par des
// passerelles, et par un modèle auto-hébergé (Ollama, vLLM). Pointer DOMIORA vers un modèle
// européen ou local ne demande donc qu'un changement de variable d'environnement, jamais une
// réécriture de Communications. Une API au protocole différent (Anthropic Messages, par exemple)
// se branche en écrivant un second adaptateur derrière la même interface — Communications reste
// intact dans les deux cas.

const TIMEOUT_MS = 12_000;
// Une reformulation, pas une génération : la marge au-dessus du brouillon source suffit largement,
// et le plafond borne aussi le coût d'un appel.
const MAX_TOKENS = 900;

export type ConfigurationRedacteur = {
  baseUrl: string;
  modele: string;
  cleApi?: string;
};

function extraireContenu(charge: unknown): string | undefined {
  const reponse = charge as { choices?: { message?: { content?: unknown } }[] };
  const contenu = reponse.choices?.[0]?.message?.content;
  return typeof contenu === "string" ? contenu : undefined;
}

// Le modèle peut encadrer son JSON d'un bloc de code malgré la consigne : on tolère ce seul
// habillage à la lecture, jamais dans le texte final (les garde-fous rejettent tout balisage
// restant dans l'objet ou le corps).
function lireObjetJson(contenu: string): { objet?: unknown; corps?: unknown } | undefined {
  const nettoye = contenu.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const valeur = JSON.parse(nettoye);
    return typeof valeur === "object" && valeur !== null ? (valeur as { objet?: unknown; corps?: unknown }) : undefined;
  } catch {
    return undefined;
  }
}

export function creerRedacteurCompatibleOpenAI(config: ConfigurationRedacteur): RedacteurCommunication {
  return {
    nom: "compatible-openai",
    async reformuler(contexte: ContexteRedactionAugmentee): Promise<ResultatRedaction> {
      const controleur = new AbortController();
      const delai = setTimeout(() => controleur.abort(), TIMEOUT_MS);

      let reponse: Response;
      try {
        reponse = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.cleApi ? { Authorization: `Bearer ${config.cleApi}` } : {}),
          },
          body: JSON.stringify({
            model: config.modele,
            // Basse mais non nulle : la reformulation doit rester naturelle sans partir en
            // invention. Les garde-fous restent la vraie limite.
            temperature: 0.3,
            max_tokens: MAX_TOKENS,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: PROMPT_SYSTEME },
              { role: "user", content: construirePromptUtilisateur(contexte) },
            ],
          }),
          signal: controleur.signal,
        });
      } catch {
        // Timeout ou rupture réseau : aucune tentative de reprise dans ce lot (un clic = un appel).
        return { type: "indisponible", raison: "reseau_ou_timeout" };
      } finally {
        clearTimeout(delai);
      }

      if (!reponse.ok) {
        // Statut seul : jamais le corps de la réponse du fournisseur, qui peut réécho le prompt.
        return { type: "indisponible", raison: `http_${reponse.status}` };
      }

      let charge: unknown;
      try {
        charge = await reponse.json();
      } catch {
        return { type: "indisponible", raison: "reponse_illisible" };
      }

      const contenu = extraireContenu(charge);
      if (!contenu) return { type: "indisponible", raison: "reponse_sans_contenu" };

      const objetJson = lireObjetJson(contenu);
      if (!objetJson) return { type: "indisponible", raison: "json_invalide" };
      if (typeof objetJson.objet !== "string" || typeof objetJson.corps !== "string") {
        return { type: "indisponible", raison: "forme_invalide" };
      }

      return { type: "reformule", objet: objetJson.objet, corps: objetJson.corps };
    },
  };
}
