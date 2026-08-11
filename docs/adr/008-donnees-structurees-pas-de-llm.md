# ADR-008 — Données structurées uniquement ; aucun LLM pour les règles métier déterministes

**Statut :** Accepté
**Date :** 2026-08-11
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-004 (Stratégie IA) prévoit un usage progressif de LLM, avec un principe Human-in-the-Loop non
négociable. Ce principe n'a pas encore été exercé : à ce jour, `apps/web` ne contient **aucune**
dépendance LLM (vérifié : ni `package.json`, ni aucun appel réseau vers un service de génération
de texte dans tout `src/`). Les moteurs qui produisent du texte à l'écran (points d'attention,
points forts, historique dérivé, sélection Mérimée "à raconter") sont tous des ensembles de
règles déterministes sur des champs structurés typés. Cette absence est un choix assumé sur le
périmètre déjà construit, pas un oubli — elle mérite d'être actée pour ne pas être réintroduite
par erreur au moment où un LLM sera effectivement branché (ADR-004, phase 2+).

## Décision

Toute règle métier qui **peut** être exprimée comme une condition sur des champs structurés
(`Bien`, `ProfilAcquereur`, `ActionMetier`, `TransportsProximite`, etc.) est écrite comme telle —
jamais comme une extraction ou une interprétation de texte libre (`contenu` d'une note, `retour`
d'un compte rendu, `description` d'un bien).

Concrètement :
- `produirePointsAttention()` / `produirePointsForts()` ne lisent que des champs structurés
  (prix, budget, étage, ascenseur, pièces, surface, parking, extérieur) — jamais `bien.description`
  ni `acquereur.notes`.
- `deriverHistoriqueBien()` ne transforme jamais le texte libre `retour` d'un compte rendu en un
  résumé — l'événement d'historique est un label court dérivé du champ structuré `interet`
  (`"Visite effectuée — Intéressé"`), jamais une reformulation du texte.
- `selectionSelectionMerimee` (`lib/araconter/selectionMerimee.ts`) sélectionne des phrases du
  texte officiel Mérimée par une règle syntaxique simple (présence d'une date explicite), sans
  jamais reformuler — le commentaire du fichier le dit explicitement.
- Une note (`notes_bien`) ou un compte rendu de visite (`comptes_rendus_visite`) ne sont **jamais**
  lus par un moteur de règles : ce sont des faits affichés tels quels au conseiller, jamais une
  entrée d'un calcul.

## Alternatives écartées

**Résumé automatique des notes/retours de visite via LLM dès maintenant :** explicitement refusé
à plusieurs reprises pendant la construction (Notes, Mémoire du dossier, Comptes rendus de
visite) — anticiperait sur ADR-004 phase 2+ sans les garde-fous Human-in-the-Loop qu'elle exige
(validation explicite, structure typée en sortie).

**Extraction de mots-clés/sentiment depuis le texte libre pour enrichir les points d'attention :**
écarté pour la même raison — un signal extrait automatiquement d'un texte libre n'est pas un fait
structuré fiable tant qu'aucune validation humaine n'existe pour le corriger.

## Conséquences

- Tout futur moteur de règles doit d'abord vérifier s'il peut s'exprimer sur des champs déjà
  structurés ; si l'information nécessaire n'existe que sous forme de texte libre, la bonne
  réponse est de **structurer un nouveau champ** (comme `interet` sur les comptes rendus), pas
  d'ajouter une analyse de texte.
- Le jour où un LLM est introduit (ADR-004), son périmètre sera net : il n'entrera jamais en
  silencieux remplacement d'un moteur déterministe existant sans nouvelle ADR.
- Notes et retours de visite restent des données de mémoire passive, jamais actives.
