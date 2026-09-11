# ADR-058 — Contact, unité de recherche humaine

**Statut :** Accepté — read model implémenté (migration `0042`)
**Date :** 2026-09-11
**Décideurs :** Steven Gausset (CEO), CTO

> Rubriques : Contexte · Problème · Décision · Alternatives écartées · Modèle de données /
> contrats · Invariants · Conséquences · Risques · Hors périmètre · Questions ouvertes ·
> Scalabilité · Réversibilité (ADR-051).
>
> Dépend de : **ADR-055** (§A, le Contact est l'identité d'une personne ; §H, jamais de fusion
> automatique), **ADR-057** (identité effective) et **ADR-054** (appartenance).

## Contexte

Le produit compte neuf surfaces de recherche, toutes siloées par dossier : on cherche un
« acquéreur » ou un « prospect vendeur », jamais une personne. Il n'existe ni recherche globale, ni
page `/contacts`, ni fiche Contact — `getContactById()` n'a aujourd'hui aucun appelant de production.

Depuis ADR-055 et ADR-057, le même humain peut pourtant porter un projet d'achat et un projet de
vente sous une seule identité canonique. La recherche est le dernier endroit où le produit le fait
encore apparaître deux fois.

## Problème

Chercher « Dupont » oblige aujourd'hui le conseiller à savoir **sous quel rôle** il connaît cette
personne, et à répéter sa recherche sur deux écrans. Le modèle canonique a supprimé cette dualité
dans les données ; elle survit dans l'interrogation.

Un écran qui met côte à côte deux personnes proches est aussi le seul endroit du produit où la
tentation de les regrouper sera permanente. La règle doit donc être posée avant l'écran.

## Décision

1. **Le Contact est l'unité principale de résultat humain.** On cherche une personne ; ses dossiers
   sont du contexte.
2. **Un Contact multi-rôle apparaît UNE fois.** Acquéreur et vendeur sont des attributs du résultat,
   jamais deux lignes.
3. **Plusieurs Contacts partageant un email ou un téléphone restent plusieurs résultats.**
4. **La recherche ne déduit JAMAIS une identité commune.** Aucun `GROUP BY email`, aucun
   `DISTINCT ON`, aucun regroupement visuel. Les mettre côte à côte est précisément ce qui permet à
   un humain de trancher — et à lui seul (ADR-055 §H).
5. Les dossiers legacy non rattachés seront des résultats **secondaires et explicitement non
   canoniques**, jamais promus en Contact virtuel. Hors de ce lot.
6. La recherche est **strictement workspace-scoped** : `workspaceId` est un paramètre obligatoire,
   jamais optionnel, jamais avec repli.
7. Elle est **provider-agnostique** : elle lit `contacts`, jamais `references_externes`. Un contact
   importé par un futur connecteur est un contact comme un autre.
8. **PostgreSQL est le moteur V1.**
9. Le **ranking est déterministe** et explicable : exact, puis préfixe, puis contient. Aucun score
   appris, aucune pondération opaque.
10. **Aucune tolérance aux fautes, aucune fusion automatique** dans cette V1.

### Pourquoi PostgreSQL, et pas un moteur dédié

La volumétrie qui compte n'est pas le total mais **ce que voit une requête** : toute recherche est
scopée à un workspace, et un conseiller accumule de l'ordre du millier de contacts sur sa carrière.
Même à 10 000 agents, chaque requête ne balaie que son propre millier de lignes. Un moteur externe
ajouterait un service à exploiter, une synchronisation à maintenir et une seconde source de vérité,
pour un problème qu'un index résout.

### Pourquoi le ranking est en paliers, et pas un score

Un conseiller doit pouvoir prédire ce que sa recherche va rendre. « Email exact d'abord » est une
règle qu'on explique en une phrase ; un score composite ne s'explique pas, et se met à mentir dès
qu'on lui ajoute un critère.

## Alternatives écartées

**Regrouper les résultats par email.** Transformerait un couple partageant une adresse en une seule
personne — la fusion silencieuse qu'ADR-055 §H interdit, déguisée en confort d'affichage.

**Remplacer les recherches acquéreur et vendeur.** Elles ne cherchent pas une personne : ce sont des
vues de pipeline, par stade et par échéance. Elles deviendront des filtres à côté de la recherche
pivot, pas des doublons à supprimer.

**Introduire `email_normalise` / `telephone_normalise` dès maintenant.** La recherche a besoin de
ressemblance, pas d'égalité stricte ; ces colonnes ne se justifieront qu'avec le rapprochement
assisté, et les poser sans lecteur créerait des colonnes mortes.

## Modèle de données / contrats

Aucune table nouvelle. Une seule migration : un index sur `contacts(workspace_id)` — le filtre le
plus sélectif de toute requête, et le seul qui manquait.

Le read model rend `ContactSearchResult` : identité, rôles dérivés, résumé de projets, date de
dernière interaction. Rien d'autre — le détail appartiendra à la fiche Contact.

**Nombre de requêtes constant**, quel que soit le nombre de résultats : la page de contacts, puis un
agrégat de rôles et projets, puis un agrégat d'interactions, tous deux batchés sur les ids retenus.

## Invariants

1. `workspaceId` obligatoire ; aucune jointure ne réintroduit de donnée d'un autre workspace.
2. Un Contact = au plus une ligne de résultat, quels que soient ses rôles et ses projets.
3. Deux Contacts distincts restent deux lignes, même identité apparente comprise.
4. Les rôles sont dérivés de `parties_projet`, jamais stockés.
5. Le statut vendeur est calculé par la primitive métier existante, jamais réécrit en SQL.
6. Aucun terme de recherche n'est journalisé.

## Conséquences

- Le Contact devient interrogeable pour la première fois : `contacts` n'avait aucun lecteur de
  production.
- La recherche pivot coexiste avec les recherches de pipeline existantes.
- Les dossiers historiques non rattachés restent invisibles de cette recherche tant que le lot des
  résultats mixtes n'existe pas. C'est une limite assumée, pas un oubli.

## Risques

| Risque | Portée | Atténuation |
|---|---|---|
| La déduplication par email est la pente naturelle de cet écran | **Élevé** | Interdite par des tests structurels et un test métier dédié |
| Dupliquer la dérivation du statut vendeur en SQL | Moyen | La primitive JS est appelée sur les données brutes |
| Une requête par contact pour les rôles ou les interactions | Moyen | Agrégats batchés, protégés par un test |

## Hors périmètre

Page `/contacts` · autosuggest · fiche Contact · résultats legacy mixtes · déduplication assistée ·
backfill · Sync Engine · tolérance aux fautes · index trigram.

## Scalabilité

L'index de workspace suffit à l'horizon prévisible. `pg_trgm` et `unaccent` sont disponibles sur
l'instance ; ils seront posés quand une mesure le justifiera, pas avant.

## Réversibilité

Totale. Le read model n'a aucun écrivain et aucun consommateur obligatoire ; le retirer ne change
rien au reste du produit. L'index resterait sans effet visible.
