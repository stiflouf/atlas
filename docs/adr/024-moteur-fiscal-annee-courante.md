# ADR-024 — Moteur fiscal, année civile courante

**Statut :** Accepté
**Date :** 2026-08-13
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-023 a construit les fondations de collecte fiscale (`dossier_fiscal`, `profil_fiscal`,
`historique_amorcage`, `rfr_foyer`, `regle_fiscale`) sans construire aucun calcul. Cette passe
construit le premier moteur de calcul, strictement borné à l'année civile en cours, à partir
exclusivement de ces fondations, des faits `remuneration` (ADR-021) et de la projection commerciale
existante (`chargerProjectionAnnuelle`, ADR-022) — jamais d'un nouveau champ, jamais d'une nouvelle
table.

Un premier tour de revue architecturale a validé le plan en principe et demandé quatre corrections
avant codage, détaillées ci-dessous. Codage direct après ces corrections, sans nouveau tour de plan.

## Décision

### 1. Assiette annuelle : le premier encaissement Atlas n'est jamais un début de couverture

`resoudreAssietteAnnuelle(dossierFiscalId, annee)` (`src/lib/fiscal/assietteAnnuelle.ts`) construit
l'assiette de l'année à partir de deux sources : une ligne `historique_amorcage` éventuelle
(intervalle confirmé explicitement, y compris à 0) et les encaissements `remuneration` réellement
datés de l'année (`remunerationRepository.listerEncaissementsAnnee`, nouveau).

Correction obligatoire : **en l'absence de ligne `historique_amorcage`, tous les encaissements Atlas
connus de l'année entrent quand même dans `montantConnuCentimes`** (y compris le tout premier) —
mais `couverture` reste `"partielle"` et `periodesInconnues` couvre toute la période visible de
l'année, **y compris la portion où des encaissements connus existent**. `PeriodeInconnue`
(`src/types/assietteFiscale.ts`) a été redéfini en conséquence : ce n'est plus "aucune donnée
connue dans cet intervalle" mais "aucune garantie d'exhaustivité sur cet intervalle", qui peut
contenir des montants déjà comptés. Seule une ligne `historique_amorcage` explicite (montant réel ou
zéro confirmé) fait basculer `couverture` à `"complete"`. `dateDebutActivite` du profil borne le
début de la période à couvrir : avant cette date, il n'y a pas d'activité à couvrir, ce n'est pas une
période inconnue.

Une deuxième structure interne, `TrancheAssiette` (une tranche par encaissement individuel +
l'éventuel intervalle d'amorçage), est exposée par `resoudreAssietteAnnuelle` en plus de
l'`AssietteAnnuelle` publique — nécessaire à la granularité requise par le point 5 ci-dessous
(rattachement d'un taux à la date exacte de chaque encaissement).

### 2. Moteurs sociaux/fiscaux micro : garde de régime stricte, jamais d'approximation

`cotisationsSociales.ts`, `cfp.ts`, `versementLiberatoire.ts` ne calculent que pour les profils
réellement couverts par les règles micro-entrepreneur seedées (ADR-023) :

- Cotisations sociales : `regimeFiscal === 'micro_bnc'` **et** `affiliationRetraite ===
  'ssi_regime_general'` (seul code seedé, `taux_cotisations_bnc_general`) — jamais appliqué à une
  déclaration contrôlée (mécanisme de cotisations entièrement différent, assiette nette et non un
  pourcentage direct des recettes) ni à la Cipav (aucun code correspondant dans le référentiel).
- CFP : `regimeFiscal === 'micro_bnc'` uniquement.
- Versement libératoire : `regimeFiscal === 'micro_bnc'` **et** `optionVersementLiberatoire ===
  true` à la date de la tranche — jamais dérivé du RFR (voir point 3 du plan initial, confirmé).

Un profil non couvert retourne `regime_non_couvert` (nouvelle variante de `RaisonIndisponibilite`),
jamais un taux approximé. Pour ACRE : aucun code n'existe dans le référentiel (ADR-023, absence
volontaire) — une tranche dont l'ACRE est active à sa date retourne `regle_absente`
(`cotisationsSociales.ts`), jamais le taux plein appliqué par défaut.

Rattachement au changement de taux en cours d'année (`resoudreTrancheAvecTaux`,
`src/lib/fiscal/resolutionTranche.ts`) : chaque tranche est résolue à sa propre date, jamais un taux
moyen appliqué au total. Une tranche `historique_amorcage` (un intervalle, pas une date unique) dont
le taux ou le régime diffère entre son début et sa fin retourne `amorcage_non_ventilable` — limite
assumée, la couverture n'a pas de granularité journalière.

### 3. Franchise TVA : uniquement `regimeTva === 'franchise'`, aucune couche TVA créée

`montantRemunerationConseillerCentimes` n'a aujourd'hui aucune sémantique HT/TTC modélisée. Pour
`regimeTva = 'redevable_reel_simplifie' | 'redevable_reel_normal' | 'inconnu'`,
`calculerFranchiseTva` retourne `regime_tva_non_supporte` (nouvelle raison) — jamais un CA de
référence construit sur une hypothèse HT/TTC non vérifiée. Aucune couche TVA/facturation n'est créée
dans cette passe.

### 4. Prorata : arithmétique entière/BigInt exclusivement, jamais un seuil de sortie immédiate

`Math.round(plafond * jours / joursAnnee)` est banni (la division `/` produit un flottant JS
intermédiaire). `src/lib/fiscal/arithmetiqueFiscale.ts` implémente `appliquerTauxPointsBase` et
`prorataJours` exclusivement en `BigInt`, arrondi "moitié vers le haut" documenté et testé aux bornes
exactes (`arithmetiqueFiscale.test.ts`). `BigInt(n)` plutôt que des littéraux `Nn` : le `target`
TypeScript du projet (ES2017) n'autorise pas la syntaxe de littéral BigInt.

En année de création d'activité, `calculerMicroBnc` expose `plafondProratiseReferenceCentimes`
**séparément** de `plafondPleinCentimes` — la comparaison `depasse` de l'année courante compare
toujours au plafond plein, jamais à la valeur proratisée. La valeur proratisée est documentée comme
une "valeur annualisée de référence nécessaire au mécanisme légal des années de référence", jamais
un seuil dont le dépassement déclencherait une sortie immédiate du régime micro — `calculerMicroBnc`
ne se prononce d'ailleurs jamais sur une "sortie du micro" : seuls des faits factuels (recettes
connues vs plafond plein, par année, avec leur propre couverture) sont exposés.

## Contrat générique — `ResultatFiscal<T>`

```ts
type ResultatFiscal<T> =
  | { statut: "calcule"; valeur: T; provenance: ProvenanceRegle[]; assiette: AssietteAnnuelle }
  | { statut: "partiel"; valeurConnue: T; provenance: ProvenanceRegle[]; raisons: RaisonIndisponibilite[]; assiette: AssietteAnnuelle }
  | { statut: "indisponible"; raisons: RaisonIndisponibilite[] };
```

Utilisé tel quel par `cotisationsSociales`/`cfp`/`versementLiberatoire` ; adapté (mais dans le même
esprit — jamais un `number` nu, toujours un statut explicite) pour `calculerMicroBnc` (structure
multi-année N/N-1/N-2) et `calculerFranchiseTva` (deux seuils simultanés). `construireResultatFiscal`
(`resolutionTranche.ts`) centralise la règle de statut : `"calcule"` seulement si aucune raison
n'existe, **y compris l'incomplétude de l'assiette elle-même** (jamais `"calcule"` sur une couverture
partielle, même si toutes les tranches connues résolvent un taux) ; `"indisponible"` seulement si des
tranches existaient et qu'aucune n'a pu être résolue ; `"partiel"` dans tous les autres cas.
`statutVerification` d'une règle `a_confirmer`/`recoupement` n'empêche jamais `"calcule"` — la
provenance le porte, à l'UI de le signaler.

## Projection fin d'année

`calculerProjectionFinAnnee` (`src/lib/fiscal/projectionFinAnnee.ts`) expose trois blocs jamais
fusionnés : encaissé réel (`resoudreAssietteAnnuelle`), ventes finalisées non encaissées avec date
prévue restant dans l'année (nouveau champ `finaliseNonEncaisseRestantCentimes` sur
`dashboardRepository.chargerProjectionAnnuelle`, symétrique de `encaissementsAttendusDepassesCentimes`
déjà existant), compromis `en_cours` avec date prévue restant dans l'année (réutilise
`previsionnelRestantCentimes`, ADR-022, sans le redupliquer). `projectionCouverteFinAnneeCentimes`
n'est calculé que si les deux blocs "restant" sont tous deux des nombres connus. Une rémunération
sans date prévue n'est placée dans aucun des deux blocs.

## UX — `/fiscal`, section "Vue {année}"

Extension de `/fiscal` existant (pas de nouvelle route, même logique qu'ADR-022 sur `/dashboard`) :
cinq blocs — ce que j'ai encaissé, ce que je devrais provisionner, où j'en suis par rapport aux
seuils, ce qui pourrait encore arriver cette année, ce qu'Atlas ne sait pas encore calculer et
pourquoi. `ExplicationCalcul` (`<details>` natif) affiche l'assiette et la provenance de chaque
règle sous chaque montant calculé ; `libellesRaisons.ts` traduit chaque `RaisonIndisponibilite` en
phrase française sans jargon.

## Conséquences

- Aucune migration (aucune nouvelle table/colonne).
- Nouveaux : `src/types/assietteFiscale.ts`, `src/types/resultatFiscal.ts`,
  `src/lib/fiscal/{arithmetiqueFiscale,assietteAnnuelle,resolutionTranche,cotisationsSociales,cfp,
  versementLiberatoire,microBnc,franchiseTva,projectionFinAnnee,libellesRaisons}.ts` (+ tests),
  `src/components/fiscal/{VueAnneeResume,ExplicationCalcul}.tsx`.
- `remunerationRepository.ts` : nouvelle fonction `listerEncaissementsAnnee`.
- `dashboardRepository.ts` : `chargerProjectionAnnuelle` gagne `finaliseNonEncaisseRestantCentimes`/
  `nombreFinaliseNonEncaisseRestant`, testés dans `dashboardRepository.test.ts` (distinction "date
  connue hors fenêtre ⇒ 0 mesuré" vs "aucune date connue ⇒ undefined").
- `src/app/fiscal/page.tsx` : nouvelle section "Vue {année}", affichée uniquement si un profil
  fiscal existe.
- Piège de test découvert et documenté : `remuneration` n'est pas cloisonnée par dossier fiscal
  (mono-dossier V1) — plusieurs scénarios de test dans un même fichier partageant la même année se
  polluent mutuellement si l'un d'eux n'a pas de ligne `historique_amorcage` (fenêtre de lecture
  ouverte sur toute l'année). Stratégie retenue par scénario : année dédiée quand la garde de régime
  se déclenche avant toute résolution de règle (n'a pas besoin du référentiel) ; assertions en delta
  ou en borne minimale quand l'année courante doit être partagée (référentiel seedé à partir de
  2026-01-01 seulement, années futures traitées comme "pas encore arrivées" par l'assiette).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/
  `docs/AI_HANDOFF.md` mis à jour en conséquence.
- Hors périmètre, réservé à des passes ultérieures : projections N+1 à N+5 (ADR-025), scénarios
  prudent/haut, déclaration fiscale automatique, génération de formulaires Urssaf/impôts, TVA
  collectée/déductible et facturation complète, sociétés, BIC/carte T, multi-utilisateur,
  optimisation fiscale.
