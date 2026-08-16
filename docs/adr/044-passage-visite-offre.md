# ADR-044 — De la visite à l'offre : création contextuelle sans ressaisie

**Statut :** Accepté
**Date :** 2026-08-16
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Un audit préalable en lecture seule a confirmé que le modèle Offre existant (`offres`,
`offre_visites`, ADR-015/ADR-019) est structurellement suffisant : `offre_visites` relie déjà une
offre à un ou plusieurs comptes rendus de visite, `ajouterOffreAction` revalide déjà intégralement
côté serveur (bien/acquéreur/CR, correspondance, dates), et aucune FK directe `visite_id` sur
`offres` n'apporte de valeur supplémentaire. Le problème identifié était uniquement UX : après une
visite intéressante, le seul point d'entrée de création (un formulaire inline dans l'onglet
« Offres » de la fiche Bien) obligeait le conseiller à retrouver manuellement l'acquéreur dans une
liste globale non filtrée, puis à recocher manuellement le compte rendu source.

**Invariant ferme, jamais transgressé** : `interet = interesse` ne crée jamais automatiquement une
Offre. Une Offre reste un fait explicitement saisi par le conseiller, quel que soit le contexte
d'entrée.

## Décision

### 1. Route canonique `/offres/nouveau`

Nouveau point d'entrée réutilisable, sur le même patron que `/taches/nouveau` déjà en production :
lit `?bienId=&acquereurId=&compteRenduVisiteId=` côté serveur, revalide chaque id contre les
entités réellement chargées en base — jamais une confiance dans le query param lui-même. Un `bienId`
absent, inexistant ou archivé affiche un état honnête (aucun formulaire menant à un échec garanti)
avec un lien de retour vers `/biens`, plutôt qu'un formulaire incomplet.

### 2. Formulaire unique et partagé (`OffreFormulaire`)

Le formulaire de création (`src/components/offre/OffreFormulaire.tsx`) est désormais le **seul**
point d'écriture UI vers `ajouterOffreAction` — utilisé à la fois par l'onglet « Offres » de
`BienTabs` (mode non verrouillé, acquéreur choisi dans la liste complète, comme avant) et par
`/offres/nouveau` (mode verrouillé si le contexte est entièrement cohérent). Même contrat métier,
même Server Action, jamais deux implémentations divergentes.

### 3. Verrouillage contextuel, jamais partiel ni deviné

Le contexte n'est verrouillé (Bien affiché, Acquéreur affiché en texte non modifiable, compte rendu
source pré-associé) que si **toute la chaîne est cohérente** : le bien existe et n'est pas archivé,
l'acquéreur existe et n'est pas archivé, et le compte rendu (s'il est fourni) appartient exactement
à ce bien et à cet acquéreur. Tout maillon manquant ou incohérent (acquéreur invalide/archivé, CR
d'un autre acquéreur) fait retomber la page sur le comportement non verrouillé correspondant —
jamais une substitution silencieuse (par exemple, un autre compte rendu du bien) pour compléter un
contexte cassé.

### 4. Compte rendu source toujours transmis

Depuis une Visite, le compte rendu exact est transmis en `hidden input` (`compteRenduVisiteIds`),
toujours soumis, jamais recochable par erreur — le conseiller peut en plus lier d'autres comptes
rendus de la même paire bien/acquéreur (le modèle M:N reste pleinement exploité, jamais réduit à
« une seule visite »). Aucune FK `offres.visite_id` : le lien passe exclusivement par
`offre_visites`, déjà existante.

### 5. Lien contextuel depuis la fiche Visite, jamais conditionné à `interet`

`/visites/{id}` affiche un lien « Créer une offre » dès que la visite est `realisee` et possède un
compte rendu — **quelle que soit la valeur d'`interet`** (`interesse`, `a_reflechir`, `inconnu` ou
même `pas_interesse`, un acquéreur pouvant changer d'avis). Le lien transmet uniquement des IDs
structurés déjà résolus par la page (`bien.id`, `acquereur.id`, `compteRendu.id`) — jamais un texte
ou titre parsé. `TacheItem` (cockpit) reste volontairement inchangé, générique — aucune branche
`origineCode` ajoutée, décision explicite pour ne pas créer un premier précédent de ce genre sur ce
composant.

### 6. Doublon accidentel : avertissement, jamais un blocage définitif

Nouvelle fonction `listerOffresEnCoursPourPaire(bienId, acquereurId)`
(`offreRepository.ts`) et garde dans `ajouterOffreAction` : si une offre `en_cours` existe déjà pour
la paire exacte bien/acquéreur, la création est refusée (`throw`) sauf confirmation explicite
(`confirmerNouvelleOffreMalgreExistante`) — **jamais un blocage définitif**, une nouvelle
proposition à un montant différent restant un scénario métier pleinement supporté. Le contrôle est
**revalidé côté serveur à chaque appel**, y compris pour un POST qui contournerait l'avertissement
affiché côté client (le bouton de soumission est simplement désactivé tant que la case n'est pas
cochée, un confort, jamais la source de vérité). Aucune `UNIQUE(bien_id, acquereur_id, statut)` —
la politique reste appliquée par la Server Action, la même pour les deux points d'entrée (onglet
Bien et route canonique).

### 7. Aucun couplage automatique

- La création d'une offre ne modifie jamais `comptes_rendus_visite.interet`.
- La création d'une offre ne modifie jamais/ne termine jamais la tâche `suivi_apres_visite`
  existante — elle reste ouverte jusqu'à terminaison manuelle par le conseiller (vérifié par test).
- Aucune offre `en_cours` existante n'est retirée automatiquement lors de la création d'une nouvelle
  offre pour la même paire — plusieurs offres `en_cours` peuvent légitimement coexister après
  confirmation explicite.
- Aucun événement métier Offre, aucune automatisation ADR-032 liée à l'Offre — hors périmètre.

## Hors périmètre, volontairement

Création automatique d'Offre, bouton « Créer une offre » dans `TacheItem`, FK `visite_id` sur
`offres`, fiche Offre navigable (`/offres/{id}`), événement métier Offre, automatisation Offre,
expiration automatique de `dateValidite`, scoring/comparaison d'offres, contre-offre structurée,
signature, financement/conditions structurées, email automatique, création d'Offre depuis la fiche
Acquéreur, correction de la rupture UX Offre acceptée → Compromis (dette documentée,
`KNOWN_LIMITATIONS.md`).

## Conséquences

- **0 migration** — le schéma est strictement inchangé par cette ADR.
- Nouveaux fichiers : `src/app/offres/nouveau/page.tsx` (+ test), `src/components/offre/OffreFormulaire.tsx`,
  `src/actions/offre.tacheSuiviApresVisite.test.ts`.
- Fichiers modifiés : `src/actions/offre.ts` (garde doublon), `src/lib/offreRepository.ts`
  (`listerOffresEnCoursPourPaire`), `src/components/bien/BienTabs.tsx` (formulaire extrait, réutilise
  `OffreFormulaire`), `src/app/visites/[id]/page.tsx` (lien contextuel « Créer une offre »), et les
  fichiers de test associés à chacun.
- `docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md`
  mis à jour en conséquence. `docs/DATA_MODEL.md` **non modifié** — aucun changement de schéma.
- Dette documentée, réservée à une ADR ultérieure : Offre acceptée → Compromis reste un parcours
  manuel (sélection indépendante de l'acquéreur et de l'offre dans le formulaire Compromis, jamais
  préremplie depuis une offre acceptée précise).
