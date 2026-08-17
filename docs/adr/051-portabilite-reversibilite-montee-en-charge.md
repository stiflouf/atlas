# ADR-051 — Portabilité, réversibilité et montée en charge d'Atlas

**Statut :** Accepté
**Date :** 2026-08-17
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Atlas V1 Candidate (`v1.0.0-rc1`) est mono-conseiller (ADR-006/047), déployée aujourd'hui sur
Railway, sur PostgreSQL, avec un stockage documentaire filesystem configurable (ADR-050). Le pilote
réel avec un vrai conseiller est la priorité immédiate — cette ADR ne le retarde pas et n'introduit
aucun changement de code.

L'objectif est purement préventif : éviter qu'une croissance future (changement d'hébergeur,
augmentation du nombre d'utilisateurs, passage à un stockage objet, besoin de traitements
asynchrones, passage multi-utilisateur/multi-tenant) impose une réécriture fondamentale du cœur
métier simplement parce qu'aucun principe transversal n'avait été posé à temps. Railway est
l'hébergeur actuel et pragmatique du pilote — il ne doit jamais devenir une dépendance structurelle
du domaine.

**Hors périmètre, explicitement** : aucune implémentation. Aucun Redis, aucune queue, aucun worker,
aucun Kubernetes, aucun Terraform/OpenTofu, aucun stockage objet, aucun multi-tenant, aucune
fonctionnalité Atlas Team, aucune abstraction de code nouvelle. Cette ADR fixe des principes, pas un
chantier.

## Décision

### 1. Objectif d'échelle — un objectif d'architecture, jamais une garantie actuelle

**Atlas doit être conçu de manière à pouvoir évoluer d'un pilote de quelques utilisateurs vers une
plateforme de l'ordre de 10 000+ utilisateurs sans réécriture fondamentale du cœur métier.**

Ceci est un objectif d'architecture à garder en tête lors des décisions structurantes — **ce n'est
ni un benchmark, ni une garantie de capacité actuelle, ni une promesse que la RC1 supporte 10 000
connexions, ni une validation de performance.** Chaque étape réelle de montée en charge devra être
mesurée et testée le moment venu, jamais supposée.

### 2. PostgreSQL standard

Le cœur transactionnel Atlas repose autant que possible sur PostgreSQL standard et des
fonctionnalités largement portables. Une règle métier fondamentale ne doit pas dépendre d'une
extension propriétaire d'un hébergeur lorsque ce n'est pas nécessaire. Cela n'interdit **pas**
l'usage déjà fait aujourd'hui des index PostgreSQL, de JSONB, des contraintes (`CHECK`, `UNIQUE`,
`NO ACTION`), des transactions, ou des fonctions PostgreSQL standard. Le principe : pas de
dépendance métier à un service DB propriétaire d'un cloud quand PostgreSQL standard suffit.

### 3. Stockage documentaire — principe de réversibilité, ADR-050 inchangée

**ADR-050 reste entièrement valide pour le pilote** : filesystem, volume persistant, configuré par
`ATLAS_DOCUMENT_STORAGE_DIR`. Rien ici ne la contredit ni ne planifie sa remise en cause.

Décision stratégique **future** : si Atlas passe un jour à un stockage objet, l'accès aux documents
devra être encapsulé derrière une abstraction suffisamment simple pour permettre un backend
S3-compatible ou équivalent portable. Le principe de réversibilité est que **le domaine ne doit
jamais dépendre de chemins, SDK ou identifiants propres à Railway** — déjà respecté aujourd'hui
(`stockageDocuments.ts` est le seul point de lecture de la variable, ADR-050). Aucune abstraction
n'est créée par cette ADR.

### 4. Conteneurisation — objectif futur, pas un chantier immédiat

L'application doit rester exécutable dans un environnement conteneurisable conforme aux standards
OCI/Docker le jour où l'industrialisation le nécessitera. Aucun `Dockerfile` n'est créé par cette
ADR — le besoin ne s'est pas encore présenté. Le principe vise uniquement à empêcher l'introduction
future de dépendances applicatives impossibles à reproduire hors d'un fournisseur donné.

### 5. Configuration externe — officialisation des conventions ADR-047/050

Secrets hors code, configuration via variables d'environnement, aucune URL/credential fournisseur
codée en dur dans une règle métier, aucune clé d'infrastructure commitée dans le repository — déjà
la pratique constante depuis ADR-047/050, ici explicitement élevée en principe transversal.

### 6. Stateless applicatif — principe futur, pas un état actuel constaté

Objectif : les instances applicatives web doivent rester aussi stateless que raisonnablement
possible, l'état durable résidant exclusivement dans des systèmes explicitement persistants
(PostgreSQL, stockage documentaire, futurs systèmes de queue/cache si un jour réellement
introduits). Cette ADR ne prétend pas qu'Atlas est aujourd'hui parfaitement stateless — c'est un
principe à respecter dans les décisions futures, pas un audit de conformité actuel.

### 7. Traitements asynchrones — évolution possible, jamais imposée maintenant

Atlas possède déjà des scans, reprises, automatisations et traitements périodiques (ADR-032/033/036/038).
Principe : les traitements lourds ou non interactifs doivent pouvoir évoluer vers une exécution
asynchrone sans réécrire les règles métier. **Cela ne signifie pas ajouter Redis, une queue ou des
workers maintenant** — le découplage n'est introduit que lorsque la charge réelle le justifie.

### 8. Migrations versionnées

Toute évolution du schéma reste versionnée et reproductible (`src/db/migrations/`, déjà la
pratique) — jamais de modification manuelle silencieuse du schéma en production. Sauvegarde prise
en compte avant tout changement sensible. La procédure existante reste la référence opérationnelle :
`docs/PROCEDURE_MIGRATION_PRODUCTION.md`.

### 9. Identifiants indépendants de l'hébergement

Les identifiants métier/techniques Atlas (uuid applicatifs, clés de stockage) ne doivent jamais
dépendre d'un ID Railway, d'un ID Scaleway, d'un bucket propriétaire, d'une URL fournisseur ou
d'une machine précise — déjà le cas aujourd'hui (`uuid` générés par Postgres/l'application, clés de
stockage propres à `stockageDocuments.ts`).

### 10. Multi-tenant — décision de principe uniquement, rien introduit maintenant

La RC1 reste strictement mono-conseiller selon ADR-047. Décision de principe pour l'avenir : si
Atlas devient un jour SaaS multi-utilisateur, l'isolation stricte des données entre
organisations/conseillers deviendra un invariant fondamental. Cette ADR **n'introduit aujourd'hui
aucun** `tenant_id`, `organisation_id`, modèle RBAC, session multi-utilisateur ni migration — elle
dit uniquement que toute future architecture Atlas Team/SaaS devra explicitement traiter : la
frontière de tenant, l'isolation DB, le contrôle d'accès, les risques de fuite inter-tenant, et la
stratégie de migration des données mono-conseiller existantes vers ce futur modèle.

### 11. Permissions futures — aucun rôle, aucune table aujourd'hui

Atlas Team est une direction produit future (voir README racine, section Roadmap). Lorsqu'elle sera
conçue, les permissions devront permettre des droits granulaires et temporaires (consulter,
modifier, assister, déléguer, partager un dossier précis, révoquer l'accès). Cette ADR ne définit
aucun modèle RBAC, ne crée aucun rôle, aucune table. Le principe à retenir : **ne jamais construire
Atlas Team sur un simple "tous les membres voient tout".**

### 12. Observabilité — exportable, jamais enfermée dans un fournisseur unique

Logs, métriques et traces futures doivent rester exportables. Cela n'impose **pas** aujourd'hui
OpenTelemetry, Prometheus, Sentry ou Grafana — Atlas n'a actuellement aucune de ces briques. Toute
future solution d'observabilité significative devra documenter sa propre réversibilité au moment de
son introduction.

### 13. Backup et restauration testée

**Une sauvegarde sans restauration testée n'est pas une stratégie de résilience suffisante.** À
terme, l'exploitation Atlas doit permettre de vérifier concrètement : sauvegarde DB, sauvegarde
documents, restauration DB, restauration documents, et cohérence entre les deux. Pour le pilote, le
runbook actuel (`docs/PILOT_RUNBOOK.md`, recommandation manuelle `pg_dump` + copie du volume) reste
suffisant. Aucun mécanisme de backup n'est codé par cette ADR.

### 14. Infrastructure reproductible — déclenchée par l'industrialisation réelle

Lorsque l'infrastructure Atlas deviendra suffisamment complexe pour le justifier, elle devra être
reproductible via Infrastructure as Code — préférence pour Terraform ou OpenTofu selon le contexte
retenu au moment de l'industrialisation. **Aucun fichier Terraform, provider ou stack IaC n'est créé
par cette ADR.** Le déclencheur doit être l'industrialisation réelle, jamais l'anticipation
abstraite.

### 15. Souveraineté / Europe — préférence stratégique, pas un invariant technique

Pour les phases commerciales futures d'Atlas, privilégier lorsque réaliste un hébergement européen,
idéalement français, la maîtrise de la localisation des données, et des fournisseurs permettant une
réversibilité raisonnable. **Scaleway est cité ici comme une option stratégique future** (cohérente
avec la préférence de souveraineté), **jamais comme une décision arrêtée** — aucun contrat, aucun
fournisseur n'est décidé par cette ADR.

### 16. Railway — rôle exact

Railway est un hébergeur actuel et pragmatique pour le pilote. Railway n'est **pas** une couche
métier, pas une abstraction métier, pas une dépendance que les repositories ou services applicatifs
doivent connaître — le code applicatif ne référence aujourd'hui aucun concept propre à Railway
(confirmé : seules des variables d'environnement génériques sont lues). Une future migration
Railway → autre fournisseur doit concerner l'infrastructure, la configuration, le stockage et les
opérations — le moins possible le cœur métier.

```text
Aujourd'hui :                       Demain, possible :

   Railway                             Scaleway / autre fournisseur européen
      |                                          |
    Atlas                                       Atlas
```

Le message est qu'Atlas doit pouvoir changer d'hébergeur sans réécriture fondamentale du domaine —
pas qu'une migration Scaleway est planifiée.

### 17. Règle anti-sur-ingénierie

**Portabilité ne signifie pas abstraction prématurée.** Ne pas créer maintenant, "au cas où" : un
`StorageProviderFactory`, un `CloudAdapter` abstrait, Kubernetes, Redis, Kafka, un event bus
distribué, un repository multi-cloud, ou une stack Terraform vide. Une abstraction s'extrait
seulement lorsque : (1) un deuxième backend devient réel, (2) la dépendance fournisseur commence
réellement à contaminer le domaine, ou (3) la charge terrain démontre le besoin — jamais par
anticipation seule.

### 18. Rubriques obligatoires pour les futures ADR importantes

À partir de cette ADR, toute future ADR fonctionnelle ou technique importante doit comporter deux
rubriques (voir `docs/adr/README.md`, créé par cette même passe, pour la règle canonique) :

**## Scalabilité** — répond à : *"Que se passe-t-il si cette fonctionnalité est utilisée dans un
Atlas comptant de l'ordre de 10 000 utilisateurs ?"* (cardinalité, requêtes, index, pagination,
concurrence, mémoire, CPU, stockage, traitement synchrone/asynchrone, rate limits, jobs — selon
pertinence). *"Aucun impact particulier"* est une réponse acceptable si elle est justifiée ; aucun
benchmark fictif n'est exigé.

**## Réversibilité** — répond à : *"Si Atlas quitte son fournisseur actuel, comment cette brique
est-elle migrée ?"* (données, fichiers, secrets, API, identifiants, dépendances SDK, jobs,
observabilité — selon pertinence). Une fonctionnalité purement métier sans dépendance infra peut
répondre simplement qu'elle n'introduit aucune nouvelle dépendance fournisseur.

**Les ADR 001 à 050 ne sont pas réécrites rétroactivement** — elles restent immuables. Cette règle
s'applique aux décisions futures, ADR-051 devenant la référence transversale.

## Séquence produit à retenir

```
V1 Candidate → validation pilote réelle → premiers retours terrain
  → hardening SaaS si besoin commercial démontré → éventuelle industrialisation infrastructure
  → fonctionnalités Team/Pro/Safe/Enterprise selon validation produit
```

Principe essentiel : **ne jamais laisser les idées futures retarder la mise de la V1 entre les mains
d'un vrai conseiller.** La taxonomie produit future (Atlas / Pro / Team / Team+ / Safe / Enterprise)
et l'hypothèse Atlas Team sont documentées dans le README racine (section Roadmap), pas ici — cette
ADR reste une décision d'architecture technique, jamais un document de packaging commercial.

### Hardening SaaS futur (conceptuel, post-pilote)

Après validation terrain et avant toute commercialisation massive, une phase future distincte
pourra traiter, sans qu'aucun de ces chantiers ne soit lancé par ADR-051 :

- **Sécurité** : multi-tenant, permissions, audit.
- **Scalabilité** : async/jobs, stockage objet, optimisation DB, cache si justifié.
- **Exploitabilité** : monitoring, backup/restore testé, IaC, procédures.

## Hors périmètre, volontairement

Toute implémentation : Redis, Kubernetes, Terraform/OpenTofu, stockage objet, multi-tenant, RBAC,
Atlas Team, conteneurisation (Dockerfile), observabilité outillée (Sentry/Prometheus/Grafana/OTel),
IaC. Toute décision commerciale/contractuelle (fournisseur cloud futur, tarification). Toute
modification du code, du schéma, ou des dépendances.

## Conséquences

- Les décisions structurantes futures disposent d'un cadre de référence explicite (portabilité,
  réversibilité, montée en charge) sans qu'aucun chantier d'industrialisation ne soit engagé
  prématurément.
- Toute future ADR importante devra documenter Scalabilité et Réversibilité — coût marginal faible,
  discipline qui évite les angles morts d'échelle découverts trop tard.
- Le pilote réel reste la priorité immédiate. **Après cette ADR, la prochaine phase est la
  VALIDATION PILOTE RÉELLE** (Railway → Google réel → stockage/redéploiement → desktop/mobile →
  premiers dossiers réels) — pas une nouvelle ADR fonctionnelle.
- Le code freeze V1 reste actif jusqu'à validation pilote : seuls restent autorisés blocker,
  bugfix, sécurité, stabilité, configuration pilote et documentation réellement nécessaire (voir
  `CONTRIBUTING.md`).
