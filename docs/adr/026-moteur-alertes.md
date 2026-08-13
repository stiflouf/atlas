# ADR-026 — Moteur d'alertes déterministes du copilote

**Statut :** Accepté
**Date :** 2026-08-13
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-022 à ADR-025 ont construit, indépendamment les uns des autres, plusieurs résultats typés
(`ResultatFiscal`, `ResultatFiscalProjete`, compteurs `dashboardRepository`) qui exposent chacun
leurs propres raisons d'indisponibilité (`RaisonIndisponibilite`, `RaisonIndisponibiliteProjection`)
ou leurs propres compteurs de couverture. Rien ne les rassemble aujourd'hui en une vue unique
"ce qui mérite l'attention du conseiller" — le conseiller doit visiter `/fiscal` et `/dashboard`
séparément et interpréter lui-même chaque raison technique. Cette passe construit un moteur
d'alertes qui dérive, à la lecture et sans aucune persistance, un ensemble priorisé d'alertes à
partir des résultats déjà calculés — sur le même patron que `src/lib/pointsForts/moteur.ts` et
`src/lib/pointsAttention/moteur.ts` (règles pures `{ id, evaluer }`) et `src/lib/actionPriority.ts`
(priorité déterministe par score).

Un tour de revue architecturale a validé le plan en principe et demandé quatre corrections
obligatoires avant codage, détaillées ci-dessous. Codage direct après incorporation, sans nouveau
tour de plan.

## Décision

### 1. Assiette incomplète fondée sur `AssietteAnnuelle.couverture`, jamais sur l'absence brute d'une ligne `historique_amorcage`

L'alerte "couverture incomplète" (catégorie données/couverture) se déclenche uniquement sur
`assiette.couverture === "partielle"` (ADR-024) — jamais sur la simple absence d'une ligne
`historique_amorcage`, qui n'est pas en soi une anomalie : une activité commencée en même temps
qu'Atlas peut légitimement n'avoir aucun amorçage à renseigner. C'est cette même alerte qui, en
déduplication, peut absorber "historique run-rate insuffisant" quand la cause est effectivement la
même couverture manquante — jamais l'alerte "règles futures hypothétiques" (ADR-025), dont la cause
(absence de publication légale officielle) est indépendante de tout historique utilisateur.

### 2. Champ inconnu vs régime connu mais non couvert : deux alertes distinctes, jamais confondues

Une donnée `'inconnu'` (vraie valeur stockée, ADR-023) que l'utilisateur peut compléter et un
régime réellement renseigné mais non pris en charge par le moteur de calcul V1 (ex.
`regimeFiscal = 'declaration_controlee'`, `regimeTva = 'redevable_reel_simplifie'`) sont deux
situations opposées, jamais mélangées :

- **Champ inconnu** : niveau `action_requise`, action explicite vers `/fiscal#profil`.
- **Régime connu, non couvert** : niveau `information`/`attention` selon l'ampleur de ce qui est
  bloqué, **jamais d'action demandant de changer une situation réelle**. Le texte explique une
  limite actuelle d'Atlas, jamais une anomalie de la situation du conseiller.

### 3. Déduplication par cause racine (type + code), jamais par comparaison de texte

`profil_fiscal_absent` est une cause racine : sa présence supprime toute alerte qui dépend d'un
profil fiscal (assiette, régime, règle absente, run-rate, dépassements constatés/projetés,
éligibilité VFL) — jamais les alertes purement commerciales (rémunération manquante, date
d'encaissement manquante, encaissement attendu dépassé), qui restent indépendantes. Une couverture
historique insuffisante peut absorber l'alerte "run-rate insuffisant" pour la même cause — elle
n'absorbe jamais "règles futures hypothétiques" (cause indépendante, voir point 1). Le cas ACRE
(règle absente alors qu'ACRE est active) n'est jamais une seconde alerte séparée : c'est la même
règle générique "règle légale absente", dédupliquée par code (`taux_acre_micro_entrepreneur`) comme
n'importe quel autre code manquant du référentiel. Les règles futures reconduites à titre
d'hypothèse (ADR-025, `origine: "hypothese_reconduction"`) sont regroupées en **une seule** alerte
sur tout l'horizon N+1→N+5, jamais une alerte par règle et par année (`reglesProjection.ts`) — un
dernier filet de sécurité déduplique par identifiant déterministe puis, en tout dernier recours, par
libellé strictement identique, mais ce filet n'est jamais le mécanisme principal.

### 4. Priorité déterministe à deux niveaux, jamais un score affiché

`priorite.ts` reprend exactement le principe de `actionPriority.ts` : score = poids fixe du niveau
(`action_requise` > `attention` > `information`, toujours dominant) + poids fixe documenté par type
d'alerte (convention produit interne, table explicite et testée) + tie-break stable sur l'identifiant
déterministe de l'alerte. Aucun score n'est jamais exposé à l'UI — seul un libellé de niveau
(`À compléter`/`À surveiller`/`Pour information`).

## Contrat de types

```ts
type NiveauAlerte = "information" | "attention" | "action_requise";
type CategorieAlerte = "donnees_incompletes" | "commercial" | "fiscal_constate" | "fiscal_projete";
type AlerteCopilote = {
  id: string; // déterministe : `${type}:${dossierFiscalId}:${annee ?? ""}:${code ?? ""}`
  type: TypeAlerte;
  categorie: CategorieAlerte;
  niveau: NiveauAlerte;
  titre: string;
  explication: string;
  donneesDeclencheuses: { dossierFiscalId?: string; bienId?: string; compromisId?: string; annee?: number; code?: string };
  provenance: ProvenanceAlerte[];
  action?: { libelle: string; href: string };
};
```

## Catalogue des règles (V1)

- **Données/couverture** : profil fiscal absent (cause racine) ; champ réellement inconnu par
  champ (`regimeFiscal`/`regimeTva`/`affiliationRetraite`) ; régime connu non couvert (fiscal et
  TVA, séparément) ; assiette incomplète ; rémunérations manquantes (agrégé, compteurs existants
  `chargerRemuneration()`) ; dates d'encaissement prévues manquantes (agrégé, compteurs existants
  `chargerProjectionAnnuelle()`) ; règle légale absente (dédupliquée par code, couvre le cas ACRE) ;
  historique de run-rate insuffisant (1 à 5 mois garantis strictement — 0 mois n'est pas une
  anomalie, 6+ mois signifie déjà fiable).
- **Commercial** : encaissement attendu dépassé (vocabulaire neutre imposé, jamais "retard" ni
  "incident" ni "anomalie" — `dateEncaissementPrevue` reste une prévision corrigible).
- **Fiscal constaté** : dépassement micro-BNC constaté (uniquement sur couverture complète, jamais
  un verdict de sortie du régime) ; deux années consécutives de dépassement constaté (combinaison de
  faits déjà calculés, jamais une seconde implémentation de la règle micro-BNC) ; versement
  libératoire actif mais éligibilité RFR non vérifiable (le calcul du VFL lui-même n'est jamais remis
  en cause, seul le contrôle d'éligibilité l'est).
- **Fiscal projeté** : dépassement projeté par année (pipeline et tendance statistique mentionnés
  côte à côte, jamais additionnés, toujours qualifié de projection) ; règles futures reconduites à
  titre d'hypothèse, regroupées globalement sur N+1→N+5.

**Volontairement exclu de cette V1** : proximité d'un seuil (micro-BNC ou TVA) — décision produit
"option 2+3" : les marges restent affichées factuellement en continu dans `/fiscal`
(`franchiseTva.margeAvantSeuilBaseCentimes`/`margeAvantSeuilMajoreCentimes`), mais aucune alerte
proactive de proximité tant qu'un seuil produit explicite (ex. "80 %", "90 %") n'a pas été décidé.
Statuts `a_confirmer`/`recoupement` (déjà visibles dans `ExplicationCalcul`), différence
pipeline/run-rate (interdite par ADR-025), recommandation d'optimisation fiscale, notification
push/email, persistance des alertes, LLM : tous hors périmètre.

## Architecture

`src/lib/alertes/{contexte,reglesDonnees,reglesCommercial,reglesFiscal,reglesProjection,
deduplication,priorite,moteur,id,raisons}.ts`. `contexte.ts` assemble les résultats déjà exposés par
ADR-022→025 (aucune nouvelle requête Drizzle, aucun nouveau repository) ; les fichiers `regles*.ts`
ne font eux-mêmes aucune requête, uniquement des règles pures `{ id, evaluer }` sur un objet
`ContexteAlertes` déjà chargé — même séparation que `pointsForts`/`pointsAttention`. `moteur.ts`
compose : règles → alertes brutes → déduplication causale → priorité déterministe → résultat.

## UX

Nouvelle section "Ce qui mérite mon attention" en tête de `/` (`AlerteCard.tsx`) : 5 alertes
prioritaires au maximum affichées directement, le reste derrière un `<details>`/`<summary>` natif
"Afficher les autres" (aucun JS client, même patron que `ExplicationCalcul`) — développé localement,
aucune nouvelle route `/alertes`. `/dashboard` et `/fiscal` restent les vues détaillées existantes,
ni l'une ni l'autre ne duplique le moteur : leurs résultats sont des sources du moteur, jamais
l'inverse. Ancres `id` simples ajoutées sur les sections existantes utilisées comme cibles d'action
(`/fiscal#profil`, `/fiscal#amorcage`, `/fiscal#rfr`, `/dashboard#remuneration`,
`/dashboard#projection`) — aucune nouvelle logique, uniquement des ancres DOM.

## Conséquences

- Aucune migration (aucune nouvelle table/colonne) — les alertes ne sont jamais persistées.
- Nouveaux : `src/types/alerte.ts`, `src/lib/alertes/{contexte,id,raisons,reglesDonnees,
  reglesCommercial,reglesFiscal,reglesProjection,deduplication,priorite,moteur}.ts` (+ tests, 57 cas),
  `src/lib/alertes/contexteTest.ts` (fabriques de fixtures partagées entre suites),
  `src/components/alertes/AlerteCard.tsx`.
- `src/app/page.tsx` : nouvelle section "Ce qui mérite mon attention" en tête de page.
- `src/app/fiscal/page.tsx`/`src/app/dashboard/page.tsx` : ancres `id` ajoutées sur des sections
  déjà existantes, aucune section ni logique nouvelle.
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/
  `docs/AI_HANDOFF.md` mis à jour en conséquence.
- Hors périmètre, réservé à des passes ultérieures : alerte de proximité de seuil (seuil produit à
  décider), listing individuel dossier par dossier pour les compteurs A4/A5, notifications
  push/email, persistance/historisation des alertes, route `/alertes` dédiée, recommandation
  d'optimisation fiscale.
