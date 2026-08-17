# Onboarding développeur — Atlas

Porte d'entrée canonique pour tout ingénieur qui rejoint Atlas. Ce document ne remplace aucun des
documents spécialisés existants — il explique comment entrer dans le projet et renvoie vers eux.
Voir `docs/README.md` pour l'index complet.

---

## Partie 1 — Atlas en 5 minutes

### Ce qu'est Atlas

Logiciel métier pour conseiller immobilier : suit un dossier de la prospection vendeur jusqu'à la
vente, prépare les visites, garde la mémoire de ce qui a été dit/fait, et propose chaque jour au
conseiller les actions qui comptent. Vision produit complète (ton commercial) : `README.md` racine.

### Ce qu'Atlas couvre aujourd'hui (V1)

Le tunnel métier réel, dans l'ordre :

```
Prospect vendeur → Bien → Acquéreur → compatibilité → visite → compte rendu
→ Offre → Compromis → acte → vente → rémunération
```

En parallèle :

```
Documents → Pack Notaire → transmission notariale déclarative → historique
```

```
événements métier → automatisations → tâches → cockpit « Aujourd'hui »
```

Chaque brique correspond à une ou plusieurs ADR (`docs/adr/`) — le détail métier exact de chacune
vit dans `docs/BUSINESS_RULES.md`, jamais reproduit ici.

### Ce qu'Atlas n'est pas

- **Multi-utilisateur** — une seule adresse autorisée (`ATLAS_ALLOWED_EMAIL`), mono-conseiller par
  construction (ADR-006/047).
- **Un CRM/une GED de notaire** — Atlas ne gère aucune entité Notaire/Étude, ne transporte aucun
  fichier vers un tiers, ne détient aucun portail externe.
- **Un moteur IA** — règles déterministes uniquement (ADR-008), aucun LLM, aucun scoring.
- **Un remplacement de Playiad** ni un outil déclarant un dossier juridiquement complet — les
  checklists documentaires sont un vocabulaire produit, pas un référentiel légal.

Détail exhaustif des limites volontaires : `docs/KNOWN_LIMITATIONS.md`. **Une absence listée
là n'est presque jamais un oubli — c'est un choix de scope.** Avant de "corriger" quelque chose qui
semble manquant, vérifier que ce n'est pas déjà documenté comme volontaire.

### Stack technique réelle

- Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript strict.
- PostgreSQL via Drizzle ORM.
- Vitest (tests unitaires + intégration Postgres réelle).
- Playwright (2 smoke E2E seulement).
- `iron-session` (session Atlas), Google OAuth (identité Atlas + Calendar/Gmail métier, deux flux
  distincts).
- Stockage documentaire filesystem, chemin configurable (`ATLAS_DOCUMENT_STORAGE_DIR`).
- Turborepo + pnpm workspaces (un seul workspace applicatif actif : `apps/web`).

Détail complet et à jour, avec versions : `apps/web/package.json`. Ne pas dupliquer ici.

---

## Partie 2 — Premier démarrage

Séquence vérifiée dans cet environnement (commandes réellement exécutées, pas devinées).

### Prérequis

- Node.js ≥ 20 (`package.json` racine, champ `engines`).
- pnpm `10.34.5` (`packageManager` dans `package.json`).
- Docker (Postgres local via `infra/docker-compose.yml`) — ou un Postgres accessible autrement.
- Pour Playwright uniquement : Chromium se télécharge via `npx playwright install chromium`: sur
  Linux sans les bibliothèques système déjà présentes, il faut aussi les dépendances partagées
  Chromium (`libnspr4`, `libnss3`, etc.) — `npx playwright install --with-deps chromium` les
  installe si l'environnement le permet.

### Fresh clone

```bash
git clone <repo>
cd atlas
pnpm install                                   # depuis la racine du monorepo

docker compose -f infra/docker-compose.yml up -d   # Postgres local (base "atlas")

cp apps/web/.env.local.example apps/web/.env.local
# renseigner les valeurs — voir Partie 5, section "Variables d'environnement"

cd apps/web
pnpm db:migrate                                # applique src/db/migrations/ sur DATABASE_URL

pnpm dev                                       # http://localhost:3000
```

Sans configuration Google, l'app fonctionne normalement en mode démo (données mockées) tant que
Postgres est démarré — voir `docs/DEMO_VS_REAL.md`.

### Lancer les tests

```bash
cd apps/web

# Base de test dédiée (une seule fois) :
docker exec <conteneur-postgres> psql -U atlas -d atlas -c "CREATE DATABASE atlas_test;"
DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlas_test pnpm db:migrate

pnpm test          # vitest run — utilise atlas_test automatiquement, jamais la base de dev
pnpm test:e2e      # 2 smoke Playwright — démarre son propre serveur Next.js dédié (port 3100)
```

**`pnpm test` ne peut jamais utiliser implicitement une `DATABASE_URL` de production** même si elle
traîne dans le shell — voir Partie 4, section Base de données. C'est un garde-fou, pas une
convention à respecter manuellement.

### Build et typecheck

```bash
npx tsc --noEmit -p tsconfig.json
pnpm build
```

---

## Partie 3 — Architecture

### Vue d'ensemble

```mermaid
flowchart TD
    Browser["Navigateur / UI Next.js"] --> Proxy["Proxy (src/proxy.ts)
    PRIVATE BY DEFAULT — session Atlas"]
    Proxy --> Surface["Pages Server Components
    Server Actions (src/actions)
    Route Handlers (src/app/api)"]
    Surface --> Guard["exigerSessionAtlas()
    2e couche — protège CHAQUE Server Action
    /Route Handler, le Proxy seul ne suffit pas"]
    Guard --> Lib["src/lib — règles métier,
    moteurs déterministes, clients externes"]
    Surface --> GoogleAuth["Google OAuth
    identité Atlas (ADR-047) ≠
    Calendar/Gmail métier"]
    Lib --> Repo["Repositories
    src/lib/*Repository.ts
    SEULS fichiers autorisés à importer src/db/*"]
    Repo --> PG[(PostgreSQL)]

    Lib --> Docs["Documents (documents_bien)
    stockage filesystem
    ATLAS_DOCUMENT_STORAGE_DIR"]
    Docs --> Pack["Pack Notaire — ZIP à la demande,
    jamais persisté"]
    Pack --> Transmission["Transmission déclarative (ADR-049)
    Atlas n'envoie jamais le fichier"]

    Lib --> Evt["Événements métier
    (evenements_metier, append-only)"]
    Evt --> Auto["Automatisations
    (executions_automatisation)"]
    Auto --> Taches["Tâches (taches)"]
    Taches --> Cockpit["Cockpit « Aujourd'hui »"]
```

Ce diagramme est conceptuel — le détail exact du chemin d'une mutation (formulaire → Server Action
→ repository → Postgres → revalidation) est déjà dans `docs/ARCHITECTURE.md#flux-général--ui--server-action--repository--postgresql`,
avec son propre schéma Mermaid. Ne pas le reproduire ici.

### Carte du repository

| Dossier | Responsabilité |
|---|---|
| `src/app/` | Pages (Server Components) et Route Handlers — App Router, une arborescence par domaine (`biens/`, `clients/`, `compromis/`, `taches/`, `visites/`, `prospects-vendeurs/`, `api/`). |
| `src/actions/` | Server Actions (`"use server"`) — minces par convention (ADR-007), toujours protégées par `exigerSessionAtlas()` en première ligne. |
| `src/lib/` | Cœur métier : repositories (I/O Postgres), moteurs de règles purs, clients de services externes, moteur de matching, automatisations. |
| `src/db/` | `schema.ts` (Drizzle, source structurelle), `migrations/` (SQL commité, fait foi), `client.ts` (connexion), `resoudreDatabaseUrlTest.ts` (garde test/production). |
| `src/components/` | UI React, organisée par domaine (`bien/`, `client/`, `compromis/`, `documents/`, `aujourd-hui/`, `ui/`). |
| `src/types/` | Types métier partagés, un fichier par domaine. |
| `src/data/` | Données mockées (mode démo) — voir `docs/DEMO_VS_REAL.md`. |
| `e2e/` | Smoke Playwright (2 scénarios seulement) — jamais exécutés par `pnpm test`. |
| `docs/adr/` | Décisions d'architecture, numérotées, jamais renumérotées ni réécrites rétroactivement. |

**Règle observée dans tout le code** : seuls les fichiers `src/lib/*Repository.ts` (+
`contexteRepository.ts`) importent `@/db/*`. Une nouvelle fonctionnalité qui a besoin de lire/écrire
en base passe par un repository existant ou en crée un nouveau — jamais un accès direct à Drizzle
depuis une action, une page ou un composant.

### Le client n'est jamais la source de vérité

Chaque mutation revalide côté serveur ce que le client prétend : un id de Bien/Acquéreur/Offre
soumis par un formulaire est toujours relu en base avant d'agir, jamais fait confiance tel quel.
Exemple représentatif : `enregistrerTransmissionDossierNotaireAction` (ADR-049) relit intégralement
le Compromis, le Bien, la sélection de documents et leur taille avant tout `INSERT` — voir
`docs/BUSINESS_RULES.md#traçabilité-des-transmissions-du-pack-notaire-adr-049`.

---

## Partie 4 — Comment travailler sans casser les invariants

### Règles de sécurité à ne jamais casser

1. **Private by default** (ADR-047) — toute page/route exige une session Atlas valide, sauf
   `/connexion` et le flux d'identité lui-même.
2. **Auth Atlas ≠ autorisations Google métier** — `sessionAtlas.ts` (identité, jamais de token)
   est strictement distinct de `src/lib/google/connexion.ts` (Calendar/Gmail, refresh tokens
   chiffrés).
3. **Toute Server Action exportée sous `src/actions/*.ts` doit commencer par
   `await exigerSessionAtlas();`** — vérifié par analyse AST (`gardeSessionAtlas.structurel.test.ts`),
   pas par convention seule. Le Proxy ne protège **jamais** les Server Actions à lui seul.
4. **Tout Route Handler utilisateur** (pas machine) doit appeler `exigerSessionAtlas()`/
   `refuserSiSessionAtlasAbsente()` en première ligne.
5. **Les endpoints machine** (`/api/automatisations/scan`, `/api/automatisations/reprise`,
   `/api/compatibilite/scan`, `/api/compatibilite/baseline`) utilisent chacun leur propre secret
   Bearer, indépendant du Proxy — jamais partagé entre eux.
6. **Aucun document n'est jamais exposé via une URL publique** — `/api/documents/[id]` exige une
   session.
7. **Jamais logger un secret, un token, une session ou le contenu d'un document sensible.**
8. **`ATLAS_ALLOWED_EMAIL` reste une allowlist à une seule adresse** — ne jamais y ajouter un
   notaire ou un second utilisateur sans repasser par une vraie décision d'architecture (ADR).
9. **Jamais de bypass d'authentification via `NODE_ENV=test`** — y compris dans l'infrastructure
   E2E (`e2e/session.ts` scelle une vraie session avec les vraies primitives `iron-session`).
10. **Les tests utilisent une base explicitement dédiée**, jamais implicitement la base de
    production — voir section Base de données ci-dessous.

Référence complète : ADR-047 (`docs/adr/047-securisation-pilote-mono-conseiller.md`).

### Base de données

`DATABASE_URL` (application) ≠ `ATLAS_TEST_DATABASE_URL` (tests). La suite Vitest résout sa propre
connexion via `src/db/resoudreDatabaseUrlTest.ts` (appelé par `vitest.setup.ts` avant le chargement
de chaque fichier de test) : une `DATABASE_URL` déjà présente dans le shell — même de production —
n'est **jamais** utilisée par la suite. Par défaut, repli sur une base locale dédiée
(`postgresql://atlas:atlas@localhost:5432/atlas_test`), à créer et migrer une fois (Partie 2).

Migrations locales : `pnpm db:migrate` (lit `DATABASE_URL`). Après une modification de
`src/db/schema.ts`, régénérer avec `pnpm db:generate` — c'est le SQL commité dans
`src/db/migrations/`, pas `schema.ts`, qui fait foi du schéma physique.

**Production** : procédure dédiée, jamais improvisée — `docs/PROCEDURE_MIGRATION_PRODUCTION.md`.

### Stockage documentaire

Les métadonnées d'un document vivent dans `documents_bien` (Postgres) ; les octets vivent sur
filesystem, chemin lu **uniquement** dans `src/lib/stockageDocuments.ts`
(`ATLAS_DOCUMENT_STORAGE_DIR`). En local, un repli automatique existe si la variable est absente.
En production, un chemin absolu préexistant sur un volume persistant est obligatoire — fail-closed
explicite, jamais de création automatique de la racine. **Un volume persistant n'est pas une
sauvegarde** — voir ADR-050 et `docs/PILOT_RUNBOOK.md`.

### Tests

- **Vitest** — mélange de tests purs et de tests d'intégration Postgres réelle (jamais mockée). La
  RC1 (`v1.0.0-rc1`) a été validée avec 1198 tests Vitest, 100 % verts sur 3 exécutions complètes
  consécutives — ce nombre évoluera, ne pas le considérer figé.
- **Playwright** — exactement 2 smoke E2E, jamais une suite étendue :
  - `e2e/coeur.smoke.spec.ts` — prouve le câblage réel navigateur → Proxy → session → SSR →
    Server Action → Postgres (session sans cookie → `/connexion`, création Bien/Acquéreur/Compromis,
    déconnexion réelle).
  - `e2e/documents-adr049.smoke.spec.ts` — prouve le parcours documentaire complet en navigateur
    (upload, téléchargement ZIP du Pack, enregistrement de transmission, historique, manifeste).
  - Jamais exécutés par `pnpm test`, jamais dans une CI (absente à ce jour).

### Definition of Done d'une modification

- [ ] Règle métier comprise (BUSINESS_RULES.md et/ou ADR pertinente lue).
- [ ] Validation serveur conservée (le client ne devient jamais source de vérité).
- [ ] Garde d'authentification conservée si la zone touchée en dépend.
- [ ] Invariant repository/DB respecté (contrainte SQL, garde applicative, append-only...).
- [ ] Tests ciblés ajoutés/adaptés.
- [ ] Tests de non-régression du domaine touché passants.
- [ ] Suite complète (`pnpm test`) passée si le changement touche une zone partagée.
- [ ] `pnpm build` propre.
- [ ] Smoke E2E rejoué si le câblage navigateur (auth, formulaire critique) est concerné.
- [ ] Documentation mise à jour si le comportement documenté change.
- [ ] Migration documentée si le schéma change.
- [ ] Données de test nettoyées (aucune ligne `[test réel]`/`[E2E:...]` orpheline).
- [ ] `git status` propre avant de proposer la modification.

### Invariants à ne jamais "simplifier" sans lire l'ADR d'abord

| Invariant | Lire d'abord |
|---|---|
| Un critère de compatibilité inconnu devient `a_verifier`, jamais traité comme incompatible | ADR-034, `docs/BUSINESS_RULES.md#compatibilité-bien--acquéreur-adr-034` |
| `budgetMin` n'a **aucune** sémantique dans le moteur de compatibilité (décision explicite) | ADR-034 |
| Aucun score/pondération de compatibilité — statut global uniquement (`compatible`/`a_verifier`/`incompatible`) | ADR-034 |
| Un seul Compromis `en_cours` par Bien à la fois (garde applicative, pas une contrainte SQL) | ADR-016, `docs/BUSINESS_RULES.md#compromis-structuré` |
| Le Compromis est le pivot du dossier notarial — aucune entité Notaire/Étude, destinataire snapshoté à chaque transmission | ADR-049 |
| Le ZIP du Pack Notaire n'est jamais persisté — généré à la demande, aucune reprise partielle possible | ADR-030 |
| La transmission notariale est **déclarative** en V1 — Atlas n'envoie jamais le fichier lui-même | ADR-049 |
| Une transmission enregistrée est immuable — snapshot SHA-256 jamais recalculé, jamais modifiable | ADR-049 |
| Un document `rejete` est toujours exclu du Pack — jamais inclus, même sélectionné manuellement | ADR-029/030 |
| Un document `douteux`/`non_verifie` n'est jamais auto-sélectionné dans le Pack | ADR-029/030 |
| Un événement métier référencé ne peut jamais être supprimé (`NO ACTION`) — trace d'audit append-only | ADR-032 |
| Les automatisations sont idempotentes (index unique partiel, `ON CONFLICT DO NOTHING`) — jamais de double exécution/tâche | ADR-032 |
| La baseline de compatibilité (`/api/compatibilite/baseline`) est un geste manuel explicite — **jamais** un cron | ADR-036, `docs/KNOWN_LIMITATIONS.md` |
| La tâche « nouveau match » ne se duplique jamais tant que la précédente reste ouverte pour la même paire | ADR-037 |
| Archiver n'est jamais supprimer — `UPDATE` d'un timestamp, jamais un `DELETE` | ADR-012 |

Ces 15 invariants sont vérifiés contre le code/la documentation réels au moment de la rédaction —
ne pas les recopier aveuglément dans une future passe sans revérifier.

---

## Partie 5 — Où trouver l'information

### Hiérarchie documentaire

| Document | Répond à |
|---|---|
| `docs/DEVELOPER_ONBOARDING.md` (ce document) | Comment entrer dans le projet |
| `docs/BUSINESS_RULES.md` | Ce que le métier exige, règle par règle |
| `docs/DATA_MODEL.md` | Comment les données sont structurées |
| `docs/ARCHITECTURE.md` | Le flux technique détaillé (UI → Action → Repository → DB) |
| `docs/FLOWS.md` | Quelques parcours utilisateur bout en bout |
| `docs/DEMO_VS_REAL.md` | Comment la bascule mock/réel fonctionne |
| `docs/adr/*.md` | Pourquoi une décision a été prise, une par sujet |
| `docs/KNOWN_LIMITATIONS.md` | Ce qui est volontairement absent/incomplet |
| `docs/AI_HANDOFF.md` | État synthétique pour une reprise assistée (agent IA ou humain pressé) |
| `docs/PILOT_RUNBOOK.md` | Comment exploiter la V1 Candidate en pilote |
| `docs/PROCEDURE_MIGRATION_PRODUCTION.md` | Comment migrer la base de production |
| `docs/CHANGELOG_V1.md` | Ce qui a été livré, étape par étape |
| `CONTRIBUTING.md` | Workflow Git, conventions, Definition of Done |

Index cliquable : `docs/README.md`.

### Matrice « si tu touches X, lis d'abord Y »

| Zone touchée | ADR à lire |
|---|---|
| Compatibilité Bien ↔ Acquéreur | ADR-034, 035, 036, 037 |
| Automatisations / événements / tâches automatiques | ADR-032, 033, 036, 037, 038 |
| Visites (cycle de vie, préparation, suivi) | ADR-040, 041, 042, 043 |
| Offres | ADR-044 |
| Compromis | ADR-045, 046 |
| Documents (dossier documentaire, checklist) | ADR-029, 050 |
| Pack Notaire / transmissions | ADR-030, 049, 050 |
| Authentification / session / sécurité pilote | ADR-047 |
| Recherche / pagination | ADR-048 |
| Release / E2E / exploitation pilote | `docs/PILOT_RUNBOOK.md`, `docs/PROCEDURE_MIGRATION_PRODUCTION.md`, ce document (Partie 4, section Tests) |

### Variables d'environnement (catégories)

Liste exhaustive et à jour (noms uniquement, jamais de valeur) : `apps/web/.env.local.example`.
Aucune valeur n'est jamais recopiée dans un document.

| Catégorie | Exemples de variables |
|---|---|
| Dev local | `DATABASE_URL` |
| Tests | `ATLAS_TEST_DATABASE_URL` (voir `apps/web/.env.test.example`) |
| Auth Atlas | `ATLAS_ALLOWED_EMAIL`, `ATLAS_SESSION_PASSWORD`, `GOOGLE_ATLAS_REDIRECT_URI` |
| Google métier | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY` |
| Jobs périodiques (Bearer machine) | `AUTOMATISATIONS_SCAN_SECRET`, `AUTOMATISATIONS_REPRISE_SECRET`, `COMPATIBILITE_SCAN_SECRET`, `COMPATIBILITE_BASELINE_SECRET` |
| Documents | `ATLAS_DOCUMENT_STORAGE_DIR` |

Configuration exhaustive de production : `docs/PILOT_RUNBOOK.md` + checklist ADR-047.

### Zones à lire avec leur ADR avant d'y toucher (hotspots)

Confirmées par lecture du code réel, pas supposées :

- **`src/components/bien/BienTabs.tsx`** (le plus gros fichier du projet, ~1450 lignes) — agrège
  tous les onglets de la fiche Bien (Contexte, Notes, Visites, Documents, Offres, Compromis, Pack
  Notaire, Transmissions). Lire ADR-029/030/044/045/046/049 selon l'onglet concerné avant d'y
  toucher.
- **Moteur de compatibilité** (`src/lib/compatibilite/`) — six critères purs, chacun avec sa propre
  sémantique d'« inconnu » (voir tableau des invariants ci-dessus). ADR-034/035.
- **Automatisations** (`src/lib/automatisations/`) — séparation stricte événement/règle/exécution/
  action, idempotence à plusieurs niveaux. ADR-032/033/036/037/038.
- **Documents / Pack Notaire** (`src/lib/documents/`, `src/lib/stockageDocuments.ts`) — combine
  filesystem, checklist déclarative et immutabilité des transmissions. ADR-029/030/049/050.
- **Auth / session** (`src/proxy.ts`, `src/lib/auth/`) — private-by-default à deux couches, la
  seule zone où une erreur a un impact sécurité direct. ADR-047.

---

## Partie 6 — Première journée

### Première heure

- [ ] Lire ce document en entier.
- [ ] Lire `docs/README.md` (index).
- [ ] Lancer Atlas (Partie 2).
- [ ] Ouvrir le cockpit (`/`).
- [ ] Lancer un test ciblé (`npx vitest run src/lib/bienRepository.test.ts`).

### Première demi-journée

- [ ] Lancer la suite Vitest complète (`pnpm test`).
- [ ] Lancer les smoke Playwright (`pnpm test:e2e`).
- [ ] Lire `docs/BUSINESS_RULES.md` (au moins les sections des domaines qu'on va toucher).
- [ ] Lire `docs/DATA_MODEL.md`.
- [ ] Parcourir les ADR listées dans la matrice ci-dessus pour sa zone de travail.

### Avant une première PR

- [ ] Identifier l'ADR concernée (ou constater qu'aucune ne l'est).
- [ ] Être capable d'expliquer l'invariant modifié, s'il y en a un.
- [ ] Tests ciblés + non-régression passants.
- [ ] Build propre.
- [ ] Documentation mise à jour si nécessaire.
- [ ] Nettoyage des données de test.

### Première contribution conseillée

Idéalement une contribution **documentation**, **test**, ou **bug isolé** — pas une refonte
d'architecture, une modification des automatisations, un changement d'auth, une migration
destructive, ou un changement des règles Compromis/documentaires. Recommandation d'onboarding, pas
une contrainte technique imposée par le code.

---

## État de la release courante

`v1.0.0-rc1` — V1 Candidate techniquement validée, pilote réel **non** encore autorisé (validations
externes Railway/Google/mobile/backup restantes). Code freeze actif : seuls bugfix, sécurité,
stabilité, configuration pilote et documentation indispensable sont autorisés — voir
`docs/PILOT_RUNBOOK.md#10-code-freeze-à-partir-de-la-validation-v1-candidate` et
`CONTRIBUTING.md`. Détail de ce qui reste explicitement post-V1 : `docs/KNOWN_LIMITATIONS.md`.
