# ADR-013 — Documents réels : stockage filesystem local V1, hors `public/`

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Le conseiller doit pouvoir attacher de vrais documents (mandats, diagnostics, plans, compromis...)
à un bien réel, sans construire une GED complète. Trois stratégies de stockage du binaire étaient
envisageables : bytea en base Postgres, objet externe (S3/GCS/Drive), filesystem local du serveur.
Aucune infrastructure objet n'existe dans le projet à ce jour (`.env.local.example` et
`infra/docker-compose.yml` audités : ni clé, ni bucket, ni volume dédié) et aucune cible de
déploiement n'est encore documentée — l'app tourne aujourd'hui uniquement en local.

## Décision

**Filesystem local**, dans un répertoire dédié (`apps/web/stockage-documents/`, jamais commité),
servi exclusivement via un Route Handler (`/api/documents/[id]`) — jamais par `public/`, qui est
servi sans aucun contrôle d'accès et donc inadapté à des documents potentiellement confidentiels.

Le nom physique sur disque est une **clé de stockage opaque** générée côté serveur
(`randomUUID()`, `src/lib/stockageDocuments.ts`), jamais dérivée d'un nom ou chemin fourni par
l'utilisateur — élimine par construction tout risque de path traversal, de collision, ou de
problème d'encodage. Le nom original du fichier reste une métadonnée en base (`documents_bien.
nom_fichier_original`), restituée uniquement via l'en-tête `Content-Disposition` au téléchargement.

Le corps d'une Server Action est plafonné à 1 Mo par Next.js par défaut ; relevé à 11 Mo
(`next.config.ts`, `experimental.serverActions.bodySizeLimit`) pour couvrir la limite applicative
de 10 Mo par fichier (`src/actions/ajouterDocumentBien.ts`) plus la marge d'overhead
multipart/form-data documentée par Next.js.

Type MIME restreint à une liste blanche stricte (`application/pdf`, `image/jpeg`, `image/png`) —
pas de bureautique, pas d'archives, pas d'exécutables.

Pas de bytea Postgres (alourdirait la base et les sauvegardes sans bénéfice réel) ni de service
objet (aucune infrastructure existante, hors périmètre de cette passe).

## Limites assumées

- **Pas de persistance garantie hors dev local.** Le répertoire n'a pas de volume dédié
  (contrairement à Postgres, qui a le sien dans `infra/docker-compose.yml`) : un futur déploiement
  serverless/conteneurisé sans volume monté perdrait les fichiers à chaque redéploiement. Non
  problématique aujourd'hui (aucune cible de déploiement n'existe), mais un verrou explicite pour
  plus tard.
- **Pas de sauvegarde automatique.** Un vrai backup devrait inclure ce répertoire en plus d'un
  `pg_dump` — non outillé aujourd'hui.
- **Mono-instance implicite**, cohérent avec ADR-006 (mono-conseiller) : un filesystem local ne
  serait plus partagé si l'app tournait un jour sur plusieurs instances.
- **Aucune suppression en V1**, ni applicative ni physique. `ON DELETE CASCADE` sur `bien_id`
  nettoie la ligne `documents_bien` si un bien était supprimé (cas qui n'existe pas aujourd'hui,
  seul l'archivage existe — ADR-012), mais **ne nettoiera jamais le fichier physique associé**. Le
  jour où une suppression est implémentée, elle devra explicitement supprimer la métadonnée DB ET
  le fichier physique (`stockageDocuments.ts` n'expose aujourd'hui aucune fonction de suppression,
  volontairement).
- **Limite de taille à deux niveaux non alignés.** Un upload dépassant `bodySizeLimit` (11 Mo,
  framework) échoue en erreur serveur (500) avant même d'atteindre la validation applicative ;
  seul un fichier entre 10 et 11 Mo déclenche le rejet applicatif propre (redirection silencieuse).
  Comportement vérifié en conditions réelles, documenté dans `docs/KNOWN_LIMITATIONS.md`.

## Alternatives écartées

**Bytea en base** : simplicité de sauvegarde (un seul `pg_dump` couvre tout), mais alourdit
Postgres pour un usage qui n'en a pas besoin, et complique le streaming de fichiers volumineux.

**S3/GCS/Drive** : la cible naturelle à terme (persistance, réplication, partage contrôlé), mais
aucune infrastructure de ce type n'existe dans le projet — l'introduire pour cette seule
fonctionnalité aurait été disproportionné pour du V1 local.

## Conséquences

- Toute future fonctionnalité de suppression de document devra explicitement supprimer le fichier
  physique en plus de la ligne DB — `ON DELETE CASCADE` seul ne suffit jamais.
- Un futur déploiement hors dev local devra traiter le stockage de documents comme un problème
  d'infrastructure à part entière (volume persistant a minima, migration vers un stockage objet à
  terme) — pas une extension gratuite de la config Postgres existante.
