#!/usr/bin/env bash
# Sauvegarde de la base PostgreSQL de production DOMIORA (PILOT_PRODUCTION_HARDENING_V1).
#
# Reproductible, non interactif, sans aucun paramètre obligatoire. Produit sur ce poste — donc HORS
# de l'environnement de production — un dump horodaté, son empreinte SHA-256, et vérifie la
# signature `PGDMP` avant de considérer l'artefact comme valide.
#
# `pg_dump` est exécuté DANS le service Postgres, via son réseau privé : `DATABASE_URL` n'est lue
# que par le conteneur, et `DATABASE_PUBLIC_URL` n'est jamais sollicitée (le proxy TCP public reste
# fermé). Aucune valeur secrète ne transite par ce poste, n'est journalisée, ni ne figure dans un
# nom de fichier. Voir lib-commun.sh pour les règles communes.
#
# Format `custom` (et non `plain`) : c'est le seul qui permette une restauration sélective et qui
# soit compressé nativement — même choix que la procédure déjà validée (PILOT_RUNBOOK §6).
# `--no-owner` : la restauration cible une instance jetable dont le rôle propriétaire diffère.

cd "$(dirname "$0")"
# shellcheck source=./lib-commun.sh
. ./lib-commun.sh

SERVICE_DB="${DOMIORA_BACKUP_SERVICE_DB:-Postgres}"
PREFIXE="domiora-db"

prouver_cible
preparer_destination

ARTEFACT="$RACINE_SAUVEGARDES/${PREFIXE}-$(horodatage).dump"

# `$ARTEFACT` ci-dessous est la variable du script DISTANT (définie par transferer_artefact), pas
# celle-ci : les apostrophes simples empêchent toute expansion locale. `-d "$DATABASE_URL"` est lu
# dans l'environnement du conteneur.
transferer_artefact "$SERVICE_DB" \
  'pg_dump -d "$DATABASE_URL" --format=custom --no-owner -f "$ARTEFACT" || exit 1' \
  "$ARTEFACT"

# Signature d'un dump pg_dump --format=custom. Un artefact qui ne la porte pas n'est pas un dump :
# supprimé plutôt que conservé sous un nom rassurant.
if [ "$(head -c 5 "$ARTEFACT")" != "PGDMP" ]; then
  rm -f "$ARTEFACT" "${ARTEFACT}.sha256"
  echec "Signature PGDMP absente — l'artefact n'est pas un dump PostgreSQL valide. Supprimé."
fi

journal "Signature PGDMP vérifiée."
journal "Sauvegarde base : $ARTEFACT ($(stat -c%s "$ARTEFACT") octets)"

appliquer_retention "$PREFIXE"
journal "Terminé — sauvegarde base de données."
