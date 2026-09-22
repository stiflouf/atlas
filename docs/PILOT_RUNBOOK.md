# Runbook pilote — Atlas mono-conseiller

Point d'entrée opérationnel canonique du pilote mono-conseiller (audit V1 Candidate). Destiné à
l'exploitant (déploiement/exploitation), pas au conseiller utilisateur final (voir le guide
conseiller, à produire avant le pilote réel — hors périmètre de cette passe, voir
`docs/KNOWN_LIMITATIONS.md`).

Ce document ne duplique pas ce qui existe déjà ailleurs — il y renvoie :

- Checklist exacte des variables d'environnement/configuration : **`docs/adr/047-securisation-pilote-mono-conseiller.md#checklist-de-configuration-avant-pilote`**
  (emplacement canonique, ne pas la recopier ici).
- Procédure de migration production : **`docs/PROCEDURE_MIGRATION_PRODUCTION.md`**.
- Limites connues et dettes assumées : **`docs/KNOWN_LIMITATIONS.md`**.

## 0. Environnements, branches et autorisations d'écriture (source canonique)

**Emplacement canonique unique de la correspondance environnement ↔ branche ↔ autorisation.** Toute
autre documentation doit pointer ici plutôt que recopier ces valeurs. En cas de désaccord entre un
document et l'état Railway réel, **c'est l'état Railway qui fait foi**, et ce tableau doit être
corrigé.

| Environnement | Usage | Branche source | Écriture autorisée |
|---|---|---|---|
| local | développement quotidien | `feature/*` puis `develop` | oui |
| `domiora-demo` (service `domiora-demo`) | showroom, démonstration, validation, tests manuels réalistes | **`develop`** | oui, après tests verts |
| `sparkling-rejoicing` (service `DOMIORA`) | **production personnelle réelle de Steven** | **`main`** | **NON depuis un lot `develop`** — mission explicite distincte obligatoire |

Identifiants (lecture, jamais des secrets) :

| | Pilote (Steven) | DOMIORA DEMO |
|---|---|---|
| Projet Railway | `sparkling-rejoicing` | `domiora-demo` |
| Project ID | — [Non vérifié depuis ce dépôt] | `3d771bb3-f397-4aed-9216-c5587c5232b4` |
| Environment | `production` | `production` |
| Service | `DOMIORA` | `domiora-demo` |
| Service ID | — [Non vérifié depuis ce dépôt] | `50fdd82a-68d7-4afe-9f26-a3b14312809b` |

Les deux environnements portent un environment Railway nommé `production` : **le nom
« production » ne désigne donc jamais à lui seul la production de Steven.** Ne jamais déduire la
cible d'un nom d'environnement.

Dernier état vérifié de `sparkling-rejoicing` (constaté lors de VALUE-02/VALUE-03, **non revérifié
depuis** — aucun accès Railway, CLI absente de l'environnement de développement) :

- deployment `88756778-b4da-45ec-91cd-3b75b3aa49f7`
- commit `1c92c8a`
- date 2026-08-28

### Règle Git canonique

```
feature/*  →  develop  →  domiora-demo         (courant, autorisé dans les lots de développement)
develop    →  main     →  sparkling-rejoicing  (promotion, mission explicite uniquement)
```

- Ne jamais travailler directement sur `main`.
- Ne jamais pousser `main` dans un lot de développement courant.
- Un déploiement demo réussi n'est **jamais** une autorisation implicite de promotion en production.
- **Une suite de tests entièrement verte n'autorise pas `main`.** La promotion est une décision
  humaine, jamais une conséquence d'un état technique.

### Garde-fou avant toute écriture Railway

Aucune écriture (variable, redéploiement, configuration de service ou de branche, création de
Function) sans avoir déroulé ces cinq points **dans cet ordre** :

1. identifier le **projet** ;
2. identifier l'**environment** ;
3. identifier le **service** ;
4. vérifier la **branche source** de ce service ;
5. comparer avec la cible **explicitement nommée par la mission**.

Si la mission dit « `domiora-demo` uniquement », alors `sparkling-rejoicing` est **lecture seule**.
Si la cible n'est pas explicitement autorisée : **STOP**, demander avant d'agir.

### Vérification en lecture seule

Aucune de ces commandes n'écrit quoi que ce soit ; aucune ne doit jamais contenir de token ni de
secret (l'authentification CLI est déjà établie côté poste, jamais passée en argument).

```
railway whoami                                          # compte utilisé
railway status                                          # projet/environment/service actuellement liés
railway service status --service <nom> --environment production   # statut du dernier déploiement
railway logs --service <nom> --environment production --lines 30  # logs du dernier run
railway functions list                                  # Functions cron et leurs horaires
```

À relever avant de conclure quoi que ce soit : **service, branche source, commit déployé,
deployment ID, statut**. Un `railway status` qui ne nomme pas explicitement le projet attendu
signifie que le lien local pointe ailleurs — relier avant toute lecture, jamais supposer.

## 1. Architecture mono-conseiller (rappel)

Un seul conseiller autorisé (`ATLAS_ALLOWED_EMAIL`, allowlist à une seule adresse, jamais un
annuaire), une seule base Postgres, un volume documentaire persistant, aucun scheduler interne (3
jobs déclenchés par un cron **externe**). Aucune notion de compte multi-utilisateur — voir
`docs/KNOWN_LIMITATIONS.md#pas-de-multi-utilisateur`.

### 1 bis. Instance de démonstration DOMIORA DEMO (permanente, données fictives)

Environnement **distinct et permanent**, créé le 2026-08-31, destiné aux démonstrations guidées
(conseillers, partenaires) et aux tests manuels réalistes. Il ne partage **rien** avec l'instance
pilote décrite dans le reste de ce runbook : autre projet Railway, autre base, autre volume, autre
secret de session.

Projets, services, identifiants, **branches sources** et autorisations d'écriture : **section 0
ci-dessus** (source canonique, ne pas les recopier ici). Le tableau ci-dessous ne couvre que la
configuration propre à chaque instance.

| | Pilote (Steven) | DOMIORA DEMO |
|---|---|---|
| URL | `https://domiora-production.up.railway.app` | `https://domiora-demo-production.up.railway.app` |
| Région | EU West | EU West |
| Volume | `domiora-volume` → `/data/stockage-documents` | `domiora-demo-volume` → `/data/stockage-documents` |
| Postgres | dédié | dédié, distinct |
| Jobs cron | 3 Railway Functions | **aucun** — scan manuel avant démonstration (voir « Automatisations » ci-dessous) |
| Calendar / Gmail | connectés | variables présentes, **jeton révoqué** (voir ci-dessous) |

**Interdiction permanente : aucune donnée personnelle réelle dans DOMIORA DEMO.** Cette instance
n'accueille que le dataset fictif produit par `apps/web/scripts/seed-demo.mjs`. Le jour où un
conseiller voudra tester avec ses vrais dossiers, ce sera une troisième instance, jamais celle-ci —
sans quoi de vraies données personnelles se retrouveraient dans un environnement conçu pour être
montré à des tiers.

Identité affichée : `ATLAS_ADVISOR_DISPLAY_NAME=Conseiller DOMIORA` — volontairement générique, cette
instance étant montrée à des tiers. Facultative techniquement (repli `Conseiller DOMIORA`),
recommandée sur toute instance déployée, et **strictement distincte d'`ATLAS_ALLOWED_EMAIL`** : l'une
est ce qui s'affiche, l'autre décide qui peut entrer. Steven reste donc l'identité autorisée à se
connecter au showroom sans que son nom y apparaisse.

Variables réellement configurées sur DOMIORA DEMO, constatées le 2026-09-22 (noms uniquement,
aucune valeur ici) : `DATABASE_URL`, `NODE_ENV=production`, `ATLAS_SESSION_PASSWORD`,
`ATLAS_ALLOWED_EMAIL`, `ATLAS_ADVISOR_DISPLAY_NAME`, `ATLAS_DOCUMENT_STORAGE_DIR`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ATLAS_REDIRECT_URI`, `GOOGLE_REDIRECT_URI`,
`GOOGLE_TOKEN_ENCRYPTION_KEY`, les trois `DOMIORA_REDACTION_*`, `RAILPACK_BUILD_CMD`,
`RAILPACK_START_CMD`, plus depuis `RAILWAY_DEMO_DEPLOYMENT_V1` les trois secrets d'endpoints
`AUTOMATISATIONS_SCAN_SECRET`, `AUTOMATISATIONS_REPRISE_SECRET`, `COMPATIBILITE_SCAN_SECRET`.
Reste absente : `PRIM_API_KEY` (transports sur `/preparer`, hors chemin de démonstration) et
`COMPATIBILITE_BASELINE_SECRET` (outil manuel de rebuild, délibérément non configuré).

**Google sur la démo : à ne pas toucher en direct.** Une connexion existe en base mais son
`refresh_token` est **révoqué** — chaque rendu du cockpit logue
`[google-calendar] Calendar indisponible, repli : ... invalid_grant` et l'agenda retombe sur une
liste vide (comportement voulu en production). Le cockpit affiche donc « Se reconnecter ». Le chemin
de démonstration n'en dépend pas (visites natives) : ne pas cliquer ce bouton pendant une
démonstration. Contrairement à ce que ce runbook indiquait avant le 2026-09-22, `GOOGLE_REDIRECT_URI`
est bien présente : un clic lancerait un vrai flux d'autorisation Google, pas une erreur.

Seed (confirmation **ponctuelle**, jamais enregistrée comme variable Railway) — voir
`apps/web/README.md`, section « Seed de démonstration » :

```
DOMIORA_DEMO_SEED_CONFIRM=I_UNDERSTAND_THIS_IS_DEMO_DATA pnpm db:seed:demo
```

Depuis `DEMO_SEED_CANONICAL_V1` (2026-09-21), le seed écrit aussi des fichiers (PDF du bon signé,
signature, documents, photo) dans `ATLAS_DOCUMENT_STORAGE_DIR` — le volume documentaire doit donc
être monté avant de seeder — et se **rejoue** par-dessus lui-même (périmètre ciblé, jamais une purge
par workspace) : rafraîchir le showroom après une démonstration = relancer la même commande.

### 1 quater. État vérifié de DOMIORA DEMO (RAILWAY_DEMO_DEPLOYMENT_V1, 2026-09-22)

Premier déploiement contrôlé de bout en bout de cette instance. Tout ce qui suit a été **constaté**,
jamais déduit.

| Point | État vérifié |
|---|---|
| Commit déployé | `b32513b` (`feat(crm): add contact interaction timeline`), déploiement auto depuis `develop`, statut SUCCESS |
| Projet / environnement | `domiora-demo` · `3d771bb3-f397-4aed-9216-c5587c5232b4` · environment `production` |
| Service web / Postgres | `domiora-demo` (`50fdd82a-68d7-4afe-9f26-a3b14312809b`) · `Postgres` (`681d7804-2b43-4cdd-bc63-bd545aceb128`) |
| Identité base | `current_database() = railway`, `current_user = postgres`, PostgreSQL 18.6, 1 seul workspace |
| Migrations | **40 → 54** appliquées ce jour ; dernière = `0053_seller_feedback_interaction_v1` (l'instance était restée à `0039`) |
| Volume | `domiora-demo-volume` monté sur `/data/stockage-documents`, `ATLAS_DOCUMENT_STORAGE_DIR` identique, écriture testée |
| Seed canonique | `recree_depuis_partiel` — 12 contacts, 6 prospects, 3 biens, 3 mandats + 3 mandants, 6 acquéreurs, 6 visites, 3 CR, 1 bon signé + 1 signature, 3 documents, 1 photo, 3 interactions, 2 offres, 1 compromis, 6 tâches, 18 compatibilités, 7 règles actives |
| Téléchargements | document (PDF 1 130 o), bon signé (PDF 8 748 o, **SHA-256 identique à `bons_visite.hash_document`**), photo (WebP 8 872 o) — tous HTTP 200 |
| Persistance stockage | deux redéploiements successifs, mêmes SHA-256 après chaque : le volume tient |
| Logs | aucune erreur applicative hors `invalid_grant` Google décrit ci-dessus |

**Point de méthode appris.** Le seed a d'abord **refusé** (garde n° 3 : données métier hors
périmètre) à cause de deux lignes de test manuelles créées lors d'essais antérieurs sur la démo
(un contact et un acquéreur « Demo Railway », plus leurs quatre lignes dérivées : participation
projet, deux états de compatibilité, une demande de resynchronisation, deux événements métier). La
garde a fonctionné exactement comme prévu : aucune écriture, aucune suppression. Ces six lignes ont
été supprimées une par une, par identifiant, sur décision explicite — jamais un `TRUNCATE`, jamais un
reset. **Toute saisie manuelle faite sur la démo bloquera le prochain seed de la même façon** :
c'est le prix assumé de la garde, et la marche à suivre est celle-ci, pas son contournement.

#### Procédure reproductible (démo distante)

1. **Prouver la cible** : `railway status` doit afficher `domiora-demo` /
   `3d771bb3-f397-4aed-9216-c5587c5232b4`. Aucune commande mutante avant.
2. **Backup** : `railway ssh -s Postgres -- pg_dump -U postgres -d railway --format=custom > <fichier local>`
   (vérifier l'en-tête `PGDMP`). Jamais dans le dépôt.
3. **Migrations** : `railway ssh -s domiora-demo -- sh -lc 'export PATH=/mise/shims:$PATH; cd /app/apps/web && pnpm exec drizzle-kit migrate'`
   — exécuté **dans le conteneur**, qui porte la `DATABASE_URL` interne
   (`postgres.railway.internal`, injoignable depuis un poste). Jamais `pnpm db:migrate` en local sans
   `DATABASE_URL` explicite : `drizzle.config.ts` retomberait silencieusement sur `localhost`.
4. **Vérifier** : `select count(*), max(created_at) from drizzle.__drizzle_migrations;` — attendu 54
   et `1789912897707` (= `0053`, valeur `when` du journal).
5. **Seed** : `railway ssh -s domiora-demo -- sh -lc 'export PATH=/mise/shims:$PATH; cd /app/apps/web && DOMIORA_DEMO_SEED_CONFIRM=I_UNDERSTAND_THIS_IS_DEMO_DATA node scripts/seed-demo.mjs'`.
   La confirmation reste **ponctuelle**, jamais une variable Railway.
6. **Smoke** : `/`, `/contacts/…1001` (Historique + retour vendeur), `/biens/…301`, `/visites/…501`,
   puis les trois téléchargements ci-dessus.
7. **Automatisations** : voir ci-dessous.

#### Automatisations sur la démo — scan manuel, jamais un cron

Stratégie retenue : **OPTION B, déclenchement manuel avant démonstration**. Aucune Railway Function
n'a été créée sur `domiora-demo` ; aucun cron n'y existe et il ne faut pas en laisser croire un.

Trois secrets ont été posés (valeurs jamais écrites ici ni dans le dépôt) :
`AUTOMATISATIONS_SCAN_SECRET`, `AUTOMATISATIONS_REPRISE_SECRET`, `COMPATIBILITE_SCAN_SECRET`.

```
curl -s -X POST -H "Authorization: Bearer <secret>" https://domiora-demo-production.up.railway.app/api/automatisations/scan
curl -s -X POST -H "Authorization: Bearer <secret>" https://domiora-demo-production.up.railway.app/api/compatibilite/scan
curl -s -X POST -H "Authorization: Bearer <secret>" https://domiora-demo-production.up.railway.app/api/automatisations/reprise
```

Résultat constaté le 2026-09-22 sur le dataset canonique : 4 tâches automatiques créées
(« Préparer la visite de demain », « Compléter le compte rendu de visite »,
« Offre en attente de décision », « Mandat à renouveler bientôt »), visibles dans Today. **Second
appel identique : 0 nouvelle occurrence** — idempotence vérifiée. Un Bearer absent ou faux est
refusé en 401. `inactivite_prospect_vendeur` ne s'exécute pas (règle non activée par le seed), et
`/api/compatibilite/baseline` reste sans secret : geste manuel jamais nécessaire ici.

Formulation honnête en démonstration : « le scan a été déclenché avant la séance ». Ne jamais dire
que DOMIORA vient de générer ces tâches toute seule sur cette instance.

### 1 ter. Build Railpack — commandes de build/start

Depuis Railpack 0.38.0, les champs `buildCommand`/`startCommand` du service ne suffisent plus : la
phase *prepare* échoue en amont avec `No start command detected` sur ce monorepo pnpm, dont le
`package.json` racine n'a pas de script `start`. DOMIORA DEMO porte donc en plus deux variables :

```
RAILPACK_BUILD_CMD=pnpm install --frozen-lockfile && pnpm --filter web build
RAILPACK_START_CMD=pnpm --filter web start
```

**À surveiller sur l'instance pilote** : elle ne porte que `buildCommand`/`startCommand` au niveau
du service, sans ces deux variables. Son dernier déploiement réussi date du 2026-08-28, avec une
version antérieure de Railpack. Son prochain redéploiement pourrait donc échouer de la même façon —
constat de lecture fait pendant la création de DOMIORA DEMO, jamais vérifié en la redéployant (ce
qui serait un geste à part entière, à décider séparément).

## 2. Version déployée

- Noter ici, à chaque déploiement réel, le tag ou le hash de commit exact déployé en production
  (ex. `v1.0.0-rc1` ou `e0423f9`) et sa date. Aucun déploiement sans un identifiant exact tracé.
- `domiora-demo` : **`b32513b`**, déployé et validé le **2026-09-22** (migrations 0053, seed
  canonique, téléchargements et persistance du volume vérifiés — section 1 quater).
- `sparkling-rejoicing` : `1c92c8a` (2026-08-28), **non revérifié** depuis.

## 3. Prérequis avant tout déploiement réel

- Domaine + HTTPS réel actif.
- Postgres managé de production provisionné (distinct de tout Postgres local de dev/test).
- Volume documentaire persistant attaché (voir checklist ADR-047, section Stockage documentaire).
- Projet Google Cloud configuré (identité Atlas + Calendar/Gmail métier) — voir checklist ADR-047.
- Ensemble des variables d'environnement renseignées — voir checklist ADR-047 (ne pas la
  redupliquer ici).
- Stratégie de backup définie (section 6 ci-dessous).

## 4. Variables d'environnement (rappel des familles, valeurs dans ADR-047)

Application, Auth Atlas, Google métier, Endpoints techniques (Bearer), Stockage documentaire — noms
exacts et détail dans `apps/web/.env.local.example` et la checklist ADR-047. Aucune valeur secrète
n'est reproduite ici.

## 5. Jobs périodiques

Trois jobs déclenchés par des **Railway Functions cron** (projet `sparkling-rejoicing`,
environnement `production`, région EU West), chacune un wrapper TypeScript minimal (aucune
dépendance npm, runtime Bun fourni par Railway) qui fait un seul `fetch` POST vers DOMIORA puis se
termine (`process.exit(0)`/`process.exit(1)`) — jamais de processus/serveur laissé actif entre deux
exécutions. Sources versionnées : `ops/railway/functions/*.ts` (voir aussi
`ops/railway/functions/wrappers.test.mjs` pour les tests locaux).

| Job (Railway Function) | Route DOMIORA | Secret (`JOB_SECRET`, référence Railway vers DOMIORA) | Cron (UTC) | Résultat attendu |
|---|---|---|---|---|
| `domiora-automatisations-scan` | `POST /api/automatisations/scan` | `AUTOMATISATIONS_SCAN_SECRET` | `15 5 * * *` (quotidien) | 200, `{"execute":...}` — `false` si aucune règle `active` en base (ADR-032), normal tant qu'aucune règle n'est activée depuis `/automatisations`. |
| `domiora-automatisations-reprise` | `POST /api/automatisations/reprise` | `AUTOMATISATIONS_REPRISE_SECRET` | `17 * * * *` (horaire) | 200, `{"examinees":N,"traitees":N,"plafondAtteint":N}` — `0` partout est un résultat normal (filet de reprise, généralement no-op). |
| `domiora-compatibilite-scan` | `POST /api/compatibilite/scan` | `COMPATIBILITE_SCAN_SECRET` | `47 * * * *` (horaire) | 200, `{"demandesExaminees":N,"demandesTraitees":N,"evenementsEmis":N}` — `0` partout est un résultat normal. |

Horaires volontairement décalés (`:15`, `:17`, `:47`) pour ne jamais déclencher les trois jobs
horaires/quotidien simultanément.

`/api/compatibilite/baseline` (`COMPATIBILITE_BASELINE_SECRET`) — **jamais un cron, aucune Railway
Function créée pour cette route**, geste manuel exclusif (dry-run par défaut, `apply` refusé sur
table non vide sans confirmation explicite). Si une future Function `*baseline*` apparaît dans
`railway functions list`, c'est une anomalie de configuration à corriger, pas un état normal.

Chaque `JOB_SECRET` est une **référence Railway native** vers le secret correspondant du service
DOMIORA (ex. `JOB_SECRET -> DOMIORA.AUTOMATISATIONS_SCAN_SECRET`), jamais une copie manuelle
dupliquée — évite toute divergence si le secret DOMIORA est un jour renouvelé. Un Bearer
invalide/absent sur ces 4 endpoints doit être refusé (jamais un traitement silencieux) — vérifié
avant le premier jour de pilote (checklist ADR-047, section Validation).

### Diagnostic / run manuel

- **Lister les Functions et leurs horaires** : `railway functions list` (lecture seule).
- **Statut du dernier déploiement d'une Function** : `railway service status --service <nom> --environment production`.
- **Logs d'un run** (dernier passage, pas besoin d'en déclencher un nouveau) : `railway logs --service <nom> --environment production --lines 30`. Un run réussi affiche exactement une ligne
  `[<nom-job>] ok status=200 duree_ms=<n> resultat=<json>` ; un échec affiche
  `[<nom-job>] échec ...` sur stderr et se termine par un code de sortie non nul — jamais de secret
  ni d'en-tête `Authorization` dans ces logs (voir `ops/railway/functions/*.ts`).
- **Run manuel de validation** : déclenchable depuis l'UI Railway (bouton "Run now" sur la
  Function) — `railway functions new`/`push` en CLI a été refusé pendant la mise en place initiale
  (voir Limitation CLI ci-dessous) ; un run manuel via l'UI reste possible et a été utilisé pour
  valider les 3 jobs avant configuration définitive du cron.
- **Une Function reste "active"/ne se termine pas** : investiguer avant de relancer quoi que ce
  soit — un wrapper qui ne se termine jamais indique un problème réseau (DOMIORA injoignable) ou un
  bug du wrapper lui-même, jamais relancer en boucle sans diagnostic.
- **Piège observé pendant la mise en place** : le cron de `domiora-automatisations-scan` avait été
  temporairement réglé à `*/5 * * * *` pour faciliter son test manuel initial — vérifié remis à
  `15 5 * * *` avant la clôture du pilote. Toujours vérifier `railway functions list` après un test
  manuel pour s'assurer qu'aucun cron de test n'est resté en place.

### Limitation CLI observée (pas une propriété garantie de Railway)

Lors de la mise en place initiale, `railway functions new` (CLI, binaire `~/.railway/bin/railway`
et `npx @railway/cli`, v5.41.2) a été systématiquement refusé avec `You do not have access to this
resource`, malgré un compte confirmé Admin du workspace, une authentification propre (sans
`RAILWAY_TOKEN`/`RAILWAY_API_TOKEN` parasite) et un projet/environnement correctement résolus
(`railway status`/`whoami` fonctionnels). Toutes les opérations de lecture CLI fonctionnaient
normalement ; seule la création d'une nouvelle ressource via `functions new` échouait. Les 3
Functions ont donc été créées manuellement via l'UI Railway officielle. C'est l'incident constaté
lors de cette mise en production, pas un comportement documenté ou garanti de Railway — à
réévaluer si une prochaine Function doit être créée en CLI.

## 6. Stockage documentaire et backup

- Attacher/vérifier le volume persistant et `ATLAS_DOCUMENT_STORAGE_DIR` — voir checklist ADR-047.
- **Un volume persistant n'est pas une sauvegarde.** Recommandation pilote (échelle mono-conseiller,
  faible volume) : procédure **manuelle documentée**, pas un moteur de backup automatisé —
  export périodique `pg_dump` (voir `docs/PROCEDURE_MIGRATION_PRODUCTION.md#3-sauvegarde-avant-migration-non-négociable`
  pour la commande) + copie périodique du contenu du volume documentaire, fréquence à définir par
  l'exploitant (ex. hebdomadaire) et à formaliser si l'usage grandit après le pilote.
- Test de validation exact à faire une fois en conditions réelles (non exécutable depuis cet audit,
  aucun accès Railway) : uploader un document réel → redéployer le service → retélécharger le même
  document → comparer les octets/le SHA-256 → régénérer un Pack Notaire → vérifier que l'historique
  des transmissions (ADR-049) reste intact après le redéploiement.

### Validation pilote — backup et restore réels (2026-08-21)

Backup et restore réels effectués et vérifiés sur le projet Railway `sparkling-rejoicing`
(environnement `production`, service `Postgres` PostgreSQL 18.6). Restauration systématiquement
locale/jetable — jamais sur la production.

**Procédure backup DB** — `pg_dump` exécuté directement sur le service `Postgres` via
`railway ssh --service Postgres` (évite d'exposer `DATABASE_URL` localement) :

```
pg_dump "$DATABASE_URL" --format=custom --no-owner -f domiora-prod-<horodatage>.dump
```

Dump téléchargé vers un poste local via `railway ssh --service Postgres -- cat <dump> > ...`,
intégrité vérifiée par comparaison SHA-256 avant/après transfert, puis fichier temporaire supprimé
du conteneur `Postgres` une fois le téléchargement confirmé.

**Procédure restore DB** — instance PostgreSQL 18 locale et jetable via Docker
(`docker run postgres:18`, base `domiora_restore_test`, aucun lien réseau vers la production),
restauration avec `pg_restore --no-owner --exit-on-error`. Comparaison des counts avant/après :
29 tables (`public`), 30 migrations (`drizzle.__drizzle_migrations`), et les tables métier
(`biens`, `acquereurs`, `taches`, `documents_bien`, `connexions_google`, `envois_email`)
identiques entre la production (lecture seule) et la base restaurée. Contraintes (74) et index
(50) présents après restauration. Conteneur Docker supprimé après validation (jetable par
construction).

**Procédure backup documents** — archive `tar.gz` du contenu de
`ATLAS_DOCUMENT_STORAGE_DIR` (`/data/stockage-documents`) créée directement sur le service
`DOMIORA` via `railway ssh --service DOMIORA` (répertoire `lost+found` exclu, vide, artefact
ext4), sans modification des documents existants. Téléchargée puis vérifiée par SHA-256, fichier
temporaire supprimé du conteneur une fois le téléchargement confirmé.

**Procédure restore documents** — extraction locale dans un dossier jetable
(`~/domiora-restore-test/documents/`). Nombre de fichiers, taille et SHA-256 du document de test
identiques entre la source et le fichier restauré.

**Emplacements locaux** : sauvegardes conservées dans `~/domiora-backups/railway/` (jamais
committées dans Git). Répertoire de restauration jetable : `~/domiora-restore-test/`.

**Contrôles SHA-256** : appliqués systématiquement à chaque étape (dump avant/après transfert,
archive documents avant/après transfert, document restauré vs hash de référence).

**Fréquence/recommandation opérationnelle** : à l'échelle mono-conseiller du pilote, un export
manuel hebdomadaire (DB + documents) est suffisant ; formaliser un automatisme si l'usage
grandit après le pilote (voir aussi le rappel ci-dessus : un volume Railway persistant n'est pas
une sauvegarde).

**Rappel** : toute restauration doit systématiquement être testée dans un environnement isolé
avant toute procédure de crise réelle — ne jamais restaurer directement sur la production.

## 7. Séquence de déploiement

Séquence destinée à la **production de Steven** (`sparkling-rejoicing`, branche `main`) : elle
suppose une mission de promotion explicite, jamais un lot `develop` courant (section 0). Un
déploiement `domiora-demo` ne suit pas cette séquence — il découle automatiquement d'un push sur
`develop`.

1. Vérifier le commit/tag à déployer (section 2).
2. Sauvegarde (`docs/PROCEDURE_MIGRATION_PRODUCTION.md`, étape 3).
3. Migration (`docs/PROCEDURE_MIGRATION_PRODUCTION.md`, étapes 4-5).
4. Déploiement du code.
5. Vérification post-déploiement :
   - [ ] Connexion réelle (`/connexion` → Google → session) fonctionne.
   - [ ] Cockpit (`/`) répond sans erreur 500.
   - [ ] Un document existant se télécharge toujours (stockage intact).
   - [ ] Les 3 jobs répondent 200 au prochain déclenchement.
   - [ ] Google Calendar/Gmail toujours connectés (ou reconnexion possible si révoqués).

## 8. Rollback

### Rollback DOMIORA DEMO

- **Base** : restaurer le `pg_dump --format=custom` pris avant migration
  (`pg_restore --clean --if-exists`). Les données étant fictives, l'alternative normale est plus
  simple : rejouer le seed (`recree`), qui remet le dataset canonique en place.
- **Code** : redéployer le déploiement Railway précédent depuis l'interface, ou `railway deployment
  redeploy -s domiora-demo` sur le déploiement voulu.
- **Stockage** : **aucune sauvegarde du volume documentaire n'est faite**. Ne pas prétendre le
  contraire. Les fixtures du seed sont déterministes et recréées à chaque exécution du seed ; tout
  fichier déposé manuellement pendant une démonstration, lui, serait définitivement perdu.

### Rollback code

Revenir au commit/tag précédemment déployé (section 2) — **sûr uniquement si ce commit précédent
est compatible avec le schéma de base actuellement en place**. Si la migration la plus récente a
supprimé/renommé une colonne que l'ancien code attend, un rollback code seul ne suffit pas : la
base doit alors aussi être restaurée (rollback données) ou la migration compensée manuellement.
Ne jamais supposer qu'un rollback code est automatiquement sûr sans avoir vérifié cette
compatibilité.

### Rollback données

Restauration du `pg_dump` réalisé avant la migration (`docs/PROCEDURE_MIGRATION_PRODUCTION.md`,
étape 3) — geste lourd (perte de toute donnée créée depuis la sauvegarde), jamais automatique,
réservé aux cas où le rollback code seul ne suffit pas. Décision qui revient à l'exploitant, jamais
déclenchée par défaut.

## 9. Incidents simples

| Symptôme | Piste de diagnostic |
|---|---|
| Atlas inaccessible | Logs de la plateforme d'hébergement + état du service (crash, redémarrage en boucle). |
| Login impossible | Vérifier `GOOGLE_ATLAS_REDIRECT_URI` et son enregistrement exact côté Google Cloud Console ; vérifier `ATLAS_ALLOWED_EMAIL`. |
| Documents en erreur 503 | Volume détaché, `ATLAS_DOCUMENT_STORAGE_DIR` absente/incorrecte, ou permissions insuffisantes — voir checklist ADR-047, section Stockage documentaire. |
| Jobs inactifs / non déclenchés | Vérifier la configuration du scheduler externe (aucun cron interne à Atlas) et la validité des secrets Bearer. |
| Google déconnecté (Calendar/Gmail) | Vérifier le badge de connexion sur `/` ; reconnexion via les liens `/api/auth/google/login` — la révocation Google est globale (Calendar + Gmail), voir `docs/KNOWN_LIMITATIONS.md`. |

Pas de système d'observabilité complexe en V1 — ces vérifications reposent sur les logs de la
plateforme d'hébergement et un contrôle manuel direct, cohérent avec un pilote à un seul
utilisateur actif qui constate lui-même une anomalie.

## 10. Code freeze (à partir de la validation V1 Candidate)

Aucune nouvelle fonctionnalité produit. Seules les catégories suivantes restent autorisées :
correction de bug, sécurité, stabilité, configuration pilote, correction fermant explicitement un
item des checklists V1 Candidate / Pilote réel. Toute évolution produit repasse post-pilote (voir
`docs/KNOWN_LIMITATIONS.md` pour la liste POST-V1).
