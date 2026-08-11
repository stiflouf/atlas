# ADR-009 — `NULL` ≠ `false` : convention de représentation de l'inconnu

**Statut :** Accepté
**Date :** 2026-08-11
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

`biens` et `acquereurs` portent plusieurs champs booléens ou numériques optionnels (`ascenseur`,
`parking`, `accessibilite_requise`, `necessite_parking`, `necessite_exterieur`, `etage`,
`pieces_min`, `surface_min`). Pour ces champs, trois états existent réellement dans le métier :
"oui", "non", et "on ne sait pas encore" — un mandat pris rapidement peut très bien ne pas
renseigner si l'immeuble a un ascenseur. Confondre "non renseigné" avec "non" produirait de
faux signaux dans les moteurs de règles (ADR-008) : un point d'attention "pas d'ascenseur"
afficherait alors qu'un bien sans ascenseur *pose problème*, alors que l'information est
simplement absente.

## Décision

Pour tout champ optionnel de ce type :
- **Colonne Postgres** : nullable, **sans** valeur par défaut (`etage: integer("etage")`,
  `ascenseur: boolean("ascenseur")` — pas de `.default(false)`).
- **`NULL` en base → `undefined` côté type applicatif**, jamais `false` ni `0`. Chaque
  `ligneVersXxx()` de repository traduit explicitement : `ascenseur: ligne.ascenseur ?? undefined`.
- **`false` en base signifie une information explicitement connue et négative** — un conseiller a
  vérifié et il n'y a effectivement pas d'ascenseur. C'est une donnée à part entière, pas un
  défaut.
- **Formulaires de saisie** : un sélecteur à trois états ("Inconnu" / "Oui" / "Non"), jamais une
  case à cocher HTML brute (qui ne peut représenter que deux états et confondrait "non coché" et
  "non"). Voir `parseTriEtat()` dans `src/actions/creerBien.ts` / `creerAcquereur.ts`.
- **Moteurs de règles** (`pointsAttention`, `pointsForts`) : une règle de croisement bien×acquéreur
  ne se déclenche que si **les deux** champs croisés sont explicitement renseignés (`!== undefined`).
  L'absence d'un des deux désactive la règle plutôt que de supposer une valeur.

## Alternatives écartées

**Valeur par défaut `false` en base :** aurait simplifié le typage (`boolean` au lieu de
`boolean | undefined`), mais aurait rendu impossible de distinguer "vérifié négatif" de "jamais
vérifié" — perte d'information irréversible dès l'insertion.

**Un champ `xxxConnu: boolean` séparé à côté de chaque booléen métier :** techniquement
équivalent à NULL-comme-inconnu, mais double le nombre de colonnes pour un gain nul — `NULL` est
déjà le mécanisme SQL natif pour "absent".

## Conséquences

- Tout nouveau champ optionnel booléen/numérique sur une entité réelle doit suivre ce patron :
  colonne nullable sans défaut, mapping `?? undefined`, saisie à trois états si un formulaire
  existe.
- Les tests et les mocks doivent représenter "inconnu" par l'absence du champ (`{}` ou champ omis
  dans l'objet TypeScript), jamais par `false` explicite quand l'intention est "je ne sais pas".
