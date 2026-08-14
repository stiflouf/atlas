# ADR-030 — Pack notaire et contrôle documentaire pré-transmission

**Statut :** Accepté
**Date :** 2026-08-14
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Audit du code réel livré par ADR-029 (`documents_bien` étendue, `calculerChecklistDossier`,
`biens.chargeHonoraires`) et des entités bien/acquéreur/prospect vendeur/compromis/tâches
(ADR-014 à ADR-028), pour permettre à un conseiller de préparer un dossier destiné au notaire sans
mélanger les clients, les biens ou les copropriétés — sans encore l'envoyer.

Deux tours de plan ont corrigé la direction initiale avant codage, notamment : `manquant` n'est
jamais un blocage (la checklist ADR-029 est une checklist produit, non juridiquement exhaustive),
une sélection manuelle éphémère doit compléter la proposition automatique, l'auto-sélection doit
croiser strictement `etatVerification` et l'état de checklist, le wording du manifeste ne doit
jamais affirmer un statut légal (« contact vendeur principal », pas « vendeur »), et l'absence de
compromis courant doit interdire tout export, pas seulement l'afficher comme « non prêt ». Codage
direct après incorporation de ces corrections.

## Décision

### 1. Aucune persistance — `pack_notaire` n'est jamais une table

Le pack est entièrement dérivé à la demande depuis `bien` + `compromisActuel` +
`prospectVendeurOrigine` (+ acquéreur résolu) + `documents` — les mêmes entrées que
`calculerChecklistDossier`. Rien n'est mémorisé entre deux générations, y compris la sélection de
documents pour un export donné (§4) et le ZIP lui-même (§7, jamais écrit sur disque).

### 2. Quatre sévérités, aucun critère juridique bloquant inventé

```ts
export type SeveritePackNotaire = "a_obtenir" | "a_verifier" | "information" | "bloquant_technique";
```

`bloquant_technique` est **strictement réservé** à une impossibilité sûre/factuelle d'inclusion :
document explicitement rattaché à un autre compromis/acquéreur/contact vendeur principal
(contradiction **structurelle démontrée**, §3), document `etatVerification = 'rejete'`,
incohérence de checklist (`incoherent`), fichier physiquement introuvable à l'export. Une exigence
`manquant` produit `a_obtenir`, **jamais** `bloquant_technique` — c'est une règle produit non
exhaustive juridiquement, jamais une obligation légale. Un diagnostic `perime` produit un constat
strictement **factuel** (« date de fin de validité renseignée dépassée le {date} »), jamais la
conclusion juridique « transmission impossible » — ADR-030 n'a aucun référentiel légal de validité
permettant cette affirmation. La divergence textuelle `coproprieteDeclaree`/`adresseDeclaree` reste
toujours `a_verifier`, jamais `bloquant_technique` : c'est du texte libre, pas une preuve
structurelle.

### 3. Anti-mauvais-dossier : contradiction démontrée vs correspondance impossible à établir

Balayage de **tous** les documents du bien, indépendant de toute correspondance par
`typeDocument` (une contradiction structurelle prime toujours sur une simple ressemblance de
type) : pour `compromisId`, `acquereurId`, `prospectVendeurId`, deux cas distincts —
- une **référence existe réellement** (`compromisActuel`/`compromisActuel.acquereurId`/
  `prospectVendeurOrigine`) et diffère du document → **`bloquant_technique`**, document exclu,
  message explicite nommant la contradiction ;
- **aucune référence n'existe** pour comparer → **`a_verifier`** seulement (« correspondance
  impossible à établir »), jamais une contradiction démontrée, jamais d'exclusion. En particulier,
  `doc.compromisId !== compromisActuel?.id` ne peut jamais produire de contradiction si
  `compromisActuel` est `undefined` — sans compromis courant, la comparaison elle-même n'a pas de
  sens.

### 4. Sélection : proposition automatique + choix manuel éphémère, jamais persisté

`calculerPackNotaire` retourne trois ensembles disjoints :

```
documentsInterdits    = documents bloquant_technique — jamais sélectionnables, même manuellement
selectionProposee     = candidats (hors interdits) où etatVerification = 'confirme'
                         ET la checklist les retient comme document d'une exigence 'present'
                         (ou PV AG présent)
documentsDisponibles  = candidats restants — visibles, sélection manuelle possible
```

Un document `present` + `non_verifie` (le cas le plus fréquent — défaut à l'upload, personne ne
l'a confirmé) **n'est jamais auto-inclus** : la primauté va à l'anti-mauvais-dossier sur la
commodité. Le formulaire de la page `/biens/[id]/pack-notaire` est un `<form method="POST">` HTML
natif (pas de `"use client"`, pas de JavaScript nécessaire) — cases à cocher pré-cochées pour
`selectionProposee`, décochées pour `documentsDisponibles`, aucune case pour `documentsInterdits`.
Rien n'est écrit en base à la coche/décoche : la checklist reste l'unique source de complétude,
totalement insensible au choix d'export.

### 5. Revalidation serveur intégrale, jamais de confiance dans la sélection client

`POST /api/biens/[id]/pack-notaire` recharge le contexte et recalcule `calculerPackNotaire()`
côté serveur, puis vérifie chaque id soumis contre `selectionProposee ∪ documentsDisponibles` —
tout id absent, inconnu, ou appartenant à `documentsInterdits` fait échouer la requête entière
(400, nomme le document), même discipline que les Server Actions (ADR-015/016/029).

### 6. Aucun export sans compromis courant

`ctx.compromisActuel === undefined` fait refuser la requête (409) **avant** tout calcul de
sélection — l'export ZIP est strictement indisponible en l'absence de contexte transactionnel réel,
pas seulement affiché comme « non prêt ». Côté page, le formulaire de téléchargement n'est même pas
rendu dans ce cas ; côté route, le refus est revérifié indépendamment de l'UI.

### 7. État de préparation — jamais une prétention juridique

```ts
export type EtatPreparationPack =
  | "contexte_transactionnel_incomplet"  // aucun compromisActuel
  | "elements_bloquants"                  // au moins un document interdit
  | "elements_a_traiter"                  // aucun interdit, mais a_obtenir/a_verifier restants
  | "preparation_atlas_complete";         // rien de bloquant/à obtenir/à vérifier
```

`preparation_atlas_complete` signifie **uniquement** qu'aucun constat n'est détecté par les
contrôles Atlas actuellement implémentés — jamais une garantie de conformité légale ni
d'acceptation par le notaire, rappelé explicitement dans l'UI. Sans compromis courant, l'état est
`contexte_transactionnel_incomplet`, jamais assimilé à un verdict « non prêt » qui présupposerait à
tort qu'une transaction est en cours d'évaluation.

### 8. Nommage d'export — jamais un renommage du fichier stocké

`genererNomExport(doc, index, ctx)` : préfixe séquentiel (`01_`, `02_`...), corps dérivé de
`LABEL_TYPE_DOCUMENT[typeDocument]`, complété du nom de la personne (contact vendeur principal ou
acquéreur enregistré) uniquement pour `typeDocument = 'cni'`, ou de l'année de `dateDocument`
uniquement pour `typeDocument = 'pv_ag'` — **jamais** un repli sur `creeLe` (daterait l'upload, pas
l'AG). `nomFichierOriginal`/`cleStockage` du document stocké (ADR-013) ne sont **jamais** modifiés
— ce nom n'existe que comme entrée dans l'archive ZIP générée.

### 9. Wording manifeste — jamais un statut légal implicite

`Contact vendeur principal : {nom}` (jamais « Vendeur » seul — ADR-027 représente une opportunité
avec un contact principal, pas l'ensemble des propriétaires en indivision). `Acquéreur enregistré :
{nom}` (jamais « Acquéreur » seul — limite mono-acquéreur actuelle d'`offres`/`compromis`). Un
champ absent s'affiche explicitement « non renseigné(e) », jamais silencieusement omis.

### 10. Export ZIP en mémoire, génération atomique, `jszip`

**Dépendance ajoutée** : `jszip@3.10.1` (pure JS, zéro binding natif — `lie`/`pako`/
`readable-stream`/`setimmediate`, toutes pures JS ; compatible sans configuration avec le runtime
Node.js par défaut des Route Handlers, déjà requis par `stockageDocuments.ts`). Écarté :
`archiver`/`yazl` (streaming Node, complexité de gestion de flux non justifiée au volume V1) ;
`adm-zip` (API synchrone, moins idiomatique en Route Handler async).

**Atomicité stricte** (`genererZipPackNotaire`) : la taille cumulée (`MAX_TAILLE_PACK_OCTETS`) est
vérifiée **avant** toute lecture fichier ; tous les fichiers sont lus et validés avec succès
**avant** le premier appel à `zip.file()`/`generateAsync` — un seul document absent/inaccessible
fait échouer la génération entière (`ErreurGenerationPack`, nomme le document), jamais un ZIP
silencieusement plus petit que la sélection demandée.

**Garde-fou de taille** : `MAX_TAILLE_PACK_OCTETS = 200 Mo` — **contrainte technique Atlas V1**,
explicitement documentée comme telle, pas une règle métier/juridique. Frontière testée
(exactement à la limite : accepté ; un octet au-delà : refusé).

Le ZIP est généré entièrement en mémoire (`generateAsync({ type: "nodebuffer" })`) et renvoyé
directement en réponse HTTP — **jamais écrit sur disque, jamais persisté**.

### 11. Aucun PDF serveur, aucune journalisation factice

Le manifeste `.txt` (dans le ZIP) et la page HTML de la fiche pack suffisent — pas de génération
PDF serveur (nécessiterait une dépendance supplémentaire, non justifiée pour cette passe). Aucun
`console.log` présenté comme piste d'audit : une vraie traçabilité des générations/transmissions
reste une évolution future explicite, à traiter conjointement avec l'authentification.

### 12. Limite d'accès héritée — non résolue, à traiter avant exposition à un tiers

Aucune authentification n'existe dans Atlas aujourd'hui (ADR-006, mono-conseiller). Le pack notaire
**agrège** des pièces d'identité et données sensibles de plusieurs documents en un seul point
d'accès — une agrégation matériellement plus sensible que la consultation d'un document isolé.
ADR-030 ne résout pas ce point et ne doit **pas** être considéré prêt pour un usage au-delà du
poste local du conseiller, en particulier avant tout envoi effectif à un tiers ou tout usage
multi-utilisateur.

### 13. Aucune tâche automatique, aucun email, aucun OCR/LLM

Confirmé hors périmètre. Chaque `ConstatPackNotaire` est structurellement prêt à devenir, plus
tard, une tâche `origine = 'automatique'` (`taches.origineCode` dérivable du `code` du constat) —
non implémenté ici, aucun dual-write.

## Alternatives écartées

- **Table `pack_notaire`** : aucun état à mémoriser, tout est dérivable à la demande.
- **`manquant` = `bloquant`** : confondrait une règle produit non exhaustive avec une obligation
  légale — rejeté explicitement en cours de plan.
- **Sélection automatique unique sans choix manuel** : sacrifierait le contrôle humain final,
  contraire à la primauté anti-mauvais-dossier.
- **Auto-sélection sur `present` seul (sans exiger `etatVerification = 'confirme'`)** : aurait
  inclus par défaut la majorité des documents jamais explicitement confirmés (`non_verifie`) —
  rejeté, la commodité ne prime jamais sur la prudence anti-mauvais-dossier.
- **ZIP en streaming (`archiver`/`yazl`)** : plus robuste à très grand volume, complexité non
  justifiée par le plafond 10 Mo/document déjà imposé (ADR-013) et l'usage mono-conseiller local.
- **Génération PDF serveur du manifeste** : nouvelle dépendance non justifiée, le `.txt` +
  la page HTML suffisent en V1.
- **`console.log` comme piste d'audit** : n'est pas une vraie traçabilité, retiré de la proposition.

## Conséquences

- **Aucune migration.**
- Nouvelle dépendance : `jszip` (`apps/web/package.json`/`pnpm-lock.yaml`).
- Nouveaux fichiers : `src/lib/documents/packNotaire.ts` (pur), `src/lib/documents/
  genererZipPackNotaire.ts` (E/S, atomicité), `src/app/api/biens/[id]/pack-notaire/route.ts`
  (Route Handler POST), `src/app/biens/[id]/pack-notaire/page.tsx` (server component, lecture
  seule).
- `src/components/bien/BienTabs.tsx` : lien « Préparer le pack notaire » depuis l'onglet Documents.
- Tests : `packNotaire.test.ts` (27 cas, pur), `genererZipPackNotaire.test.ts` (7 cas, atomicité et
  garde-fou de taille avec frontière testée), `route.test.ts` (5 cas d'intégration Postgres,
  incluant une génération réelle de ZIP inspectée) — suite complète du projet passante (579
  tests).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- **Hors périmètre, réservé à des passes ultérieures** : envoi email/connexion Gmail, déduction
  d'adresse notaire, relances programmées, création automatique de tâches, OCR/LLM, génération PDF
  serveur, authentification/URLs signées, journalisation d'audit persistante, table `pack_notaire`.
