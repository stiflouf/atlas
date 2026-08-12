# ADR-019 — Lien explicite visite → offre : table de liaison `offre_visites`

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-018 a explicitement écarté le taux et le délai visite → offre du tableau de bord V1, faute de
lien matérialisé entre `comptes_rendus_visite` et `offres`. Ce lien est maintenant construit.

Quatre faits du domaine devaient être représentables sans exception :
- une offre peut exister sans visite préalable ;
- une visite peut ne produire aucune offre ;
- plusieurs visites peuvent précéder une même offre ;
- une même visite peut précéder plusieurs offres successives (rien dans le modèle n'empêche un
  acquéreur de refaire une offre après un refus, sur le même bien).

Contrainte non négociable : ce lien doit toujours être un fait déclaré explicitement par le
conseiller, jamais une inférence automatique par proximité de date ou par texte.

## Décision

### Table de liaison many-to-many `offre_visites`

```
offre_visites
  id                      uuid PK
  offre_id                uuid FK -> offres.id, ON DELETE CASCADE
  compte_rendu_visite_id  uuid FK -> comptes_rendus_visite.id, ON DELETE CASCADE
  cree_le                 timestamptz
  UNIQUE (offre_id, compte_rendu_visite_id)
```

Alternatives écartées :
- **FK `compteRenduVisiteId` nullable directement sur `offres`** : ne représente qu'une seule
  visite déclenchante par offre — sous-estime mécaniquement le taux visite → offre pour toute
  visite non retenue comme "la" déclenchante quand plusieurs visites ont réellement précédé
  l'offre.
- **FK inverse `offreLieeId` nullable sur `comptes_rendus_visite`** : couvre "plusieurs visites →
  une offre" sans table supplémentaire, mais (a) casse l'invariant documenté "append-only, aucune
  édition prévue" de `comptes_rendus_visite`, et (b) ne supporte pas "une même visite → plusieurs
  offres successives", pourtant possible dans ce modèle.
- **Rapprochement par proximité bien/acquéreur/date, sans lien matérialisé** : rejeté sans
  ambiguïté — c'est exactement l'inférence que ce lien doit remplacer.

Cascade des deux côtés (contrairement à `compromis.offreId`, en `SET NULL`) : une ligne de
`offre_visites` n'a aucun sens indépendamment de l'offre et de la visite qu'elle relie — elle
disparaît avec l'une ou l'autre. Contrainte unique sur la paire : dernier filet de sécurité contre
un doublon, indépendant de la validation applicative.

### Intégrité applicative, jamais en `CHECK` SQL

Avant toute création de lien (`lierVisiteAOffre`) : l'offre existe, le compte rendu existe, ils
partagent le même `bienId` et le même `acquereurId`, et `dateVisite <= dateOffre`. Comparaisons
entre deux tables, non exprimables en `CHECK` Postgres classique et ce projet n'utilise aucun
trigger — même principe qu'`offres.statut`/`compromis.statut` ("validées côté Server Action, pas
en `CHECK` SQL"). Le filtrage côté UI (visites déjà cochables/sélectionnables) est purement
indicatif et ne remplace jamais cette validation serveur, qui s'exécute identiquement quel que
soit l'appel (formulaire normal ou contourné).

### Deux points d'entrée, jamais un seul

- **À la création d'une offre** (`ajouterOffreAction`, onglet Offres de la fiche bien) : le
  conseiller peut cocher, parmi les comptes rendus déjà enregistrés pour ce bien et cet acquéreur,
  ceux qui ont mené à cette offre. `enregistrerOffre`, la création des liens choisis et
  `marquerOffreEnCours` sont écrits dans **une seule transaction** (`enregistrerOffreAvecLiensEtJalon`,
  `src/lib/offreRepository.ts`) : si un lien échoue, l'offre et le jalon ne sont jamais créés non
  plus — jamais d'offre "orpheline" de ses visites annoncées. Cette transaction compose des
  fonctions de trois repositories (`offreRepository`, `offreVisiteRepository`, `bienRepository`),
  chacune acceptant désormais un paramètre `executeur` optionnel (`Executeur`, `src/db/client.ts`)
  qui reçoit soit `getDb()` par défaut, soit le `tx` de la transaction — première composition
  inter-repositories du projet, préférée à dupliquer leur logique d'écriture ou à faire porter la
  transaction par la Server Action (ADR-007 : seuls les repositories parlent à Postgres).
- **Rattachement rétroactif** (`lierVisiteAOffreAction`/`delierVisiteAction`,
  `src/actions/offreVisite.ts`) : une offre déjà existante peut recevoir des liens plus tard, ou
  en perdre un posé par erreur — la liaison n'est jamais figée au seul instant de création de
  l'offre. `delierVisiteAction` retrouve le bien de redirection en base à partir du `lienId`
  (lien → offre → `bienId`), jamais d'un `bienId` fourni par le formulaire, qui ne serait qu'une
  donnée de confort côté navigateur, pas une source fiable. `retirerLienVisiteOffre` supprime
  uniquement la ligne de liaison — ne modifie jamais la visite ni l'offre elles-mêmes.

### Suppression physique du lien, jamais de l'offre ni de la visite

Contrairement à une visite ou une offre, un lien n'est pas un fait métier historique mais une
annotation de rapprochement faite par Atlas ; le supprimer corrige une erreur de saisie sans
réécrire l'histoire. Suppression franche, pas de flag "annulé" — inutile pour une simple ligne de
jonction sans autre donnée attachée.

### Aucune garde d'archivage sur la liaison

Lier ou délier une visite et une offre documente un rapprochement entre deux faits déjà
enregistrés — ce n'est pas la création d'un nouveau fait commercial sur une entité active. Même
principe qu'ADR-018 : l'historique inclut les entités archivées. La création d'une offre, elle,
continue de refuser un bien/acquéreur archivé (ADR-015) — seule la liaison en est dispensée.

### Aucun événement d'historique dédié

`historiqueBien.ts` n'est pas modifié : la visite et l'offre ont chacune déjà leur événement ; un
événement pour le lien lui-même ajouterait du bruit sans nouvelle information factuelle.

### Aucun backfill automatique

Les visites et offres créées avant ce lien restent non liées — aucun rattrapage rétroactif par
proximité de date. Conséquence assumée et documentée : `tauxVisiteOffre` et
`delaiMoyenVisiteOffreJours` ne couvrent que les liaisons faites explicitement après la mise en
place de cette fonctionnalité, biaisant transitoirement le taux à la baisse.

### Deux métriques débloquées dans `/dashboard`

- **`tauxVisiteOffre`** (famille Activité) : nombre de comptes rendus distincts référencés par au
  moins une ligne `offre_visites`, sur le nombre total de comptes rendus enregistrés. `undefined`
  si aucun compte rendu n'est enregistré.
- **`delaiMoyenVisiteOffreJours`** (famille Délais/pertes, libellé UI "Délai moyen entre une
  visite liée et l'offre") : moyenne de `dateOffre - dateVisite` sur chaque paire explicitement
  liée — une visite liée à plusieurs offres, ou une offre liée à plusieurs visites, contribue une
  valeur par paire. `undefined` si aucune paire liée n'existe.

Réserve affichée dans l'UI pour les deux métriques : "Calculé uniquement à partir des visites
explicitement associées à une offre."

## Conséquences

- Nouvelle table `offre_visites`, migration `0011_friendly_captain_flint.sql`, aucune colonne
  ajoutée aux tables existantes.
- Première composition inter-repositories du projet (`offreRepository` appelle
  `bienRepository.marquerOffreEnCours` et `offreVisiteRepository.lierVisiteAOffre` à l'intérieur
  d'une même transaction) — motif à réutiliser pour tout futur geste conseiller touchant
  plusieurs entités atomiquement, plutôt que de dupliquer la logique d'écriture ou d'ouvrir une
  transaction dans une Server Action.
- `BUSINESS_RULES.md`/`DATA_MODEL.md`/`KNOWN_LIMITATIONS.md`/`CHANGELOG_V1.md` mis à jour en
  conséquence.
