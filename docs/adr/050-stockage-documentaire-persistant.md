# ADR-050 — Stockage documentaire persistant et sûr

**Statut :** Accepté
**Date :** 2026-08-17
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Un audit ciblé (ADR-049, point 20) a confirmé que le stockage documentaire (`stockage-documents/`,
filesystem local) dépend de `process.cwd()`, codé en dur, sans volume persistant démontré. Un
redéploiement Railway sans volume explicitement monté ferait disparaître silencieusement tous les
documents — risque bloquant avant toute utilisation avec de vrais documents. ADR-013 avait déjà
anticipé cette limite comme un verrou explicite pour plus tard ; ADR-050 le ferme.

**Hors périmètre, confirmé par l'audit** : S3/objet, CDN, multi-provider, backup engine codé, route
HTTP health publique, suppression documentaire, durcissement symlink, validation MIME par magic
bytes, migration DB, évolution fonctionnelle ADR-029/030/049.

## Décision

### 1. Variable `ATLAS_DOCUMENT_STORAGE_DIR` — seule source de configuration

Lue **uniquement** dans `src/lib/stockageDocuments.ts` — aucun autre fichier ne lit
`process.env.ATLAS_DOCUMENT_STORAGE_DIR` directement.

- **Production** (`NODE_ENV=production`) : obligatoire, doit être un chemin absolu pointant vers un
  répertoire déjà existant. Absente, relative, ou inexistante → refus explicite
  (`ErreurStockageDocumentsIndisponible`), **jamais** de repli silencieux.
- **Hors production** : optionnelle. Si définie, utilisée telle quelle. Sinon, repli sur le
  comportement historique (`path.join(process.cwd(), "stockage-documents")`), créé automatiquement
  si nécessaire — préserve un poste de développement sans configuration.

### 2. Aucune création automatique de la racine en production

Un répertoire configuré mais absent signifie très probablement un volume non monté. Le créer
masquerait exactement l'erreur que cette ADR doit rendre visible. En production,
`verifierDisponibiliteStockageDocuments()` ne fait jamais de `mkdir` — seulement des vérifications
(existence, type répertoire, lecture, écriture si demandée).

### 3. Fail-closed paresseux au runtime, pas au build/démarrage

Aucun refus de démarrage global de l'application ni blocage au `next build` : le build peut
s'exécuter dans un environnement différent du runtime, et une panne documentaire ne doit pas
empêcher la consultation des fonctionnalités CRM non documentaires. En revanche, **chaque**
opération documentaire (`ecrireDocument`, `lireDocument`) vérifie sa configuration avant tout accès
disque — jamais de repli silencieux vers un filesystem éphémère.

### 4. Fonction centrale de disponibilité, sans nouvelle route HTTP

`verifierDisponibiliteStockageDocuments(options?: {ecriture?: boolean})` — testable, sans cache
définitif (une résolution figée au démarrage masquerait un volume démonté/une permission perdue en
cours de vie du process). Point de réutilisation futur pour un readiness-check ; **aucune route
`/api/health/...` créée dans cette passe**.

### 5. Erreur dédiée — jamais confondue avec un document absent

`ErreurStockageDocumentsIndisponible` couvre à la fois une mauvaise configuration et une
indisponibilité runtime. Distinction stricte préservée dans `lireDocument()` :
- fichier précis absent (`ENOENT` sur ce fichier, racine par ailleurs disponible) → `undefined`,
  comportement 404 inchangé.
- racine indisponible/mal configurée → `ErreurStockageDocumentsIndisponible`, jamais `undefined`.

Répercuté dans les 3 points de lecture :
- `GET /api/documents/[id]` → 503 JSON générique si stockage indisponible, 404 inchangé sinon.
- `POST /api/biens/[id]/pack-notaire` → 503 si stockage indisponible (distinct du 422
  `ErreurGenerationPack` déjà existant pour un fichier précis manquant) ; ZIP toujours atomique,
  aucun changement à `genererZipPackNotaire.ts`.
- `enregistrerTransmissionDossierNotaireAction` (ADR-049) → `{statut:"echec", message:"..."}`
  distinct du message "introuvable" existant, avant tout INSERT — aucune transmission partielle.

`ajouterDocumentBienAction` (upload) : aucun changement — `ErreurStockageDocumentsIndisponible` se
propage comme n'importe quelle autre erreur de validation de ce fichier (`throw new Error(...)`),
cohérent avec le style existant.

### 6. Tests isolés, jamais le dossier de dev réel

Toutes les suites qui écrivaient des fichiers réels (`stockageDocuments.test.ts`,
`ajouterDocumentBien.test.ts`, `genererZipPackNotaire.test.ts`, `documents/[id]/route.test.ts`,
`pack-notaire/route.test.ts`, `transmissionDossierNotaire.test.ts`) utilisent désormais
`ATLAS_DOCUMENT_STORAGE_DIR` pointant vers un répertoire temporaire unique (`mkdtemp`), nettoyé en
fin de suite. Aucune ne dépend plus de `process.cwd()` implicite — une pollution silencieuse de ce
type avait déjà été observée dans une session de développement précédente.

## Hors périmètre, volontairement

S3/objet, CDN, multi-provider, upload direct client→cloud, backup engine codé dans Atlas, route HTTP
health publique, suppression documentaire, cleanup automatique, durcissement symlink (risque classé
faible pour un pilote mono-conseiller sans accès shell externe), validation MIME par magic bytes,
antivirus, chiffrement fichier applicatif supplémentaire, versioning documentaire, GED, migration DB,
évolution fonctionnelle ADR-029/030/049, Gmail, Proxy/session/ADR-047/048.

## Conséquences

- **0 migration** — `documents_bien.cle_stockage` reste indépendant du répertoire racine, aucune
  colonne DB liée au chemin physique.
- Fichier modifié : `src/lib/stockageDocuments.ts` (seul point de lecture de la variable, désormais
  seul point d'écriture réelle sur disque possible).
- Fichiers modifiés (distinction stockage indisponible / document absent) :
  `src/app/api/documents/[id]/route.ts`, `src/app/api/biens/[id]/pack-notaire/route.ts`,
  `src/actions/transmissionDossierNotaire.ts`.
- `apps/web/.env.local.example` : nouvelle variable documentée.
- Checklist Railway (`docs/adr/047-securisation-pilote-mono-conseiller.md`) complétée d'une
  sous-section "Stockage documentaire".
- **Dettes non traitées, réaffirmées** : la checklist ADR-029 ne détecte toujours pas un fichier
  physiquement disparu (un document reste affiché "present" tant que sa ligne DB existe) ; la
  validation MIME repose toujours sur `file.type` déclaré par le client, jamais les octets réels ;
  un fichier orphelin reste possible si l'écriture disque réussit puis que l'INSERT DB échoue (aucun
  rollback/cleanup) ; **une sauvegarde du volume reste entièrement à définir côté exploitation —
  un volume persistant n'est pas une stratégie de backup.**
- **Code prêt à utiliser un volume persistant** — la configuration externe Railway (créer/attacher le
  volume, définir la variable sur le mount path réel, vérifier la persistance après un redéploiement
  réel) reste entièrement à effectuer et valider manuellement, hors périmètre de cette passe de code.
