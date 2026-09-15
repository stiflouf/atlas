# ADR-057 — Identité canonique effective : Contact source de vérité pendant la coexistence

**Statut :** Accepté — implémenté côté acquéreur (migration `0042`)
**Date :** 2026-09-11
**Décideurs :** Steven Gausset (CEO), CTO

> Rubriques : Contexte · Problème · Décision · Alternatives écartées · Modèle de données /
> contrats · Invariants · Stratégie de migration · Conséquences · Risques · Hors périmètre ·
> Questions ouvertes · Scalabilité · Réversibilité (ADR-051).
>
> Dépend de : **ADR-055** (§A, le Contact est l'identité d'une personne), **ADR-056** (§4, le verrou
> humain) et **ADR-054** (appartenance). Prolonge la bascule déjà faite sur les CRITÈRES acquéreur
> (`projets_acquereur`), dont elle reprend la discipline à l'identique.

## Contexte

ADR-055 §A décide **à qui appartient** l'identité humaine : au Contact, indépendamment de tout
dossier. Elle ne dit pas **comment on y bascule** sans casser les dossiers historiques.

État constaté avant cette ADR :

- `contacts` est strictement **append-only**. `creerContact` et `getContactById` sont les deux
  seules fonctions du repository ; aucun `UPDATE` n'existe nulle part dans le dépôt.
- La création d'un acquéreur écrit l'identité **deux fois** : dans `contacts` et dans `acquereurs`.
- `modifierAcquereurAction` n'écrit que `acquereurs`. Le Contact garde donc l'identité qu'il avait
  **au moment de la création**, et diverge dès la première correction.
- Aucune lecture d'identité ne passe par `contacts` : `getContactById()` n'a aucun appelant de
  production. Environ soixante sites lisent le dossier historique.
- L'adresse d'envoi Gmail est lue sur `acquereurs.email` ; le Contact n'intervient qu'après l'envoi,
  pour rattacher l'interaction.

## Problème

Une correction d'adresse email faite par le conseiller est enregistrée, affichée, et **sans effet**
sur l'identité canonique. Les interactions sont rattachées au bon Contact, mais ce Contact porte une
identité périmée. Le produit détient deux réponses à « qui est cette personne », et rien ne dit
laquelle fait foi.

## Décision

1. `contact_id` présent → **le Contact possède** `nom`, `prenom`, `email`, `telephone`.
2. `contact_id` absent → l'identité reste celle du dossier historique.
3. Le repli est au niveau de **l'agrégat d'identité**, jamais champ par champ. `contact.email` à
   NULL signifie « pas d'adresse connue », jamais « reprendre celle du dossier ».
4. Une édition humaine sur un dossier rattaché écrit l'identité **uniquement dans le Contact**.
5. Une édition humaine sur un dossier non rattaché écrit **uniquement dans le dossier**.
6. **Aucun Contact n'est créé** pendant l'édition d'un dossier historique. Rattacher l'historique
   est un geste explicite, réservé à son propre lot.
7. **Aucun double-write permanent.** Après la création, les colonnes d'identité du dossier
   deviennent un instantané et ne sont plus réécrites.
8. Les communications — Gmail compris — consomment l'identité **effective**. Pour un acquéreur
   rattaché, l'email part donc à l'adresse du Contact.
9. Une correction humaine d'un champ d'identité **pose le verrou** d'ADR-056 §4 sur ce champ.
10. **Aucune déduplication automatique**, ni par email ni par téléphone (ADR-055 §H).

### Pourquoi lecture et écriture basculent ensemble

C'est la leçon du lot précédent. Le Contact porte aujourd'hui une valeur gelée à la création :
brancher la lecture avant l'écriture afficherait une identité périmée — l'inverse exact du défaut
que cette ADR corrige. Les deux moitiés ne valent que livrées ensemble.

### Pourquoi la duplication reste autorisée à la CRÉATION

`acquereurs.nom/prenom/email/telephone` sont `NOT NULL`. Cesser de les écrire à l'INSERT exigerait
une migration de nullabilité et la bascule préalable des soixante lecteurs. La duplication à la
création est donc conservée comme **couche de compatibilité**, et elle seule : après la création,
une seule des deux copies bouge. L'asymétrie est assumée et nommée, jamais découverte.

## Alternatives écartées

**Double-write permanent Contact + dossier.** Maintient deux vérités et donne l'illusion qu'elles ne
peuvent pas diverger — jusqu'au premier chemin d'écriture qui en oublie une.

**Backfill préalable puis bascule.** Un `INSERT contacts SELECT DISTINCT email` créerait exactement
les fusions qu'ADR-055 §H interdit : un couple partage une adresse, une famille un numéro.

**Contact source de vérité pour les seuls nouveaux dossiers.** Laisse sans réponse les dossiers déjà
rattachés dont l'identité a divergé, c'est-à-dire précisément ceux que cette ADR vise.

## Modèle de données / contrats

`contacts` gagne `modifie_le` — et rien d'autre. Le premier chemin d'écriture le justifie, comme
`acquereurs.modifie_le` et `biens.modifie_le` avant lui.

Volontairement ABSENTS : `email_normalise`, `telephone_normalise`, tout index ou `UNIQUE` sur email
ou téléphone, `archive_le`, `personne_morale`. Aucun n'a de lecteur, et les deux premiers ne se
justifieront qu'avec la recherche par personne et le rapprochement assisté.

La règle de source vit dans un module unique, consommé par la projection d'affichage et par
l'écriture — jamais réimplémentée.

### Addendum — la recherche des listes lit la même source (2026-09-15)

Les listes `/clients` et `/prospects-vendeurs` projetaient l'identité effective mais filtraient `q`
sur l'instantané du dossier : une ligne affichée « Alice » ne se retrouvait qu'en tapant « Bob ».
Le prédicat de recherche applique désormais les points 1 à 3 en SQL —
`CASE WHEN contact_id IS NOT NULL THEN contact.x ELSE dossier.x END`, jamais `COALESCE` — sur
`nom`, `prenom`, `email`, `telephone`. **Identité affichée = identité recherchée.** Conséquence
assumée : un dossier rattaché n'est plus trouvable par son ancien nom ni son ancien email, même si
le Contact n'a pas d'email.

## Invariants

1. Un dossier rattaché ne voit jamais son identité lue ailleurs que sur son Contact.
2. Aucun champ d'identité n'est repris du dossier lorsqu'un Contact existe, même à NULL.
3. Un Contact référencé mais introuvable est une **anomalie** : échec bruyant, jamais un repli.
4. Une écriture d'identité vérifie que le Contact appartient au workspace courant.
5. Aucun rapprochement par email, téléphone ou nom n'entre dans cette résolution.

## Stratégie de migration

Additive, sans backfill. Les dossiers historiques gardent `contact_id = NULL` et se comportent
exactement comme avant.

## Conséquences

- La divergence d'identité acquéreur **disparaît** : la limite correspondante sort de
  `KNOWN_LIMITATIONS.md`.
- **L'adresse d'envoi Gmail change** pour un acquéreur rattaché dont l'identité avait divergé. C'est
  l'effet recherché, et c'est un changement de comportement réel — il est couvert par un test dédié.
- Le côté vendeur reste inchangé et conserve sa divergence, documentée.

## Risques

| Risque | Portée | Atténuation |
|---|---|---|
| Un email part à une autre adresse qu'avant | Moyen | C'est l'adresse corrigée par un humain ; test de divergence explicite |
| Un Contact à l'email NULL rend un acquéreur injoignable | Moyen | Comportement normal d'absence de destinataire, déjà géré pour les prospects ; un repli le masquerait |
| Les colonnes legacy gelées trompent une lecture directe | Moyen | Projection appliquée dans le repository, test structurel contre le repli champ par champ |

## Hors périmètre

Bridge vendeur · recherche globale par personne · déduplication assistée · rattachement de
l'historique · Contact dans le Sync Engine · `personne_morale` · archivage d'un Contact.

## Questions ouvertes

Le jour où `contacts` entrera dans le Sync Engine, `nom`/`prenom`/`email`/`telephone` sont déjà
déclarés verrouillables (ADR-056) et `references_externes` accepte déjà une cible `contact` : le lot
sera additif.

## Réversibilité

Totale. Retirer la projection et rebrancher l'écriture sur le dossier restaure le comportement
antérieur ; `contacts.modifie_le` resterait une colonne sans écrivain, sans effet.
