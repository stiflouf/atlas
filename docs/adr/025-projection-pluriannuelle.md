# ADR-025 — Projection fiscale pluriannuelle (N+1 à N+5)

**Statut :** Accepté
**Date :** 2026-08-13
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-024 a construit le premier moteur de calcul fiscal, strictement borné à l'année civile en
cours. Cette passe étend la projection à un horizon N+1 → N+5, à partir du pipeline commercial daté
(compromis `en_cours`, ventes finalisées non encaissées) et d'une tendance statistique dérivée des
encaissements réels passés (`remuneration`) — toujours sans nouvelle table.

Un tour de revue architecturale a validé le plan en principe et demandé cinq corrections
obligatoires avant codage, détaillées ci-dessous. Codage direct après incorporation, sans nouveau
tour de plan.

## Décision

### 1. Pipeline daté et tendance statistique : jamais additionnés

Le pipeline commercial connu (compromis engagés, dates prévues) et la tendance statistique (moyenne
mensuelle passée projetée sur l'année) sont deux lectures indépendantes du même chiffre d'affaires
futur possible — pas deux composantes d'un total. Atlas n'a aucun historique de snapshots permettant
d'estimer quelle part du run-rate statistique recouvre déjà le pipeline connu ; les additionner
produirait un double comptage silencieux.

`ProjectionAnneeFiscale` (`src/types/projectionFiscale.ts`) expose donc `pipeline`, `statistique` et
`hypothese` comme trois blocs strictement séparés, chacun avec ses propres conséquences fiscales
calculées indépendamment. **Aucun champ agrégé n'existe sur ce type** — pas de
`totalProjeteCentimes`, ni dans les types ni dans l'UI (`ProjectionPluriannuelle.tsx`). Testé
explicitement (`projectionPluriannuelle.test.ts`) : pipeline 18 000 € + run-rate 72 000 € ne produit
jamais 90 000 € nulle part dans la structure retournée.

### 2. Run-rate : mois calendaires entièrement couverts, y compris les mois à zéro

`chargerHistoriqueMensuel` (`src/lib/fiscal/historiqueMensuel.ts`) construit une série mensuelle
**zero-remplie** : un mois couvert sans encaissement vaut `0` et entre dans la moyenne au même titre
qu'un mois avec vente — jamais une moyenne calculée sur les seuls mois ayant une vente (biais
haussier systématique). Le seuil produit reste 6 mois consécutifs (`SEUIL_MOIS_MINIMUM_RUN_RATE`,
`runRate.ts`), mais uniquement 6 mois **entièrement garantis** : la frontière de couverture
(dernière `dateFinCouverture` d'`historique_amorcage`, toutes années confondues) doit tomber au
dernier jour d'un mois pour que ce mois compte ; si elle tombe en cours de mois, ce mois-là ne
compte pas et le premier mois garanti est le suivant. Absence totale de ligne `historique_amorcage`
= aucune frontière garantie = série vide, quel que soit le volume de faits Atlas disponibles (même
principe que `resoudreAssietteAnnuelle`, ADR-024). Testé aux trois bornes
(`historiqueMensuel.test.ts`, `runRate.test.ts`) : `[1000, 0, 1000, 0, 1000, 0]` sur 6 mois garantis
utilise bien les 6 mois (moyenne 500, pas une moyenne sur les 3 mois non nuls) ; 5 mois garantis
seulement reste non fiable ; une frontière tombant en milieu de mois exclut ce mois.

### 3. `resoudreRegleProjection()` : distinguer validité actuelle et règle future officiellement connue

`dateFinValidite = NULL` sur une `regle_fiscale` signifie « toujours en vigueur aujourd'hui », **pas**
« publiée pour couvrir une année lointaine ». `resoudreRegleProjection`
(`src/lib/fiscal/resolutionRegleProjection.ts`) distingue, pour une date future :

- **officielle** — une règle dont la `dateFinValidite` est explicitement connue et postérieure à la
  date demandée (preuve qu'une publication couvre réellement cette date) ;
- **hypothese_reconduction** — la règle actuellement ouverte (`dateFinValidite = NULL`) ou la
  dernière règle jamais publiée pour ce code, reconduite sans garantie ;
- **indisponible** — aucune règle historique pour ce code.

`regle_fiscale` n'est **jamais** modifiée pour matérialiser une reconduction hypothétique — aucun
appel à `insererRegleFiscale` dans ce chemin. L'UI (`ExplicationCalculProjection.tsx`) affiche
toujours la distinction, jamais masquée. Testé (`resolutionRegleProjection.test.ts`) : une règle
sans fin connue demandée en 2030 est une hypothèse, jamais officielle ; une règle explicitement
publiée jusqu'en 2028 est officielle en 2028 et redevient une reconduction hypothétique au-delà de
sa fin de validité ; aucune reconduction n'est jamais écrite en base.

### 4. Granularité temporelle conservée pour appliquer un changement de règle en cours d'année

Le run-rate produit une **ventilation mensuelle** (`ventilerRunRateSurAnnee`), pas seulement un
montant annuel — ventilation plate, sans saisonnalité (V1). Chaque tranche (mois de run-rate ou
élément de pipeline) est résolue à sa propre date via `resoudreTrancheProjeteeAvecTaux`
(`resolutionTrancheProjetee.ts`), qui réutilise telles quelles les gardes de régime exportées par les
moteurs ADR-024 (`cotisationsSociales`/`cfp`/`versementLiberatoire`/`microBnc`/`franchiseTva`) —
aucune règle n'est réimplémentée, seule la source de résolution change
(`resoudreRegleProjection` au lieu de `resoudreRegle`). Un changement de taux/régime/fin d'ACRE en
cours d'année projetée est donc appliqué mois par mois, jamais un dernier taux connu multiplié par
le total annuel. Testé (`resolutionTrancheProjetee.test.ts`) : deux règles officielles couvrant
chacune une moitié de 2030 (10 % puis 20 %) donnent 1 800 000 sur 12 tranches mensuelles de
1 000 000, jamais 2 400 000 (dernier taux × total).

Pour une hypothèse utilisateur (montant annuel unique, correction n° 5), la même contrainte
s'applique : `calculerConsequencesFiscalesHypothese` (`consequencesFiscalesProjetees.ts`) ne taxe le
montant directement que si le profil **et** chaque règle applicable sont strictement identiques du
1er janvier au 31 décembre de l'année (`hypotheseVentilable`). Sinon, aucune répartition n'est
devinée : chaque composante retourne explicitement `ventilation_requise`
(`RaisonIndisponibiliteProjection`) plutôt qu'un chiffre construit sur une hypothèse de
répartition. Testé (`consequencesFiscalesProjetees.test.ts`) : un changement de régime en cours
d'année produit `ventilation_requise` sur toutes les composantes, jamais une estimation approximative.

### 5. Hypothèses utilisateur : temporaires, jamais persistées

Le montant annuel hypothétique saisi par l'utilisateur (`hypothese_{année}` sur le formulaire GET de
`/fiscal`) sert uniquement à la simulation de la requête courante — lu depuis la query string,
jamais écrit en base, aucune migration dans cette passe. `BlocHypothese`
(`src/types/projectionFiscale.ts`) documente explicitement cette absence de persistance. La
sauvegarde éventuelle de scénarios fera l'objet d'une passe ultérieure.

## Contrat générique — `ResultatFiscalProjete<T>`

```ts
type ProvenanceRegleProjection =
  | { origine: "officielle"; regle: ProvenanceRegle }
  | { origine: "hypothese_reconduction"; regleReconduite: ProvenanceRegle; anneeDerniereRegleOfficielle: number }
  | { origine: "indisponible"; code: string };

type ResultatFiscalProjete<T> =
  | { statut: "calcule"; valeur: T; provenance: ProvenanceRegleProjection[] }
  | { statut: "partiel"; valeurConnue: T; provenance: ProvenanceRegleProjection[]; raisons: RaisonIndisponibiliteProjection[] }
  | { statut: "indisponible"; raisons: RaisonIndisponibiliteProjection[] };
```

Sur-ensemble strict du contrat ADR-024 (`ResultatFiscal<T>`) : même philosophie (jamais un `number`
nu), provenance élargie pour porter la distinction officielle/hypothèse,
`RaisonIndisponibiliteProjection` ajoute uniquement `ventilation_requise` aux raisons ADR-024
existantes — `libelleRaisonIndisponibilite` (`libellesRaisons.ts`) accepte les deux types sans
affecter les appelants ADR-024 existants.

## UX — `/fiscal`, section "Projection {N+1}–{N+5}"

Extension de `/fiscal` existant (pas de nouvelle route) : une carte par année, chacune avec pipeline
connu, tendance statistique (avec nombre de mois d'historique utilisés) et hypothèse utilisateur si
saisie pour cette requête, jamais fusionnés visuellement. `ExplicationCalculProjection.tsx`
(`<details>` natif, même patron que `ExplicationCalcul` d'ADR-024) affiche la provenance de chaque
règle, avec la distinction officielle/hypothèse toujours visible. Un formulaire GET natif par carte
année permet de simuler un montant annuel sans rechargement JS et sans persistance.

## Conséquences

- Aucune migration (aucune nouvelle table/colonne).
- Nouveaux : `src/types/projectionFiscale.ts`, `src/lib/fiscal/{runRate,historiqueMensuel,
  resolutionRegleProjection,resolutionTrancheProjetee,projectionAnnuelle,projectionPluriannuelle,
  consequencesFiscalesProjetees}.ts` (+ tests), `src/components/fiscal/{ProjectionPluriannuelle,
  ExplicationCalculProjection}.tsx`.
- `remunerationRepository.ts` : nouvelle fonction `listerEncaissementsDepuis` (sans borne de fin,
  contrairement à `listerEncaissementsAnnee` d'ADR-024 — le run-rate doit pouvoir remonter sur
  plusieurs années).
- `dashboardRepository.ts` : nouvelle fonction `listerPipelineDate`, pipeline daté non agrégé sur une
  fenêtre d'années arbitraire (contrairement à `chargerProjectionAnnuelle`, jamais limitée à l'année
  civile en cours).
- `assietteAnnuelle.ts`/`cotisationsSociales.ts`/`cfp.ts`/`versementLiberatoire.ts`/`microBnc.ts`/
  `franchiseTva.ts` : quelques constantes/fonctions internes (catégorie d'activité, codes, gardes de
  régime) exportées pour être réutilisées telles quelles par le moteur de projection — aucune règle
  réimplémentée.
- `src/app/fiscal/page.tsx` : nouvelle section "Projection {N+1}–{N+5}", affichée uniquement si un
  profil fiscal existe ; hypothèses utilisateur lues depuis la query string d'un formulaire GET.
- Validation UI faite par rendu HTML serveur (`fetch` + assertions de contenu contre un serveur
  `next dev` réel, avec un profil fiscal et un historique temporaires insérés/supprimés dans le
  dossier fiscal par défaut), pas par inspection visuelle dans un navigateur — aucun binaire
  Chromium utilisable dans l'environnement d'exécution (dépendances système non installables, réseau
  restreint).
- Observation, non bloquante : le seul code du référentiel réellement borné dans le temps
  (`plafond_micro_bnc`, jusqu'au 2029-01-01) permettrait d'observer le badge "officielle" dans l'UI,
  mais `StatutRegimeMicroBncProjete`/`SeuilTvaProjete` ne sont pas affichés avec détail de provenance
  dans `ProjectionPluriannuelle.tsx` — même choix d'UI que `VueAnneeResume.tsx` en ADR-024 (seuls
  cotisations/CFP/VFL ont un `<details>`). Le chemin "officielle" reste couvert par les tests
  d'intégration dédiés (`resolutionRegleProjection.test.ts`).
- Hors périmètre, réservé à des passes ultérieures : persistance des hypothèses utilisateur,
  saisonnalité, scénarios prudent/haut nommés, TVA collectée/déductible et facturation complète,
  déclaration fiscale automatique, sociétés, BIC/carte T, multi-utilisateur, optimisation fiscale.
