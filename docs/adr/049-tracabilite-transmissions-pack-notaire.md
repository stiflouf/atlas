# ADR-049 — Pack Notaire : traçabilité des transmissions

**Statut :** Accepté
**Date :** 2026-08-17
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

L'audit "Passerelle Notaire Atlas" a étudié comment faire évoluer le Pack Notaire existant
(ADR-029/030) vers un suivi plus complet du dossier notarial, sans transformer Atlas en logiciel
notarial et sans casser les garanties documentaires/sécurité déjà construites (ADR-047/048).

L'audit a conclu que la plus petite extension à valeur immédiate est une **traçabilité de
transmission** : permettre au conseiller de déclarer dans Atlas qu'un Pack (ou un sous-ensemble
autorisé de documents) a été transmis à une étude notariale, sans qu'Atlas transporte lui-même les
octets. Aujourd'hui, rien ne permet de répondre après coup à "qu'avons-nous envoyé à quelle étude,
et quand ?" — le manifeste ADR-030 est un texte narratif non structuré, jamais persisté.

**Hors périmètre, confirmé par l'audit** : entité Notaire/Étude/Contact structurée, transport réel
des fichiers (Gmail avec pièce jointe), demandes de pièces, accès externe (mini-espace étude, token,
magic link), événement métier dédié, tâche automatique. Ces chantiers restent séparés, non traités
ici.

## Décision

### 1. Atlas ne transporte aucun fichier

Le flux reste : le conseiller (1) prépare/télécharge le Pack avec le mécanisme existant (ADR-030,
inchangé), (2) le transmet par son canal externe habituel, (3) revient dans Atlas et déclare
explicitement la transmission. Aucun bouton "Envoyer"/"Transmettre" — le wording est "Enregistrer
la transmission", avec confirmation explicite "Je confirme avoir transmis cette sélection à l'étude
indiquée." et un avertissement affiché : "Atlas enregistre cette transmission dans le suivi du
dossier. Les documents ne sont pas envoyés par Atlas à cette étape." Aucune valeur ne prétend être
une preuve juridique irréfutable, un recommandé électronique, un accusé de réception légal, ou une
confirmation de réception par l'étude.

### 2. Compromis comme pivot, pas d'entité Notaire

Chaque transmission appartient à exactement un `compromisId`. Aucune table `notaires`/`etudes`/
`contacts` n'est créée : le destinataire (étude, interlocuteur, email) est un **snapshot** propre à
chaque transmission, pas un carnet d'adresses. Un même Compromis peut avoir plusieurs transmissions
vers la même étude, des études différentes, ou des interlocuteurs différents — suffisant pour
couvrir opérationnellement le cas de notaires distincts sans modéliser de relation métier non
démontrée (vendeur/acquéreur).

### 3. Table `transmissions_dossier_notaire`

Une seule nouvelle table (migration `0029_nappy_microbe.sql`), schéma minimal :

```
id                  uuid PK
compromis_id        uuid NOT NULL REFERENCES compromis(id)   -- pas d'onDelete (NO ACTION)
cle_idempotence     uuid NOT NULL UNIQUE
etude_nom           text NOT NULL
destinataire_nom    text
destinataire_email  text
transmis_le         timestamptz NOT NULL   -- date DÉCLARÉE, distincte de cree_le
cree_par_email      text NOT NULL          -- email de la session Atlas créatrice, pas de FK utilisateur
manifeste_version   integer NOT NULL DEFAULT 1   -- seule source de vérité du format
manifeste_snapshot  jsonb NOT NULL
cree_le             timestamptz NOT NULL DEFAULT now()
```

**FK `compromis_id` sans `onDelete` (NO ACTION)** — vérifié avant migration : aucun `DELETE`
physique de `compromis`/`biens`/`documents_bien` n'existe dans le code de production (uniquement
dans le teardown des tests). Même choix déjà fait pour `evenements_metier.compromis_id`/`bien_id`,
avec la même justification : une transmission ne doit jamais disparaître silencieusement avec son
Compromis.

**Idempotence** : `cle_idempotence` générée côté client (`crypto.randomUUID()`, même pattern que
l'envoi Gmail ADR-031-bis) mais en colonne UNIQUE séparée de `id` (contrairement à `envois_email` où
`id` lui-même sert de clé fournie par le client) — correspond à la convention dominante du schéma
(id auto-généré + colonne UNIQUE pour une clé externe). `ON CONFLICT (cle_idempotence) DO NOTHING` :
un double submit ne crée jamais deux lignes.

**Pas de statut technique d'envoi** (`demarreLe`/`reussiLe`/`echoueLe`/`incertainLe`) : Atlas ne
réalise aucun transport externe ici, il n'y a pas de tentative réseau à distinguer d'un succès.

**Immutabilité** : aucune Server Action de modification/suppression. Une correction se traduit par
une nouvelle ligne (nouvelle `cle_idempotence`).

**Premier usage JSONB du projet** (`manifeste_snapshot`) — type Postgres standard, aucune dépendance
ajoutée.

### 4. Snapshot structuré et SHA-256

`manifeste_snapshot` fige, au moment de la transmission : le texte du manifeste (identique à celui
inclus dans le ZIP, ADR-030) et, pour chaque document sélectionné, `documentId`, `nomExport`,
`nomOriginal`, `categorie`, `typeDocument`, `etatVerification`, `tailleOctets`, et un **SHA-256**
calculé avec `node:crypto` sur les octets réellement présents dans `stockage-documents/` au moment
de l'enregistrement — jamais recalculé à la lecture. Si un fichier est absent au moment de
l'enregistrement, la transmission entière est refusée (aucune ligne partielle). Le SHA-256 identifie
opérationnellement les octets correspondant au snapshot — il ne constitue ni preuve légale de
remise, ni signature, ni horodatage qualifié, ni recommandé.

### 5. Revalidation serveur intégrale

La Server Action `enregistrerTransmissionDossierNotaireAction` (`src/actions/
transmissionDossierNotaire.ts`) suit ADR-047 (`await exigerSessionAtlas()` première instruction,
détectée automatiquement par le test structurel) et revalide tout, sans confiance dans les champs du
formulaire : Compromis relu en base, Bien relu via `compromis.bienId` (jamais un `bienId` fourni par
le client), `compromis.statut === "annule"` → refus, `en_cours`/`realise` → autorisé, Bien archivé →
refus, le `compromisId` soumis doit correspondre exactement au Compromis que le contexte Pack
determinerait lui-même (empêche un POST rattaché à un autre Compromis que celui affiché),
sélection revalidée via `calculerPackNotaire`/`chargerContextePackNotaire` (extraits de ADR-030 pour
n'exister qu'à un seul endroit, réutilisés par le Route Handler ZIP et cette action), taille
cumulée ≤ 200 Mo (même constante que le ZIP), sélection vide refusée, tout document hors de
l'ensemble autorisé refuse l'opération entière (aucune transmission partielle).

### 6. UI

Nouveau composant `TransmissionNotaireFormulaire` (`src/components/documents/`), ajouté à la page
Pack Notaire existante (`/biens/[id]/pack-notaire`) en plus du formulaire de téléchargement ZIP
inchangé — pas de nouvelle page. Sélection de documents indépendante du téléchargement (permet un
complément ultérieur avec un sous-ensemble différent). Écran de confirmation explicite avant
soumission (même patron que `EcranConfirmationEnvoi`, ADR-031-bis), clé d'idempotence régénérée à
chaque nouvelle tentative.

Historique en lecture seule dans l'onglet Compromis de la fiche Bien (`BienTabs.tsx`) : section
"Transmissions notariales" par Compromis, `<details>` affichant le manifeste texte snapshoté tel
quel (jamais recalculé) — pas de nouvelle route, rendu server-side dans la page déjà protégée par
ADR-047.

## Hors périmètre, volontairement

Entité Notaire/Étude/Contact ; carnet d'adresses ; Gmail multipart/pièce jointe ; lecture Gmail
entrante ; détection d'accusé de réception ; demande de pièce structurée ; nouveau `StatutTache` ;
événement métier (`dossier_notaire_transmis` ou autre) ; tâche automatique ; timeline persistée
(dérivée de la même façon que `historiqueBien`, pas une nouvelle table) ; accès externe (portail
notaire, magic link, token) ; signature électronique ; preuve juridique ; migration S3/blob.

## Conséquences

- **1 migration** (`0029_nappy_microbe.sql`) — une seule table créée, aucune modification de
  `documents_bien`/`compromis`/`evenements_metier`/`envois_email`.
- Fichiers créés : `src/types/transmissionDossierNotaire.ts`,
  `src/lib/transmissionDossierNotaireRepository.ts`,
  `src/actions/transmissionDossierNotaire.ts`,
  `src/components/documents/TransmissionNotaireFormulaire.tsx`, tests associés.
- Fichiers modifiés : `src/db/schema.ts` (nouvelle table), `src/lib/documents/packNotaire.ts`
  (extraction de `determinerCompromisActuel`/`chargerContextePackNotaire`, réutilisés par
  `pack-notaire/route.ts`, `pack-notaire/page.tsx` et la nouvelle action — élimine une triple
  duplication), `src/app/biens/[id]/pack-notaire/page.tsx`, `src/app/biens/[id]/page.tsx`,
  `src/components/bien/BienTabs.tsx`.
- Dette réaffirmée (déjà connue depuis ADR-047, non traitée ici) : le stockage documentaire
  (`stockage-documents/`, filesystem local) n'a aucun volume persistant démontré en production — un
  redéploiement peut faire disparaître les fichiers sources. Le snapshot/hash de transmission reste
  lisible (historique de ce qui a été transmis), mais le fichier lui-même pourrait ne plus être
  retéléchargeable. **Prérequis avant utilisation avec des données réelles** : configurer un
  stockage documentaire persistant et sauvegardé.
- Limites nouvelles à documenter (`KNOWN_LIMITATIONS.md`) : transmission déclarative non vérifiée
  techniquement par Atlas ; aucune confirmation de réception ; le snapshot ne garantit pas que les
  octets effectivement remis au tiers par le canal externe du conseiller étaient nécessairement
  identiques à ceux présents dans Atlas au moment T.
