# ADR-016 — Compromis structuré : table dédiée, lien optionnel vers une offre

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

`biens.compromisSigneLe` (ADR-014) indique qu'un compromis existe sur un bien, mais ne dit ni
avec quel acquéreur, ni à quel prix, ni la date d'acte prévue. Audit : `acquereurs.stadeProjet`
va jusqu'à `"acte"`, `lib/matching/matchType.ts` reconnaît déjà `["signature","compromis","acte"]`
comme vocabulaire de rendez-vous, et `data/actions.ts` (mock) contient *"Signature de l'acte
prévue le 14 août"* — la notion de date d'acte est déjà présente dans le vocabulaire du projet,
pas une invention. `offres.statut = "acceptee"` (ADR-015) existe mais n'est lié à aucun compromis.

## Décision

Nouvelle table `compromis`, FK réelles vers `biens`/`acquereurs`, FK nullable vers `offres`
(`ON DELETE SET NULL`, pas cascade : un compromis ne doit jamais disparaître si son offre
d'origine venait à disparaître) :
```
id, bienId, acquereurId, offreId?, prixConvenu, dateSignature, dateActe?, statut, creeLe
```

`prixConvenu`/`bienId`/`acquereurId`/`offreId`/`dateSignature` **immuables** après création — une
nouvelle signature (si un premier compromis tombe à l'eau) est une nouvelle ligne. **Plusieurs
compromis historiques autorisés** pour un même bien, un compromis annulé restant consultable.

**Statut mutable, `UPDATE` en place** (même patron qu'`offres.statut`, ADR-015) : `en_cours` →
`realise` ou `annule` uniquement, jamais l'inverse.

**Garde d'unicité applicative** (pas de contrainte SQL) : un seul compromis `en_cours` par bien à
la fois — `ajouterCompromisAction` refuse explicitement si un tel compromis existe déjà.

**Cohérence de l'offre liée**, validée côté Server Action si `offreId` fourni : l'offre existe,
appartient au même bien, au même acquéreur, et est `acceptee`. Aucune de ces règles n'est un
`CHECK` SQL (cohérent avec le reste du projet).

**Couplage unidirectionnel avec `compromisSigneLe`** (ADR-014, non modifiée) : créer un compromis
pose aussi `compromisSigneLe = now()` — un seul geste. Changer son statut ne modifie **jamais**
`compromisSigneLe` — gestes commerciaux séparés, cohérent avec ADR-015 pour les offres.

**Refus explicites (throw)**, même domaine métier qu'ADR-014/015 : bien/acquéreur introuvable ou
archivé, prix invalide, compromis déjà `en_cours` pour ce bien, offre liée incohérente
(introuvable / mauvais bien / mauvais acquéreur / pas `acceptee`), compromis déjà dans un statut
final.

**Onglet dédié "Compromis"** sur `/biens/[id]` (réel uniquement, aucun équivalent structuré dans
`DossierBien`), formulaire masqué si un compromis `en_cours` existe déjà ou si le bien est
archivé. Sélection de l'offre acceptée : `<select>` listant toutes les offres `acceptee` du bien
(toutes acquéreurs confondus, impossible de filtrer dynamiquement par l'acquéreur choisi sans JS
côté client) — la cohérence bien/acquéreur/offre est garantie côté serveur, pas par le formulaire.

**Historique dérivé** : un événement à la création, `"Compromis structuré — {prixConvenu}"` —
libellé volontairement distinct de l'événement générique ADR-014 (`"Compromis signé"`, dérivé de
`compromisSigneLe`) pour éviter deux libellés quasi identiques dans la même liste : le premier est
la création de l'entité détaillée, le second le jalon commercial synthétique du bien. Les deux
coexistent séparément. Aucun événement pour un changement de statut (pas de champ dédié pour
dater une transition, volontairement absent du modèle).

## Alternatives écartées

Mêmes alternatives qu'ADR-015 (une ligne par changement de statut, dériver `compromisSigneLe`
depuis `compromis`, ajouter un champ de date de transition) — écartées pour les mêmes raisons :
complexité disproportionnée par rapport à "pas de workflow notarial complet".

## Conséquences

- Fiche acquéreur : section "Compromis" en lecture seule, même style que la section Offres.
- Préparation de visite : non pertinente ici (contrairement à Offre) — un bien avec compromis
  signé n'est normalement plus en phase de visite active.
- `ON DELETE SET NULL` sur `offre_id` : si une offre disparaissait un jour (aucune suppression
  n'existe aujourd'hui), le compromis resterait consultable, juste sans lien vers l'offre
  d'origine.
