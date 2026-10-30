# Sauvegarde et restauration DOMIORA

Scripts reproductibles de sauvegarde de l'instance pilote (`PILOT_PRODUCTION_HARDENING_V1`,
chantier C). Ils remplacent la suite de commandes manuelles de
`docs/PILOT_RUNBOOK.md#6-stockage-documentaire-et-backup` — procédure qui restait correcte mais
dépendait entièrement de la mémoire et de la disponibilité de l'exploitant.

Ce répertoire ne contient **aucun secret**, et les scripts n'en impriment aucun.

## Les trois scripts

| Script | Rôle | Touche la production |
|---|---|---|
| `backup-db.sh` | Dump PostgreSQL horodaté + SHA-256 + vérification de la signature `PGDMP` | lecture seule (+ un fichier temporaire dans `/tmp` du conteneur, détruit dans la même commande) |
| `backup-volume.sh` | Archive `tar.gz` du volume documentaire + SHA-256 + manifeste par fichier | idem |
| `restore-test.sh` | Restaure la sauvegarde la plus récente dans un PostgreSQL Docker **jetable**, vérifie, détruit | **jamais** — aucune commande Railway, aucun accès réseau |

```bash
ops/backup/backup-db.sh
ops/backup/backup-volume.sh
ops/backup/restore-test.sh
```

Aucun argument. Aucune interaction. Code de sortie non nul = échec réel, jamais un avertissement.

## Ce qui est garanti par construction

- **La cible est prouvée avant toute commande distante.** `railway status --json` est interrogé et
  son nom de projet comparé à `sparkling-rejoicing` ; toute divergence arrête le script. Un nom
  contenant `domiora-demo` est refusé explicitement — sauvegarder la démo serait inutile, la
  confondre avec le pilote serait grave.
- **Aucun secret n'est exposé.** `DATABASE_URL` est lue uniquement par `pg_dump`, à l'intérieur du
  conteneur Postgres, depuis son propre environnement. Elle ne transite pas par le poste, n'apparaît
  dans aucun log ni nom de fichier. Aucun `set -x` nulle part.
- **`DATABASE_PUBLIC_URL` n'est jamais utilisée.** Le proxy TCP public de Railway n'a pas à être
  ouvert : la sauvegarde part de l'intérieur du réseau privé.
- **L'intégrité du transfert est prouvée de bout en bout.** Le SHA-256 est calculé *dans le
  conteneur*, l'artefact transféré en base64 (la sortie de `railway ssh` n'est pas garantie
  transparente aux octets), puis l'empreinte recalculée localement. En cas d'écart, l'artefact est
  **supprimé** plutôt que conservé sous un nom rassurant.
- **Aucun contenu de document n'est lu, affiché ni journalisé.** Le manifeste ne porte que des
  chemins et des empreintes ; les noms physiques sont des UUID opaques générés par Atlas, jamais un
  nom fourni par un utilisateur.
- **Le test de restauration est hermétique.** Conteneur Docker sans volume ni port publié, détruit
  par un `trap` qui s'exécute aussi sur échec ou interruption. `pg_restore --exit-on-error` : aucune
  erreur tolérée.

## Rétention locale

14 artefacts conservés par type (`DOMIORA_BACKUP_RETENTION`), les plus anciens supprimés au-delà,
avec leurs fichiers compagnons (empreinte, manifeste) pour ne jamais laisser d'orphelin qui ferait
croire à une sauvegarde existante. **Plancher absolu de 2** : une rétention mal réglée ne doit pas
pouvoir détruire la propriété « deux sauvegardes consécutives existent ».

Les sauvegardes manuelles antérieures (`domiora-prod-*`, `domiora-documents-2026*-*` au format
d'août 2026) portent une autre convention de nommage et ne sont **délibérément pas** gérées par
cette rétention : un script ne supprime pas des fichiers qu'il n'a pas créés.

## Variables

Toutes optionnelles, aucune n'est un secret.

| Variable | Défaut | Rôle |
|---|---|---|
| `DOMIORA_BACKUP_DIR` | `~/domiora-backups/railway` | Destination des artefacts |
| `DOMIORA_BACKUP_PROJET` | `sparkling-rejoicing` | Projet Railway attendu (prouvé, pas supposé) |
| `DOMIORA_BACKUP_ENVIRONNEMENT` | `production` | Environnement Railway |
| `DOMIORA_BACKUP_SERVICE_DB` | `Postgres` | Service de la base |
| `DOMIORA_BACKUP_SERVICE_WEB` | `DOMIORA` | Service portant le volume |
| `DOMIORA_BACKUP_RETENTION` | `14` | Artefacts conservés par type (plancher 2) |
| `DOMIORA_RESTORE_IMAGE` | `postgres:18` | Image de la base jetable |
| `DOMIORA_RESTORE_ECHANTILLON` | `3` | Fichiers comparés au manifeste de production |
| `RAILWAY_BIN` | `railway` | Chemin de la CLI Railway |

## Automatisation

Les scripts sont non interactifs et idempotents dans le temps (chaque exécution produit un nouvel
horodatage) : ils sont prêts à être planifiés. **Aucune planification n'est posée par ce lot** — la
décision appartient à l'exploitant, et le choix de l'ordonnanceur dépend de la destination retenue
(voir « Destination hors site » ci-dessous).

Pré-requis d'une exécution planifiée : une session `railway` CLI valide pour l'utilisateur qui
exécute le cron, et Docker disponible pour le test de restauration.

### Option A — poste de l'exploitant (immédiatement disponible)

`cron` de l'utilisateur. `PATH` explicite : un cron n'hérite pas du shell de connexion.

```cron
# Sauvegarde DOMIORA — base + volume, tous les jours à 06h15 locale
15 6 * * * PATH=/usr/bin:/bin:/usr/local/bin:$HOME/.railway/bin \
  /home/sgausset/atlas/ops/backup/backup-db.sh >> $HOME/domiora-backups/journal.log 2>&1 && \
  /home/sgausset/atlas/ops/backup/backup-volume.sh >> $HOME/domiora-backups/journal.log 2>&1

# Test de restauration hebdomadaire — une sauvegarde jamais restaurée n'est pas une sauvegarde
30 6 * * 0 PATH=/usr/bin:/bin:/usr/local/bin \
  /home/sgausset/atlas/ops/backup/restore-test.sh >> $HOME/domiora-backups/journal.log 2>&1
```

Limite honnête de cette option : elle ne s'exécute que quand le poste est allumé, et le poste est
un point de défaillance unique. Elle est suffisante pour un pilote, pas pour un engagement client.

### Option B — hors site, planifié côté infrastructure

Nécessite une destination approuvée — voir ci-dessous. Non configuré.

## Destination hors site — `OFFSITE_BACKUP_DESTINATION = DECISION_REQUIRED`

Les artefacts sont aujourd'hui écrits dans `~/domiora-backups/railway/` sur le poste de
l'exploitant. C'est bien **hors de l'environnement de production** — une perte totale du projet
Railway laisserait les sauvegardes intactes — mais ce n'est **pas** une stratégie hors site : un
seul support, un seul lieu, aucune redondance, aucun chiffrement au repos autre que celui du
disque.

Aucune destination cloud n'est configurée, et ce lot n'en choisit aucune : l'audit du dépôt, de
`docs/` et du poste n'a trouvé **aucun fournisseur de stockage objet déjà approuvé** (ni S3, ni
Backblaze, ni rclone, ni AWS CLI installés ou référencés ailleurs que comme pistes futures dans
ADR-013/050/067). Envoyer des sauvegardes contenant des données personnelles réelles chez un
fournisseur non qualifié serait une décision de sous-traitance RGPD, pas une tâche technique.

Ce qui reste à décider, et qui n'appartient pas à ce lot : le fournisseur, la localisation des
traitements, le chiffrement avant envoi, la durée de conservation hors site, et l'inscription de ce
sous-traitant dans la documentation de conformité. Les scripts sont prêts à recevoir une étape
d'expédition : les artefacts et leurs empreintes sont déjà des fichiers autonomes et vérifiables.

## Restaurer réellement (incident, pas test)

`restore-test.sh` ne restaure jamais vers la production, par construction. Une restauration réelle
reste un geste humain délibéré, décrit par
`docs/PILOT_RUNBOOK.md#8-rollback` et `docs/PROCEDURE_MIGRATION_PRODUCTION.md` — à exécuter
seulement après avoir constaté, dans un environnement jetable, que l'artefact choisi est bon.
