# Atlas — `apps/web`

> **Nouvel ingénieur ?** La porte d'entrée canonique est
> [`docs/DEVELOPER_ONBOARDING.md`](../../docs/DEVELOPER_ONBOARDING.md) — ce document reste une
> référence bootstrap plus détaillée (variables d'environnement, connexion Google, routes).

Pour la vision produit, voir le [`README.md` racine](../../README.md). Pour la documentation
technique approfondie, voir [`docs/`](../../docs/README.md) (architecture, modèle de données,
règles métier, parcours, mode démo vs réel, décisions architecturales, limites connues, changelog).

## Qu'est-ce qu'Atlas ?

Atlas est un compagnon quotidien pour les conseillers immobiliers : il centralise l'agenda, les
biens, les acquéreurs et les actions à faire, prépare les visites avec des données réelles
(transports, écoles, commerces, patrimoine, marché), et garde la mémoire de ce qui a déjà été dit
ou fait sur un dossier (notes, comptes rendus de visite, historique). Vision produit complète :
[`README.md` racine](../../README.md).

**Ce module (`apps/web`)** est aujourd'hui l'intégralité du code applicatif : Next.js, base de
données, moteur de matching, tout y vit — voir `docs/ARCHITECTURE.md` pour le détail (et la
section "Architecture actuelle vs cible historique", qui distingue le code construit des
décisions d'architecture encore à l'état de cible).

## Stack technique

- **Framework** : Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript
  strict.
- **Base de données** : PostgreSQL, accédée via [Drizzle ORM](https://orm.drizzle.team/).
- **Styling** : Tailwind CSS 4.
- **Tests** : Vitest.
- **Monorepo** : Turborepo + pnpm workspaces (racine du repo) — un seul workspace actif pour
  l'instant, `apps/web`.

## Architecture du monorepo

```
atlas/
├── apps/
│   └── web/          ← ce module (tout le code applicatif actuel)
├── docs/
│   ├── adr/           Décisions architecturales (001 à 013)
│   └── *.md            Architecture, modèle de données, règles métier, parcours, etc.
├── infra/
│   └── docker-compose.yml   Postgres local
├── turbo.json
└── pnpm-workspace.yaml
```

`apps/api` et `apps/worker` (backend Python, connecteurs) sont évoqués dans les ADR 003/004/005
comme architecture cible, mais **n'existent pas** dans le code aujourd'hui — voir
`docs/ARCHITECTURE.md`.

## Prérequis

- Node.js ≥ 20
- pnpm (`packageManager: "pnpm@10.34.5"` dans `package.json`)
- Docker (pour Postgres local) — ou un Postgres accessible autrement

## Installation

Depuis la racine du monorepo :

```bash
pnpm install
```

## Base de données

L'app a besoin d'un Postgres accessible **même en mode démo** : la connexion Google Calendar est
un fait serveur stocké en base (`connexions_google`) — `getAgendaSemaine()` interroge la base
avant même de décider d'utiliser les mocks. Voir `docs/adr/006-memory-architecture.md` pour le
détail des choix, `docs/DATA_MODEL.md` pour le schéma complet.

### 1. Démarrer Postgres localement

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 2. Copier et renseigner les variables d'environnement

```bash
cp .env.local.example .env.local
```

Voir la section [Variables d'environnement](#variables-denvironnement) ci-dessous pour le détail
de chaque valeur à renseigner. `.env.local` n'est jamais commité (`.gitignore`).

### 3. Appliquer les migrations

```bash
pnpm db:migrate
```

Les fichiers SQL sont dans `src/db/migrations/` et commités — **c'est ce SQL, pas le schéma
Drizzle (`src/db/schema.ts`), qui fait foi du schéma physique**. Après une modification de
`schema.ts`, régénérer une migration avec :

```bash
pnpm db:generate
```

## Variables d'environnement

Toutes déclarées (noms uniquement) dans `.env.local.example`. **Aucune valeur ne doit jamais être
commitée ou partagée dans un document.**

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion Postgres (locale par défaut : `postgresql://atlas:atlas@localhost:5432/atlas`, cohérente avec `infra/docker-compose.yml`) |
| `GOOGLE_CLIENT_ID` | Identifiant client OAuth Google Calendar |
| `GOOGLE_CLIENT_SECRET` | Secret client OAuth Google Calendar |
| `GOOGLE_REDIRECT_URI` | URI de redirection OAuth (doit correspondre exactement à la configuration Google Cloud Console) |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Clé AES-256 (32 octets, base64) pour chiffrer le refresh token Google stocké en base — générer avec `openssl rand -base64 32` |
| `PRIM_API_KEY` | Clé API PRIM / Île-de-France Mobilités (transports à proximité) — inscription gratuite sur [prim.iledefrance-mobilites.fr](https://prim.iledefrance-mobilites.fr), abonnement à l'API "Navitia - Calcul d'itinéraire" |

Les autres services de données externes (géocodage IGN, Vélib', annuaire Éducation nationale,
Overpass/OpenStreetMap, base Mérimée, DVF) ne nécessitent **aucune** clé — voir
`docs/ARCHITECTURE.md#services-externes-réellement-utilisés`.

## Lancer l'application

```bash
pnpm dev
```

Ouvrir [http://localhost:3000](http://localhost:3000). Sans connexion Google configurée, l'app
fonctionne normalement en mode démo (données mockées) tant que Postgres est démarré.

## Tests, typecheck, build

```bash
npx tsc --noEmit -p tsconfig.json   # typecheck
pnpm test                            # vitest run
pnpm build                           # build de production
```

**`pnpm test` nécessite un Postgres local démarré et migré** : plusieurs suites sont des tests
d'intégration réels sur la base (`actionRepository.test.ts`, `noteBienRepository.test.ts`,
`compteRenduVisiteRepository.test.ts`, `documentBienRepository.test.ts`) — elles ne mockent jamais
la base de données, elles créent et nettoient leurs propres lignes de test.

## Connexion Google Calendar

L'écran "Aujourd'hui" peut afficher les vrais rendez-vous du conseiller depuis Google Calendar
(lecture seule) au lieu des données de démonstration. Sans connexion configurée, l'app continue de
fonctionner normalement avec les mocks (à condition que Postgres soit démarré).

### 1. Créer les credentials OAuth dans Google Cloud Console

1. Aller sur [console.cloud.google.com](https://console.cloud.google.com), créer un projet (ou en
   sélectionner un existant).
2. **Activer l'API** : *APIs & Services > Library*, rechercher "Google Calendar API", *Enable*.
3. **Configurer l'écran de consentement** : *APIs & Services > OAuth consent screen*.
   - Type d'utilisateur : *External* (ou *Internal* pour un compte Google Workspace).
   - Nom d'application et email de support.
   - Scope : `https://www.googleapis.com/auth/calendar.events.readonly`.
   - *Test users* : ajouter l'adresse Gmail du conseiller (obligatoire en mode *Testing*, jusqu'à
     100 utilisateurs de test, aucune validation Google requise dans ce mode).
4. **Créer les identifiants** : *APIs & Services > Credentials > Create Credentials > OAuth client
   ID*, type *Web application*, *Authorized redirect URIs* :
   `http://localhost:3000/api/auth/google/callback` (adapter le domaine en production). Récupérer
   le **Client ID** et le **Client Secret**.

### 2. Renseigner `.env.local`

Voir [Variables d'environnement](#variables-denvironnement) — `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY`.

### 3. Procédure de test local

1. `pnpm dev`, ouvrir [http://localhost:3000](http://localhost:3000).
2. Sans connexion : l'écran Aujourd'hui affiche les rendez-vous mockés avec l'indicateur *"Source
   : Données de démonstration"* et un lien *"Connecter Google Calendar"*.
3. Cliquer sur ce lien, valider le consentement Google (mention "accès non vérifié" normale en
   mode *Testing* — cliquer *Continuer*).
4. Après redirection, l'indicateur passe à *"Source : Google Calendar"*.
5. Un événement de test créé aujourd'hui (avec heure et lieu) doit apparaître avec le badge
   générique "Événement". Un événement "toute la journée" affiche "Toute la journée" au lieu
   d'une heure. Un événement annulé/supprimé disparaît après rafraîchissement.
6. *"Déconnecter"* revient à l'indicateur "Données de démonstration".
7. Pour tester le cas d'erreur : se reconnecter, révoquer l'accès depuis
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions) sans cliquer
   "Déconnecter" dans Atlas, puis recharger : l'indicateur doit afficher *"Google Calendar
   indisponible — données de démonstration affichées"* avec un lien *"Se reconnecter"*.

Pour observer la priorité "validation humaine > cache > moteur de matching" (mémoire persistée),
voir la procédure détaillée dans `docs/BUSINESS_RULES.md#mémoire-contextuelle-du-matching-priorité-de-résolution`.

## Principales routes

| Route | Rôle |
|---|---|
| `/` | Accueil — agenda du jour + à venir, actions prioritaires |
| `/dashboard` | Tableau de bord commercial — résultats, pipeline, activité, délais/pertes, agrégés côté SQL (voir ADR-018) |
| `/biens`, `/biens?archives=1`, `/biens/nouveau`, `/biens/[id]`, `/biens/[id]/modifier` | Liste active / archivée, création, fiche bien (onglets Contexte/Historique/Notes/Visites/Documents/Actions), édition — édition et archivage réservés à un bien réel |
| `/clients`, `/clients?archives=1`, `/clients/nouveau`, `/clients/[id]`, `/clients/[id]/modifier` | Liste active / archivée, création, fiche acquéreur, édition — édition et archivage réservés à un acquéreur réel |
| `/actions/nouveau` | Création d'une action (préremplissable via `?bienId=`/`?acquereurId=`) |
| `/visites/[id]/preparer` | Préparation de visite + formulaire de compte rendu après la visite |
| `/api/auth/google/{login,callback,logout}` | Flux OAuth Google Calendar |
| `/api/documents/[id]` | Téléchargement d'un document réel attaché à un bien (lecture seule, voir ADR-013) |

## Où commencer pour comprendre le code

1. **`docs/ARCHITECTURE.md`** — vue d'ensemble, y compris ce qui est construit vs ce qui reste une
   cible dans les ADR.
2. **`src/app/page.tsx`** — l'accueil, point d'entrée le plus représentatif : agenda, matching,
   actions, tout y converge.
3. **`src/lib/matching/index.ts`** puis **`src/lib/contexteRepository.ts`** — comment un
   rendez-vous devient un bien/acquéreur résolu, et comment cette résolution est mémorisée.
4. **`src/app/visites/[id]/preparer/page.tsx`** — la page la plus riche, assemble à peu près tous
   les modules du projet (matching, moteurs de règles, services externes, mémoire du dossier).
5. **`docs/DATA_MODEL.md`** et **`src/db/schema.ts`** — le schéma réel.
6. **`docs/adr/`** — le *pourquoi* des choix structurants, notamment 006 (mémoire/mono-conseiller),
   007 (repositories), 008 (pas de LLM), 009 (`NULL ≠ false`).

Si un agent IA reprend ce projet : lire **`docs/AI_HANDOFF.md`** en premier.
