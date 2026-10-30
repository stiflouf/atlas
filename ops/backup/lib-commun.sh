# shellcheck shell=bash
# Fonctions partagées par les scripts de sauvegarde DOMIORA (PILOT_PRODUCTION_HARDENING_V1).
# Jamais exécuté directement — sourcé par backup-db.sh / backup-volume.sh / restore-test.sh.
#
# RÈGLES NON NÉGOCIABLES, encodées ici une seule fois :
#
#  1. Aucune valeur secrète n'est jamais imprimée ni passée en argument. `DATABASE_URL` n'est lue
#     QUE par pg_dump À L'INTÉRIEUR du conteneur Postgres, via son propre environnement. Elle ne
#     traverse jamais ce poste, n'apparaît dans aucune ligne de log, aucun nom de fichier.
#  2. `DATABASE_PUBLIC_URL` n'est jamais utilisée : le proxy TCP public de Railway n'a aucune raison
#     d'être ouvert pour une sauvegarde, qui part de l'intérieur du réseau privé.
#  3. Aucun `set -x`. Une trace shell afficherait exactement ce que les points 1 et 2 interdisent.
#  4. La cible est PROUVÉE avant toute commande distante (garde-fou PILOT_RUNBOOK §0) : jamais
#     déduite d'un nom de service, jamais supposée depuis le lien local courant.
#  5. `domiora-demo` est refusé explicitement. Sauvegarder une instance de démonstration serait
#     inutile ; la confondre avec le pilote serait grave.

set -euo pipefail

# Projet Railway attendu. Surchargeable pour une future seconde instance pilote, jamais deviné.
PROJET_ATTENDU="${DOMIORA_BACKUP_PROJET:-sparkling-rejoicing}"
ENVIRONNEMENT="${DOMIORA_BACKUP_ENVIRONNEMENT:-production}"

# Destination : hors de l'environnement de production, sur ce poste. C'est l'emplacement déjà
# documenté par PILOT_RUNBOOK §6 — ce script ne décide d'aucune destination cloud, et n'envoie rien
# à aucun fournisseur tiers (voir README.md, OFFSITE_BACKUP_DESTINATION).
RACINE_SAUVEGARDES="${DOMIORA_BACKUP_DIR:-$HOME/domiora-backups/railway}"

# Nombre d'archives conservées PAR TYPE. Au-delà, les plus anciennes sont supprimées — jamais en
# dessous de 2, pour que la contrainte « deux sauvegardes consécutives disponibles » reste vraie
# même si quelqu'un configure une rétention agressive.
RETENTION_MIN=2
RETENTION_A_CONSERVER="${DOMIORA_BACKUP_RETENTION:-14}"

RAILWAY_BIN="${RAILWAY_BIN:-railway}"

journal() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
echec() { printf '[%s] ÉCHEC : %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

horodatage() { date -u +%Y%m%dT%H%M%SZ; }

# Point 4 : prouver la cible. Interroge Railway plutôt que de faire confiance au lien local, et
# compare au projet explicitement attendu. Toute divergence arrête le script AVANT la moindre
# commande distante.
prouver_cible() {
  command -v "$RAILWAY_BIN" >/dev/null 2>&1 || echec "CLI Railway introuvable (RAILWAY_BIN=$RAILWAY_BIN)."

  local statut nom
  statut="$("$RAILWAY_BIN" status --json 2>/dev/null)" || echec "railway status a échoué — authentification ou lien de projet absent."
  nom="$(printf '%s' "$statut" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("name",""))')" \
    || echec "Réponse de railway status illisible."

  [ -n "$nom" ] || echec "railway status ne nomme aucun projet — relier le projet avant toute lecture."
  case "$nom" in
    *domiora-demo*) echec "Cible refusée : '$nom' est l'instance de DÉMONSTRATION, jamais sauvegardée." ;;
  esac
  [ "$nom" = "$PROJET_ATTENDU" ] || echec "Cible inattendue : projet lié '$nom', projet attendu '$PROJET_ATTENDU'."

  journal "Cible prouvée : projet '$nom', environnement '$ENVIRONNEMENT'."
}

preparer_destination() {
  mkdir -p "$RACINE_SAUVEGARDES"
  chmod 700 "$RACINE_SAUVEGARDES"
  [ -w "$RACINE_SAUVEGARDES" ] || echec "Destination non inscriptible : $RACINE_SAUVEGARDES"
}

# Transfert d'un artefact BINAIRE depuis un conteneur, avec preuve d'intégrité de bout en bout.
#
# Pourquoi base64 : la sortie de `railway ssh` traverse une couche qui n'est pas garantie
# transparente aux octets. Un dump pg_dump --format=custom ou un tar.gz silencieusement altéré en
# transit serait une sauvegarde qui ressemble à une sauvegarde — le pire défaut possible pour ce
# script. L'encodage texte supprime la question ; le surcoût de 33 % est sans objet à l'échelle du
# pilote.
#
# L'artefact est produit dans `/tmp` du CONTENEUR — jamais sur le volume documentaire, jamais dans
# la base : un système de fichiers éphémère, sans donnée métier. Il y est haché puis supprimé dans
# la MÊME commande distante (`trap`), y compris en cas d'interruption : aucun résidu à nettoyer
# plus tard, et donc aucun résidu oublié. C'est le seul endroit où ces scripts écrivent quoi que ce
# soit du côté production, et ce qui y est écrit est détruit avant leur retour.
#
# Volontairement du shell POSIX dans la commande distante (`sh` est dash sur ces images) : aucune
# substitution de processus, aucune construction bash.
#
# $1 = service, $2 = commande shell écrivant dans "$ARTEFACT", $3 = fichier local de sortie
transferer_artefact() {
  local service="$1" commande_distante="$2" sortie_locale="$3"
  local b64="${sortie_locale}.b64.partiel" empreinte="${sortie_locale}.sha256.distant"

  local script_distant
  script_distant=$(
    cat <<'PROLOGUE'
ARTEFACT=$(mktemp /tmp/domiora-backup.XXXXXXXX) || exit 1
trap 'rm -f "$ARTEFACT"' EXIT INT TERM HUP
PROLOGUE
  )
  script_distant="$script_distant
$commande_distante
sha256sum \"\$ARTEFACT\" | cut -d' ' -f1 >&2
base64 -w0 \"\$ARTEFACT\""

  journal "Production de l'artefact dans le service '$service' puis transfert encodé…"
  # Le SHA-256 distant part sur stderr, les données sur stdout : deux canaux, jamais mélangés.
  "$RAILWAY_BIN" ssh --service "$service" --environment "$ENVIRONNEMENT" -- sh -c "$script_distant" \
    >"$b64" 2>"$empreinte" || { rm -f "$b64" "$empreinte"; echec "Production/transfert de l'artefact a échoué."; }

  local sha_distant
  sha_distant="$(grep -oE '^[0-9a-f]{64}$' "$empreinte" | tail -n1 || true)"
  [ -n "$sha_distant" ] || { rm -f "$b64" "$empreinte"; echec "Aucune empreinte distante lisible — transfert non vérifiable."; }

  # stdout ne porte QUE la charge utile : la bannière de `railway ssh` (« Using SSH key from
  # file… ») part sur stderr, c'est-à-dire dans le fichier d'empreinte lu juste au-dessus. On ne
  # retient malgré tout que l'alphabet base64, sans supposer l'absence de retours à la ligne ou
  # d'espaces introduits en route.
  #
  # Et si une version future de la CLI écrivait sa bannière sur stdout, la contamination ne
  # produirait pas une sauvegarde silencieusement corrompue : la comparaison d'empreintes
  # ci-dessous échouerait et l'artefact serait supprimé. Le pire cas est un échec bruyant.
  tr -cd 'A-Za-z0-9+/=' <"$b64" | base64 -d >"$sortie_locale" \
    || { rm -f "$b64" "$empreinte" "$sortie_locale"; echec "Décodage de l'artefact a échoué."; }
  rm -f "$b64" "$empreinte"

  local sha_local
  sha_local="$(sha256sum "$sortie_locale" | cut -d' ' -f1)"
  if [ "$sha_local" != "$sha_distant" ]; then
    rm -f "$sortie_locale"
    echec "Intégrité NON vérifiée : empreinte distante et locale diffèrent. Artefact supprimé, jamais conservé."
  fi

  chmod 600 "$sortie_locale"
  printf '%s  %s\n' "$sha_local" "$(basename "$sortie_locale")" >"${sortie_locale}.sha256"
  chmod 600 "${sortie_locale}.sha256"
  journal "Intégrité vérifiée (SHA-256 identique dans le conteneur et sur ce poste)."
}

# Rétention locale. Supprime les plus anciens artefacts d'un même préfixe au-delà du nombre à
# conserver, et JAMAIS en dessous de RETENTION_MIN : une politique de rétention mal réglée ne doit
# pas pouvoir détruire la propriété « deux sauvegardes consécutives existent ».
appliquer_retention() {
  local prefixe="$1" a_conserver="$RETENTION_A_CONSERVER"
  if [ "$a_conserver" -lt "$RETENTION_MIN" ]; then
    journal "Rétention demandée ($a_conserver) inférieure au plancher ($RETENTION_MIN) — plancher appliqué."
    a_conserver="$RETENTION_MIN"
  fi

  local -a artefacts=()
  while IFS= read -r fichier; do artefacts+=("$fichier"); done < <(
    find "$RACINE_SAUVEGARDES" -maxdepth 1 -type f -name "${prefixe}-*" ! -name '*.sha256' -printf '%f\n' | sort
  )

  local total=${#artefacts[@]}
  if [ "$total" -le "$a_conserver" ]; then
    journal "Rétention : $total artefact(s) '$prefixe' conservé(s) (plafond $a_conserver, rien à supprimer)."
    return 0
  fi

  local a_supprimer=$((total - a_conserver)) i=0
  for fichier in "${artefacts[@]}"; do
    [ "$i" -lt "$a_supprimer" ] || break
    # Un artefact et ses compagnons partent ENSEMBLE : une empreinte ou un manifeste orphelin
    # laisserait croire qu'une sauvegarde existe encore. Les deux noms sont explicites, jamais un
    # glob qui pourrait emporter autre chose.
    local base="${fichier%%.*}"
    rm -f -- \
      "$RACINE_SAUVEGARDES/$fichier" \
      "$RACINE_SAUVEGARDES/$fichier.sha256" \
      "$RACINE_SAUVEGARDES/$base.manifeste.sha256"
    journal "Rétention : artefact ancien supprimé — $fichier"
    i=$((i + 1))
  done
  journal "Rétention : $a_conserver artefact(s) '$prefixe' conservé(s)."
}
