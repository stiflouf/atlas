# ADR-070 — Modèle d'exploitation du pilote : un projet d'hébergement dédié par conseiller

Statut : accepté
Date : 2026-11-02
Chantier : `PILOT_INSTANCE_PROVISIONING_V1`
Tranche : ADR-054 question ouverte n°2 (« le pilote reste-t-il une instance par conseiller ? »), pour
le pilote et le modèle d'exploitation initial uniquement
Complète : ADR-047 (sécurisation du pilote mono-conseiller), ADR-054 (appartenance workspace),
ADR-051 (frontières de plateforme), ADR-013 (stockage documentaire), ADR-006 (mono-conseiller)

## Contexte

Le dépôt décrivait deux instances d'hébergement — une production personnelle et un showroom de
démonstration — sans jamais décrire le **modèle** qui les sépare. Le runbook énonçait un constat
a posteriori (« autre projet Railway, autre base, autre volume, autre secret de session »), jamais
une règle, et aucune procédure de création d'instance n'existait.

Trois documents nommaient l'absence de décision :

- ADR-054 §9, question ouverte n°2 : « Le pilote reste-t-il une instance par conseiller ? Décision
  d'exploitation, indépendante de ce modèle de données » ;
- ADR-054 : « La question "une instance par conseiller, ou un déploiement partagé ?" reste ouverte
  côté exploitation » ;
- l'audit stratégique de septembre 2026 : « Si la réponse est "jamais" (une instance par conseiller,
  isolation par déploiement), alors **cela doit être écrit noir sur blanc** ».

Entre-temps, le runbook posait une interdiction sans la rattacher à un modèle : « Le jour où un
conseiller voudra tester avec ses vrais dossiers, ce sera une troisième instance, jamais celle-ci ».
Une interdiction de réutiliser la démo n'est pas une architecture.

`PILOT_INSTANCE_PROVISIONING_V1` s'est arrêté sur ce vide, conformément au garde-fou du runbook §0 :
une cible d'écriture que la documentation n'autorise pas explicitement impose un arrêt. Cette ADR
lève le vide. **Elle ne crée aucune ressource**, et le lot de provisioning reprend après elle.

## Décision 1 — Un projet d'hébergement entièrement dédié par conseiller

```
PILOT_RAILWAY_PLACEMENT = DEDICATED_PROJECT
```

Chaque conseiller pilote reçoit un **projet d'hébergement distinct**, portant ses propres :

- service applicatif ;
- service PostgreSQL ;
- volume documentaire ;
- variables et secrets d'instance ;
- healthcheck ;
- jobs périodiques dédiés, si et quand ils deviennent nécessaires.

**Aucune ressource métier ni de stockage n'est partagée** avec la production personnelle de
l'exploitant ni avec le showroom de démonstration.

Motifs, dans l'ordre où ils ont emporté la décision :

1. **isolation opérationnelle et des données** — une instance ne peut pas lire ce qu'une autre
   écrit, parce qu'elles ne partagent ni base ni système de fichiers ;
2. **limitation du rayon d'impact** — une erreur de configuration, une migration malheureuse ou une
   restauration ne touche qu'un conseiller ;
3. **suppression et recréation simples** — la fin d'un pilote est la suppression d'un projet, pas un
   tri de lignes dans une base partagée ;
4. **modèle reproductible** — le deuxième conseiller suit la même procédure que le premier ;
5. **absence de multi-tenant mature** — voir décision 2, qui est la raison technique dure.

## Décision 2 — La raison technique, et elle n'est pas une préférence

Le produit **ne sait pas** isoler deux conseillers dans un même déploiement, et cette incapacité est
documentée depuis ADR-054 :

- aucun chemin de lecture ne filtre par `workspace_id`. La colonne existe sur les neuf tables
  racines, elle n'est pas appliquée en lecture ;
- l'allowlist d'accès n'accepte **qu'une seule adresse**, par égalité stricte après normalisation
  (`apps/web/src/lib/auth/allowlist.ts`). Une liste n'autoriserait personne, et plusieurs identités
  autorisées sur la même base verraient toutes les mêmes données ;
- `exigerWorkspaceCourant()` **refuse** une identité portant plus d'une appartenance : aucun
  sélecteur de workspace n'existe, et le refus est délibéré ;
- une seule ligne `workspaces` existe en base, semée par migration sous l'identifiant `'default'` ;
- l'appartenance du dossier fiscal du conseiller — régime, TVA, revenu fiscal de référence du foyer,
  nombre de parts — n'est **pas tranchée** entre workspace et identité (ADR-065 §9). Un second
  membre de workspace exposerait le revenu du foyer du premier.

Dans cet état, « un déploiement partagé » ne signifierait pas « plusieurs conseillers isolés » mais
« plusieurs conseillers voyant les mêmes données ». L'isolation par déploiement n'est donc pas la
solution la plus élégante : c'est **la seule qui existe**.

## Décision 3 — Ce qui est propre à l'instance, et ce qui peut être partagé

Classement établi depuis le code, pas depuis une liste historique. Aucune valeur ne figure ici.

### Propre à l'instance — une valeur distincte par conseiller

| Variable | Pourquoi le partage serait faux |
|---|---|
| `DATABASE_URL` | identifie la base ; deux instances sur la même URL partagent le workspace `'default'` et donc toutes les données |
| `ATLAS_DOCUMENT_STORAGE_DIR` | racine des documents et photos ; les clés de stockage sont des UUID opaques sans préfixe de périmètre, donc deux instances mélangeraient leurs fichiers |
| `ATLAS_ALLOWED_EMAIL` | l'identité du conseiller de cette instance, une seule adresse |
| `ATLAS_SESSION_PASSWORD` | scelle le cookie de session sur `path: "/"` ; partagé sur un domaine commun, un cookie scellé par une instance serait accepté par l'autre |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | chiffre les jetons de rafraîchissement **stockés dans la base de l'instance** ; la clé et la base sont solidaires, et une clé changée rend les lignes indéchiffrables sans erreur visible |
| `GOOGLE_ATLAS_REDIRECT_URI` | unique source de vérité du domaine public de l'instance pour le flux d'identité |
| `GOOGLE_REDIRECT_URI` | idem pour le flux métier |
| `ATLAS_ADVISOR_DISPLAY_NAME` | propriété d'instance, techniquement facultative (repli documenté) |

### Partageable — configuration de fournisseur, sans donnée d'instance

| Variable | Justification |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | identifient l'**application** auprès du fournisseur, pas l'instance ; un même client déclare plusieurs URI de redirection |
| `PRIM_API_KEY` | clé d'abonnement à un service de données publiques, aucune notion d'instance dans l'appel |
| `DOMIORA_REDACTION_*` | endpoint et modèle d'un service de reformulation, **non activé en production** et à ne pas activer avant qualification du fournisseur (ADR-065 §10) |

Partager le client OAuth est **permis, non prescrit**. Conséquence à connaître avant de choisir :
une révocation d'accès côté fournisseur porte sur l'application, donc sur toutes les instances qui
en dépendent. Un client distinct par instance isole aussi ce risque, au prix d'une configuration de
plus. La décision est laissée au provisioning, qui doit l'écrire.

### Hors périmètre d'une instance pilote

`COMPATIBILITE_BASELINE_SECRET` et `RETENTION_DRY_RUN_SECRET` ne sont appelés par aucun job
périodique — ce sont des outils d'exploitation ponctuels. `NODE_ENV` est posé par la plateforme et ne
se provisionne pas à la main : son absence rendrait les cookies non sécurisés et le stockage
documentaire optionnel, deux régressions silencieuses.

## Décision 4 — Le nom de l'instance n'est jamais nominatif

Un identifiant technique (`domiora-pilot-01` et sa suite), jamais le nom du conseiller. Un nom de
projet se lit dans une facture, une URL, un journal et une capture d'écran : y inscrire une personne
publierait une relation commerciale sans raison technique.

Corollaire assumé : la correspondance entre un numéro d'instance et un conseiller vit **hors du
dépôt**, et elle n'est pas publiée.

## Décision 5 — Fail-closed à la création, et l'ouverture est un acte distinct

Une instance se provisionne **sans** `ATLAS_ALLOWED_EMAIL`. L'allowlist lève alors une exception
explicite, donc personne ne peut entrer, et c'est l'état correct d'une instance qui n'a pas encore
de destinataire.

Ce que l'absence de cette variable ne bloque pas, et c'est voulu : le démarrage de l'application, le
healthcheck, l'application des migrations, la sauvegarde et la restauration. La sonde de santé est
publique et sans session ; une instance peut donc être entièrement validée avant d'être ouverte à
qui que ce soit.

**Ne jamais poser une adresse générique, de service ou d'attente pour « débloquer » une validation.**
Une instance ouverte à une adresse arbitraire est une instance ouverte.

## Décision 6 — Aucune donnée réelle avant la levée du gate

Le provisioning et la recette se font avec des données exclusivement synthétiques, selon
`docs/pilote/GATE_DONNEES_REELLES.md`.

Ce document est un **gate opérationnel** : aucun contrôle technique ne distingue une donnée réelle
d'une donnée synthétique, et le type de document accepte pièce d'identité, justificatif de domicile
et coordonnées bancaires sans condition. L'écrire est la seule protection disponible.

## Ce que cette ADR ne décide pas

- **Rien de l'architecture SaaS multi-tenant future.** Elle porte sur le pilote et le modèle
  d'exploitation initial. Le jour où plusieurs conseillers doivent coexister dans un déploiement, il
  faudra le chantier que ADR-054 et `docs/KNOWN_LIMITATIONS.md` décrivent déjà : filtrage par
  workspace sur 100 % des chemins de lecture, appartenances laissées ouvertes tranchées, rôles. Rien
  de cela n'est engagé ici.
- **Aucun choix de fournisseur d'hébergement.** Le modèle est « un projet dédié » chez le
  fournisseur déjà utilisé ; il ne qualifie aucun autre prestataire.
- **Aucune décision sur les jobs périodiques.** Voir limites connues.
- **Aucune décision sur la destination de sauvegarde hors site**, qui reste
  `OFFSITE_BACKUP_DESTINATION = DECISION_REQUIRED` et relève d'une qualification de sous-traitance.
- **Aucune ressource créée.** Cette ADR précède le provisioning ; elle ne l'exécute pas.

## Limites connues

1. **Aucun provisioning outillé.** Pas d'infrastructure as code, pas de modèle de projet, pas de
   script de création, et ADR-051 écarte explicitement Terraform. La création reste une suite de
   gestes humains, donc reproductible seulement par une procédure écrite — à produire par le lot de
   provisioning.
2. **Le `healthcheckPath` ne vit pas dans le dépôt.** Aucun fichier de configuration de déploiement
   n'est versionné : le chemin de la sonde et les commandes de construction sont des réglages de la
   plateforme. Une instance recréée depuis le seul dépôt ne les retrouverait pas.
3. **Les migrations ne sont pas appliquées au démarrage.** La commande de construction ne les
   exécute pas : leur application est un geste manuel, et la base interne n'est pas joignable depuis
   un poste. Une instance neuve a donc une base vide jusqu'à ce geste.
4. **Les jobs périodiques ne sont pas automatisables à la création.** Leur création en ligne de
   commande a été refusée par la plateforme lors du précédent déploiement, et elle a dû être faite à
   la main. De plus les trois wrappers lisent tous une variable de secret portant **le même nom**
   alors que les trois points d'entrée applicatifs attendent **trois secrets distincts** : la valeur
   doit donc être posée par job, et un copier-coller entre jobs produirait un refus silencieux.
5. **Le coût croît linéairement.** Un projet par conseiller, c'est une base et un volume par
   conseiller. Le modèle est adapté à quelques pilotes, pas à une flotte.
6. **La correspondance instance ↔ conseiller n'est pas outillée.** Elle est tenue hors dépôt, donc
   susceptible d'être perdue.

## Scalabilité

Dans un Atlas comptant de l'ordre de 10 000 utilisateurs, **ce modèle ne tient pas**, et il faut
l'écrire plutôt que de le laisser déduire.

Un projet d'hébergement par conseiller signifie 10 000 bases, 10 000 volumes, 10 000 jeux de
variables et autant de gestes de création manuels — sans infrastructure as code, sans modèle de
projet et sans création de job automatisable (limites connues n°1 et n°4). Le coût croît
linéairement avec le nombre de conseillers, et l'exploitation croît plus vite que linéairement :
chaque instance porte ses migrations, ses sauvegardes et ses restaurations.

Ce modèle est dimensionné pour **quelques pilotes**, et c'est son objet : il achète l'isolation au
prix de la densité, à un moment où le produit ne sait pas isoler autrement. Le passage à l'échelle
n'est pas une version améliorée de ce modèle, c'est son remplacement par le chantier de filtrage par
workspace décrit en décision 2 — et ce chantier est un préalable, pas une optimisation.

Le seuil de bascule n'est pas fixé ici, et aucune valeur ne serait honnête aujourd'hui : il dépendra
du coût réel par instance et de la charge d'exploitation constatée sur les premiers pilotes.

## Réversibilité

Élevée, et c'est le motif n°3 de la décision 1 : un pilote se termine par la suppression de son
projet. Aucune donnée d'un autre conseiller, aucune ligne de la production personnelle et aucun
fichier du showroom n'est touché, puisque rien n'est partagé.

Le chemin inverse — consolider plusieurs instances dans un déploiement partagé — n'est **pas**
réversible à ce coût : il exige le chantier de filtrage par workspace décrit en décision 2. Choisir
l'isolation par déploiement aujourd'hui ne ferme aucune porte ; choisir le partage en l'ouvrirait
une qu'aucun code ne garde.

## Chantiers suivants

| Lot | Objet |
|---|---|
| `PILOT_INSTANCE_PROVISIONING_V1` | reprendre la création sur la base de cette ADR : projet dédié, ressources, variables, healthcheck, migrations, sauvegarde, recette synthétique |
| `PILOT_ADVISER_ONBOARDING_V1` | poser l'allowlist et le nom d'affichage, déclarer l'URI de redirection chez le fournisseur, obtenir le consentement du conseiller |
| `FISCAL_OWNERSHIP_V1` | trancher l'appartenance du dossier fiscal — préalable à tout second membre de workspace, et donc à tout déploiement partagé |
