# ADR — Décisions d'architecture Atlas

Une décision par sujet, numérotée (`NNN-slug.md`), jamais renumérotée ni réécrite rétroactivement.
Format observé (voir n'importe quelle ADR récente, ex. `050-stockage-documentaire-persistant.md`) :

```markdown
# ADR-NNN — Titre

**Statut :** Accepté
**Date :** AAAA-MM-JJ
**Décideurs :** ...

## Contexte
## Décision
## Hors périmètre, volontairement
## Conséquences
```

## Règle depuis ADR-051

Toute nouvelle ADR **importante** (fonctionnelle ou technique) doit répondre à deux rubriques
supplémentaires, définies par
[`051-portabilite-reversibilite-montee-en-charge.md`](051-portabilite-reversibilite-montee-en-charge.md) :

- **`## Scalabilité`** — que se passe-t-il si cette fonctionnalité est utilisée dans un Atlas
  comptant de l'ordre de 10 000 utilisateurs ? *"Aucun impact particulier"* est acceptable si
  justifié.
- **`## Réversibilité`** — si Atlas quitte son fournisseur actuel, comment cette brique est-elle
  migrée ? Une fonctionnalité purement métier sans dépendance infra peut répondre simplement
  qu'elle n'introduit aucune nouvelle dépendance fournisseur.

Les ADR 001 à 050 ne sont pas modifiées pour ajouter ces rubriques rétroactivement.
