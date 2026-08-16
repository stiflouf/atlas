# ADR-048 — Recherche et pagination serveur (biens, acquéreurs, prospects vendeurs)

**Statut :** Accepté
**Date :** 2026-08-16
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Un audit préalable a confirmé que les quatre repositories de liste (`bienRepository`,
`clientRepository`, `prospectVendeurRepository`, `tacheRepository`) chargent systématiquement
toute la table (`getDb().select().from(table)`, sans `WHERE`/`ORDER BY`/`LIMIT`) puis filtrent en
mémoire — comportement sans conséquence au volume de développement actuel, mais qui ne tient pas à
l'échelle réaliste d'un conseiller sur plusieurs années (~100-400 lignes par catalogue). Aucune
recherche texte n'existe sur `/biens`, `/clients`, `/prospects-vendeurs` — seul un toggle
`archives`/`vue` filtre déjà côté serveur.

Deux familles de consommateurs distinctes des mêmes fonctions ont été identifiées : les pages de
liste elles-mêmes (le vrai problème), et des consommateurs d'agrégation/sélection (cockpit,
dashboard, `<select>` de contexte sur `/offres/nouveau`, `/compromis/nouveau`, `/taches/nouveau`,
fiches `/biens/[id]`/`/clients/[id]`) qui ont besoin de l'intégralité des données pour fonctionner
correctement — jamais paginables sans les casser.

## Décision

### 1. Nouvelles fonctions, jamais une modification des `listerX()` existantes

`rechercherBiensPage()` (`bienRepository.ts`), `rechercherAcquereursPage()` (`clientRepository.ts`),
`rechercherProspectsVendeurs()` (`prospectVendeurRepository.ts`) — toutes nouvelles, réservées aux
3 pages de liste. `listerBiens()`/`listerClients()`/`listerProspectsVendeurs()` et leurs variantes
restent strictement inchangées, toujours utilisées telles quelles par le cockpit, le dashboard et
les `<select>` de contexte.

### 2. Ordre déterministe explicite : `creeLe DESC, id DESC`

Aucun repository de ce projet n'avait d'`ORDER BY` avant cette ADR — l'ordre observé n'était donc
jamais une garantie. Chaque fonction de recherche impose désormais un ordre stable et documenté :
le plus récent en premier (`creeLe DESC`), `id DESC` en tie-breaker pour deux lignes à égalité de
timestamp — jamais un ordre implicite qui déplacerait silencieusement une ligne d'une page à
l'autre entre deux requêtes.

### 3. Recherche serveur, ILIKE, un seul champ texte

`ILIKE '%q%'` sur les colonnes déjà visibles sur la carte de liste : référence/adresse/ville pour
les biens, nom/prénom pour les acquéreurs et les prospects vendeurs. Aucun index dédié ajouté — au
volume réaliste visé, un `ILIKE` sans index reste largement sous la seconde ; à réévaluer seulement
si le volume réel le justifie un jour.

### 4. Pagination serveur, 25 éléments par page — sauf prospects vendeurs (voir §5)

`rechercherBiensPage()`/`rechercherAcquereursPage()` pagine réellement via `LIMIT`/`OFFSET` au
niveau SQL, avec un `count()` distinct pour le total. Page hors bornes (`?page=99` sur 2 pages) :
la page redirige explicitement vers la dernière page valide — jamais une page vide silencieuse.

### 5. Prospects vendeurs — pagination en mémoire, décision assumée

Contrairement aux deux autres entités, `rechercherProspectsVendeurs({ q, vue })` **ne pagine pas
elle-même** : elle retourne l'ensemble filtré/recherché/ordonné, et c'est la page
`/prospects-vendeurs` qui découpe la page demandée après avoir appliqué le tri par échéance de
tâche la plus proche (`comparerParEcheance`, existant avant cette ADR, inchangé) sur la vue
"en_cours". Deux raisons combinées :

- Le filtrage actif/perdu/converti/archivé n'est **jamais stocké** — `deriverStatutProspectVendeur`
  le dérive depuis plusieurs colonnes nullables. Traduire cette dérivation en `WHERE` SQL aurait créé
  une **seconde définition** du même prédicat métier, avec un vrai risque de divergence future.
  Un prédicat unique (`predicatVue()`, factorisé) est désormais appelé à la fois par
  `listerProspectsVendeurs()`/`listerProspectsVendeursPerdus()`/`listerProspectsVendeursConvertis()`/
  `listerProspectsVendeursArchives()` (comportement strictement inchangé, vérifié par la suite de
  tests existante sans modification) et par la nouvelle fonction de recherche.
- Le tri par échéance de tâche la plus urgente (vue "en_cours") dépend de `taches`, une donnée que
  `prospectVendeurRepository.ts` n'a délibérément pas vocation à connaître (ADR-007). Pour que la
  page 2 montre bien les 25 prospects suivants par urgence — et non les 25 suivants par `creeLe`
  avec un tri d'urgence recalculé seulement dans cette sous-page — le tri complet doit s'appliquer
  avant la pagination, ce qui exige de conserver la liste complète en mémoire à ce stade.

Volume réaliste mono-conseiller (quelques centaines de lignes) : sans coût mesurable. À reconsidérer
seulement si le volume réel dépasse largement cette estimation.

### 6. Paramètres d'URL — fermé, sans tri configurable

`q`, `page`, plus les paramètres déjà existants (`archives`, `vue`). **Aucun paramètre `tri`** :
retiré du périmètre sur demande explicite avant implémentation — aucun tri configurable par le
conseiller dans cette ADR.

### 7. UX

Formulaire de recherche GET natif (`src/components/ui/ChampRecherche.tsx`), pagination
Précédent/Suivant (`src/components/ui/Pagination.tsx`) — deux composants neufs, partagés par les 3
pages. Recherche vide = comportement historique inchangé au pixel près. Recherche sans résultat :
message dédié (« Aucun résultat pour «&nbsp;{q}&nbsp;» »), distinct du message de liste réellement
vide.

### 8. Repli démo préservé (biens, acquéreurs)

`listerBiens()`/`listerClients()` basculent sur un jeu de démonstration tant qu'aucune ligne réelle
n'existe. Les nouvelles fonctions de recherche n'ont **aucun** repli démo (la recherche/pagination
n'a pas de sens sur un jeu figé) — mais la page continue d'appeler `listerBiens()`/`listerClients()`
pour la vue par défaut (pas de recherche, page 1, actifs) tant qu'aucune ligne réelle n'existe,
préservant exactement le comportement historique d'une instance toute neuve.

## Hors périmètre, volontairement

Tri configurable par le conseiller (retiré explicitement avant implémentation). `/taches` et
`/visites` : aucune page de liste n'existe aujourd'hui, rien à paginer. Les `<select>` de contexte
(`/offres/nouveau`, `/compromis/nouveau`, `/taches/nouveau`) : friction réelle mais distincte
(sélection contextuelle, pas une page de liste) — hors périmètre, à traiter séparément si toujours
justifié. Index de recherche dédié (`pg_trgm` ou équivalent) — non construit par anticipation.

## Conséquences

- **0 migration** — aucune modification de schéma.
- Fichiers créés : `src/types/pagination.ts`, `src/components/ui/{ChampRecherche,Pagination}.tsx`,
  et les fichiers de test associés (`*.recherche.test.ts`, `page.test.tsx` pour les 3 pages).
- Fichiers modifiés : `src/lib/{bienRepository,clientRepository,prospectVendeurRepository}.ts`
  (nouvelles fonctions + factorisation `predicatVue()` pour les prospects vendeurs),
  `src/app/{biens,clients,prospects-vendeurs}/page.tsx`.
- `listerBiens()`/`listerClients()`/`listerProspectsVendeurs()` et toutes leurs variantes existantes
  restent inchangées — vérifié par la suite de tests existante (aucune régression), toujours
  utilisées telles quelles par le cockpit, le dashboard et les `<select>` de contexte.
- Limite assumée : `rechercherProspectsVendeurs()` charge l'ensemble filtré en mémoire avant de
  paginer (§5) — cohérent avec le tri par échéance existant et l'absence de seconde définition
  métier, mais different de la pagination SQL réelle des deux autres entités. Documenté, pas caché.
