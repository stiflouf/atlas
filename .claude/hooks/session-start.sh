#!/usr/bin/env bash
# Hook SessionStart Claude Code : prépare un environnement de développement et de test autonome
# dans une session Claude Code Cloud (dépendances pnpm, PostgreSQL 16 local, base de test migrée,
# Chromium préinstallé pour les smoke E2E).
#
# Principes non négociables :
# - n'agit QUE dans une session Cloud (CLAUDE_CODE_REMOTE=true) : sur un poste local, sortie
#   immédiate sans rien toucher ;
# - idempotent : relançable à chaque démarrage/reprise de session sans effet de bord ;
# - n'utilise jamais une DATABASE_URL ou un secret présents dans l'environnement : les seules
#   cibles sont les constantes locales ci-dessous (convention publique de infra/docker-compose.yml) ;
# - les migrations ne sont appliquées QUE sur la base jetable atlas_test, après vérification
#   explicite de l'hôte, du port et du nom de base, côté URL ET côté serveur.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

RACINE="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$RACINE"

# Jamais lues ni transmises par ce script, même si l'environnement en contient.
unset DATABASE_URL ATLAS_TEST_DATABASE_URL

PG_VERSION=16
PG_CLUSTER=main
PG_HOTE=127.0.0.1
PG_PORT=5432
PG_UTILISATEUR=atlas
PG_MOT_DE_PASSE=atlas # valeur de développement publique (infra/docker-compose.yml), pas un secret
BASE_DEV=atlas
BASE_TEST=atlas_test
URL_TEST="postgresql://${PG_UTILISATEUR}:${PG_MOT_DE_PASSE}@${PG_HOTE}:${PG_PORT}/${BASE_TEST}"

etape() { echo "[session-start] $*" >&2; }
echec() { echo "[session-start] ECHEC : $*" >&2; exit 1; }

# --- 1. Dépendances (depuis la racine du monorepo uniquement, lockfile figé) ---
etape "pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile --reporter=silent >&2

# --- 2. PostgreSQL 16 local (cluster Debian préinstallé, sans Docker) ---
if ! pg_lsclusters --no-header "$PG_VERSION" "$PG_CLUSTER" 2>/dev/null | grep -q online; then
  etape "démarrage du cluster PostgreSQL ${PG_VERSION}/${PG_CLUSTER}"
  pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" start
fi
for _ in $(seq 1 30); do
  pg_isready -q -h "$PG_HOTE" -p "$PG_PORT" && break
  sleep 1
done
pg_isready -q -h "$PG_HOTE" -p "$PG_PORT" || echec "PostgreSQL ne répond pas sur ${PG_HOTE}:${PG_PORT}"

psql_admin() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -p "$PG_PORT" "$@"; }

etape "rôle ${PG_UTILISATEUR} et bases ${BASE_DEV}, ${BASE_TEST}"
psql_admin -d postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PG_UTILISATEUR}') THEN
    CREATE ROLE ${PG_UTILISATEUR} LOGIN CREATEDB PASSWORD '${PG_MOT_DE_PASSE}';
  END IF;
END
\$\$;
SQL
for base in "$BASE_DEV" "$BASE_TEST"; do
  if [ -z "$(psql_admin -d postgres -tA -c "SELECT 1 FROM pg_database WHERE datname = '${base}'")" ]; then
    psql_admin -d postgres -c "CREATE DATABASE ${base} OWNER ${PG_UTILISATEUR}"
  fi
done

# --- 3. Migrations sur la base de test jetable uniquement ---
# Vérification côté URL : hôte local, port attendu, nom de base contenant "test".
node -e '
  const u = new URL(process.argv[1]);
  const base = u.pathname.slice(1);
  const ok = ["127.0.0.1", "localhost"].includes(u.hostname) && u.port === process.argv[2]
    && base === process.argv[3] && /test/i.test(base);
  if (!ok) { console.error("cible de migration refusée : " + u.hostname + ":" + u.port + "/" + base); process.exit(1); }
' "$URL_TEST" "$PG_PORT" "$BASE_TEST" || echec "URL de migration non conforme"

# Vérification côté serveur : la connexion aboutit bien sur la base locale attendue.
cible="$(psql -X -tA "$URL_TEST" -c "SELECT inet_server_addr() || '|' || inet_server_port() || '|' || current_database()")"
[ "$cible" = "${PG_HOTE}/32|${PG_PORT}|${BASE_TEST}" ] || echec "cible serveur inattendue : ${cible}"

etape "migrations Drizzle sur ${PG_HOTE}:${PG_PORT}/${BASE_TEST}"
# Sortie détaillée (NOTICE Postgres de troncature d'identifiants, attendues) affichée seulement en
# cas d'échec.
journal="$(mktemp)"
if ! (cd apps/web && DATABASE_URL="$URL_TEST" pnpm exec drizzle-kit migrate) >"$journal" 2>&1; then
  tail -n 40 "$journal" >&2
  rm -f "$journal"
  echec "drizzle-kit migrate sur ${BASE_TEST}"
fi
rm -f "$journal"
appliquees="$(psql -X -tA "$URL_TEST" -c "SELECT count(*) FROM drizzle.__drizzle_migrations")"
etape "${appliquees} migrations appliquées sur ${BASE_TEST}"

# --- 4. Chromium pour les smoke E2E ---
# Le conteneur ne peut pas télécharger de navigateur (CDN Playwright bloqué). Si la révision
# attendue par @playwright/test est absente, désigner le headless shell préinstallé le plus récent
# via ATLAS_E2E_CHROMIUM_PATH (lue par apps/web/playwright.config.ts).
CHROMIUM_E2E=""
revision_attendue="$(cd apps/web && node -e '
  const pt = require.resolve("@playwright/test/package.json");
  const pc = require.resolve("playwright-core/package.json", { paths: [pt] });
  const b = require(require("node:path").join(require("node:path").dirname(pc), "browsers.json"));
  console.log(b.browsers.find((x) => x.name === "chromium-headless-shell").revision);
')"
repertoire_navigateurs="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if [ -d "${repertoire_navigateurs}/chromium_headless_shell-${revision_attendue}" ]; then
  etape "Chromium ${revision_attendue} attendu par Playwright présent : aucune substitution"
else
  CHROMIUM_E2E="$(ls -d "${repertoire_navigateurs}"/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$CHROMIUM_E2E" ] && [ -x "$CHROMIUM_E2E" ]; then
    etape "Chromium ${revision_attendue} absent : E2E sur $("$CHROMIUM_E2E" --version 2>/dev/null | head -n 1) (${CHROMIUM_E2E})"
  else
    CHROMIUM_E2E=""
    etape "AVERTISSEMENT : aucun Chromium utilisable, pnpm test:e2e échouera (pnpm test non concerné)"
  fi
fi

# --- 5. Variables de session (base de test explicite, jamais une DATABASE_URL applicative) ---
ecrire_env() {
  [ -n "${CLAUDE_ENV_FILE:-}" ] || return 0
  grep -qxF "$1" "$CLAUDE_ENV_FILE" 2>/dev/null || echo "$1" >> "$CLAUDE_ENV_FILE"
}
ecrire_env "export ATLAS_TEST_DATABASE_URL=${URL_TEST}"
[ -z "$CHROMIUM_E2E" ] || ecrire_env "export ATLAS_E2E_CHROMIUM_PATH=${CHROMIUM_E2E}"

etape "environnement prêt (pnpm test utilisera ${BASE_TEST})"
