import type { SourceDeVerite } from "@/types/provenance";

// ADR-056 §4/§5 — la primitive qui décide, pour UN champ, ce qu'une valeur entrante a le droit de
// faire. Fonction PURE : aucun I/O, aucun appel fournisseur, aucune base, aucune IA. C'est ce qui
// la rend exhaustivement testable, et c'est aussi ce qui garantit que la règle « une correction
// humaine n'est jamais écrasée » ne dépend d'aucun état d'exécution.
//
// Elle ne décide RIEN d'autre : elle ne crée pas d'entité, ne résout pas d'identité, n'écrit pas.
// Le moteur de synchronisation l'appellera champ par champ et agira sur sa réponse.

export type DecisionImport =
  // La valeur entrante peut être écrite.
  | "appliquer"
  // Rien à faire : les deux valeurs disent déjà la même chose.
  | "ignorer"
  // Le fournisseur propose autre chose que ce que DOMIORA tient pour vrai. AUCUNE écriture, et le
  // désaccord doit devenir visible — jamais un log silencieux, jamais une résolution automatique.
  | "conflit";

export type ContexteDecisionImport = {
  // Ce que DOMIORA a aujourd'hui. `undefined` = le champ n'est pas renseigné.
  valeurLocale: unknown;
  // Ce que le fournisseur propose.
  valeurExterne: unknown;
  // Un humain a-t-il explicitement figé ce champ ?
  champVerrouille: boolean;
  // Qui fait foi pour cette entité et ce fournisseur (ADR-056 §5).
  sourceDeVerite: SourceDeVerite;
};

// Comparaison de VALEURS, volontairement stricte et sans coercition : `450000` et `"450000"` ne
// disent pas la même chose, et les traiter comme égales ferait disparaître un vrai désaccord de
// typage entre deux systèmes. `Object.is` traite aussi `NaN` comme égal à lui-même, ce que `===`
// ne fait pas — un `NaN` des deux côtés est une absence de valeur identique, pas un conflit.
function memeValeur(locale: unknown, externe: unknown): boolean {
  return Object.is(locale, externe);
}

// L'ordre des règles EST la décision (ADR-056 invariant 4) :
//
//   1. valeurs identiques         -> `ignorer`, quoi qu'il arrive. Il n'y a pas de conflit à
//                                    déclarer quand tout le monde dit la même chose, verrou ou pas.
//   2. champ verrouillé           -> `conflit`. C'est le cas fondateur : 470 000 corrigé à la main,
//                                    450 000 proposé au pull suivant. Aucune écriture.
//   3. source de vérité `domiora` -> `conflit`. DOMIORA fait foi ; le pull ne sert alors qu'à
//                                    détecter des écarts, et un écart tu ne serait pas un écart
//                                    détecté.
//   4. sinon                      -> `appliquer`.
//
// Le verrou est évalué AVANT la source de vérité, et ce n'est pas un détail : même quand le
// fournisseur fait foi, une correction humaine reste prioritaire. « Human validation > external
// sync », sans condition.
export function deciderApplicationValeurExterne(contexte: ContexteDecisionImport): DecisionImport {
  if (memeValeur(contexte.valeurLocale, contexte.valeurExterne)) return "ignorer";
  if (contexte.champVerrouille) return "conflit";
  if (contexte.sourceDeVerite === "domiora") return "conflit";
  return "appliquer";
}
