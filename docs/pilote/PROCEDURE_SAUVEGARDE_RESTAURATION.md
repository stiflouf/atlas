# Procédure d'exploitation — sauvegarde et restauration

Statut : procédure d'exploitation. Les scripts existent déjà et sont inchangés par ce lot.
Chantier : `PILOT_LEGAL_AND_OPERATING_PROCEDURES_V1`

**Source canonique du mode opératoire, des variables et des garanties : `ops/backup/README.md`.**
Ce document ne le réécrit pas : il dit **qui fait quoi, quand, et quoi faire en cas d'échec**.
Le raisonnement et la validation réelle d'août 2026 restent dans `docs/PILOT_RUNBOOK.md` §6.

## Les trois gestes

| Geste | Commande | Touche la production |
|---|---|---|
| Sauvegarde base | `ops/backup/backup-db.sh` | lecture seule |
| Sauvegarde documents | `ops/backup/backup-volume.sh` | lecture seule |
| Test de restauration | `ops/backup/restore-test.sh` | **jamais** — PostgreSQL Docker jetable, détruit à la fin |

Aucun argument, aucune interaction. Un code de sortie non nul est un échec réel, jamais un
avertissement.

Prérequis : session `railway` CLI valide, et Docker disponible pour le test de restauration.

## Cadence proposée pour le pilote

Non planifiée aujourd'hui : la décision appartient à l'exploitant, et aucun ordonnanceur n'est posé.

| Quand | Quoi | Pourquoi |
|---|---|---|
| Chaque jour ouvré | `backup-db.sh` puis `backup-volume.sh` | la base et les documents se perdent ensemble ; les sauvegarder séparément ne les réconcilie pas |
| Chaque semaine | `restore-test.sh` | une sauvegarde jamais restaurée n'est pas une sauvegarde |
| Avant toute migration | les deux sauvegardes, puis vérification | `docs/PROCEDURE_MIGRATION_PRODUCTION.md` étape 3 |
| Avant la fin du pilote | les deux, plus un export par personne si une restitution est due | `docs/pilote/PROCEDURE_EXPORT_PERSONNE.md` |

Un exemple de `cron` utilisateur figure dans `ops/backup/README.md`, avec sa limite énoncée : il ne
s'exécute que quand le poste est allumé, et le poste est un point de défaillance unique.

## Vérification après chaque exécution

1. **Code de sortie nul.** Les scripts vérifient déjà le SHA-256 dans le conteneur **et** sur le
   poste, et suppriment l'artefact en cas d'écart plutôt que de le conserver sous un nom rassurant.
2. **Deux sauvegardes consécutives existent.** La rétention locale garde quatorze artefacts par
   type, avec un plancher absolu de deux.
3. **Le test hebdomadaire de restauration est passé.** `pg_restore --exit-on-error` : aucune erreur
   tolérée.

```bash
ls -lt ~/domiora-backups/railway/ | head -8      # artefacts récents, sans ouvrir leur contenu
tail -20 ~/domiora-backups/journal.log           # si la planification est posée
```

Ne jamais ouvrir le contenu d'une sauvegarde pour « vérifier » : elle contient les données
personnelles réelles du pilote. Les empreintes et les codes de sortie sont les preuves ; la lecture
du contenu n'en est pas une.

## En cas d'échec

| Symptôme | Cause probable | Geste |
|---|---|---|
| Le script s'arrête sur la vérification du projet Railway | mauvais projet sélectionné, ou nom divergent | ne pas forcer : vérifier `railway status`. Un nom contenant `domiora-demo` est refusé volontairement |
| Écart de SHA-256 | transfert corrompu | l'artefact est déjà supprimé par le script ; relancer. Deux échecs consécutifs = ne pas insister, diagnostiquer |
| `railway ssh` en échec | session CLI expirée | se reconnecter à la CLI, relancer |
| `restore-test.sh` échoue | artefact inexploitable | **traiter comme un incident de sauvegarde**, pas comme un problème de test : la dernière sauvegarde n'est pas restaurable. Relancer une sauvegarde, puis retester |
| Docker indisponible | — | la sauvegarde reste possible, le test de restauration non. Ne pas déclarer la sauvegarde validée |

## Restauration réelle — ce n'est pas le test

`restore-test.sh` ne restaure **jamais** vers la production, par construction.

Une restauration réelle est un geste humain délibéré, lourd, qui **perd toute donnée créée depuis la
sauvegarde**. Elle n'est jamais automatique et jamais le réflexe par défaut.

Séquence :

1. **Constater d'abord, dans un environnement jetable**, que l'artefact choisi est bon
   (`restore-test.sh`, ou une restauration manuelle dans un conteneur jetable).
2. **Décider explicitement**, en mesurant la perte : quelle fenêtre de données disparaît.
3. **Informer le conseiller pilote** avant, pas après : des données qu'il a saisies vont disparaître.
4. **Restaurer** selon `docs/PILOT_RUNBOOK.md` §8 (rollback données) et
   `docs/PROCEDURE_MIGRATION_PRODUCTION.md`.
5. **Vérifier après** : `/api/health` en `200` avec les trois états `UP`, connexion réelle,
   téléchargement d'un document existant, intégrité de l'historique des transmissions.
6. **Reconnecter Google si nécessaire** : la connexion est rattachée à l'identité, et une
   restauration peut exiger une reconnexion par `/api/auth/google/login`.

**La base et le volume documentaire se restaurent ensemble.** Restaurer la base seule laisse des
lignes `documents_bien` pointant des fichiers absents, et des fichiers orphelins que rien ne
référence.

## Ce qui n'est pas résolu

`OFFSITE_BACKUP_DESTINATION = DECISION_REQUIRED`

Les artefacts sont écrits sur le poste de l'exploitant. C'est hors de l'environnement de production
— une perte totale du projet d'hébergement laisserait les sauvegardes intactes — mais ce n'est pas
une stratégie hors site : un seul support, un seul lieu, aucune redondance, aucun chiffrement au
repos autre que celui du disque.

Choisir une destination cloud est une **décision de sous-traitance**, pas une tâche technique : les
sauvegardes contiennent les données personnelles réelles du pilote. Restent à décider le
fournisseur, la localisation des traitements, le chiffrement avant envoi, la durée de conservation
hors site, et l'inscription de ce sous-traitant dans la documentation. Les scripts sont prêts à
recevoir une étape d'expédition : les artefacts et leurs empreintes sont déjà des fichiers
autonomes et vérifiables.

## À valider par un juriste

1. **Durée de conservation des sauvegardes.** Quatorze artefacts par type est un réglage technique,
   pas une politique de conservation décidée. Les sauvegardes ne relèvent d'aucune des neuf
   politiques de `conservation.ts`.
2. **Les sauvegardes et le droit à l'effacement.** Une personne effacée de la base reste dans les
   sauvegardes antérieures, qui ne sont pas expurgées. Position à arrêter et à énoncer dans la
   notice.
3. **Destination hors site.** Avant tout envoi : qualification du fournisseur et acte de
   sous-traitance.

## Décisions produit requises

1. **Poser ou non la planification `cron`.** Non posée aujourd'hui ; sans elle, la sauvegarde dépend
   d'un geste humain quotidien.
2. **Chiffrement des artefacts au repos.** Non implémenté. Prérequis à tout envoi hors site.
3. **Surveillance de l'échec silencieux.** Rien ne signale qu'une sauvegarde n'a pas eu lieu.
   `ERROR_ALERTING_PROVIDER = DECISION_REQUIRED`.
