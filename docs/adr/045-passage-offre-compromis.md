# ADR-045 — De l'Offre acceptée au Compromis

**Statut :** Accepté
**Date :** 2026-08-16
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Un audit préalable en lecture seule a confirmé que le modèle Compromis existant (`compromis`,
`offreId` nullable, ADR-016) est structurellement suffisant : `ajouterCompromisAction` revalide
déjà bien/acquéreur/offre, un compromis direct sans offre reste pleinement supporté, et aucune
migration n'est nécessaire. Comme pour ADR-044, le problème identifié était uniquement UX : depuis
une Offre acceptée, le seul point de création (formulaire inline dans l'onglet « Compromis » de la
fiche Bien) obligeait à ressaisir manuellement Bien, Acquéreur et Offre, sans aucune garantie de
cohérence entre les deux `<select>` indépendants côté client.

**Clarification de modèle actée par l'audit** : dans Atlas V1, créer un Compromis **est** l'acte de
signature — `dateSignature` est obligatoire dès la création, et l'événement `compromis_signe` est
émis dans la même transaction que l'insertion. Il n'existe pas de « brouillon » de compromis. ADR-045
ne change rien à cette sémantique, elle reste UX pure.

**Invariant ferme, jamais transgressé** : `offre.statut = "acceptee"` ne crée jamais automatiquement
un Compromis. Le conseiller déclenche toujours explicitement « Créer le compromis ».

## Décision

### 1. Route canonique `/compromis/nouveau`

Même patron que `/offres/nouveau` (ADR-044) et `/taches/nouveau` : lit
`?bienId=&acquereurId=&offreId=`, revalide chaque id côté serveur contre les entités réellement
chargées. Aucun query param n'est jamais traité comme un fait métier.

### 2. Formulaire unique et partagé (`CompromisFormulaire`)

`src/components/compromis/CompromisFormulaire.tsx` est désormais le seul point d'écriture UI vers
`ajouterCompromisAction` — utilisé par `/compromis/nouveau` (mode verrouillé) et par l'onglet
« Compromis » de `BienTabs` (mode non verrouillé, comportement historique strictement inchangé :
Acquéreur et Offre restent deux `<select>` indépendants, un compromis direct sans offre reste
pleinement possible).

### 3. Verrouillage total, jamais partiel, depuis une Offre acceptée

Le contexte n'est verrouillé (Acquéreur affiché en texte, Offre affichée en référence, tous deux en
hidden inputs) que si **toute la chaîne** est cohérente : l'acquéreur existe et n'est pas archivé,
l'offre existe, appartient exactement à ce bien et à cet acquéreur déjà verrouillé, et est
`acceptee`. Tout maillon cassé (acquéreur invalide, offre d'un autre bien/acquéreur, offre non
acceptée) fait retomber la page sur le mode non verrouillé — jamais une substitution devinée.

### 4. Prix convenu — jamais préempli automatiquement

Le montant de l'offre acceptée est affiché en simple référence (« Offre acceptée : 340 000 € —
{date} »), jamais copié dans `prixConvenu` (aucun `defaultValue`). Le prix convenu reste un nouveau
fait explicitement saisi par le conseiller — il peut légitimement différer du montant de l'offre
entre acceptation et signature.

### 5. Bouton « Créer le compromis » sur la carte Offre acceptée

Affiché uniquement si `offre.statut === "acceptee"`, le bien n'est pas archivé, aucun compromis n'est
déjà `en_cours` pour le bien, et cette offre précise n'est pas déjà l'origine d'un compromis existant
(vérifié sans requête supplémentaire — `compromis` est déjà chargé pour l'onglet). Jamais affiché
pour `en_cours`/`refusee`/`retiree`.

### 6. Nouvelle garde V1 : une Offre acceptée, origine d'au plus un Compromis

Nouvelle fonction `getCompromisParOffreId(offreId)` (`compromisRepository.ts`), lecture fail-closed
(0 ligne → `undefined`, 1 → retournée, plus d'1 → exception explicite — aucun `UNIQUE(offre_id)` en
base, décision explicite, la garantie vit uniquement dans `ajouterCompromisAction`). Si une offre est
déjà associée à un compromis, la création est **refusée sans confirmation possible** — contrairement
au doublon Offre×Offre d'ADR-044, il s'agit ici d'une provenance structurée unique, pas d'une
nouvelle proposition commerciale légitime.

### 7. Garde « compromis déjà en cours » — inchangée, blocage dur

Comportement pré-existant conservé tel quel (portée par bien, jamais par paire ni par offre) —
`/compromis/nouveau` détecte cet état avant d'afficher le formulaire (état honnête, aucun bouton
menant à un échec garanti), tout comme l'onglet Compromis de `BienTabs` le faisait déjà.

### 8. Aucun couplage automatique nouveau

- La création d'un compromis ne modifie jamais `offre.statut` (reste `acceptee`).
- Aucune tâche n'est terminée automatiquement.
- `compromis_signe` reste émis exactement comme avant, une seule fois, à la création.
- L'automatisation `preparation_dossier_notaire_apres_compromis` continue de fonctionner sans
  modification.

## Hors périmètre, volontairement

Compromis automatique, préremplissage automatique de `prixConvenu`, fiche Compromis navigable,
`UNIQUE(offre_id)` en base, nouvel événement métier, automatisation Offre, signature électronique,
génération de document juridique, workflow notaire, correction de la rupture UX Offre acceptée →
Compromis pour les entrées manuelles restantes (déjà couverte par la nouvelle route canonique).

## Conséquences

- **0 migration** — le schéma est strictement inchangé.
- Nouveaux fichiers : `src/app/compromis/nouveau/page.tsx` (+ test), `src/components/compromis/CompromisFormulaire.tsx`.
- Fichiers modifiés : `src/actions/compromis.ts` (garde offre-déjà-utilisée), `src/lib/compromisRepository.ts`
  (`getCompromisParOffreId`), `src/components/bien/BienTabs.tsx` (formulaire extrait, lien contextuel
  sur la carte Offre acceptée), et les fichiers de test associés.
- `docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md`
  mis à jour en conséquence. `docs/DATA_MODEL.md` **non modifié** — aucun changement de schéma.
- Dette documentée, prochain chantier potentiel : suivi post-compromis (signature → suivi dossier),
  non implémenté dans cette ADR.
