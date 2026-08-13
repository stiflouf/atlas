# ADR-023 — Fondations fiscales (dossier fiscal, profil, amorçage, RFR, référentiel légal)

**Statut :** Accepté
**Date :** 2026-08-13
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Atlas ne connaît aujourd'hui aucune donnée fiscale ou sociale du conseiller : ADR-021/022 traitent
la rémunération commerciale (centimes, trois états dérivés) mais aucune notion de régime fiscal,
TVA, cotisations ou référentiel légal n'existe. Un audit fiscal préalable, mené hors de cette passe
technique, a établi le champ (agent commercial immobilier indépendant, micro-BNC régime général
hors Cipav en cible V1), sourcé chaque paramètre légal (BOFiP, URSSAF) et attribué un statut de
confiance par source. Cette passe construit les **fondations de collecte** correspondantes —
profil fiscal historisé, amorçage des recettes antérieures, RFR du foyer, référentiel légal versé —
sans construire aucun moteur de calcul ni aucune estimation : ADR-024 (moteur année courante) et
ADR-025 (projections N+1 à N+5) consommeront ces fondations, pas cette passe.

Un premier tour de revue architecturale a validé le principe mais demandé cinq corrections avant
codage, détaillées ci-dessous. Aucun second audit fiscal n'a été refait — seules des corrections de
modélisation.

## Décision

### 1. Racine `dossier_fiscal`, mono-dossier aujourd'hui, additif demain

`profil_fiscal`, `historique_amorcage` et `rfr_foyer` référencent tous `dossier_fiscal_id` plutôt
que d'exister isolément, avec `UNIQUE(dossier_fiscal_id, annee)` /
`UNIQUE(dossier_fiscal_id, annee_rfr)`. ADR-023 ne construit ni authentification ni
multi-utilisateur (même posture que `connexions_google`, ADR-006) : `dossier_fiscal` est une table
à une seule ligne (`id = 'default'`), créée à la demande par `obtenirDossierFiscalDefaut()`, jamais
en migration/seed. Le jour où un rattachement conseiller → dossier fiscal devient nécessaire, il
s'ajoute comme une colonne sur `dossier_fiscal` seule — aucune des trois tables filles ni leurs
contraintes `UNIQUE` n'a besoin d'être retouchée.

### 2. Aucune contrainte d'ordre sur `dateDebutValidite`, résolution par date + `creeLe`

`profil_fiscal` reste un instantané complet historisé, append-only (même patron que la rémunération
figée, ADR-021) — jamais un historique champ par champ. Mais aucune contrainte n'impose que
`dateDebutValidite` soit postérieure à la dernière ligne existante : Atlas doit permettre de
renseigner rétroactivement un changement de situation découvert après coup (ex. franchissement de
seuil TVA constaté en juillet pour une bascule effective en avril).
`chargerProfilFiscalADate(D)` résout la ligne dont `dateDebutValidite <= D` est la plus récente,
triée par `dateDebutValidite DESC, creeLe DESC`. Stratégie de correction non ambiguë : en cas
d'égalité exacte de `dateDebutValidite` entre plusieurs lignes (une correction saisie le même jour
métier qu'un instantané déjà existant), la ligne la plus récemment créée fait foi pour la lecture —
aucune ligne n'est jamais supprimée ni modifiée, seul l'ordre de résolution départage l'égalité.

### 3. Absence de ligne `historique_amorcage` = inconnu, jamais zéro

Contrat de lecture typé, préparé pour le futur résolveur (ADR-024) :

```ts
type CouvertureAnnuelle =
  | { annee: number; connu: true; montantEncaisseCentimes: number; dateFinCouverture: string }
  | { annee: number; connu: false };
```

Absence de ligne pour une année → `{ connu: false }` : couverture antérieure inconnue. Une ligne
avec `montantEncaisseCentimes = 0` → `{ connu: true, montantEncaisseCentimes: 0, ... }` : zéro
confirmé explicitement par le conseiller. Les deux cas ne sont jamais distingués par une valeur
numérique par défaut, toujours par le champ `connu`. `dateFinCouverture` porte l'invariant
anti-double-comptage : un futur résolveur ne doit additionner un fait Atlas (ex.
`remuneration.dateEncaissementReelle`) que s'il est strictement postérieur à `dateFinCouverture`
— jamais à l'aveugle. `CHECK` SQL : `extract(year from date_fin_couverture) = annee`.

### 4. Aucune donnée monétaire ou fiscale en flottant

- `historique_amorcage.montant_encaisse_centimes`, `rfr_foyer.rfr_foyer_centimes` : entiers,
  centimes.
- `rfr_foyer.nombre_parts_centiemes` : entier exact (1,5 part = `150`), remplace tout
  `nombre_parts_quotient real` — le rapport RFR/part utilisé pour un futur contrôle d'éligibilité
  est dérivé au moment du calcul (ADR-024), jamais saisi ni stocké.
- `regle_fiscale.valeur` : entier exact dont `unite` fixe la représentation — `centimes` pour un
  montant, `points_base` pour un taux (25,6 % = `2560`, 1 % = `100`), `jours` pour une durée. Aucune
  conversion flottante côté JS, à aucun endroit de cette passe.

### 5. Référentiel légal : périodes non ambiguës, convention `[début, fin[`

`regle_fiscale` porte uniquement des paramètres légaux datés (taux, seuils, abattements) — jamais
un algorithme ; les mécanismes (deux années consécutives micro-BNC, prorata temporis,
franchissement de seuil TVA, barème ACRE) vivront en code, versionnés et testés séparément, dans
ADR-024. Convention temporelle : intervalle semi-ouvert `[dateDebutValidite, dateFinValidite[` —
fin exclue, `NULL` = pas de fin connue. Pour un même `(code, categorieActivite)`, deux règles ne se
chevauchent jamais : validation portée par `referentielFiscalRepository.insererRegleFiscale`
(rejet explicite par exception, pas de `CHECK` SQL inter-lignes — seul chemin d'écriture est un
script de seed, jamais une Server Action utilisateur, le volume rend une garde applicative
suffisante). `resoudreRegle(code, categorieActivite, date)` retourne la règle applicable ou
`undefined` (jamais une valeur par défaut ni une extrapolation) ; `statutVerification` est toujours
retourné avec la règle, jamais filtré — c'est au futur moteur de calcul (ADR-024) de refuser un
résultat présenté comme "officiel" si le statut vaut autre chose que `verifie_direct`. Testé aux
bornes (`referentielFiscalRepository.test.ts`) : résolution à la borne de début (incluse), à la
borne de fin (exclue, bascule sur la règle suivante), absence de couverture, chevauchement direct,
chevauchement par une règle à fin inconnue, contiguïté acceptée.

### `regime_comptable` totalement découplé de la TVA (déjà acté, reconfirmé)

`profil_fiscal.regimeComptable` (`caisse`/`engagement`/`inconnu`) concerne exclusivement la lecture
des recettes BNC en déclaration contrôlée (le micro-BNC est en comptabilité de caisse par
construction légale). Il n'intervient dans aucune détermination du CA de référence TVA — celle-ci
dépend uniquement de `regimeTva` et `optionDebits`.

### `inconnu` comme vraie valeur stockée (généralisation d'ADR-009)

Chaque champ à choix contraint de `profil_fiscal` (`regimeFiscal`, `regimeComptable`, `regimeTva`,
`periodiciteUrssaf`, `affiliationRetraite`) admet `'inconnu'` comme valeur explicite, distincte de
l'absence de ligne. Absence de ligne = jamais interrogé ; `'inconnu'` = interrogé, réponse "je ne
sais pas" — Atlas n'en déduit jamais un régime par défaut. Les `CHECK` valident uniquement le
vocabulaire de chaque colonne ; les règles croisées (`regimeComptable` pertinent seulement en
déclaration contrôlée, `optionDebits` pertinent seulement hors franchise, cohérence
`acreDateDebut`/`acreDateFin` avec `acreActif`) sont entièrement portées par
`src/actions/profilFiscal.ts`, même séparation que `motifPerte`/`motifAnnulation` (ADR-020).

### Onboarding "Ma situation fiscale", aucune estimation affichée

Nouvelle page `/fiscal` (nav principale, icône dédiée) : trois formulaires (profil, amorçage,
RFR) au-dessus d'un résumé du profil actuel et d'un historique par année pour amorçage/RFR.
`regle_fiscale` n'est ni affichée ni consommée par cette page — elle ne fait que collecter des
faits, jamais les combiner. Le texte d'introduction le dit explicitement : "Aucune estimation
n'est encore calculée à ce stade."

## Alternatives écartées

- **Historique champ par champ pour `profil_fiscal`** : rendrait la lecture "profil complet à la
  date D" ambiguë dès que deux champs changent à des dates différentes — écarté au profit de
  l'instantané complet, cohérent avec le principe déjà appliqué à la rémunération (ADR-021).
- **Interdire `dateDebutValidite` rétroactive** : contredirait le besoin métier réel (correction
  d'une situation découverte après coup) — écarté explicitement, voir point 2.
- **`montant = 0` implicite en l'absence de ligne `historique_amorcage`** : confondrait "pas encore
  demandé" et "confirmé à zéro", violation directe du principe `NULL ≠ false` déjà acté (ADR-009) —
  écarté, contrat `CouvertureAnnuelle` typé à la place.
- **`nombre_parts_quotient real` / taux en flottant JS** : imprécision inacceptable sur une donnée
  fiscale — écarté au profit d'entiers exacts partout (centièmes, centimes, points de base).
- **`CHECK` SQL `EXCLUDE` pour interdire le chevauchement de `regle_fiscale`** : plus complexe à
  lire qu'une garde applicative, pour un volume d'écriture (seed contrôlé, jamais concurrent) qui ne
  la justifie pas — écarté au profit d'un rejet explicite dans le repository.

## Conséquences

- Migration `0014_lame_deadpool.sql` : `dossier_fiscal`, `profil_fiscal`, `historique_amorcage`,
  `rfr_foyer`, `regle_fiscale`.
- Migration `0015_seed_referentiel_fiscal_2026.sql` : amorçage du référentiel légal 2026 (plafond
  micro-BNC, seuils de franchise TVA, taux de cotisations, CFP, abattement micro-BNC, versement
  libératoire) — sourcé BOFiP/URSSAF, statuts de vérification différenciés
  (`verifie_direct`/`recoupement`/`a_confirmer`) ; barème ACRE volontairement non seedé, aucune
  valeur vérifiée pendant l'audit.
- Nouveaux repositories : `dossierFiscalRepository.ts`, `profilFiscalRepository.ts`,
  `historiqueAmorcageRepository.ts`, `rfrFoyerRepository.ts`, `referentielFiscalRepository.ts`.
- Nouvelles Server Actions : `src/actions/profilFiscal.ts`, `historiqueAmorcage.ts`, `rfrFoyer.ts`.
- Nouvelle page `src/app/fiscal/page.tsx` et composants `src/components/fiscal/` ; entrée nav
  ajoutée dans `NavItems.tsx`.
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/
  `docs/AI_HANDOFF.md` mis à jour en conséquence.
- Aucun calcul fiscal, aucune estimation, aucun moteur : réservé à ADR-024 (année courante) et
  ADR-025 (projections N+1 à N+5).
