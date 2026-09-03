# Procédure de migration production — Atlas

Procédure d'exploitation (audit V1 Candidate) pour appliquer une migration Drizzle sur la base de
données de **production** du pilote mono-conseiller. Distincte de l'usage local documenté dans
`apps/web/README.md` — cette procédure est destinée à l'exploitant, pas au développement quotidien.

**Toute migration future n'est pas garantie additive.** Les migrations livrées jusqu'à V1 Candidate
le sont toutes (`ADD TABLE`/`ADD COLUMN`, jamais de `DROP`/`ALTER TYPE` destructeur), mais cette
procédure doit rester valable pour une migration future qui ne le serait pas — d'où le backup
systématique à l'étape 3, jamais une étape sautée « parce que ça a toujours été sans risque ».

**Quelle « production » ?** Deux environnements Railway portent un environment nommé `production` —
`sparkling-rejoicing` (production réelle de Steven, branche `main`) et `domiora-demo` (showroom,
branche `develop`). Cette procédure vise la première. Identifier la cible avant toute commande :
`docs/PILOT_RUNBOOK.md#0-environnements-branches-et-autorisations-décriture-source-canonique`.

## 1. Identifier la DATABASE_URL de production

La variable `DATABASE_URL` de l'environnement Railway (ou équivalent) du service Atlas en
production — jamais une valeur locale, jamais `ATLAS_TEST_DATABASE_URL`. Récupérer sa valeur exacte
depuis la configuration de la plateforme d'hébergement (ex. `railway variables` ou l'interface web),
jamais en la reconstruisant de mémoire.

## 2. Vérifier que la cible est bien la production

Avant toute commande mutante :

```
psql "$DATABASE_URL" -c "select current_database(), inet_server_addr();"
```

Comparer le résultat à l'identité connue de la base de production (nom de base, hôte). **Ne jamais
exécuter l'étape 4 sans avoir positivement confirmé cette identité** — en cas de doute, s'arrêter et
vérifier via la console de la plateforme plutôt que de deviner.

## 3. Sauvegarde AVANT migration (non négociable)

```
pg_dump "$DATABASE_URL" --format=custom --file="atlas-prod-$(date +%Y%m%d-%H%M).dump"
```

Copier ce fichier hors de la machine qui a exécuté la commande (stockage externe au service) avant
de poursuivre. Sans cette sauvegarde vérifiable, ne pas passer à l'étape 4.

## 4. Appliquer les migrations

Depuis `apps/web/`, avec `DATABASE_URL` positionnée EXPLICITEMENT sur la valeur de production
vérifiée à l'étape 2 (jamais une variable d'environnement ambiante non vérifiée) :

```
DATABASE_URL="<url de production vérifiée>" pnpm db:migrate
```

`drizzle-kit migrate` applique uniquement les migrations de `src/db/migrations/` non encore
enregistrées comme appliquées sur cette base (table de suivi interne à Drizzle) — jamais une
recréation ou un `push` de schéma.

## 5. Vérifier le succès

- La commande se termine sans erreur (`migrations applied successfully`).
- Vérifier que les nouvelles tables/colonnes attendues existent :
  `psql "$DATABASE_URL" -c "\d nom_de_la_table"`.
- Conserver la sortie de la commande (log de la migration) avec l'horodatage.

## 6. Déployer le code compatible

Ne déployer le nouveau code applicatif **qu'après** la migration réussie (étape 5) — l'ordre
« migration avant code » est sûr pour des migrations additives (le code déployé peut alors compter
sur la présence des nouvelles tables/colonnes dès son premier démarrage). Pour une future migration
non additive (ex. renommage/suppression de colonne), cette procédure devra être adaptée au cas par
cas (migration en plusieurs étapes compatibles avec l'ancien ET le nouveau code) — ne pas supposer
que l'ordre « migration puis déploiement » reste automatiquement sûr dans ce cas.

## 7. Vérifier l'application après déploiement

- Connexion réelle (`/connexion`) fonctionne.
- Une lecture simple (ex. cockpit `/`) répond sans erreur 500.
- Aucune erreur applicative liée au schéma dans les logs de la plateforme dans les minutes suivant
  le déploiement.

## Rollback

Voir `docs/PILOT_RUNBOOK.md#rollback` — distinction stricte entre rollback du **code** (revenir au
commit/release précédent, sûr uniquement si compatible avec le schéma déjà en place) et rollback des
**données** (restauration du `pg_dump` de l'étape 3, un geste lourd, jamais automatique, à ne
déclencher qu'en dernier recours).
