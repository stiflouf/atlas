# ADR-052 — Photos de Bien : galerie, photo principale et stockage

**Statut :** Accepté
**Date :** 2026-08-25
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

`Bien` ne porte aujourd'hui aucun champ photo (`src/types/bien.ts`, 24 champs, confirmé par audit).
`PropertyVisual` (branche `design/polish-final`) implémente déjà la règle cible — vraie photo
prioritaire, placeholder DOMIORA sinon — mais aucun écran ne peut l'activer : le contrat de
`PropertyVisual` a été délibérément conçu sans `photoUrl`, pour ne jamais exposer une API morte en
attendant ce cadrage. Cette ADR ferme ce chantier : une vraie galerie de photos par Bien, une photo
principale déterministe, sans jamais retoucher `PropertyVisual` ni `TypeBien`.

**Hors périmètre, confirmé par l'audit préalable** : synchronisation IAD/SeLoger/Leboncoin/Bien'ici,
IA de retouche/reconnaissance/génération de description, CDN, multi-tenant, watermark, visite
virtuelle, vidéo, plans 3D, thumbnails générées serveur (une seule version optimisée suffit),
nettoyage automatique des fichiers orphelins, redesign de la Fiche Bien.

## Décision

### 1. Table dédiée `photos_bien`, jamais une extension de `documents_bien`

`documents_bien` porte un vocabulaire (catégorie, type de document légal, rattachements
compromis/acquéreur/prospect vendeur) étranger à une photo, et n'a **jamais implémenté de
suppression** (ni fonction, ni test — vérifié exhaustivement). Une photo exige une galerie ordonnée
et une suppression dès la V1 : mélanger les deux tables aurait importé un vocabulaire et un cycle de
vie qui ne correspondent pas.

Colonnes : `id` (uuid, PK), `bienId` (uuid, FK `biens.id` `ON DELETE CASCADE`), `cleStockage`,
`nomFichierOriginal`, `typeMimeOriginal` (CHECK `image/jpeg|image/png|image/webp`),
`tailleOctetsOriginal` (CHECK `> 0`), `hashSha256`, `ordre` (CHECK `>= 0`), `creeLe`. Index composite
`(bienId, ordre, creeLe, id)` — couvre exactement le tri de lecture (§2/§5).

**Volontairement absents** : `photoUrl` (contrat déjà tranché côté `PropertyVisual`), `estPrincipale`
(§2), `largeur`/`hauteur` (Sharp les lit à l'upload, mais aucune fonctionnalité V1 ne les consomme —
rendu en `fill` + ratio CSS fixe ; ajouter les colonnes maintenant poserait une ambiguïté prématurée
entre dimensions originales/après auto-orientation/optimisées pour un gain nul ; migration additive
triviale si un besoin apparaît).

### 2. Photo principale dérivée, jamais une colonne `estPrincipale`

Tri total unique : `ordre ASC, creeLe ASC, id ASC` — **identique** en galerie et pour la résolution
de la photo principale (`LIMIT 1` sur ce même tri, `id` en dernier départage garantit un résultat
déterministe même en cas de collision d'`ordre`). « Définir comme principale » est un déplacement en
position 0, pas la mutation d'un flag séparé : source de vérité unique, aucun invariant
d'unicité/exclusivité supplémentaire à maintenir.

### 3. `ordre` entier, volontairement NON unique

Pas de `UNIQUE(bienId, ordre)` : cette contrainte imposerait une transaction de swap à chaque
réorganisation. Filet de simplicité assumé — le tri total (§2) reste déterministe même sous
collision. Une nouvelle photo est ajoutée en fin de galerie : `MAX(ordre) + 1` pour ce bien (0 si
vide), calculé sous le même verrou que la vérification de limite (§4).

### 4. Sérialisation des mutations de galerie par verrou de ligne (`SELECT ... FOR UPDATE`)

La limite de 20 photos/bien doit rester correcte sous upload concurrent — un test-puis-écriture non
protégé y échouerait (race). `ajouterPhotoBien`, `reordonnerPhotosBien` et `supprimerPhotoBien`
verrouillent tous la ligne `biens` correspondante (`tx.select(...).where(...).for("update")`, API
Drizzle confirmée disponible) au début de leur transaction — sérialise toutes les mutations de
galerie d'un **même** bien entre elles, sans jamais bloquer celles d'un autre bien.

### 5. Réorganisation : réécriture complète, rejet total si l'ensemble diverge

`reordonnerPhotosBien(bienId, photoIds)` réécrit l'intégralité des `ordre` en `0..N-1`, jamais une
mise à jour partielle. Si l'ensemble soumis ne correspond pas exactement (cardinalité, doublon,
omission, photo d'un autre bien) à la galerie réelle du bien sous verrou : rejet de l'opération
**entière**, rien n'est écrit.

### 6. Suppression : DB d'abord, fichiers ensuite en best-effort

Principe déjà appliqué côté upload de `documents_bien` (ADR-050) : toute incohérence résiduelle doit
se résoudre en **fichier orphelin** (invisible), jamais en **ligne DB pointant vers un fichier
absent** (visible, cassé). `supprimerPhotoBien` supprime la ligne, puis l'appelant supprime les deux
fichiers physiques en best-effort. Idempotent : une photo déjà absente en DB n'est jamais une erreur.
Un fichier physique déjà absent au moment du nettoyage n'est pas non plus une erreur (état déjà
atteint). Aucun secret, contenu de fichier ou chemin fourni par l'utilisateur n'est jamais journalisé
— seuls l'id de la photo et sa `cleStockage` (opaque) apparaissent dans les logs de compensation.

### 7. Upload : fichiers avant DB, compensation best-effort si l'un échoue

`exigerSessionAtlas()` → validation bien/fichier → traitement Sharp (rejette un contenu réellement
illisible **avant** toute écriture) → clé opaque → écriture originale → écriture optimisée → INSERT
DB. Si l'écriture du second fichier échoue : suppression best-effort du premier, aucune ligne DB
créée. Si l'INSERT échoue après écriture des deux fichiers : suppression best-effort des deux,
l'échec DB n'est jamais masqué (il est retourné explicitement à l'appelant). Même principe qu'en §6 :
la résolution résiduelle est toujours un fichier orphelin, jamais une ligne DB cassée.

### 8. Validation réelle du contenu, jamais une confiance dans `file.type`

Le fichier est décodé par Sharp (`sharp(buffer).metadata()`) — un contenu non décodable (corrompu,
faux JPEG, format non supporté type HEIC/GIF/BMP) est rejeté avant toute écriture disque. Le MIME
persisté est celui déduit du format **réellement décodé**, jamais celui déclaré par le client.

### 9. Une seule version optimisée, pas de pipeline

À l'upload : orientation EXIF corrigée (`sharp().rotate()`), redimensionnement `fit: "inside"` max
1600 px sur le grand côté, `withoutEnlargement`, export WebP qualité 75. Une seule version sert
indifféremment hero/card/thumb via `fill` + `object-cover` côté composant — pas de thumbnails
multiples, pas de pipeline asynchrone, pas de CDN. L'original est conservé intact, jamais retouché.

### 10. Stockage : réutilise `ATLAS_DOCUMENT_STORAGE_DIR`, sous-répertoires dédiés

Aucune nouvelle variable d'environnement, aucun nouveau volume Railway. Réutilise la racine et sa
garde de disponibilité fail-closed (`verifierDisponibiliteStockageDocuments`, ADR-050) sous
`photos/originaux/` et `photos/optimisees/` — séparés du vocabulaire `documents_bien`, mais sur le
même volume physique (impact backup nul, §13). `cleStockage` (uuid opaque, jamais dérivée d'un nom
fourni par l'utilisateur) sert de base au nom physique des deux fichiers — chemins toujours
construits côté serveur, aucune entrée utilisateur ne détermine un chemin filesystem.

### 11. `sharp` en dépendance directe

`sharp` n'était disponible que transitivement (`optionalDependencies` de `next`), non résolvable
depuis `apps/web`. Ajouté explicitement à `apps/web/package.json` (`^0.35.3`, compatible lockfile
existant) — vérifié résolu depuis `apps/web` après installation.

### 12. Limites pilotables en code, pas en contraintes SQL rigides

12 Mo/photo, 20 photos/bien (`src/types/photoBien.ts`) — ajustables sans migration. `bodySizeLimit`
(Server Actions, plafond **global**, pas de scope par action) relevé de 11 Mo à 13 Mo ; `documents_bien`
garde sa propre validation applicative à 10 Mo, ce relèvement ne change donc pas sa limite métier.

### 13. Upload multiple côté UX, une Server Action par fichier

Sélection multiple côté UI, mais chaque fichier est envoyé dans un appel séparé de
`ajouterPhotoBienAction` (jamais les N fichiers dans une seule requête) — élimine structurellement le
risque d'une requête à 20 × 12 Mo. Concurrence client limitée à 2. Un échec sur un fichier n'annule
jamais les fichiers déjà envoyés avec succès dans le même lot — l'action retourne un résultat
`{ succes, ... }` plutôt que `redirect()`, contrairement au reste des Server Actions de mutation
Bien : c'est le seul moyen d'obtenir un feedback par fichier depuis un composant client pilotant
plusieurs appels.

### 14. Lecture liste Biens sans N+1 : sous-requête corrélée

`listerBiens()` et `rechercherBiensPage()` récupèrent `photoPrincipaleId` dans **la même requête**
que la page de résultats (sous-requête corrélée sur `photos_bien`, même tri qu'en §2), jamais un
`getPhotoPrincipaleBien()` par card. Un seul aller-retour SQL pour toute une page, quel que soit le
nombre de biens affichés. `Bien` (type de base) reste inchangé — l'extension `BienAvecPhotoPrincipale`
(`Bien & { photoPrincipaleId?: string }`) n'est portée que par ces deux fonctions ; `getBienById` et
toutes les mutations continuent de manipuler `Bien` tel quel.

### 15. Route `/api/photos-bien/[photoId]` : authentifiée, jamais `unoptimized` public

Même garde que `/api/documents/[id]` (session Atlas obligatoire, ADR-047), mais sans
`Content-Disposition: attachment` (doit s'afficher inline) et sert toujours la version **optimisée**
WebP. `cleStockage` ne quitte jamais le serveur — seul l'id de la ligne circule. 404 sans distinction
observable entre ligne DB absente et fichier physique absent ; 503 si le stockage est indisponible
(ADR-050).

Vérifié dans le code de Next.js 16.3.0 installé
(`node_modules/next/dist/server/image-optimizer.js`) : l'Image Optimizer ne transmet **jamais** le
cookie de session vers une route source, ni en externe (`fetchExternalImage`, aucun header transmis)
ni en interne (`fetchInternalImage`, requête mockée sans `headers`). `<Image unoptimized>` est donc
la seule option techniquement correcte pour une route protégée : le navigateur charge alors l'URL
lui-même en same-origin, cookie inclus (`sameSite: "lax"` n'affecte que le cross-site).

### 16. Cache privé, jamais immutable — authentification avant toute revalidation 304

`Cache-Control: private, no-cache` (jamais `public`/`immutable`) : une photo peut être supprimée et
une session révoquée, un cache navigateur figé pendant un an contournerait la revalidation.
`ETag` stable (dérivé de `hashSha256` de l'original — la version optimisée en est une dérivation
déterministe et immuable). La session est vérifiée **avant** toute réponse conditionnelle 304 : le
navigateur réutilise les octets déjà en cache local, mais repasse par l'autorisation serveur à
chaque requête.

### 17. PropertyVisual inchangé — fallback uniquement

Aucun paramètre ajouté à `PropertyVisual`. Le point d'intégration est un nouveau composant dédié
(`PhotoPrincipale`) : vraie photo si `photoPrincipaleId` est fourni, `PropertyVisual` sinon — sur
Liste Biens (desktop et mobile) et Fiche Bien (hero). Un lien « Gérer les photos » (`/biens/[id]/photos`)
est ajouté sur la Fiche Bien ; aucun redesign de son layout existant.

## Conséquences

- Migration `0030_hot_leo.sql` (`CREATE TABLE photos_bien` + FK + index), appliquée sur les bases de
  dev/test locales uniquement — aucune migration production dans cette passe.
- Nouvelle dépendance directe : `sharp` (déjà présente transitivement, aucune nouvelle dépendance
  transitive réelle).
- `bodySizeLimit` global relevé à 13 Mo (impact partagé avec `documents_bien`, sans changement de sa
  limite métier propre).
- Impact backup/restore : nul — `photos/` rejoint le même volume `ATLAS_DOCUMENT_STORAGE_DIR` déjà
  couvert par la procédure manuelle existante (`pg_dump` + `tar.gz`, validée le 2026-08-21). Seul le
  volume de données transférées augmentera.
- Reprise du chantier Fiche Bien (hero + galerie complète du polish design) explicitement différée :
  cette ADR livre le contrat minimal (`PhotoPrincipale`, lien « Gérer les photos »), pas le redesign.
