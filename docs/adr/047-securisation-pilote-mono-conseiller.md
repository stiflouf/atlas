# ADR-047 — Sécurisation et garde-fous du pilote mono-conseiller

**Statut :** Accepté
**Date :** 2026-08-16
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

L'audit global Atlas V1 a identifié deux blockers avant tout pilote réel : deux endpoints servent
des documents sensibles sans aucune protection, et Atlas n'a aucune authentification applicative.
Un audit ciblé complémentaire a corrigé et précisé cette conclusion : mono-utilisateur ne signifie
pas application publique. Une instance Atlas déployée sur Internet pour un seul conseiller avec de
vraies données personnelles doit rester privée par défaut.

L'audit ciblé a aussi corrigé une confusion de l'audit global : les routes OAuth Google existantes
(`/api/auth/google/login`, `/gmail/login`, `/callback`) autorisent Atlas à accéder à Calendar/Gmail
— elles n'authentifient jamais un humain auprès d'Atlas. Il n'existait avant cette ADR aucune
authentification Atlas au sens propre.

**Hors périmètre, confirmé par l'audit** : le multi-utilisateur (table utilisateurs, `userId`,
`tenantId`, rôles, plusieurs comptes Google, ownership par ligne) reste un chantier séparé, non
traité ici. Cette ADR reste strictement mono-conseiller : une instance, une base, un conseiller,
une identité autorisée.

## Décision

### 1. Authentification Atlas — identité Google (OIDC) + allowlist, jamais un mot de passe maison

Nouveau flux, strictement distinct des autorisations métier Calendar/Gmail :

- `GET /connexion` (page publique) — un seul bouton « Se connecter avec Google », aucun formulaire
  email/mot de passe, aucune inscription.
- `GET /api/auth/atlas/login` (public) — construit une URL d'autorisation Google avec le scope
  `openid email` uniquement : jamais `access_type=offline`, jamais de refresh_token demandé ni
  conservé (`src/lib/auth/googleIdentite.ts`). State + nonce cryptographiquement aléatoires, stockés
  dans un cookie httpOnly à usage unique et courte durée (`src/lib/auth/atlasOidcState.ts`), même
  patron que `src/lib/google/state.ts` pour le flux Calendar/Gmail — mais un cookie strictement
  distinct (`atlas_oidc_state`), jamais partagé entre les deux flux.
- `GET /api/auth/atlas/callback` (public, c'est Google qui y redirige) — vérifie state, échange le
  code, **valide cryptographiquement l'id_token via `google-auth-library`** (signature, émetteur,
  audience, expiration — jamais un décodage JWT non vérifié), vérifie le nonce, l'email présent et
  vérifié (`email_verified`), puis compare l'email normalisé (trim + lowercase) à
  `ATLAS_ALLOWED_EMAIL`. Email non autorisé → refus honnête (« Compte non autorisé. »), sans jamais
  révéler l'adresse attendue, aucune session créée. Aucun id_token/access_token n'est jamais
  persisté — seule la session Atlas minimale (`sub`, `email`) survit.
- `POST /api/auth/atlas/logout` — détruit uniquement la session Atlas, ne touche jamais aux
  connexions Google métier (Calendar/Gmail), qui restent disponibles à la prochaine connexion.

Allowlist volontairement réduite à **une seule adresse** (`src/lib/auth/allowlist.ts`,
`ATLAS_ALLOWED_EMAIL`) — jamais une liste : plusieurs identités autorisées sur la même base sans
ownership par ligne donneraient l'illusion d'un produit multi-utilisateur alors que toutes
verraient/modifieraient les mêmes données. Fail-closed : configuration absente refuse tout le
monde, jamais n'autorise tout le monde.

### 2. Session Atlas — cookie chiffré, bibliothèque standard, jamais de crypto maison

`src/lib/auth/sessionAtlas.ts` — session via `iron-session` (cookie httpOnly, `Secure` en
production, `SameSite=Lax`, TTL 7 jours, décision explicite : pas de « remember me », une
reconnexion Google après expiration est acceptable puisqu'aucun mot de passe Atlas n'existe).
Contenu minimal : `sub` (identifiant Google) et `email` — jamais un token Gmail/Calendar. Quatre
fonctions : `lireSessionAtlas()` (tolérante, ne lève jamais), `exigerSessionAtlas()` (fail-closed,
lève systématiquement en l'absence de session valide), `creerSessionAtlas()`,
`detruireSessionAtlas()`. `ATLAS_SESSION_PASSWORD` absent ou trop court (< 32 caractères, minimum
exigé par iron-session) fait échouer toute lecture/création de session — jamais une ouverture
publique silencieuse.

### 3. Défense à deux couches — Proxy + garde explicite dans chaque point d'action

Conforme à la documentation Next.js elle-même (`node_modules/next/dist/docs/.../data-security.md`,
citée explicitement dans le code) : *« a Proxy matcher that excludes a path will also skip Server
Function calls on that path... Always verify authentication and authorization inside each Server
Function rather than relying on Proxy alone. »*

- **Couche 1 — `src/proxy.ts`** (convention Next.js 16 : `middleware.ts` est déprécié et renommé
  `proxy.ts`). PRIVATE BY DEFAULT : toute page/route exige une session Atlas valide, sauf
  exceptions explicites — `/connexion`, `/api/auth/atlas/login`, `/api/auth/atlas/callback`, et les
  4 endpoints techniques Bearer (ADR-033/036/038), jamais gérés par une session humaine. Anonyme sur
  une page → redirection `/connexion` ; anonyme sur une route `/api/**` non publique → 401 JSON
  explicite, jamais une redirection HTML silencieuse.
- **Couche 2 — `exigerSessionAtlas()`**, appelée en première ligne de **chaque** Server Action
  exportée (26 fichiers `src/actions/*.ts`, une cinquantaine de fonctions) et de chaque Route
  Handler utilisateur (`documents/[id]`, `pack-notaire`, `geocodage/communes`, `logout`/`login`
  Google). Garantie exhaustive et vérifiable structurellement : `src/actions/gardeSessionAtlas.structurel.test.ts`
  parse l'AST TypeScript de chaque fichier `"use server"` (compilateur déjà présent dans le projet,
  aucune dépendance ajoutée pour ça) et échoue si une fonction exportée ne commence pas par
  `await exigerSessionAtlas();` — protège contre l'oubli sur une future Server Action, pas
  seulement un contrôle textuel qu'un import inutilisé pourrait tromper.

### 4. Documents sensibles — session, jamais un Bearer

Correction explicite d'une conclusion initiale de l'audit global : `/api/documents/[id]` et
`/api/biens/[id]/pack-notaire` sont appelés par un `<a href>`/`<form method="POST">` HTML bruts,
sans JavaScript — un header `Authorization: Bearer` y est structurellement impossible à porter sans
exposer le secret côté client. Protégés par `exigerSessionAtlas()` : le cookie de session est
envoyé automatiquement par le navigateur sur ces deux points d'appel, sans aucune modification du
HTML existant. `/api/geocodage/communes` protégé de même — un proxy IGN gratuit ouvert à quiconque
reste hors politique PRIVATE BY DEFAULT même sans exposer de donnée Atlas privée.

### 5. Routes OAuth Google métier — désormais gated par la session Atlas

`/api/auth/google/login` et `/gmail/login` exigent maintenant `exigerSessionAtlas()` : un visiteur
anonyme ne peut plus initier une autorisation Calendar/Gmail pour l'instance. `/api/auth/google/callback`
exige également une session Atlas valide en plus de son `state` OAuth métier déjà vérifié — deux
garanties indépendantes. Le cookie de session Atlas (`SameSite=Lax`) est envoyé par le navigateur
sur cette redirection GET top-level depuis `accounts.google.com` (Lax autorise explicitement les
navigations top-level en GET cross-site) : validé par construction, la garantie réelle vient de
l'initiation gated en amont. `/api/auth/google/logout` exige de même une session Atlas — anonyme :
aucune révocation, aucune mutation.

### 6. Contraintes DB — défense en profondeur sur trois invariants déjà garantis applicativement

Migration `0028` (additive uniquement, aucune donnée détruite) :

- `UNIQUE(executions_automatisation.tache_id)` — la garantie « au plus une exécution automatique
  par tâche » (ADR-043) était jusqu'ici portée uniquement par la discipline du moteur et la lecture
  fail-closed (`getExecutionAutomatisationParTacheId`). `tache_id` reste nullable, plusieurs `NULL`
  restent valides (comportement standard PostgreSQL sous `UNIQUE`).
- `UNIQUE(compromis.offre_id)` — « une Offre acceptée, origine d'au plus un Compromis » (ADR-045)
  n'était garantie qu'applicativement (`ajouterCompromisAction`). `offre_id` reste nullable.
- Index unique partiel `compromis_bien_id_en_cours_unique` sur `(bien_id) WHERE statut = 'en_cours'`
  — jamais un `UNIQUE(bien_id)` classique, qui aurait interdit l'historique légitime de plusieurs
  compromis `realise`/`annule` par bien. Même patron déjà utilisé dans ce schéma
  (`compatibilites_a_resynchroniser_bien_en_attente_unique`), pas une nouveauté.

Preflight exécuté avant la migration (0 incohérence sur les données de développement) — les trois
requêtes de vérification (tache_id dupliqué, offre_id dupliqué, plusieurs compromis en_cours par
bien) sont documentées et doivent être rejouées sur toute base réelle avant application, jamais
appliquées aveuglément.

### 7. Tests

- `src/actions/gardeSessionAtlas.structurel.test.ts` — couverture exhaustive AST des ~50 Server
  Actions (voir §3).
- `src/proxy.ts` testé directement (`src/proxy.test.ts`) : anonyme redirigé, session valide admise,
  API anonyme → 401, endpoints techniques toujours atteignables sans session.
- `src/lib/auth/sessionAtlas.test.ts`, `allowlist.test.ts`, `googleIdentite.test.ts` — session
  absente/valide/détruite, fail-closed sur configuration manquante/invalide, nonce/audience/email
  invalides rejetés (google-auth-library mocké, jamais réimplémenté).
- Tests métier existants (compromis, offre, prospectVendeur, etc.) : `exigerSessionAtlas()` mocké
  comme session valide — jamais de bypass global type `NODE_ENV=test` désactivant l'authentification.
  Tests de sécurité dédiés (`*.securite.test.ts` pour documents/pack-notaire/geocodage,
  `creerAcquereur.securite.test.ts`) utilisent le vrai helper.
- Comblé au passage les tests manquants identifiés par l'audit : `creerAcquereurAction`,
  `modifierAcquereurAction`, `annulerVisiteAction`, `reporterVisiteAction` n'avaient aucun test.
- Deux tests d'intégration existants (`compromisRepository.test.ts`,
  `executionAutomatisationRepository.test.ts`) qui construisaient artificiellement une incohérence
  multi-lignes pour tester la lecture fail-closed ont été réécrits : le scénario est désormais
  rejeté dès l'écriture par les contraintes DB elles-mêmes (§6) — vérifié directement plutôt que
  contourné.

## Hors périmètre, volontairement

Multi-utilisateur (table utilisateurs, `userId`/`tenantId`, rôles, plusieurs comptes Google,
ownership par ligne) — reste un NO-GO explicite même après cette ADR. Recherche/pagination (ADR-048
si toujours justifiée). Outillage RGPD réel (export/anonymisation automatisés) — seule une
procédure manuelle documentée existe à ce stade (`docs/KNOWN_LIMITATIONS.md`). Suite E2E complète —
un seul smoke E2E sécurité pourrait être ajouté séparément, non construit ici. CI — toujours non
démontrée dans le repository.

## Conséquences

- **1 migration** (`0028_mixed_lorna_dane.sql`) — trois contraintes additives, aucune donnée
  détruite.
- Nouvelles variables d'environnement obligatoires en production : `GOOGLE_ATLAS_REDIRECT_URI`,
  `ATLAS_ALLOWED_EMAIL`, `ATLAS_SESSION_PASSWORD` (voir `.env.local.example`) — absence ou valeur
  invalide fait échouer explicitement l'authentification, jamais une ouverture publique.
- 2 nouvelles dépendances : `iron-session` (session cookie), `google-auth-library` (vérification
  cryptographique de l'id_token) — aucune crypto/JWT réimplémentée à la main.
- Fichiers créés : `src/lib/auth/{sessionAtlas,allowlist,googleIdentite,atlasOidcState}.ts`,
  `src/proxy.ts`, `src/app/connexion/page.tsx`, `src/app/api/auth/atlas/{login,callback,logout}/route.ts`,
  et les fichiers de test associés.
- Fichiers modifiés : les 4 routes Google métier existantes, `documents/[id]`, `pack-notaire`,
  `geocodage/communes`, les 26 fichiers `src/actions/*.ts` (garde ajoutée à chaque fonction
  exportée), `src/components/layout/AppShell.tsx` (masque la navigation sur `/connexion`),
  `src/db/schema.ts` (3 contraintes).
- `docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md`/`docs/DATA_MODEL.md` mis
  à jour.
- Dette retirée : absence totale d'authentification Atlas ; deux endpoints documents exposés sans
  protection ; trois invariants métier sans garde-fou DB.
- Dettes qui restent, non traitées ici : multi-utilisateur complet, RGPD outillé, CI, E2E métier,
  validation réelle du flux OAuth de bout en bout avec de vraies credentials Google (non
  disponibles dans cet environnement de développement — à faire manuellement avant le premier jour
  de pilote, voir checklist ci-dessous).

## Checklist de configuration avant pilote

Emplacement canonique de cette checklist : ce document. Ne pas dupliquer ailleurs. Noms de
variables identiques à `apps/web/.env.local.example` — aucun nom supposé.

Nous n'avons pas accès au compte Railway de production : cette checklist décrit ce qui doit être
vérifié/configuré manuellement, elle ne prétend configurer Railway elle-même.

### Application

- [ ] `DATABASE_URL` de production renseignée (Postgres managé, pas le Postgres local de dev).
- [ ] Domaine de production servi en HTTPS réel (le cookie `atlas_session` est `Secure` dès que
      `NODE_ENV=production` — un domaine encore en HTTP le rendrait inutilisable, jamais une
      dégradation silencieuse vers un cookie non sécurisé).
- [ ] `NODE_ENV=production` effectivement positionnée sur l'environnement de déploiement.

### Auth Atlas (identité, ADR-047)

- [ ] `ATLAS_ALLOWED_EMAIL` renseignée avec l'unique adresse du conseiller pilote (jamais une liste).
- [ ] `ATLAS_SESSION_PASSWORD` renseignée, 32 caractères minimum (`openssl rand -base64 32`).
- [ ] `GOOGLE_ATLAS_REDIRECT_URI` renseignée avec l'URL de production
      (`https://<domaine>/api/auth/atlas/callback`) — distincte de `GOOGLE_REDIRECT_URI` métier.
- [ ] Cette URI de callback identité déclarée côté Google Cloud Console (écran de consentement /
      identifiants OAuth) — sans cet enregistrement, Google refuse la redirection.

### Google métier (Calendar/Gmail)

- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` renseignés.
- [ ] `GOOGLE_REDIRECT_URI` renseignée avec l'URL de production (`.../api/auth/google/callback`) et
      déclarée côté Google Cloud Console.
- [ ] `GOOGLE_TOKEN_ENCRYPTION_KEY` renseignée (chiffrement du refresh_token stocké en base).

### Endpoints techniques (machine, Bearer indépendant du Proxy)

- [ ] `AUTOMATISATIONS_SCAN_SECRET` renseigné.
- [ ] `AUTOMATISATIONS_REPRISE_SECRET` renseigné (distinct du précédent).
- [ ] `COMPATIBILITE_SCAN_SECRET` renseigné.
- [ ] `COMPATIBILITE_BASELINE_SECRET` renseigné (distinct des trois précédents).

### Stockage documentaire (ADR-050)

- [ ] Créer/attacher un volume persistant au service web.
- [ ] Choisir un mount path ABSOLU (ex. `/data/stockage-documents`).
- [ ] Vérifier que ce mount path existe réellement au démarrage du runtime (le volume monté crée le
      répertoire, Atlas ne le crée jamais lui-même en production).
- [ ] Définir `ATLAS_DOCUMENT_STORAGE_DIR` sur CE chemin exact.
- [ ] Vérifier que l'utilisateur du process peut lire/écrire sur ce chemin.
- [ ] Définir une stratégie de sauvegarde/restauration du volume, séparée du code — un volume
      persistant n'est PAS automatiquement une sauvegarde.

### Jobs périodiques (cadence externe, aucun cron interne à Atlas)

- [ ] JOB-01 — `POST /api/automatisations/scan` — **quotidien**.
- [ ] JOB-02 — `POST /api/automatisations/reprise` — **horaire**.
- [ ] JOB-03 — `POST /api/compatibilite/scan` — **horaire**.
- [ ] `POST /api/compatibilite/baseline` — **JAMAIS programmé en cron** : outil manuel explicite,
      dry-run par défaut. Ne pas le configurer comme JOB-04.

### Validation avant premier jour de pilote

- [ ] Chaque job (scan/reprise/compatibilite-scan) appelé réellement au moins une fois avec le bon
      Bearer, réponse 200 constatée.
- [ ] Un Bearer invalide/absent sur ces 4 endpoints est bien refusé (503/401 selon l'implémentation,
      jamais un traitement silencieux).
- [ ] HTTPS réel vérifié dans un navigateur (pas seulement supposé actif).
- [ ] Login Atlas avec le compte autorisé fonctionne de bout en bout (`/connexion` →
      `/api/auth/atlas/login` → Google → `/api/auth/atlas/callback` → session posée).
- [ ] Un compte Google non autorisé est bien rejeté (`?erreur=compte_non_autorise`), sans révéler
      l'adresse attendue.
- [ ] Connexion Calendar fonctionne après connexion Atlas.
- [ ] Connexion Gmail fonctionne après connexion Atlas.
- [ ] Téléchargement d'un document fonctionne en session, refusé explicitement sans session.
- [ ] Logout Atlas puis nouvel accès à une page privée → redirigé vers `/connexion`.
- [ ] Upload d'un document test, redéploiement/restart du service, document toujours téléchargeable
      avec des octets identiques (ADR-050 — preuve réelle de persistance, pas seulement supposée).
