# ADR-017 — Vente finalisée : `dateActeReelle` distincte de `dateActe`, 4e état commercial `vendu`

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

`Compromis.dateActe` (ADR-016) est une **prévision**, saisie à la création, jamais modifiable
ensuite. `statut = "realise"` est un état terminal sans date attachée (pas de
`statutModifieLe`). Aucun des deux ne permet de répondre honnêtement à "ce bien est-il vendu, à
quel acquéreur, à quel prix, à quelle date l'acte a-t-il **réellement** été signé". Audit :
aucune notion de vente finalisée n'existe dans le mock (`StatutDossier` s'arrête à
`compromis_signe`), ni dans `deriverStatutCommercial()` (3 valeurs seulement), ni dans
`statutMandat`.

## Décision

**Aucune nouvelle entité** — `Compromis` porte déjà `bienId`/`acquereurId`/`prixConvenu`, les
trois réponses à "à qui, à quel prix" une fois `realise`. Un seul champ ajouté :
```
dateActeReelle: date NULL
```

**`dateActe` (prévue) et `dateActeReelle` (constatée) restent deux champs strictement distincts,
jamais fusionnés.** `dateActe` ne change jamais après création (immuable, comme `prixConvenu`).
`dateActeReelle` n'est posée qu'au passage à `realise`, **obligatoire** à cet instant (refus
explicite si absente), et **écrite atomiquement avec le changement de statut**
(`marquerCompromisRealise(id, dateActeReelle)`, un seul `UPDATE`) — aucune fenêtre où un compromis
serait `realise` sans date réelle.

**4e état commercial dérivé, `vendu`** (`deriverStatutCommercial`, ADR-014 étendue) :
```
compromisListe.some(c => c.statut === "realise" && c.dateActeReelle)
```
Prioritaire sur `compromis_signe`. Un compromis `realise` sans `dateActeReelle` (cas
structurellement impossible via l'action, garde défensive dans la fonction pure) ne bascule
jamais vers `vendu`.

**Historique dérivé** : nouvel événement `"Vente finalisée — {prixConvenu}"`, daté par
`dateActeReelle`, uniquement quand `statut === "realise"` **et** `dateActeReelle` présente.
Exception assumée à la règle "pas d'événement pour un changement de statut sans date fiable" — ici
la date existe précisément parce que l'écriture atomique la garantit. Coexiste avec les deux
événements déjà établis (`"Compromis structuré"` à la création, `"Compromis signé"` générique
ADR-014).

**Aucun couplage automatique**, cohérent avec tous les ADR précédents de cette série :
- L'archivage du bien reste un geste manuel séparé (bouton "Archiver" existant).
- `stadeProjet = "acte"` de l'acquéreur reste un champ manuel indépendant.
- Aucune commission, aucun CA calculé, aucun tableau de bord — cette passe prépare uniquement des
  données propres, ne construit aucune fonctionnalité de pilotage.

## Pourquoi conserver deux dates distinctes (au lieu de remplacer `dateActe` par sa valeur réelle)

Cette distinction est délibérément conservée pour permettre, **plus tard, sans migration ni
changement de modèle** :
- **Suivi de pipeline / délais** : écart entre `dateActe` (prévue à la signature du compromis) et
  `dateActeReelle` (constatée) — détecter les ventes en retard, mesurer le délai moyen
  compromis→acte.
- **CA prévisionnel vs réalisé** : somme des `prixConvenu` des compromis `en_cours`/`realise` non
  encore actés (prévisionnel) vs somme des ventes effectivement `vendu` (réalisé) — impossible si
  une seule date avait existé et avait été écrasée par la valeur réelle.
- **Taux de conversion** : offres → compromis → ventes réalisées, mesurable via les statuts déjà
  persistés sur `offres` et `compromis`.
- **Analyse des ventes perdues** : compromis `annule` (jamais atteints `vendu`), comparables aux
  compromis `realise` pour un taux d'échec.

Rien de ce qui précède n'est construit dans cette passe — uniquement les deux champs qui rendront
ces calculs possibles sans refonte future.

## Alternatives écartées

**Remplacer `dateActe` par la date réelle au moment de `realise`** (un seul champ, réutilisé) :
plus simple, mais détruit irrémédiablement la prévision d'origine — rend impossible toute mesure
d'écart prévu/réel plus tard, contraire à l'objectif de pilotage explicitement demandé.

**Nouvelle entité `Acte`/`Vente`** : redondante — `bienId`/`acquereurId`/`prixConvenu` existent
déjà sur `Compromis`, dupliquer ces trois champs pour ne combler qu'un manque de date aurait été
disproportionné.

## Conséquences

- `changerStatutCompromisAction` se scinde en deux chemins : `annule` (inchangé,
  `changerStatutCompromis`) et `realise` (nouveau, `marquerCompromisRealise`, exige
  `dateActeReelle`).
- `deriverStatutCommercial()` change de signature (`bien`, `compromisListe`) — tous ses appelants
  mis à jour pour passer la liste de compromis déjà chargée.
- Le bandeau "État du dossier" affiche désormais un badge "Vendu" quand applicable ; aucune
  nouvelle information de détail n'y est ajoutée (le prix/la date restent consultables dans
  l'onglet Compromis, comme pour les 3 états précédents).
