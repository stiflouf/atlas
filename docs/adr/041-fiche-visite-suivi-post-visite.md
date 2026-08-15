# ADR-041 — Fiche Visite Atlas autonome et suivi post-visite exploitable

**Statut :** Accepté
**Date :** 2026-08-15
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Un audit préalable en lecture seule a confirmé deux défauts introduits par ADR-040, tous deux
vérifiés sur le code réel :

1. **Un `GET` mutait l'état.** `/visites/[id]/preparer` (Server Component) appelait
   `materialiserVisite()` — une vraie écriture Postgres — directement dans son rendu, sans passer
   par une Server Action. Un simple accès direct à l'URL (favori, aperçu de lien Slack/e-mail,
   robot) pouvait donc créer une ligne `visites`, exactement l'anti-pattern déjà évité ailleurs
   dans le code (`api/auth/google/logout/route.ts` : *« POST plutôt que GET : cette route mute
   l'état, elle ne doit jamais pouvoir être déclenchée par un simple lien ou un prefetch »*).
2. **`/visites/{idAtlas}` redirigeait inconditionnellement** vers la préparation dépendante de
   Google Calendar — une Visite Atlas persistée, avec compte rendu complet en base, devenait donc
   totalement inconsultable dès que Calendar était déconnecté ou l'événement d'origine supprimé,
   alors que 100 % de ses données pertinentes n'avaient structurellement besoin d'aucun appel
   externe.

ADR-041 corrige les deux, et profite du même chantier pour rendre `suivi_apres_visite` réellement
utile (elle ne lisait jusqu'ici jamais `interet`, produisant systématiquement la même tâche
générique).

## Décision

### 1. Plus aucun GET ne matérialise une visite

`materialiserVisiteAction` (nouvelle Server Action, `src/actions/visite.ts`) est désormais le
**seul** point d'écriture créant une ligne `visites`. Elle ne fait confiance qu'au
`rendezVousCalendarId` soumis par le formulaire (routage, déjà exposé dans l'URL) — bien et
acquéreur sont re-résolus via `getRendezVousAvecContexte()`, exactement la même fonction que la
page utilise pour sa propre lecture, jamais une seconde logique de matching. Idempotente au niveau
DB (`UNIQUE(rendez_vous_calendar_id)`, `materialiserVisite`, inchangée depuis ADR-040) : un double
submit ne crée jamais deux visites.

`/visites/[id]/preparer` (Server Component) est désormais **purement en lecture** : elle recherche
une visite déjà matérialisée (`getVisiteParRendezVousCalendarId`), sans jamais en créer une. Trois
cas :

- **Visite déjà matérialisée** → préparation complète affichée, exactement comme avant (aucune
  régression du contenu riche : transports, écoles, patrimoine, marché, mémoire du dossier,
  formulaire de compte rendu).
- **Bien/acquéreur résolus sans ambiguïté, aucune visite matérialisée** → écran minimal (Bien,
  Acquéreur, un seul bouton `Enregistrer et préparer cette visite`, `<form action=
  {materialiserVisiteAction}>`) — **avant** tout appel externe coûteux (géocodage, transports,
  écoles, patrimoine, marché), qui n'ont plus lieu tant que le conseiller n'a pas explicitement
  confirmé vouloir entrer dans cette visite.
- **Résolution ambiguë** → comportement inchangé (message d'échec existant), jamais de
  matérialisation.

Un GET (navigation, rafraîchissement, aperçu de lien, prefetch éventuel) reste désormais sans
aucun effet de bord métier dans tous les cas.

### 2. `/visites/{idAtlas}` devient la vraie fiche métier

Le comportement de redirection inconditionnelle est supprimé. La page lit exclusivement
PostgreSQL — `getVisiteById`, `getBienById`, `getClientById`, et une nouvelle lecture
`getCompteRenduVisiteParVisiteId()` (`compteRenduVisiteRepository.ts`, exploitant la FK
`comptes_rendus_visite.visite_id` posée par ADR-040) — **aucun appel à Google Calendar ou une autre
API externe dans son noyau**. Reste consultable si OAuth a expiré, si Calendar est déconnecté, ou
si l'événement d'origine a été supprimé côté Google.

Affichée : statut (badge), date prévue, Bien (lien `/biens/{id}`), Acquéreur (lien `/clients/{id}`),
compte rendu s'il existe (retour, intérêt, prochaine étape), actions pertinentes selon le statut.
Calendar n'intervient plus qu'en enrichissement **secondaire, optionnel** : un lien conditionnel
`Préparer / renseigner le compte rendu` (visite `planifiee` uniquement) vers la page de préparation
existante — jamais une condition d'existence de la fiche elle-même.

### 3. Comportement par statut

- **`planifiee`** : lien vers la préparation (secondaire), formulaires `Reporter`/`Annuler la
  visite` (réutilisent `reporterVisiteAction`/`annulerVisiteAction`, ADR-040, désormais dotées d'un
  `redirectTo` optionnel — même patron que `terminerTacheAction` — pour revenir sur la fiche elle-
  même plutôt que sur la préparation). Aucun bouton `Marquer comme réalisée` indépendant : la seule
  voie vers `realisee` reste la création du compte rendu (inchangé, ADR-040).
- **`realisee`** : compte rendu affiché s'il existe (toujours le cas dans tous les chemins d'écriture
  actuels), aucune action de préparation proposée en avant.
- **`annulee`** : statut affiché, aucun compte rendu, aucune action de planification. Pas de motif
  structuré (inchangé, ADR-040).

### 4. `date_prevue` — aucun changement de schéma

Confirmé et assumé : `date_prevue` reste un `date` SQL, jamais une heure. La fiche affiche le jour
persisté, sans jamais aller chercher l'heure auprès de Google Calendar pour combler ce manque
(cela réintroduirait exactement la dépendance que cette ADR élimine). **Limite documentée** :
l'heure et la durée détaillées restent détenues par Calendar en V1 ; à réévaluer si Atlas devient
un jour propriétaire de la planification ou permet une création native de visites.

### 5. `visite_realisee` — un seul fait, un seul chemin d'écriture

Confirmé sur le code : `marquerVisiteRealisee()` a un unique site d'appel
(`enregistrerCompteRenduVisiteAction`), toujours précédé, dans la même transaction, par la création
du compte rendu. Il n'existe aucun chemin produisant une visite `realisee` sans compte rendu.
Définition métier retenue : l'événement représente *« un compte rendu vient d'être créé »* — la
transition de statut `realisee` en est aujourd'hui une conséquence systématique de ce même geste,
pas une garantie structurelle indépendante (aucune contrainte DB ne le impose, seule l'absence
d'un second appelant). Aucun second événement créé, aucun second chemin d'écriture ajouté.

### 6. `suivi_apres_visite` — une politique par intérêt, une seule règle

La règle (toujours désactivée par défaut, ADR-032, activation figée inchangée) lit désormais le
compte rendu qu'elle référence (`getCompteRenduVisiteById`) et adapte le titre et l'opportunité même
de produire une tâche selon `interet` :

| `interet` | Effet |
|---|---|
| `interesse` | Tâche : *« Faire le point avec {Prénom Nom} sur une éventuelle offre pour {référenceBien} »* |
| `a_reflechir` | Tâche : *« Relancer {Prénom Nom} après la visite de {référenceBien} »* |
| `inconnu` | Tâche : *« Recueillir le retour de {Prénom Nom} après la visite de {référenceBien} »* |
| `pas_interesse` | **Aucune tâche** — `undefined`, succès honnête (ADR-032), jamais une erreur, jamais repris par ADR-038 |

Toujours une seule règle, un seul événement déclencheur (`visite_realisee`), zéro nouvelle table,
zéro nouvel enum, zéro email automatique. Même garde d'archivage que `nouveau_match_bien_acquereur`
(bien ou acquéreur archivé au moment du traitement → aucune tâche).

### 7. Cible : l'acquéreur, jamais la Visite ni le compte rendu

**Changement de cible pour les nouvelles tâches produites par cette règle** : `{ type: "acquereur",
id }`, plus jamais `{ type: "visite", id: compteRenduVisiteId }`. Justification métier : l'action
portée est une action commerciale envers une personne (« dois-je le/la relancer ? »), exactement le
même raisonnement déjà validé pour `nouveau_match_bien_acquereur` (ADR-037). Bénéfice immédiat,
sans aucun changement de modèle : `Voir la fiche` (ADR-039) résout vers `/clients/{id}`, `Préparer
un email` résout le bon destinataire — les deux mécanismes existaient déjà, aucun nouveau resolver.

### 8. `taches.visite_id` — dette legacy documentée, jamais migrée

**Aucun changement de schéma.** `taches.visite_id` référence toujours `comptes_rendus_visite.id`
(nom hérité d'avant ADR-040, jamais renommé). Les tâches déjà créées par l'ancienne version de
`suivi_apres_visite` (ciblant un compte rendu) restent lisibles exactement comme avant — aucune
migration, aucune réinterprétation heuristique des identifiants existants.

Recommandation d'audit retenue : ne pas faire cibler `visites.id` par une tâche dans cette ADR
(éviterait de complexifier `taches_une_seule_cible_check` avec une seconde colonne « visite-like »
mutuellement exclusive) — un chantier séparé si le besoin se démontre un jour.

### 9. Tâche nouveau match déjà ouverte — pas de nettoyage automatique

Confirmé : si une tâche `nouveau_match_bien_acquereur` est déjà ouverte pour une paire et qu'une
visite est ensuite planifiée pour cette même paire, la tâche existante n'est ni terminée ni masquée
automatiquement. Le conseiller la termine manuellement s'il la juge redondante. Aucun moteur de
nettoyage construit — bénéfice non démontré face au risque d'un couplage caché entre deux
mécanismes.

### 10. ADR-037 — non régressée, confirmée

`existeVisitePlanifieePourPaire()` (ADR-040) continue de lire exclusivement la table `visites`,
jamais Calendar — inchangée dans cette ADR, testée explicitement à nouveau.

## Hors périmètre, volontairement

Heure/durée persistée, création native d'une visite indépendante de Calendar, synchronisation
Calendar bidirectionnelle, webhook, agenda Atlas complet, relance temporelle programmée
post-visite, tâche vendeur pour `pas_interesse`, email automatique, IA de compte rendu, nouvelle
taxonomie d'intérêt, migration de `taches.visite_id`, nettoyage automatique des tâches nouveau
match.

## Conséquences

- **Aucune migration** — le schéma est strictement inchangé par cette ADR.
- Nouveaux fichiers : `src/app/visites/[id]/preparer/page.test.tsx`,
  `src/app/visites/[id]/page.test.tsx`,
  `src/lib/automatisations/catalogueRegles.suiviApresVisite.test.ts`.
- Fichiers modifiés : `src/actions/visite.ts` (nouvelle `materialiserVisiteAction`, `redirectTo`
  optionnel sur `annulerVisiteAction`/`reporterVisiteAction`), `src/app/visites/[id]/preparer/
  page.tsx` (lecture seule), `src/app/visites/[id]/page.tsx` (fiche réelle, plus une redirection),
  `src/lib/compteRenduVisiteRepository.ts` (`getCompteRenduVisiteParVisiteId`),
  `src/lib/automatisations/catalogueRegles.ts` (`suivi_apres_visite` — politique par intérêt,
  cible acquéreur), `src/components/bien/BienTabs.tsx` (l'onglet "À venir" lie désormais chaque
  visite vers `/visites/{id}` — premier point d'entrée réel vers la fiche), `src/actions/
  enregistrerCompteRenduVisite.test.ts`/`src/lib/automatisations/moteur.test.ts` (assertions
  mises à jour pour la nouvelle cible).
- `docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/
  `docs/AI_HANDOFF.md` mis à jour en conséquence. `docs/DATA_MODEL.md` **non modifié** — aucun
  changement de schéma.
- Hors périmètre, réservé à une ADR ultérieure : faire cibler `visites.id` par une tâche
  structurée, création native de visite, heure/durée persistée, relance temporelle post-visite.
