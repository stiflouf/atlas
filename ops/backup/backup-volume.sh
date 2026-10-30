#!/usr/bin/env bash
# Sauvegarde du volume documentaire de production DOMIORA (PILOT_PRODUCTION_HARDENING_V1).
#
# Produit sur ce poste — donc HORS de l'environnement de production — une archive `tar.gz`
# horodatée du contenu d'`ATLAS_DOCUMENT_STORAGE_DIR`, son empreinte SHA-256, et un MANIFESTE
# listant l'empreinte de chaque fichier. L'arborescence est préservée (`tar -C <racine> .`), y
# compris `photos/originaux` et `photos/optimisees`.
#
# Ce que ce script ne fait jamais : afficher, extraire ou inspecter le CONTENU d'un document. Le
# manifeste ne porte que des chemins et des empreintes. Les noms physiques sont des UUID opaques
# générés par Atlas (`stockageDocuments.ts`), jamais un nom de fichier fourni par un utilisateur :
# un manifeste ne révèle donc ni identité, ni adresse, ni nature de document.
#
# `lost+found` est exclu : artefact ext4 du volume, vide, et inaccessible en lecture à l'utilisateur
# du conteneur — l'inclure ferait échouer `tar` sans rien sauvegarder.
#
# ATTENTION, limite assumée : un volume et sa sauvegarde ne sont pas atomiques l'un par rapport à
# l'autre. Un document déposé PENDANT l'archivage peut être absent de l'archive. À l'échelle d'un
# pilote mono-conseiller, le risque est une poignée de secondes par jour ; le nommer vaut mieux que
# de prétendre à une cohérence qui n'existe pas.

cd "$(dirname "$0")"
# shellcheck source=./lib-commun.sh
. ./lib-commun.sh

SERVICE_WEB="${DOMIORA_BACKUP_SERVICE_WEB:-DOMIORA}"
PREFIXE="domiora-documents"

prouver_cible
preparer_destination

HORODATAGE="$(horodatage)"
ARCHIVE="$RACINE_SAUVEGARDES/${PREFIXE}-${HORODATAGE}.tar.gz"
MANIFESTE="$RACINE_SAUVEGARDES/${PREFIXE}-${HORODATAGE}.manifeste.sha256"

# La racine n'est jamais codée en dur : elle vient de la variable du conteneur, seule source de
# vérité (ADR-050). Absente, le script refuse plutôt que d'archiver un répertoire deviné.
RACINE_DISTANTE='${ATLAS_DOCUMENT_STORAGE_DIR:?ATLAS_DOCUMENT_STORAGE_DIR absente du service}'

transferer_artefact "$SERVICE_WEB" \
  "tar -czf \"\$ARTEFACT\" --exclude=./lost+found -C \"$RACINE_DISTANTE\" . || exit 1" \
  "$ARCHIVE"

journal "Construction du manifeste (chemins et empreintes, jamais de contenu)…"
# Deuxième aller-retour, délibéré : le manifeste décrit l'ÉTAT DU VOLUME, pas l'archive. C'est
# précisément ce qui permet, lors du test de restauration, de comparer un fichier restauré à
# l'empreinte de son original côté production — et non à lui-même.
"$RAILWAY_BIN" ssh --service "$SERVICE_WEB" --environment "$ENVIRONNEMENT" -- sh -c \
  "cd \"$RACINE_DISTANTE\" && find . -type f ! -path './lost+found/*' -print0 | sort -z | xargs -0 -r sha256sum" \
  2>/dev/null | grep -E '^[0-9a-f]{64}  \./' >"$MANIFESTE" || {
  rm -f "$MANIFESTE"
  echec "Construction du manifeste a échoué."
}

chmod 600 "$MANIFESTE"
NB_FICHIERS="$(wc -l <"$MANIFESTE")"
[ "$NB_FICHIERS" -gt 0 ] || journal "AVERTISSEMENT : volume vide — archive conservée, mais rien à restaurer."

journal "Sauvegarde documents : $ARCHIVE ($(stat -c%s "$ARCHIVE") octets, $NB_FICHIERS fichier(s))"
journal "Manifeste : $MANIFESTE"

appliquer_retention "$PREFIXE"
journal "Terminé — sauvegarde du volume documentaire."
