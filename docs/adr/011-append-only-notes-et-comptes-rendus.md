# ADR-011 — Append-only pour notes et comptes rendus ; compte rendu de visite en table dédiée

**Statut :** Accepté
**Date :** 2026-08-11
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

`notes_bien` et `comptes_rendus_visite` sont les deux seules tables sans colonne `modifie_le` et
sans Server Action de mise à jour ou de suppression. Par ailleurs, un compte rendu de visite
aurait pu être ajouté comme une variante de note (`notes_bien` avec un champ `type` discriminant)
plutôt que comme une table séparée — ce choix mérite d'être justifié.

## Décision

### Append-only

Une note ou un compte rendu, une fois enregistré, n'est ni modifiable ni supprimable depuis
l'application. Chaque insertion pose `cree_le` et rien d'autre ne change ensuite. C'est un choix
de simplicité pour ce périmètre : le besoin réel observé est "garder une trace", pas "tenir un
document vivant". Aucune colonne `modifie_le` n'est créée pour ces deux tables (contrairement à
`biens`, `acquereurs`, `connexions_google`, `memoire_contextuelle`, qui, eux, sont mis à jour en
place).

### Compte rendu de visite : table dédiée, pas une variante de note

Un compte rendu diffère structurellement d'une note sur trois points, chacun suffisant seul à
justifier une table séparée :
1. **Portée** : une note concerne un bien seul ; un compte rendu concerne un **couple**
   bien + acquéreur (`comptes_rendus_visite.acquereur_id NOT NULL`, absent de `notes_bien`).
2. **Date distincte de la saisie** : `date_visite` (jour réel de la visite, préremplie depuis le
   rendez-vous mais modifiable) est un champ à part entière, sans équivalent dans une note où
   seule `cree_le` existe.
3. **Champ structuré `interet`** : contrainte `CHECK` sur un vocabulaire fermé
   (`interesse`/`a_reflechir`/`pas_interesse`/`inconnu`), qui n'a pas de sens pour une note libre.
   Le stocker dans `notes_bien` aurait exigé une colonne nullable "parfois pertinente, parfois
   pas", floutant la contrainte `CHECK` et le type applicatif.

Fusionner les deux aurait produit une table à moitié remplie selon le type de ligne (un
`interet`/`acquereur_id` vide pour une simple note bien, une `date_visite` redondante avec
`cree_le` pour un compte rendu) — exactement le type de modèle générique prématuré déjà écarté par
ADR-006 pour `memoire_contextuelle`.

## Alternatives écartées

**Champ `type: "note" | "compte_rendu"` discriminant dans une table unique :** techniquement
possible, mais aurait rendu la contrainte `CHECK` sur `interet` inapplicable proprement (elle
devrait tolérer NULL pour les notes) et aurait mélangé deux cycles de vie UI différents (le
formulaire "Ajouter une note" sur la fiche bien n'a rien à voir avec le formulaire "Compte rendu"
sur la page de préparation).

**Édition/suppression dès maintenant :** repoussé — aucun besoin observé de corriger une note ou
un compte rendu après coup pendant la construction de ces fonctionnalités ; ajouter cette
capacité maintenant serait de la complexité anticipée plutôt que répondant à un besoin réel.

## Conséquences

- Une erreur de saisie dans une note ou un compte rendu ne peut aujourd'hui être corrigée que
  directement en base (hors périmètre applicatif) — à documenter clairement comme limite connue.
- Si un besoin d'édition apparaît, il devra être ajouté explicitement (colonne `modifie_le` +
  Server Action dédiée) plutôt que supposé déjà présent.
- Toute future donnée de mémoire passive similaire (ex. un futur "retour de coup de fil") doit se
  poser la même question de structure avant de choisir entre une nouvelle table dédiée et
  l'extension d'une table existante.
