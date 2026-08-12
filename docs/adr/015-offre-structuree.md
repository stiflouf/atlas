# ADR-015 — Offre d'achat structurée : table dédiée, couplage unidirectionnel

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

`biens.offreEnCoursLe` (ADR-014) représente qu'une offre existe sur un bien, mais ne dit ni qui
l'a faite, ni combien. Audit : `acquereurs.stadeProjet = "offre"` est un état par acquéreur, sans
lien avec un bien précis ; `actions`/`comptes_rendus_visite` n'ont aucune notion de montant ; les
mocks (`data/dossier.ts`, `data/actions.ts`, `data/clients.ts`) racontent systématiquement des
offres rattachées à un acquéreur nommé et parfois un montant — richesse que le réel ne pouvait pas
représenter avant cette passe.

## Décision

Nouvelle table `offres`, FK réelles vers `biens` et `acquereurs` (même rationale qu'ADR-010 pour
`comptes_rendus_visite`) :
```
id, bienId, acquereurId, montant, dateOffre, statut, dateValidite?, creeLe
```

`montant`/`acquereurId`/`bienId`/`dateOffre` **immuables** après création — une nouvelle
proposition (contre-offre, offre d'un autre acquéreur) est une nouvelle ligne, jamais une édition.

**Statut mutable, `UPDATE` en place sur la même ligne** (pas une nouvelle ligne par transition) —
même patron que `actions.statut`, pas celui de `notes_bien`/`comptes_rendus_visite`
(append-only). Une ligne par changement de statut aurait exigé soit dupliquer les champs
immuables à chaque transition, soit un id de regroupement non prévu par le modèle — complexité
écartée volontairement ("pas de workflow notarial complet").

**Transitions strictement `en_cours` → une valeur finale** (`acceptee`/`refusee`/`retiree`),
jamais l'inverse, jamais entre deux finales — validées côté Server Action, pas en `CHECK` SQL.

**Couplage unidirectionnel avec `offreEnCoursLe`** (ADR-014, non modifiée) :
- Créer une offre pose aussi `offreEnCoursLe = now()` — un seul geste conseiller.
- Changer le statut d'une offre ne touche **jamais** `offreEnCoursLe`/`compromisSigneLe` — gestes
  commerciaux volontairement séparés, cohérent avec "le conseiller garde les gestes commerciaux
  séparés".

**Refus explicites (throw)**, cohérent avec ADR-014 (même domaine métier) :
- `ajouterOffreAction` : bien/acquéreur introuvable ou archivé, montant invalide.
- `changerStatutOffreAction` : offre introuvable, bien/acquéreur archivé, offre déjà dans un
  statut final.

**Historique dérivé** : un seul événement par offre, à la création (`"Offre reçue — {montant}"`),
**sans nommer l'acquéreur** — même convention que les comptes rendus de visite (le détail vit dans
l'onglet dédié, pas dans l'historique). Aucun événement pour un changement de statut : sans champ
`statutModifieLe` (absent du modèle, volontairement — pas ajouté au-delà de ce qui a été demandé),
aucune date de transition fiable n'est disponible.

## Alternatives écartées

**Une ligne par changement de statut** (journal immuable des transitions) : aurait permis de dater
chaque transition pour l'historique, mais contredit le modèle plat validé (un seul `id` par
offre) et s'approche du "workflow notarial complet" explicitement exclu.

**Dériver `offreEnCoursLe` depuis `offres`** (source de vérité unique) : aurait défait ADR-014
récemment validée sans raison forte, et pose une question non triviale ("plusieurs offres actives
simultanées, laquelle compte ?"). `offres` reste additive, `offreEnCoursLe` reste la source de
vérité du badge simple.

**Ajouter `statutModifieLe`** pour dater les événements de changement de statut dans l'historique :
non demandé, aurait élargi le modèle au-delà du strict nécessaire. L'historique reste donc limité
à l'événement de création (immuable, toujours exact), le statut courant se consultant dans
l'onglet Offres.

## Conséquences

- L'onglet "Offres" de `/biens/[id]` n'existe que pour un bien réel (`!dossier`) — aucun
  équivalent dans `DossierBien`, contrairement à Visites/Documents qui ont un pendant mock.
- La fiche acquéreur gagne une section "Offres" en lecture seule (pas de changement de statut
  depuis cette page — le geste vit sur la fiche bien).
- Préparation de visite : afficher les offres précédentes du couple bien/acquéreur serait une
  extension naturelle (même esprit que `selectionnerComptesRendusRecents`), non implémentée dans
  cette passe.
