# ADR-067 — Primitive de suppression de fichier et inventaire des orphelins

Statut : accepté
Date : 2026-10-22
Chantier : `FILE_DELETION_PRIMITIVE_V1`
Complète : ADR-066 (fondation du moteur de rétention, dry-run), ADR-050 (stockage documentaire
persistant et sûr), ADR-052 (photos de bien), ADR-013 (stockage filesystem local V1), ADR-063 (bon de
visite signé)

## Contexte

ADR-066 a livré la fondation du moteur de rétention et constaté que, même pour la seule politique
calculable (`SIGNED_VISIT_FORM`), aucune suppression n'était possible : il manque un modèle de
suspension pour contentieux, un chemin de suppression complet, et **une primitive de suppression de
fichier**. Cette ADR livre la troisième de ces trois briques, et seulement celle-là.

L'audit du stockage mené pour ce chantier a établi l'état réel, qui n'était écrit nulle part :

- Un seul système de fichiers, une seule racine (`ATLAS_DOCUMENT_STORAGE_DIR`, ADR-050), trois
  familles de fichiers : `<racine>/<cleStockage>` (documents de bien, PDF de bon de visite signé,
  PNG de signature — un seul espace de noms à plat), `<racine>/photos/originaux/<cleStockage>` et
  `<racine>/photos/optimisees/<cleStockage>.webp`.
- Il n'existait de suppression de fichier que pour les photos : `supprimerPhotoOriginale` et
  `supprimerPhotoOptimisee` (`src/lib/stockagePhotosBien.ts`), appelées par
  `src/actions/gererPhotosBien.ts` après succès DB et en compensation d'upload. **Aucun** chemin de
  suppression n'existait pour un document de bien, un PDF de bon de visite ou un PNG de signature —
  cohérent avec l'append-only assumé de `documents_bien`.
- Aucune validation défensive de `cleStockage` n'existait au point d'usage : `ecrireDocument`,
  `lireDocument`, `cheminOriginal` et `cheminOptimisee` font un `path.join(racine, cleStockage)`
  brut avec une valeur venue de la base. La sûreté reposait entièrement sur l'invariant « une clé
  est toujours un `randomUUID()` généré par Atlas ».
- Deux divergences fichier/base sont structurellement possibles aujourd'hui : `signerBonVisite`
  écrit le PDF et le PNG **avant** d'ouvrir sa transaction (commentaire explicite dans
  `src/lib/bonVisiteRepository.ts`), donc une transaction perdante laisse des octets sans ligne ; et
  les cascades `ON DELETE cascade` de `documents_bien`, `photos_bien`, `signatures_bon_visite` et
  `bons_visite` laisseraient tous les fichiers correspondants sur disque si elles étaient
  déclenchées — ce qu'aucun code de production ne fait aujourd'hui.

## Décision

### 1. Périmètre : une capacité, pas une règle de cycle de vie

Ce chantier livre la capacité technique de supprimer un fichier et de constater les divergences
fichier/base. Il ne branche cette capacité sur **aucun** chemin métier : ni suppression de bien, ni
suppression de contact, ni suppression de visite, ni purge de rétention, ni cron. Les règles de
cycle de vie du produit sont inchangées, et `documents_bien` reste append-only.

Le motif est le même que celui d'ADR-066 : construire d'abord l'outil vérifiable, décider ensuite de
son usage. Une primitive livrée en même temps que son premier appelant destructif est une primitive
qu'on ne peut plus auditer séparément.

### 2. La primitive n'accepte jamais un chemin

`supprimerFichierStocke({ genre, cleStockage })` (`src/lib/stockage/suppressionFichier.ts`) prend un
**genre de ressource connu d'Atlas** (`document`, `photo_originale`, `photo_optimisee`) et une clé de
stockage. Il n'existe aucun paramètre par lequel exprimer un chemin : la suppression d'un chemin
arbitraire est impossible par construction, non par vigilance de l'appelant.

Le sous-répertoire et l'extension physique (`.webp` pour une version optimisée) sont déduits du
genre, jamais fournis.

### 3. Sécurité du chemin : deux gardes explicites, pas un invariant implicite

`src/lib/stockage/cheminStocke.ts` porte les deux gardes, chacune avec sa propre erreur nommée :

- `validerCleStockage` exige la forme exacte de `genererCleStockage()` — UUID v4 en minuscules.
  Volontairement plus strict que « un nom sans séparateur » : accepter davantage reviendrait à
  accepter des noms qu'Atlas ne produit jamais, donc à élargir la surface de suppression sans besoin
  réel. Une clé en majuscules, suffixée, vide, `.`, `..`, absolue ou contenant un séparateur est
  refusée.
- `resoudreCheminSousRepertoire` prouve, via `path.relative` après `path.resolve`, que la cible reste
  strictement sous le répertoire attendu et qu'elle en est un fichier **direct** — jamais un
  sous-arbre. `path.resolve` neutralise déjà `..` ; la vérification sert à le prouver plutôt qu'à
  faire confiance à la neutralisation.

La valeur refusée n'est jamais interpolée dans le message d'erreur : une clé vient de la base ou,
en cas d'erreur d'appel, d'une entrée externe — elle n'a pas à être recopiée dans un journal.

`lstat` et non `stat` : un lien symbolique est refusé explicitement. Supprimer le lien lui-même
resterait sous la racine, mais Atlas n'en crée jamais — sa présence signale un stockage manipulé hors
du produit, cas où l'on refuse plutôt que de deviner l'intention. Une cible qui n'est pas un fichier
régulier est refusée de la même façon.

### 4. Fichier absent : un état atteint, jamais une erreur

`supprimerFichierStocke` renvoie `{ statut: "supprime" }` ou `{ statut: "deja_absent" }`. L'absence
n'est pas une anomalie : c'est l'état visé, déjà atteint. Un appelant qui rejoue une suppression
interrompue doit pouvoir le faire sans traiter d'exception. La primitive est donc idempotente.

En revanche, une racine de stockage indisponible ou mal configurée remonte comme telle
(`ErreurStockageDocumentsIndisponible`, ADR-050) : un volume démonté n'est pas un fichier déjà
supprimé. `verifierDisponibiliteStockageDocuments({ ecriture: true })` est exigé — un volume monté en
lecture seule échoue honnêtement au lieu de produire une erreur `rm` moins lisible.

### 5. Séparation stricte fichier / base

La primitive n'écrit **jamais** en base, dans aucun cas. Un test structurel le verrouille : le
module ne doit contenir ni `getDb`, ni `drizzle`, ni `.delete(`, ni `.insert(`, ni `.update(`.

Le couple ligne/fichier reste à la charge de l'appelant. C'est délibéré : le stockage n'a pas à
décider du sort d'une donnée métier, et une primitive qui ferait les deux serait impossible à
utiliser dans le seul ordre sûr — fichier après commit DB, exactement ce que fait déjà
`gererPhotosBien` pour les photos.

Aucun repository existant n'est modifié par ce chantier. En particulier, `supprimerPhotoBien`
continue de ne pas effacer de fichier et de retourner la ligne pour que son appelant le fasse.

### 6. Inventaire des orphelins : lecture seule, et nommé comme tel

`inventorierOrphelins()` (`src/lib/stockage/inventaireOrphelins.ts`) constate trois motifs :

- `reference_sans_fichier` — une ligne désigne une clé dont le fichier est absent. Les trois tables
  porteuses sont balayées : `documents_bien.cle_stockage`, `photos_bien.cle_stockage`,
  `signatures_bon_visite.signature_cle_stockage`. Une photo compte pour **deux** fichiers sous une
  seule clé : l'un peut manquer sans l'autre, l'écriture de la version optimisée suivant celle de
  l'original hors transaction.
- `cle_non_verifiable` — la clé en base n'a pas la forme produite par `genererCleStockage()`, donc le
  chemin ne peut pas être construit sûrement et l'existence du fichier n'est pas vérifiable. Jamais
  confondu avec une absence : c'est une divergence de nature différente, et le produit en contient
  déjà (les fixtures de test historiques écrivent des clés non-UUID).
- `fichier_sans_reference` — un fichier est présent sous la racine sans ligne connue qui le désigne.

Le balayage disque est **désactivé par défaut** (`{ balayerDisque: true }` pour l'activer). Le sens
d'un fichier sans référence dépend de la connaissance exhaustive des producteurs de fichiers ; quand
le balayage n'a pas eu lieu, le résultat le dit (`balayageDisqueEffectue: false`) plutôt que de
renvoyer une liste vide qu'on pourrait lire comme « aucun orphelin ».

L'inventaire ne supprime rien, ne corrige rien, n'écrit rien : ni `rm`, ni `unlink`, ni `DELETE`, ni
appel à la primitive de suppression. Un test structurel le verrouille, et deux tests d'intégration
vérifient qu'après un inventaire complet les fichiers et les lignes sont tous encore là. Il
constate ; il ne répare pas, parce que les deux divergences n'ont ni la même cause ni la même
conclusion, et qu'aucune ne se solde par une suppression sans décision humaine.

Sa sortie ne contient aucune PII : type de ressource, identifiant technique de la ligne, motif, et
pour un fichier sans référence son nom physique — qui est un UUID opaque. Jamais
`nomFichierOriginal`, jamais une donnée de bien ou de contact. Un test l'asserte sur un document au
nom volontairement parlant.

### 7. Bon de visite signé : vérifié comme techniquement supprimable, jamais supprimé

La politique `SIGNED_VISIT_FORM` d'ADR-065 (5 ans après signature) n'est **pas** connectée à une
suppression par ce chantier, et l'immutabilité du bon n'est pas touchée.

Ce qui est établi : le PDF d'un bon signé n'est pas une catégorie de fichier à part — `signerBonVisite`
crée une ligne `documents_bien` ordinaire (`typeDocument: "bon_visite"`), donc son fichier relève du
genre `document` et la primitive sait déjà le supprimer ; le PNG de signature, référencé par
`signatures_bon_visite.signature_cle_stockage`, également. Le jour où l'éligibilité sera calculée, où
la suspension pour contentieux existera et où une phase de purge sera explicitement autorisée, aucune
nouvelle primitive de stockage ne sera nécessaire.

À noter : l'immutabilité du bon signé porte sur la **ligne** en base (CHECK de cohérence de statut,
UPDATE conditionné à `statut = 'brouillon'`, unicité `(visite_id, version)`). Le PDF et le PNG sur
disque ne sont immuables que parce qu'aucun code ne les réécrit ni ne les efface — aucune garde
filesystem (permissions, WORM) ne l'impose. Ce chantier ne change pas cet état, mais le documente :
la primitive livrée est désormais un code capable de les effacer, et c'est précisément pour cela
qu'elle n'est branchée sur rien.

### 8. Aucune migration

Aucune table, aucune colonne, aucune migration. La primitive et l'inventaire fonctionnent
entièrement à partir du modèle existant : les trois colonnes de clé de stockage suffisent, et
l'inventaire est un calcul, pas un état à persister. Le numéro de migration le plus élevé reste
`0060`.

## Garanties vérifiées par les tests

41 cas répartis sur deux fichiers (`src/lib/stockage/suppressionFichier.test.ts`,
`src/lib/stockage/inventaireOrphelins.test.ts`), tous isolés dans un répertoire temporaire
(`mkdtemp` + `vi.stubEnv`), jamais le `stockage-documents/` de développement, jamais la production.

- Suppression effective d'un document, d'un original de photo, d'une version optimisée ; les autres
  fichiers de la racine restent intacts ; supprimer l'original d'une photo laisse son optimisée.
- Fichier déjà absent : `deja_absent`, sans exception ; idempotence sur deux appels consécutifs.
- 12 formes de clé refusées, chacune sans que le disque soit touché : traversée simple, profonde,
  encadrée par un UUID valide, chemin absolu externe, sous-chemin sous la racine, chaîne vide, `.`,
  `..`, nom non UUID, séparateur ajouté, extension ajoutée, UUID en majuscules.
- Genre de ressource inconnu refusé à l'exécution, pas seulement au typage.
- La valeur refusée n'apparaît pas dans le message d'erreur.
- Lien symbolique refusé, y compris pointant à l'intérieur de la racine ; ni le lien ni sa cible ne
  sont touchés. Répertoire portant une clé valide refusé.
- Racine indisponible en production : refus explicite.
- Inventaire : référence sans fichier détectée, référence saine non signalée, les deux fichiers d'une
  photo traités séparément, clé non conforme classée `cle_non_verifiable`, fichier orphelin détecté
  seulement si le balayage est demandé, absence de balayage dite explicitement, sous-répertoires
  photos inexistants supportés.
- Lecture seule prouvée : aucun fichier supprimé, aucune ligne supprimée, aucune primitive
  destructive dans le module, aucune PII dans la sortie.

Les 12 fichiers de tests voisins (stockage, photos, documents, bons de visite, rétention, actions
d'upload) passent sans modification : aucune assertion existante n'a été affaiblie.

## Ce que ce chantier ne livre pas

- Aucune suppression automatique, aucun moteur de purge, `APPLY_SUPPORTED` reste `false`.
- Aucune suspension pour contentieux (legal hold) — toujours absente du produit.
- Aucun cron, aucune route HTTP : la primitive et l'inventaire sont des fonctions internes.
- Aucun branchement sur un chemin métier existant.
- Aucun durcissement rétroactif de `ecrireDocument`/`lireDocument`/`supprimerPhotoOriginale`/
  `supprimerPhotoOptimisee` : ces fonctions continuent de faire un `path.join` brut. C'est une
  limite connue et assumée pour ce chantier — les durcir changerait le comportement de chemins de
  production existants (des clés non-UUID existent dans les fixtures et, potentiellement, en base),
  ce qui est une décision distincte de « livrer une primitive de suppression sûre ».
- Aucune correction des orphelins constatés, ni manuelle ni automatique.
- Aucune garde filesystem (permissions, WORM) sur les fichiers immuables.

## Scalabilité

`supprimerFichierStocke` est O(1) : un `lstat`, un `rm`. Aucun impact particulier à 10 000
utilisateurs.

`inventorierOrphelins` est le point à surveiller : il charge en mémoire toutes les références de
fichiers des trois tables et fait un `lstat` par fichier. À l'échelle du pilote mono-conseiller
(quelques milliers de références au plus), c'est négligeable. À 10 000 utilisateurs, il faudrait le
paginer par workspace et le sortir du chemin synchrone — raison supplémentaire pour ne pas l'exposer
en route HTTP ni en cron dans ce chantier. Le balayage disque désactivé par défaut limite déjà le
coût du cas courant.

## Réversibilité

Aucune nouvelle dépendance fournisseur. La primitive n'utilise que `node:fs/promises` et
`node:path`, sur la racine unique déjà résolue par ADR-050. Si Atlas quitte Railway, la seule
question reste celle d'ADR-050 — où est monté le volume — et elle est inchangée. Le passage à un
stockage objet (S3) remplacerait `lstat`/`rm` par deux appels d'API derrière la même signature de
fonction : le genre de ressource et la clé de stockage sont déjà les seuls paramètres, et aucun
appelant ne connaît de chemin.
