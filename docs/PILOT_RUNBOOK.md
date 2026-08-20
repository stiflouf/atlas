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

## 1. Architecture mono-conseiller (rappel)

Un seul conseiller autorisé (`ATLAS_ALLOWED_EMAIL`, allowlist à une seule adresse, jamais un
annuaire), une seule base Postgres, un volume documentaire persistant, aucun scheduler interne (3
jobs déclenchés par un cron **externe**). Aucune notion de compte multi-utilisateur — voir
`docs/KNOWN_LIMITATIONS.md#pas-de-multi-utilisateur`.

## 2. Version déployée

- Noter ici, à chaque déploiement réel, le tag ou le hash de commit exact déployé en production
  (ex. `v1.0.0-rc1` ou `e0423f9`) et sa date. Aucun déploiement sans un identifiant exact tracé.

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

## 7. Séquence de déploiement

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
