#!/usr/bin/env bash
# Test de restauration DOMIORA (PILOT_PRODUCTION_HARDENING_V1).
#
# Restaure la sauvegarde la plus récente dans un environnement LOCAL ET JETABLE, vérifie que la
# restauration est structurellement complète, puis DÉTRUIT cet environnement. Une sauvegarde qu'on
# n'a jamais restaurée n'est pas une sauvegarde, c'est un fichier.
#
# GARANTIE CENTRALE, et la seule qui compte ici : rien de ce script ne touche la production. Aucune
# commande Railway, aucune connexion distante, aucun accès réseau sortant. La base de
# restauration est un conteneur Docker éphémère, sur un port aléatoire, sans volume monté, détruit
# par un `trap` qui s'exécute aussi en cas d'échec ou d'interruption. `pg_restore` est celui du
# conteneur : ce poste n'a pas de client PostgreSQL installé, et n'en a pas besoin.
#
# Vérifications effectuées (PILOT_PRODUCTION_HARDENING_V1, chantier C) :
#   1. pg_restore se termine avec le code 0, sous --exit-on-error (aucune erreur tolérée) ;
#   2. le journal des migrations Drizzle est présent et son compte est affiché ;
#   3. comptes structuraux : tables, contraintes, index ;
#   4. les fichiers documentaires se réextraient ;
#   5. comparaison SHA-256 d'un ÉCHANTILLON de fichiers restaurés contre le manifeste pris côté
#      production — sans jamais afficher le contenu d'un document.

set -euo pipefail
cd "$(dirname "$0")"

RACINE_SAUVEGARDES="${DOMIORA_BACKUP_DIR:-$HOME/domiora-backups/railway}"
IMAGE_PG="${DOMIORA_RESTORE_IMAGE:-postgres:18}"
BASE_TEST="domiora_restore_test"
MOT_DE_PASSE_JETABLE="restore-test-$(date +%s)"
TAILLE_ECHANTILLON="${DOMIORA_RESTORE_ECHANTILLON:-3}"

journal() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
echec() { printf '[%s] ÉCHEC : %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

CONTENEUR=""
REPERTOIRE_JETABLE=""
nettoyer() {
  [ -n "$CONTENEUR" ] && docker rm -f "$CONTENEUR" >/dev/null 2>&1 || true
  [ -n "$REPERTOIRE_JETABLE" ] && rm -rf "$REPERTOIRE_JETABLE" || true
  journal "Environnement jetable détruit."
}
trap nettoyer EXIT INT TERM

plus_recent() {
  find "$RACINE_SAUVEGARDES" -maxdepth 1 -type f -name "$1" -printf '%f\n' 2>/dev/null | sort | tail -n1
}

command -v docker >/dev/null 2>&1 || echec "Docker est requis (environnement de restauration jetable)."
docker info >/dev/null 2>&1 || echec "Le démon Docker ne répond pas."

DUMP="$(plus_recent 'domiora-db-*.dump')"
ARCHIVE="$(plus_recent 'domiora-documents-*.tar.gz')"
[ -n "$DUMP" ] || echec "Aucune sauvegarde base ('domiora-db-*.dump') dans $RACINE_SAUVEGARDES — lancer backup-db.sh d'abord."
[ -n "$ARCHIVE" ] || echec "Aucune archive documentaire dans $RACINE_SAUVEGARDES — lancer backup-volume.sh d'abord."
MANIFESTE="$RACINE_SAUVEGARDES/${ARCHIVE%%.*}.manifeste.sha256"

journal "Sauvegarde base testée      : $DUMP"
journal "Archive documentaire testée : $ARCHIVE"

# ─────────────────── 0. Intégrité des artefacts avant toute restauration ───────────────────
for artefact in "$DUMP" "$ARCHIVE"; do
  empreinte="$RACINE_SAUVEGARDES/$artefact.sha256"
  [ -f "$empreinte" ] || echec "Empreinte absente pour $artefact — artefact non vérifiable."
  (cd "$RACINE_SAUVEGARDES" && sha256sum -c --quiet "$artefact.sha256") \
    || echec "$artefact a été altéré depuis sa création (SHA-256 non conforme)."
done
journal "Empreintes SHA-256 des deux artefacts conformes."

[ "$(head -c 5 "$RACINE_SAUVEGARDES/$DUMP")" = "PGDMP" ] || echec "Signature PGDMP absente du dump."
journal "Signature PGDMP conforme."

# ─────────────────── 1. Base jetable ───────────────────
CONTENEUR="domiora-restore-test-$$"
journal "Démarrage d'une instance PostgreSQL jetable ($IMAGE_PG), sans volume, sans port publié…"
docker run -d --name "$CONTENEUR" \
  -e POSTGRES_PASSWORD="$MOT_DE_PASSE_JETABLE" \
  -e POSTGRES_DB="$BASE_TEST" \
  "$IMAGE_PG" >/dev/null || echec "Démarrage du conteneur PostgreSQL impossible."

# Attente ROBUSTE. `pg_isready` seul ne suffit pas : l'entrypoint de l'image accepte des connexions
# pendant sa phase d'initialisation, puis REDÉMARRE le serveur. Un pg_restore lancé dans cette
# fenêtre échoue sur « the database system is shutting down » — observé. On exige donc trois
# requêtes réelles consécutives réussies, ce qui ne peut arriver qu'après le redémarrage final.
succes_consecutifs=0
for _ in $(seq 1 90); do
  if docker exec "$CONTENEUR" psql -U postgres -d "$BASE_TEST" -tAc 'select 1' >/dev/null 2>&1; then
    succes_consecutifs=$((succes_consecutifs + 1))
    [ "$succes_consecutifs" -ge 3 ] && break
  else
    succes_consecutifs=0
  fi
  sleep 1
done
[ "$succes_consecutifs" -ge 3 ] || echec "L'instance jetable n'est pas devenue durablement disponible."

interroger() { docker exec -i "$CONTENEUR" psql -U postgres -d "$BASE_TEST" -tAc "$1"; }

# ─────────────────── 2. Restauration ───────────────────
journal "Restauration (pg_restore --no-owner --exit-on-error : aucune erreur tolérée)…"
docker exec -i "$CONTENEUR" pg_restore -U postgres -d "$BASE_TEST" --no-owner --exit-on-error \
  <"$RACINE_SAUVEGARDES/$DUMP" || echec "pg_restore a retourné un code non nul."
journal "pg_restore : code de sortie 0."

# ─────────────────── 3. Vérifications structurelles ───────────────────
TABLES="$(interroger "select count(*) from information_schema.tables where table_schema='public'")"
CONTRAINTES="$(interroger "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'")"
INDEX="$(interroger "select count(*) from pg_indexes where schemaname='public'")"

[ "${TABLES:-0}" -gt 0 ] || echec "Aucune table restaurée dans le schéma public."
[ "${CONTRAINTES:-0}" -gt 0 ] || echec "Aucune contrainte restaurée — restauration structurellement incomplète."
[ "${INDEX:-0}" -gt 0 ] || echec "Aucun index restauré — restauration structurellement incomplète."
journal "Structure restaurée : $TABLES table(s), $CONTRAINTES contrainte(s), $INDEX index."

# Journal des migrations Drizzle : c'est lui qui dit à quelle version de schéma correspond ce dump.
# Son absence ne fait pas échouer le test (un dump pourrait précéder son introduction), mais elle
# est dite explicitement plutôt que passée sous silence.
if [ "$(interroger "select count(*) from information_schema.tables where table_schema='drizzle' and table_name='__drizzle_migrations'")" = "1" ]; then
  MIGRATIONS="$(interroger "select count(*) from drizzle.__drizzle_migrations")"
  DERNIERE="$(interroger "select coalesce(max(created_at)::text,'—') from drizzle.__drizzle_migrations")"
  journal "Migrations Drizzle restaurées : $MIGRATIONS (dernière: $DERNIERE)."
  [ "${MIGRATIONS:-0}" -gt 0 ] || echec "Journal de migrations présent mais vide."
else
  journal "AVERTISSEMENT : aucun journal drizzle.__drizzle_migrations dans ce dump."
fi

# ─────────────────── 4. Restauration des fichiers ───────────────────
REPERTOIRE_JETABLE="$(mktemp -d)"
journal "Extraction de l'archive documentaire dans un répertoire jetable…"
tar -xzf "$RACINE_SAUVEGARDES/$ARCHIVE" -C "$REPERTOIRE_JETABLE" || echec "Extraction de l'archive a échoué."

NB_RESTAURES="$(find "$REPERTOIRE_JETABLE" -type f | wc -l)"
journal "Fichiers réextraits : $NB_RESTAURES."

# ─────────────────── 5. Échantillon vs manifeste de production ───────────────────
# L'intérêt du manifeste est ici : comparer un fichier RESTAURÉ à l'empreinte de son ORIGINAL côté
# production — pas à lui-même. `sha256sum -c` lit les empreintes, jamais le contenu n'est affiché.
if [ -f "$MANIFESTE" ] && [ "$NB_RESTAURES" -gt 0 ]; then
  NB_MANIFESTE="$(wc -l <"$MANIFESTE")"
  ECHANTILLON="$(mktemp)"
  head -n "$TAILLE_ECHANTILLON" "$MANIFESTE" >"$ECHANTILLON"
  if (cd "$REPERTOIRE_JETABLE" && sha256sum -c --quiet "$ECHANTILLON"); then
    journal "Échantillon vérifié : $(wc -l <"$ECHANTILLON")/$NB_MANIFESTE fichier(s) identiques à l'original de production."
  else
    rm -f "$ECHANTILLON"
    echec "Un fichier restauré DIFFÈRE de son empreinte de production."
  fi
  rm -f "$ECHANTILLON"
elif [ ! -f "$MANIFESTE" ]; then
  journal "AVERTISSEMENT : manifeste absent ($MANIFESTE) — comparaison à l'original impossible."
else
  journal "AVERTISSEMENT : archive vide — aucun fichier à comparer."
fi

journal "RESTORE_TEST = PASS"
