# Règles métier — Atlas (`apps/web`)

Toutes les règles ci-dessous sont **déterministes** : mêmes entrées → même résultat, aucun appel
à un service de génération de texte. Voir ADR-008 pour le principe général, et
`docs/KNOWN_LIMITATIONS.md#pas-de-llm` pour la confirmation factuelle (recherche exhaustive dans
le code).

## Principes transversaux

### Aucune donnée inventée
Chaque règle ci-dessous ne produit un résultat que si les champs structurés nécessaires sont
présents. Une donnée absente désactive la règle plutôt que de faire une hypothèse — jamais de
valeur par défaut silencieuse. Aucun moteur ne lit un champ de texte libre (`bien.description`,
`acquereur.notes`, `note.contenu`, `compteRendu.retour`) pour en déduire un fait structuré.

### Absence de donnée ≠ valeur négative
Convention posée par ADR-009 : `undefined`/`NULL` signifie "inconnu", `false` signifie
"explicitement connu comme négatif". Une règle de croisement (ex. accessibilité × ascenseur) ne se
déclenche que si **les deux** champs croisés sont explicitement renseignés.

### Provenance
Chaque point d'attention et chaque point fort porte un champ `provenance` : une chaîne indiquant
sur quels champs/sources la règle s'est basée (ex. `"Bien (prix affiché) × Acquéreur (budget
maximum déclaré)"`). Affichée dans l'UI sous chaque point, pour que le conseiller puisse toujours
retracer *pourquoi* Atlas affiche cette phrase.

---

## Matching : rendez-vous → bien/acquéreur/type

**Fichiers** : `src/lib/matching/matchBien.ts`, `matchClient.ts`, `matchType.ts`, `resoudre.ts`,
`index.ts`. Entrée commune : le titre et le lieu normalisés (NFD, minuscule, diacritiques
supprimés) d'un `RendezVous`, comparés au référentiel de biens/acquéreurs disponible (réel ou
mock — voir `docs/DEMO_VS_REAL.md`).

### Correspondance bien (`matcherBien`)

| Condition (dans cet ordre) | Résultat | Provenance (`matchedBy`) |
|---|---|---|
| La référence du bien apparaît dans le titre/lieu | `confidence: 0.98` | `reference_bien` |
| L'adresse du bien apparaît dans le lieu du rendez-vous | `confidence: 0.95` | `adresse_bien` |
| Recouvrement partiel (un mot d'adresse &gt;3 lettres, ou la ville seule) | `confidence: 0.6` | `adresse_partielle` |
| Rien de ce qui précède | Aucun candidat pour ce bien | — |

### Correspondance acquéreur (`matcherClient`)

| Condition | Résultat | Provenance |
|---|---|---|
| Nom **et** prénom trouvés comme mots entiers | `confidence: 0.9` | `nom_complet_client` |
| Nom seul trouvé | `confidence: 0.65` | `nom_client` |
| Prénom seul trouvé | `confidence: 0.45` | `prenom_client` |
| Rien | Aucun candidat | — |

### Correspondance type métier (`matcherType`)

| Condition | Résultat | Provenance |
|---|---|---|
| Type calendrier natif reconnu (mock : visite/estimation/appel/signature/réunion→autre) | `confidence: 1` | `type_calendar_connu` |
| Mot-clé trouvé dans le titre (visite, estimation/avis de valeur, signature/compromis/acte, appel/téléphone, prospection/phoning...) | `confidence: 0.85` | `mot_cle_type` |
| Rien | `type: "autre"`, `confidence: 0` | `aucun_indice` |

### Résolution (`resoudre.ts`)

Seuils : `SEUIL_FORT = 0.8`, `SEUIL_AMBIGU = 0.5`, `DELTA_AMBIGUITE = 0.1`.

- **Bien** : si le meilleur candidat ≥ `SEUIL_FORT` et dépasse le second d'au moins
  `DELTA_AMBIGUITE` → résolu automatiquement. Sinon, si au moins un candidat ≥ `SEUIL_AMBIGU` →
  jusqu'à 3 candidats proposés au conseiller pour confirmation (`necessiteConfirmationBien: true`).
  En dessous de `SEUIL_AMBIGU` → aucun candidat, rien à confirmer.
- **Acquéreur** : même filtrage, mais **pas de mécanisme de confirmation** — un cas ambigu reste
  simplement non résolu (`undefined`), sans bannière UI dédiée (choix assumé : rester honnête
  plutôt qu'afficher une fausse certitude).
- **Confiance globale** : `bien × 0.45 + acquéreur × 0.45 + type × 0.1`, arrondie à 2 décimales.
  Même quand le bien reste ambigu, son meilleur candidat contribue tout de même à ce score (pour
  ne pas masquer un signal à valider) — le bien "résolu" et le bien "qui contribue au score" ne
  sont donc pas toujours le même concept.

## Mémoire contextuelle du matching : priorité de résolution

**Fichier** : `src/lib/contexteRepository.ts` (`resoudreContextePersiste`). S'applique uniquement
aux rendez-vous Google Calendar (id préfixé `gcal-`) — les rendez-vous mockés ne passent jamais
par cette mémoire (voir `docs/DEMO_VS_REAL.md`).

| Ordre | Condition | Résultat |
|---|---|---|
| 1 | Une ligne `memoire_contextuelle` existe avec `statut_validation IN ('confirme','corrige')` | Décision humaine utilisée telle quelle, sans condition — priorité absolue, même si l'événement source a changé depuis |
| 2 | `statut_validation = 'ignore'` | Traité comme une décision figée, retourné directement sans recalcul |
| 3 | `statut_validation = 'auto'` et empreinte de contenu inchangée | Résultat en cache réutilisé sans recalcul |
| 4 | Aucune ligne, ou `auto` avec empreinte différente | Moteur de matching relancé ; le résultat n'est écrit en cache que s'il n'est **pas** ambigu (un contexte ambigu est toujours recalculé au prochain appel, jamais mis en cache) |

L'empreinte de contenu est un SHA-256 calculé sur `{titre, lieu, heure, date, journeeEntiere,
type}` — volontairement pas sur le champ `updated` brut de Google Calendar, pour ne pas invalider
le cache sur des changements sans rapport avec le matching (réponse d'un invité, rappel modifié).

## Points d'attention pour la visite

**Fichier** : `src/lib/pointsAttention/moteur.ts` (`produirePointsAttention`). Entrée : `Bien`,
`ProfilAcquereur`, et optionnellement `TransportsProximite`/`VelibProximite` (résultats réels des
clients externes, jamais recalculés). 8 règles indépendantes, chacune 0 ou 1 point. Depuis ADR-034,
les 6 règles qui recoupent une règle du moteur de compatibilité (prix/budget, accessibilité,
pièces, surface, parking, extérieur) délèguent leur condition aux fonctions de critère partagées de
`src/lib/compatibilite/criteres.ts` — ne se déclenchent que si le critère partagé retourne
`statut === "incompatible"` ; comportement inchangé, verrouillé par
`src/lib/pointsAttention/moteur.test.ts` (tests de caractérisation) :

| Règle | Condition | Résultat | Provenance |
|---|---|---|---|
| Prix supérieur au budget | `bien.prix > acquereur.budgetMax` | Alerte prix, montants formatés | Bien (prix) × Acquéreur (budget max) |
| Mandat non actif | `bien.statutMandat !== "actif"` | Alerte statut mandat | Bien (statut du mandat) |
| Aucun transport proche | `transports` et `velib` tous deux définis (jamais si l'un des deux a échoué), et les deux listes vides | Alerte absence de transport dans un rayon de 500 m | PRIM (Île-de-France Mobilités) + Vélib' Métropole (GBFS) |
| Accessibilité requise non garantie | `acquereur.accessibiliteRequise === true`, `bien.etage > 0`, `bien.ascenseur === false` (tous explicitement renseignés) | Alerte accessibilité | Bien (étage, ascenseur) × Acquéreur (accessibilité requise) |
| Pièces insuffisantes | `acquereur.piecesMin` défini et `bien.pieces < piecesMin` | Alerte | Bien (pièces) × Acquéreur (pièces minimum) |
| Surface insuffisante | `acquereur.surfaceMin` défini et `bien.surface < surfaceMin` | Alerte | Bien (surface) × Acquéreur (surface minimum) |
| Parking manquant | `acquereur.necessiteParking === true` et `bien.parking === false` (explicite) | Alerte | Bien (parking) × Acquéreur (besoin parking) |
| Extérieur manquant | `acquereur.necessiteExterieur === true` et `bien.exterieur === "aucun"` (explicite) | Alerte | Bien (extérieur) × Acquéreur (besoin extérieur) |

Appelé uniquement sur la page de préparation de visite (`visites/[id]/preparer/page.tsx`), jamais
sur l'accueil.

## Points forts pour la visite

**Fichier** : `src/lib/pointsForts/moteur.ts` (`produirePointsForts`). Entrée : `Bien`,
`ProfilAcquereur` (pas de données de transport). 2 règles, chacune retenue seulement si elle
**dépasse** la simple conformité à un critère déjà demandé — une simple réponse positive à un
critère explicitement demandé n'est jamais un "point fort", juste une conformité normale.

| Règle | Condition | Provenance |
|---|---|---|
| Bonus parking | `bien.parking === true` **et** `acquereur.necessiteParking !== true` (non demandé) | Bien (parking) — atout non demandé |
| Bonus extérieur | `bien.exterieur` défini et ≠ `"aucun"`, **et** `acquereur.necessiteExterieur !== true` | Bien (extérieur) — atout non demandé |

`pointsForts` n'a volontairement pas été refactoré pour partager de code avec ADR-034 : un bonus non
demandé a une sémantique différente d'une contrainte de compatibilité (voir ADR-034, section 11).

## Compatibilité Bien ↔ Acquéreur (ADR-034)

**Fichiers** : `src/lib/compatibilite/{types,criteres,evaluerCompatibilite,orchestration}.ts`.
Moteur déterministe et entièrement dérivé à la lecture — aucune table, aucun cache, aucune
automatisation déclenchée. Distinct de `src/lib/matching/`, qui résout un rendez-vous Google
Calendar vers un bien/acquéreur par correspondance floue et ne participe jamais à cette décision.

Six critères, chacun une fonction pure indépendante (`src/lib/compatibilite/criteres.ts`),
réutilisées telles quelles par `pointsAttention` (voir ci-dessus) :

| Critère | Non concerné | Compatible | Incompatible | À vérifier |
|---|---|---|---|---|
| `budget_max` | jamais (`budgetMax`/`prix` toujours renseignés) | `bien.prix <= budgetMax` | `bien.prix > budgetMax` | jamais |
| `pieces_min` | `piecesMin` absent | `bien.pieces >= piecesMin` | `bien.pieces < piecesMin` | jamais (`bien.pieces` toujours renseigné) |
| `surface_min` | `surfaceMin` absent | `bien.surface >= surfaceMin` | `bien.surface < surfaceMin` | jamais (`bien.surface` toujours renseigné) |
| `parking` | `necessiteParking !== true` | `bien.parking === true` | `bien.parking === false` | `bien.parking` inconnu |
| `exterieur` | `necessiteExterieur !== true` | `bien.exterieur` ∈ {balcon,terrasse,jardin} | `bien.exterieur === "aucun"` | `bien.exterieur` inconnu |
| `accessibilite` | `accessibiliteRequise !== true` | `etage === 0`, ou `etage > 0` et `ascenseur === true` | `etage > 0` et `ascenseur === false` | `etage` inconnu, `etage > 0` et `ascenseur` inconnu, ou `etage < 0` (hors modèle) |

**`budgetMin` n'a aucune sémantique dans ce moteur** — décision explicite (ADR-034) : un bien moins
cher que `budgetMin` n'est jamais incompatible pour ce seul motif. Le champ reste dans le modèle,
simplement jamais lu par `evaluerBudgetMax()`.

**Agrégation du statut global** (`evaluerCompatibilite`, sur les critères pertinents,
`non_concerne` ignoré) : au moins un `incompatible` → `incompatible` ; sinon au moins un
`a_verifier` → `a_verifier` ; sinon `compatible`. Aucun score, aucune pondération.

**Aucune lecture de texte libre** (`notes`, `criteres`, `caracteristiques`, `description`) — ADR-008.

**Orchestration symétrique** — `evaluerCompatibiliteBien(bienId)`/`evaluerCompatibiliteAcquereur(acquereurId)`
appellent toutes deux la même `evaluerCompatibilite()`, itèrent sur `listerClients()`/`listerBiens()`
(candidats actifs uniquement, ADR-012) ; la fiche consultée (bien ou acquéreur), elle, reste résolue
même archivée (`getBienById`/`getClientById`).

**UX** : onglet "Acquéreurs compatibles" sur la fiche bien, section "Biens compatibles" sur la fiche
acquéreur — statut global + détail critère par critère toujours disponible, `a_verifier` jamais
présenté comme une incompatibilité, aucun score sur 100.

**Préférences pondérées : hors périmètre V1** — voir `docs/KNOWN_LIMITATIONS.md`. La géographie,
elle, est désormais couverte — voir ci-dessous (ADR-035).

## Secteurs de recherche géographique (ADR-035)

**Fichiers** : `src/lib/geocodage/ignClient.ts` (étendu), `src/lib/geocodage/resolutionBien.ts`,
`src/lib/secteurRechercheRepository.ts`, `src/lib/compatibilite/criteres.ts` (`evaluerSecteur`,
septième critère du moteur ADR-034, réutilisant `evaluerCompatibilite`/`orchestration.ts` sans les
modifier structurellement).

**Identifiant canonique** : `citycode` IGN (Géoplateforme/BAN), une **chaîne** — jamais un entier
(Corse `2A`/`2B`). `ville`/`codePostal` restent des champs de saisie libre du bien, **jamais lus**
par ce critère ni par aucune comparaison de compatibilité — seule `bien.codeInseeCommune` (résolue,
persistée) compte.

| Situation | Statut |
|---|---|
| Acquéreur sans secteur de recherche enregistré | `non_concerne` |
| Au moins un secteur enregistré, `bien.codeInseeCommune` inconnu | `a_verifier` |
| `bien.codeInseeCommune` présente dans un des secteurs recherchés | `compatible` |
| `bien.codeInseeCommune` connue mais absente de tous les secteurs recherchés | `incompatible` |

**Résolution du bien** : tentée automatiquement à chaque création/modification d'un bien via
`resoudreCommuneBien()` (réutilise le seuil de fiabilité `SEUIL_FIABLE = 0.8` déjà utilisé pour le
géocodage de préparation de visite) — **jamais bloquante** : un échec IGN (réseau, ambiguïté, score
insuffisant, réponse sans `citycode`) laisse `codeInseeCommune = NULL`, le bien reste enregistré
normalement. Recalculée **systématiquement** à chaque édition, jamais conditionnée à "l'adresse a
changé" — une résolution en échec efface toujours un éventuel ancien `codeInseeCommune`, pour ne
jamais laisser survivre une localisation périmée après un changement d'adresse.

**Sélection d'un secteur acquéreur** : validée côté serveur avant écriture (`verifierCommune()`
ré-interroge l'IGN filtré par `citycode`) — un `codeInsee`/`nomCommune`/`codePostal` soumis par le
client n'est **jamais** persisté tel quel, seule la réponse IGN fraîche l'est. Si l'IGN est
indisponible pendant l'ajout, rien n'est écrit — erreur actionnable, le conseiller réessaie. Un
secteur n'est jamais édité en place : `nomCommune`/`codePostal` ne sont pas modifiables
indépendamment de `codeInsee` — pour corriger, supprimer puis rechercher/sélectionner à nouveau.
`UNIQUE(acquereur_id, code_insee)` empêche un doublon.

**Paris/Lyon/Marseille** : chaque arrondissement est sélectionnable individuellement (son propre
`citycode`, motifs `751xx`/`693xx`/`132xx`). L'entrée générique "ville entière" (`citycode` `75056`
Paris, `69123` Lyon, `13055` Marseille) est explicitement exclue des résultats de recherche
(`CODES_INSEE_VILLE_A_ARRONDISSEMENTS`) — jamais traitée comme équivalente à "tous les
arrondissements", ce qui produirait de faux `incompatible`.

**Aucune lecture de texte libre** : un secteur mentionné uniquement dans `criteres`/`notes` (ex.
"Paris 10e ou 11e") n'a aucun effet tant qu'aucune ligne structurée `secteurs_recherche_acquereur`
n'existe — `non_concerne` dans ce cas, jamais une extraction automatique (ADR-008).

**Orchestration sans N+1** : `evaluerCompatibiliteBien` charge en une seule requête les secteurs de
tous les acquéreurs candidats (`listerSecteursPourAcquereurs`, `Map` en mémoire) ;
`evaluerCompatibiliteAcquereur` charge une seule fois les secteurs de l'acquéreur consulté, réutilisés
pour chaque bien comparé. Aucune requête IGN dans le moteur de compatibilité lui-même.

**UX** : section dédiée "Secteurs de recherche" sur la fiche acquéreur (voir/ajouter/supprimer) —
volontairement pas dans `AcquereurFormulaire`.

## Transitions de compatibilité (ADR-036)

**Fichiers** : `src/lib/compatibilite/{etatRepository,resynchronisationRepository,synchronisation,
baseline}.ts`, `src/app/api/compatibilite/{scan,baseline}/route.ts`.

`evaluerCompatibilite()` (ADR-034/035) reste l'**unique** source de vérité du matching — ADR-036
n'y ajoute rien, elle observe son résultat pour détecter une **transition** et produire un fait
métier durable quand une paire devient réellement une nouvelle opportunité commerciale.

**Trois éléments, trois rôles distincts, jamais confondus** :

```text
evaluerCompatibilite()                        = source de vérité métier (inchangée)
compatibilites_bien_acquereur_etat             = mémoire technique de dernière observation
evenements_metier (nouveau type)               = historique append-only des transitions
```

**Transition détectée** : `compatible → compatible` ne reproduit jamais le même événement ;
`incompatible`/`a_verifier` → `compatible` (y compris une première observation, une paire tout
juste créée) produit un événement ; `compatible → incompatible`/`a_verifier` ne produit jamais de
"nouveau match" (l'état technique est tout de même mis à jour, pour qu'un retour futur à
`compatible` soit détectable) ; `compatible → incompatible → compatible` produit un **second**
événement (un **nouveau cycle**, `cycle_compatibilite` incrémenté) — la paire redevient une
opportunité après avoir cessé de l'être.

**Archivage/désarchivage** : une entité archivée sort du périmètre commercial actif
(`dans_perimetre_actif = false`, jamais un détournement des statuts `compatible`/`incompatible`/
`a_verifier` d'ADR-034) sans qu'aucun "nouveau match" ne soit produit ; un désarchivage toujours
compatible produit un nouveau cycle, exactement comme un retour à compatible après une sortie
temporaire — même formule de transition, aucun code spécial.

**Handoff durable** : chaque mutation susceptible de changer une compatibilité (création/
modification/désarchivage d'un bien ou d'un acquéreur, ajout/suppression d'un secteur) enqueue une
demande de resynchronisation **dans la même transaction** que la mutation elle-même — aucune
fenêtre où une transition pourrait être perdue si le process s'arrête juste après le commit.
Traitée normalement de façon synchrone dans la foulée ; `/api/compatibilite/scan` (protégé par
secret partagé, même patron que `/api/automatisations/scan` ADR-033) reprend toute demande restée
en attente.

**Baseline** : un déploiement d'ADR-036 ne doit jamais transformer les paires déjà compatibles au
moment de l'installation en "nouveaux matchs" artificiels. `/api/compatibilite/baseline` (secret
dédié, distinct du scan) observe l'état courant et écrit la mémoire technique **silencieusement**
(jamais un événement, quel que soit le statut observé) — geste manuel explicite, jamais automatique
dans une migration. Refuse par défaut d'écraser une table déjà peuplée (protection contre un
rebuild accidentel qui remettrait à zéro les cycles d'un système déjà en fonctionnement).

**Aucune donnée personnelle, aucun détail de critère persisté** : l'événement ne porte que
`bienId`/`acquereurId`/`cycleCompatibilite` — jamais de nom, email, téléphone, ni un instantané des
7 critères (relus depuis les entités au moment où ils sont réellement nécessaires).

**Hors périmètre de cette ADR** : aucune tâche, aucun email n'était produit lors de la sortie
d'ADR-036 — ADR-037 (ci-dessous) branche désormais cet événement sur le moteur ADR-032.

## Automatisation commerciale du nouveau match (ADR-037)

**Fichier** : règle `nouveau_match_bien_acquereur` dans `src/lib/automatisations/catalogueRegles.ts`,
déclenchée par `compatibilite_bien_acquereur_devenue_compatible` (ADR-036). Séquence complète :
`evaluerCompatibilite()` (ADR-034/035) → transition + événement durable (ADR-036) → règle ADR-032 →
tâche (ADR-037) — le synchroniseur ADR-036 reste totalement ignorant de cette règle.

**Désactivée par défaut**, comme les 5 règles précédentes. L'activation figée ADR-032 garantit
qu'aucun événement antérieur à l'existence/activation de cette règle ne produit jamais de tâche
rétroactive, quelle que soit la date d'activation ultérieure.

**Cible = acquéreur, jamais une double cible** : `taches` impose au plus une cible parmi ses sept
colonnes dédiées (ADR-028) — le bien apparaît uniquement dans le contenu opérationnel de la tâche
(`contexte`), jamais comme seconde cible en base. Conséquence directe et vérifiée : l'action
"Préparer un email" existante (ADR-031, `resoudreContexteCommunicationDepuisTache`) résout alors
exactement et sans ambiguïté le bon acquéreur.

```text
titre    = "Nouveau match — contacter {Prénom Nom} pour {référenceBien}"
contexte = "Atlas a détecté une nouvelle compatibilité avec ce bien. Vérifier les critères puis contacter l'acquéreur si pertinent."
type     = "appel" ; priorité = "normale" ; aucune échéance (ChampsTacheAutomatique n'en a jamais porté)
```

**Revalidation complète au moment de l'exécution** — l'événement signifie *"cette paire est devenue
compatible à un instant donné"*, jamais *"produire une tâche quelle que soit la situation
actuelle"*. Aucune tâche si, au moment du traitement : le bien ou l'acquéreur est introuvable ou
archivé ; `evaluerCompatibilite()` n'est plus `compatible` (redevenu incompatible ou à vérifier) ;
une offre `en_cours` ou un compromis `en_cours`/`realise` existe déjà pour cette paire précise (un
compromis `annule` ne bloque jamais indéfiniment) ; une tâche de cette règle est déjà ouverte pour
cette même paire (voir ci-dessous). Chaque cas retourne le résultat honnête "rien à produire",
jamais une erreur — une vraie panne technique continue, elle, à suivre le mécanisme d'échec/retry
ADR-032 existant.

**Anti-spam inter-cycle, distinct de l'idempotence ADR-032** : `UNIQUE(regle_code, evenement_id)`
garantit qu'un même événement ne produit jamais plus d'une exécution — mais un **nouveau cycle**
(nouvel événement) pour une paire dont la tâche précédente est encore ouverte ne crée **pas** de
seconde tâche (jamais une réouverture/modification de la première non plus) ; un nouveau cycle après
qu'une tâche précédente a été **terminée** produit, lui, normalement une nouvelle tâche. Identité de
la paire retrouvée via la provenance déjà réelle du moteur ADR-032
(`executions_automatisation.evenementId → evenements_metier.bienId/acquereurId`,
`executions_automatisation.tacheId → taches`), jamais une analyse de texte de tâche.

**Aucun snapshot, aucun email** : ni score, ni détail de critère, ni code INSEE dans la tâche — le
conseiller remonte à l'explication à jour depuis la fiche acquéreur (ADR-034). Aucun Gmail, aucune
notification : ADR-037 s'arrête à la tâche.

## Tâches (ADR-028)

**Fichier** : `src/lib/tachePriority.ts` (`scoreTache`). Utilisée pour trier les tâches sur
l'accueil, la fiche bien, et la "Mémoire du dossier" de la préparation de visite — un seul moteur,
jamais réimplémenté ailleurs. Remplace l'ancien `src/lib/actionPriority.ts`.

- Poids de base par priorité déclarée : `haute: 30`, `normale: 20`, `basse: 10`.
- `+50` si l'échéance est dépassée (en retard).
- `+15` si l'échéance est dans 2 jours ou moins (imminente, non encore dépassée).
- Une tâche `terminee` **ou** `annulee` (statut dérivé, `deriverStatutTache`) obtient un score de
  `-Infinity` (toujours exclue des listes triées, jamais de suppression physique nécessaire pour la
  faire disparaître).
- À score égal, la tâche créée le plus tôt (`creeLe` le plus ancien) passe devant.

Une tâche est rattachée à **au plus une** cible parmi bien/acquéreur/prospect vendeur/visite/
offre/compromis/rémunération (sept FK dédiées, `CHECK` en base — jamais un couple `objetType`/
`objetId` polymorphe, voir ADR-028) — ou à aucune (tâche générale). Terminer une tâche ne signifie
**jamais** silencieusement "contact réalisé" : pour une tâche rattachée à un prospect vendeur,
l'enregistrement d'une vraie interaction (mécanisme ADR-027) reste **opt-in**, une soumission
explicite distincte de la simple terminaison. `en_attente` (`StatutTache`) est réservé à une future
vraie notion métier d'attente — jamais dérivé aujourd'hui ; l'absence d'échéance s'affiche "Sans
échéance", jamais "En attente".

## Mémoire du dossier (page de préparation de visite)

**Fichier** : `src/lib/memoireDossier.ts`. Trois fonctions pures, chacune limitée et triée
indépendamment — jamais de dépendance implicite à l'ordre déjà fourni par l'appelant.

| Fonction | Entrée | Règle | Maximum |
|---|---|---|---|
| `selectionnerActionsEnCours` | Tâches du bien + tâches de l'acquéreur | Fusionne les deux listes (statut `a_faire` uniquement), tague chaque tâche `provenance: "bien" \| "acquereur"` (distinct de `Tache.origine`, manuelle/automatique) sans le stocker, trie par `scoreTache` décroissant | 5 |
| `selectionnerHistoriqueRecent` | Tâches du bien | Ne retient que les tâches **terminées** (jamais les créations, ni les annulées, déjà visibles dans "Tâches en cours" pour les tâches encore ouvertes), triées par `termineeLe` décroissant | 3 |
| `selectionnerComptesRendusRecents` | Comptes rendus du bien + id de l'acquéreur concerné | Filtre sur `acquereurId` exact (jamais les comptes rendus d'un autre acquéreur sur le même bien), trie par `dateVisite` décroissant | 3 |

Rien de cette section n'alimente `produirePointsAttention`/`produirePointsForts` : c'est une
relecture passive, jamais une entrée de calcul.

## Historique dérivé du bien

**Fichier** : `src/lib/historiqueBien.ts` (`deriverHistoriqueBien`). Ne s'applique qu'à un bien
réel sans dossier mock associé (voir `docs/DEMO_VS_REAL.md`) — pour un bien avec dossier mock,
l'historique manuscrit du mock est affiché tel quel, jamais mélangé au dérivé.

| Source | Condition | Texte produit |
|---|---|---|
| `bien.creeLe` | Toujours, si présent | `"Bien créé"` |
| Chaque tâche du bien | Toujours | `"Tâche créée : {titre}"` |
| Chaque tâche terminée du bien | Statut dérivé `terminee` et `termineeLe` défini | `"Tâche terminée : {titre}"` |
| Chaque tâche annulée du bien | Statut dérivé `annulee` et `annuleeLe` défini | `"Tâche annulée : {titre}"` |
| Chaque compte rendu de visite du bien | Toujours (tous acquéreurs confondus, contrairement à la Mémoire du dossier) | `"Visite effectuée — {label intérêt}"` |

Tri final par date décroissante sur l'ensemble combiné. **Jamais** le texte libre `retour` d'un
compte rendu n'apparaît dans l'historique — seulement le label court dérivé du champ structuré
`interet`.

## Comptes rendus de visite

**Fichiers** : `src/actions/enregistrerCompteRenduVisite.ts`, `src/lib/compteRenduVisiteRepository.ts`.

- `interet` est validé côté serveur contre exactement 4 valeurs
  (`interesse | a_reflechir | pas_interesse | inconnu`) — toute autre valeur est un refus
  d'insertion silencieux (pas d'exception, simple redirection sans écriture).
- `retour` (texte libre) est requis, `trim()` non vide, sinon refus d'insertion.
- `prochaineEtape` (texte libre, optionnel) **ne crée jamais de tâche automatiquement** — c'est un
  rappel textuel affiché dans la Mémoire du dossier ; créer une tâche à partir de cette
  information reste un geste manuel du conseiller (via "+ Ajouter une tâche").

## Onglet Visites → Effectuées de la fiche bien

**Fichier** : `src/components/bien/BienTabs.tsx`. Pour un bien réel sans dossier mock, la section
"Effectuées" est dérivée de `comptes_rendus_visite`, triés par `dateVisite` décroissante — jamais
mélangée au mock (`dossier.visitesEffectuees` reste affiché tel quel si un dossier existe).

| Champ affiché | Source | Traitement |
|---|---|---|
| Date de visite | `dateVisite` | Formatage seul, aucune reformulation |
| Acquéreur | `acquereurId` | Résolu via `getClientById()` (jamais `listerClients()`, pour rester résolu même si l'acquéreur a depuis été archivé) — `"Acquéreur indisponible"` si la résolution échoue malgré la garantie de FK (ADR-010) |
| Intérêt | `interet` | `LABEL_INTERET[interet]` |
| Retour | `retour` | Texte brut, jamais reformulé |
| Prochaine étape | `prochaineEtape` | Affiché uniquement si présent |

Complémentaire de l'historique dérivé (ligne courte, sans `retour` ni acquéreur nommé — voir
"Historique dérivé du bien" ci-dessus) : aucun des deux n'est une reformulation de l'autre, ce sont
deux granularités différentes des mêmes faits.

## Documents réels d'un bien

**Fichiers** : `src/lib/documentBienRepository.ts`, `src/lib/stockageDocuments.ts`,
`src/lib/documents/coherenceRattachementDocument.ts`, `src/lib/documents/checklistDossier.ts`,
`src/actions/ajouterDocumentBien.ts`, `src/app/api/documents/[id]/route.ts`. Détail de la
stratégie de stockage : ADR-013. Modèle documentaire étendu (rattachements, checklist) : ADR-029.

| Règle | Condition | Résultat |
|---|---|---|
| Type de fichier accepté | Toujours | Liste blanche stricte : `application/pdf`, `image/jpeg`, `image/png` — tout autre type MIME est refusé explicitement (`throw`, ADR-029) |
| Taille maximale | Toujours | 10 Mo (validation applicative) — au-delà de la limite framework (11 Mo, `next.config.ts`), la requête échoue avant même d'atteindre cette validation, voir `docs/KNOWN_LIMITATIONS.md` |
| Ajout sur un bien archivé | `bien.archiveLe` non NULL | Refusé explicitement (`throw`) — formulaire masqué côté UI, même patron que Notes/Comptes rendus (ADR-012) |
| Documents existants d'un bien archivé | Toujours | Restent listés et téléchargeables (`getBienById()`/`getDocumentBienById()` résolvent toujours une entité archivée) |
| Nom physique sur disque | Toujours | Clé opaque générée côté serveur (`genererCleStockage()`) — jamais le nom original, jamais un chemin fourni par l'utilisateur (ADR-013) |
| Nom affiché au téléchargement | Toujours | `nomFichierOriginal` (métadonnée DB), restitué via `Content-Disposition: attachment` — le chemin physique n'est jamais révélé |
| Document introuvable (id invalide, métadonnée absente, fichier physique absent) | Toujours | `404`, sans distinction observable entre ces cas |
| Suppression | — | Aucune en V1 — voir ADR-013 |
| Correction de classement (`bienId`, `nom`, `categorie`, `typeDocument`, dates, rattachements, `provenance`, `etatVerification`) | Toujours | Autorisée, remplacement complet (jamais un patch partiel) via `corrigerClassementDocumentBienAction` — **ne touche jamais** `nomFichierOriginal`/`cleStockage`/`tailleOctets`/`typeMime`/`creeLe` (fichier immuable, ADR-013/ADR-029) |
| Rattachement `compromisId`/`acquereurId`/`prospectVendeurId` incohérent avec `bienId` | `compromisId` renseigné et `compromis.bienId ≠ bienId`, ou `acquereurId` renseigné et incohérent avec le compromis, ou `prospectVendeurId` renseigné et `prospectVendeur.bienId ≠ bienId` | Refusé explicitement (`throw`, ADR-029) — des FK valides séparément ne suffisent pas |
| Vocabulaire `typeDocument` | Toujours | Liste fermée (`TYPES_DOCUMENT`, ADR-029) — vocabulaire **produit**, jamais une affirmation d'obligation légale |
| Checklist documentaire (`calculerChecklistDossier`) | Toujours | Entièrement dérivée (contexte + règles codées + documents présents), jamais un score global, jamais un booléen stocké — voir ADR-029 |
| Diagnostic sans `dateFinValidite` renseignée | Exigence à `suiviValidite` | État `a_verifier` — aucune durée légale calculée automatiquement (ADR-029, aucun audit officiel des durées) |
| Document `etatVerification = 'rejete'` | Toujours | L'exigence de checklist correspondante devient `incoherent` — jamais déduit automatiquement, uniquement sur signalement explicite du conseiller |

## Statut commercial du bien

**Fichiers** : `src/lib/statutCommercialBien.ts` (`deriverStatutCommercial`),
`src/actions/statutCommercialBien.ts`. Détail de la décision : ADR-014, 4e état `vendu` : ADR-017.

Aucun statut stocké — dérivé en lecture depuis deux timestamps de jalons sur `biens` et la liste
des compromis du bien :

| Condition | Statut dérivé |
|---|---|
| `offreEnCoursLe` NULL et `compromisSigneLe` NULL | `en_commercialisation` |
| `offreEnCoursLe` non NULL, `compromisSigneLe` NULL | `offre_en_cours` |
| `compromisSigneLe` non NULL | `compromis_signe` |
| Un compromis `realise` avec `dateActeReelle` existe | `vendu` (prioritaire sur les 3 précédents) |

| Règle | Condition | Résultat |
|---|---|---|
| Marquer une offre en cours | Toujours (bien non archivé) | `offreEnCoursLe = now()` |
| Retirer l'offre | `bien.archiveLe` NULL et `compromisSigneLe` NULL | `offreEnCoursLe = NULL` — sinon `throw` explicite (incohérence : compromis sans offre) |
| Marquer compromis signé | Toujours (bien non archivé) | `compromisSigneLe = now()` — **ne pose jamais `offreEnCoursLe`**, un compromis peut être marqué directement |
| Annuler le compromis | `bien.archiveLe` NULL | `compromisSigneLe = NULL` |
| Toute action sur un bien archivé | `bien.archiveLe` non NULL | `throw` explicite sur les 4 actions — écart volontaire par rapport à `modifierBienAction`/`archiverBienAction` (qui restent disponibles sur un bien archivé) : un jalon commercial est un nouveau fait métier, pas une édition des champs structurels |
| Jamais dérivé automatiquement | — | Aucune visite, aucun compte rendu, aucune action ne modifie ces timestamps — geste manuel du conseiller uniquement (aucun signal réel fiable, voir ADR-014) |

**Historique dérivé** (`deriverHistoriqueBien`) : lit directement `offreEnCoursLe`/
`compromisSigneLe` pour produire "Offre en cours"/"Compromis signé". **Non append-only** — annuler
un jalon efface rétroactivement l'événement correspondant, puisqu'il est recalculé en direct
depuis la valeur courante (voir `docs/KNOWN_LIMITATIONS.md`).

## Offres structurées

**Fichiers** : `src/lib/offreRepository.ts`, `src/actions/offre.ts`. Détail de la décision :
ADR-015.

`montant`/`acquereurId`/`bienId`/`dateOffre` immuables après création — une nouvelle proposition
(contre-offre, offre d'un autre acquéreur) est une nouvelle ligne. Seul `statut` est mutable,
`UPDATE` en place.

| Règle | Condition | Résultat |
|---|---|---|
| Créer une offre | Bien et acquéreur réels, existants, non archivés ; montant > 0 | `enregistrerOffre(...)` **puis** `marquerOffreEnCours(bienId)` dans la même action — un seul geste |
| Créer une offre — refus | Bien/acquéreur introuvable, archivé, ou montant invalide | `throw` explicite (`ajouterOffreAction`) |
| Changer le statut | Offre `en_cours`, bien et acquéreur non archivés | `en_cours` → `acceptee`/`refusee`/`retiree` uniquement — jamais l'inverse, jamais entre deux valeurs finales |
| Changer le statut — refus | Offre introuvable, bien/acquéreur archivé, ou offre déjà dans un statut final | `throw` explicite (`changerStatutOffreAction`) |
| `dateDecision` (ADR-020) | Obligatoire pour les trois transitions finales | `throw` explicite si absente, **aucune écriture** — posée atomiquement avec `statut` (`changerStatutOffre`) |
| `motifPerte` (ADR-020) | Obligatoire pour `refusee`/`retiree` ; doit rester `NULL` pour `acceptee` | `throw` explicite si absent/invalide pour `refusee`/`retiree`, ou si fourni pour `acceptee` — type discriminé `TransitionFinaleOffre` rendant ce dernier cas irreprésentable à la compilation |
| Couplage avec le statut commercial | Toujours | Créer une offre pose `offreEnCoursLe` ; changer son statut **ne modifie jamais** `offreEnCoursLe`/`compromisSigneLe` — gestes commerciaux volontairement séparés (ADR-014 non touchée) |
| Consultation | Toujours | `listerOffresPourBien()`/`listerOffresPourAcquereur()`/`getOffreById()` résolvent toujours, même sur un bien/acquéreur archivé |

**Historique dérivé** : un événement par offre à la création (`"Offre reçue — {montant}"`), plus un
second événement à la transition finale — `"Offre acceptée/refusée/retirée — {montant}"`, daté par
`dateDecision`, uniquement si cette date est présente (ADR-020 ; lignes créées avant cette
fonctionnalité, sans aucun backfill, n'affichent jamais ce second événement). **Sans nommer
l'acquéreur** (même convention que les visites) et **sans jamais afficher le motif** dans le texte
de l'historique — le détail vit dans l'onglet Offres.

## Compromis structuré

**Fichiers** : `src/lib/compromisRepository.ts`, `src/actions/compromis.ts`. Détail de la
décision : ADR-016.

`prixConvenu`/`bienId`/`acquereurId`/`offreId`/`dateSignature` immuables après création — une
nouvelle signature (si un premier compromis tombe à l'eau) est une nouvelle ligne. Plusieurs
compromis historiques autorisés par bien, un compromis annulé reste consultable. Seul `statut` est
mutable, `UPDATE` en place (même patron qu'`offres.statut`).

| Règle | Condition | Résultat |
|---|---|---|
| Créer un compromis | Bien et acquéreur réels, non archivés ; prix convenu > 0 ; aucun compromis `en_cours` déjà présent pour ce bien | `enregistrerCompromis(...)` **puis** `marquerCompromisSigne(bienId)` — un seul geste |
| Créer un compromis — refus | Bien/acquéreur introuvable ou archivé, prix invalide, ou compromis déjà `en_cours` pour ce bien | `throw` explicite (`ajouterCompromisAction`) — garde d'unicité applicative, pas une contrainte SQL |
| Offre liée (`offreId` optionnel) | Fournie | Doit exister, appartenir au même bien, au même acquéreur, et être `acceptee` — sinon `throw` explicite spécifique à chaque cas |
| Changer le statut vers `annule` | Compromis `en_cours`, bien et acquéreur non archivés, `dateAnnulation` et `motifAnnulation` fournis et valides | `marquerCompromisAnnule(id, dateAnnulation, motifAnnulation)` — **écriture atomique** : `statut`, `dateAnnulation` et `motifAnnulation` posés dans le même `UPDATE` (ADR-020) |
| Changer le statut vers `annule` — refus | `dateAnnulation` absente, ou `motifAnnulation` absent/hors vocabulaire | `throw` explicite, **aucune écriture** |
| Changer le statut vers `realise` | Compromis `en_cours`, bien et acquéreur non archivés, `dateActeReelle` fournie et valide | `marquerCompromisRealise(id, dateActeReelle)` — **écriture atomique** : `statut` et `dateActeReelle` posés dans le même `UPDATE` (ADR-017) ; ne touche jamais `dateAnnulation`/`motifAnnulation` |
| Changer le statut vers `realise` — refus | `dateActeReelle` absente ou invalide | `throw` explicite, **aucune écriture** — un compromis ne peut jamais devenir `realise` sans date réelle |
| Changer le statut — refus (commun) | Compromis introuvable, bien/acquéreur archivé, ou compromis déjà dans un statut final | `throw` explicite (`changerStatutCompromisAction`) |
| `dateActe` (prévue) vs `dateActeReelle` (constatée) | Toujours | Deux champs strictement distincts, jamais fusionnés — `dateActe` immuable après création, `dateActeReelle` posée uniquement au passage à `realise` (ADR-017) |
| Couplage avec le statut commercial | Toujours | Créer un compromis pose `compromisSigneLe` ; changer son statut **ne le modifie jamais** — geste commercial séparé (ADR-014/ADR-016 non touchées) |
| Couplage vers archivage/`stadeProjet`/commission | Jamais | Aucune automatisation — gestes manuels séparés (ADR-017) |
| Consultation | Toujours | `listerCompromisPourBien()`/`listerCompromisPourAcquereur()`/`getCompromisById()` résolvent toujours, même sur un bien/acquéreur archivé |

**Historique dérivé** : un événement par compromis, à la création
(`"Compromis structuré — {prixConvenu}"`), **sans nommer l'acquéreur**. Libellé volontairement
distinct de l'événement générique ADR-014 (`"Compromis signé"`, dérivé de `compromisSigneLe`), qui
continue de coexister séparément — le premier est la création de l'entité détaillée, le second le
jalon commercial synthétique du bien. Aucun événement pour un changement de statut, **sauf**
`realise` avec `dateActeReelle` présente (`"Vente finalisée — {prixConvenu}"`, ADR-017) et
**sauf** `annule` avec `dateAnnulation` présente (`"Compromis annulé — {prixConvenu}"`, ADR-020) —
chacune datée par son champ dédié, jamais affichée si la date manque (aucun backfill), jamais avec
le motif dans le texte de l'événement.

**Pilotage futur (non construit dans cette passe)** : la distinction `dateActe`/`dateActeReelle`
est délibérément conservée pour permettre plus tard, sans changement de modèle, un suivi de
pipeline/délais (écart prévu/réel), un CA prévisionnel (compromis non actés) vs réalisé (ventes
`vendu`), des taux de conversion, et une analyse des ventes perdues (compromis `annule`) — voir
ADR-017.

## Rémunération conseiller

**Fichiers** : `src/lib/remunerationRepository.ts`, `src/actions/remuneration.ts`,
`src/types/remuneration.ts`. Détail de la décision : ADR-021.

Relation 1:1 stricte avec `compromis` (`compromisId` `UNIQUE`) — au plus une ligne pour toute la
durée de vie d'un compromis, V1 suppose un encaissement unique (pas de paiement partiel, plusieurs
versements, avoirs ni régularisations). Montants en **centimes entiers**, saisis à la main,
**aucun** calcul automatique (jamais `prixConvenu × taux`, jamais `honoraires × pourcentage`,
aucune relation entre `montantHonorairesTotalCentimes` et `montantRemunerationConseillerCentimes`).
Aucune ligne vide : si le montant n'est pas connu, aucune ligne `remuneration` n'est créée.

| Règle | Condition | Résultat |
|---|---|---|
| Créer une rémunération | Compromis réel, non `annule` ; si `en_cours`, bien et acquéreur non archivés ; montant conseiller > 0 ; honoraires totaux absents ou > 0 ; aucune rémunération déjà associée à ce compromis | `enregistrerRemuneration(...)` |
| Créer une rémunération — refus | Compromis introuvable/`annule` ; compromis `en_cours` avec bien/acquéreur archivé ; montant invalide ; doublon | `throw` explicite (`ajouterRemunerationAction`) |
| Créer sur un compromis `realise` archivé | Toujours autorisé | Aucun blocage d'archivage — voir "Archivage" ci-dessous |
| Corriger avant encaissement | Rémunération non encaissée ; mêmes conditions d'archivage que la création | `modifierRemunerationPrevisionnelle(...)` — **remplacement complet** des trois champs corrigibles, `montantHonorairesTotalCentimes`/`dateEncaissementPrevue` en `number \| null` / `string \| null` (jamais `undefined` = "ne pas toucher") |
| Corriger — refus | Déjà encaissée, compromis `annule`, ou compromis `en_cours` avec bien/acquéreur archivé | `throw` explicite (`modifierRemunerationAction`) |
| Marquer encaissée | Compromis `statut === "realise"` **et** `dateActeReelle` présente ; `dateEncaissementReelle` fournie | `marquerRemunerationEncaissee(...)` — écriture atomique dédiée, ligne figée ensuite |
| Marquer encaissée — refus | Compromis non `realise`, `dateActeReelle` absente, `dateEncaissementReelle` manquante, ou déjà encaissée | `throw` explicite (`marquerRemunerationEncaisseeAction`) — **aucune vérification d'archivage** |
| Gel concurrent | `modifierRemunerationPrevisionnelle`/`marquerRemunerationEncaissee` appelées après un encaissement posé entre-temps | L'`UPDATE` (protégé par `WHERE date_encaissement_reelle IS NULL`) ne touche aucune ligne → le repository retourne `undefined` → la Server Action lève une erreur explicite |
| Vente annulée | Compromis passé `annule` après création d'une rémunération prévisionnelle | La ligne reste consultable telle quelle (jamais modifiée/supprimée), sort du prévisionnel actif |
| Consultation | Toujours | `listerRemunerationsPourBien()`/`getRemunerationParCompromis()` résolvent toujours, même sur un bien/acquéreur archivé |

**Archivage — exception au reste du domaine commercial** : l'archivage du bien/acquéreur ne bloque
**que** les nouveaux engagements/corrections sur un compromis encore `en_cours`. Il ne bloque jamais
la création, la correction (avant encaissement) ni l'encaissement d'une rémunération sur un
compromis déjà `realise` — le règlement financier d'une vente déjà conclue ne s'arrête pas à
l'archivage du dossier commercial (ADR-021, "Archivage commercial ≠ clôture du suivi financier
historique").

**États dérivés, jamais stockés** : `previsionnelle` (`en_cours`), `associee_vente_finalisee`
(`realise` sans `dateEncaissementReelle`), `encaissee` (`realise` avec `dateEncaissementReelle`) —
mutuellement exclusifs, calculés par `deriverEtatRemuneration()`. Un compromis `annule` ne retourne
aucun état. Aucune notion comptable/juridique de "CA acquis" n'est gravée dans cette passe — une
future passe dédiée déterminera le traitement fiscal/comptable.

**Historique dérivé** : un seul événement, `"Rémunération encaissée — {montant}"`, posé uniquement
quand `dateEncaissementReelle` est présente — pas d'événement à la création de la ligne
prévisionnelle, pas d'événement de correction.

## Dashboard commercial

**Fichiers** : `src/lib/dashboardRepository.ts` (lecture seule, aucune Server Action),
`src/app/dashboard/page.tsx`. Détail de la décision : ADR-018.

Convention de retour : un compteur/une somme à `0` est une vraie valeur mesurée ; un taux, une
moyenne ou un délai dont le dénominateur est vide retourne `undefined` (affiché "—"), jamais `0`
(même principe qu'ADR-009 appliqué aux agrégats).

**Règle d'archivage** : Résultats/Activité/Délais/Pertes commerciales incluent les biens et
acquéreurs archivés (l'historique ne se réécrit pas rétroactivement) ; Pipeline exclut les biens
archivés uniquement (jointure `biens.archive_le is null` — l'archivage acquéreur n'est pas pris en
compte). Rémunération suit une règle asymétrique par métrique (ADR-021) : voir la famille dédiée
ci-dessous.

| Famille | Métrique | Formule / source | Réserve affichée dans l'UI |
|---|---|---|---|
| Résultats | Ventes finalisées | `count(*)` sur `compromis` où `statut = 'realise'` et `date_acte_reelle` non nulle | — |
| Résultats | Volume vendu | `sum(prix_convenu)` sur le même périmètre | Volume de transaction, jamais le CA du conseiller |
| Résultats | Taux compromis → vente | `realise / (realise + annule)` parmi les compromis résolus | `undefined` si aucun compromis résolu |
| Résultats | Réalisé par mois | `sum(prix_convenu)` groupé par mois de `date_acte_reelle` | — |
| Pipeline | Compromis en cours | `count(*)` sur `compromis` `en_cours`, bien non archivé | Biens archivés exclus |
| Pipeline | Volume sous compromis | `sum(prix_convenu)` même périmètre | Biens archivés exclus |
| Pipeline | Pipeline prévisionnel par mois | `sum(prix_convenu)` groupé par mois de `date_acte` (prévue), compromis `en_cours`, bien non archivé | Prévisionnel, non garanti (annulation/décalage possibles) |
| Pipeline | Offres en cours / leur volume | `count(*)`/`sum(montant)` sur `offres` `en_cours`, bien non archivé | Biens archivés exclus |
| Activité | Visites / offres / compromis enregistrés | `count(*)` sur chaque table, sans filtre d'archivage | — |
| Activité | Moyenne de visites avant vente | Moyenne, par vente `realise`, du nombre de `comptes_rendus_visite` du même couple bien/acquéreur antérieurs à `date_signature` — **ventes sans compte rendu exclues du dénominateur**, jamais comptées comme 0 | "Calculé uniquement sur les ventes disposant d'au moins un compte rendu de visite" |
| Activité | Taux visite → offre | Comptes rendus distincts référencés par au moins une ligne `offre_visites`, sur le total des comptes rendus enregistrés (ADR-019) — lien explicite uniquement, jamais par proximité de date | "Calculé uniquement à partir des visites explicitement associées à une offre" |
| Délais | Délai moyen offre → compromis | `avg(date_signature - date_offre)` sur les compromis liés à une offre (`offre_id` non nul) | Uniquement les compromis liés à une offre enregistrée |
| Délais | Délai moyen compromis → acte | `avg(date_acte_reelle - date_signature)` sur les compromis `realise` | — |
| Délais | Délai moyen visite → offre | `avg(date_offre - date_visite)` sur chaque paire explicitement liée via `offre_visites` (ADR-019) | "Calculé uniquement à partir des visites explicitement associées à une offre" |
| Pertes commerciales | Offres refusées / retirées | `count(*)` sur `offres` `statut in ('refusee','retiree')` (ADR-020) | — |
| Pertes commerciales | Volume des offres perdues | `sum(montant)` même périmètre | "Montant proposé, jamais accepté — pas un chiffre d'affaires" |
| Pertes commerciales | Compromis annulés | `count(*)` sur `compromis` `annule` (déplacé depuis Délais, ADR-020) | — |
| Pertes commerciales | Volume de transactions interrompues | `sum(prix_convenu)` même périmètre | "Volume de transaction, pas un chiffre d'affaires" |
| Pertes commerciales | Offres perdues / compromis annulés par motif | `GROUP BY motif_perte`/`motif_annulation`, `WHERE motif ... IS NOT NULL` (ADR-020) | "Calculé uniquement sur les pertes disposant d'un motif renseigné" |
| Pertes commerciales | Offres perdues / compromis annulés par mois | `GROUP BY` mois de `date_decision`/`date_annulation`, `WHERE ... IS NOT NULL` — jamais approximé depuis `date_offre`/`date_signature` | "Calculé uniquement sur les pertes disposant d'une date de décision/d'annulation fiable" |
| Rémunération | Rémunération prévisionnelle | `sum(montant_remuneration_conseiller_centimes)` sur `remuneration` ⨝ `compromis` `en_cours`, bien non archivé (ADR-021) | Biens archivés exclus + compteur de couverture ("renseignée sur X compromis sur Y") ; `undefined` (pas `0`) si aucune ligne renseignée |
| Rémunération | Rémunération associée à une vente finalisée | Même somme, `compromis` `realise` **et** `date_encaissement_reelle IS NULL`, biens archivés inclus | Compteur de couverture partagé avec la ligne "encaissée" (même dénominateur : toutes les ventes `realise`) ; `undefined` si aucune ligne renseignée |
| Rémunération | Rémunération encaissée | Même somme, `compromis` `realise` **et** `date_encaissement_reelle IS NOT NULL`, biens archivés inclus | Mutuellement exclusive de la ligne précédente (jamais la même ligne dans les deux) ; `undefined` si aucune ligne renseignée |
| Rémunération | Rémunération encaissée par mois | `sum(...)` groupé par mois de `date_encaissement_reelle` | — |
| Projection annuelle | Encaissé depuis le 1er janvier | `sum(...)` sur `remuneration` ⨝ `compromis` `realise` **et** `date_encaissement_reelle` dans l'année en cours, biens archivés inclus (ADR-022) | Réserve reprend la couverture "ventes finalisées" de `chargerRemuneration()` : le montant ne peut refléter que les ventes finalisées disposant d'une rémunération renseignée |
| Projection annuelle | Finalisé non encaissé à ce jour | Réutilise `remunerationVenteFinaliseeNonEncaisseeCentimes` (`chargerRemuneration()`), **jamais filtré à l'année** | "Toutes années confondues. Les rémunérations sans date d'encaissement prévue restent incluses dans ce total mais sont absentes de la ventilation mensuelle" |
| Projection annuelle | Prévisionnel restant jusqu'au 31 décembre | `sum(...)` sur `compromis` `en_cours` **uniquement** (jamais fusionné avec finalisé non encaissé), bien non archivé, `date_encaissement_prevue` entre aujourd'hui et le 31/12 (ADR-022) | Compteur de couverture à un troisième niveau ("Z/Y disposent en plus d'une date prévue"), composé avec les deux premiers niveaux de `chargerRemuneration()` ; `undefined` seulement si aucune date prévue n'est connue du tout, `0` si des dates sont connues mais hors fenêtre (jamais confondus, ADR-022) |
| Projection annuelle | Encaissement(s) attendu(s) dépassé(s) | `sum(...)` + `count(*)` sur `remuneration` ⨝ `compromis` `realise`, `date_encaissement_reelle IS NULL`, `date_encaissement_prevue IS NOT NULL` et `< aujourd'hui`, biens archivés inclus (ADR-022) | **Jamais** le mot "retard" ; nombre de ventes concernées + couverture des dates prévues affichés ; même distinction `undefined`/`0` que ci-dessus |
| Projection annuelle | Ventilation janvier → décembre (prévisionnel / finalisé non encaissé / encaissé) | `generate_series` (spine 12 mois) `LEFT JOIN` trois agrégats par `date_encaissement_prevue` (prévisionnel, finalisé non encaissé) ou `date_encaissement_reelle` (encaissé), `coalesce(...,0)` | Toujours 12 mois, zero-remplis ; un `0 €` signifie "aucune ligne datée ce mois-là", pas une couverture exhaustive — réserve rappelle les compteurs de couverture |

**Explicitement écarté** (donnée non instrumentée dans le dashboard lui-même) : chiffre d'affaires,
fiscalité, et toute notion comptable/juridique de rémunération "acquise" — `remuneration`
(ADR-021) instrumente les montants saisis mais ne tranche aucune de ces questions. Le moteur fiscal
année courante (ADR-024, voir section dédiée ci-dessous) calcule désormais cotisations/CFP/VFL et
seuils micro-BNC/TVA à partir des fondations de collecte (ADR-023), mais reste entièrement séparé
du dashboard commercial — aucune de ces métriques n'apparaît sur `/dashboard`, uniquement sur
`/fiscal`. Projection pluriannuelle N+1 à N+5 disponible depuis ADR-025 (voir section dédiée
ci-dessous) ; scénarios nommés, TVA collectée/déductible et déclaration automatique restent hors
périmètre. Voir ADR-018, ADR-021, ADR-023, ADR-024, ADR-025 et
`docs/KNOWN_LIMITATIONS.md`. Le taux
et le délai visite → offre, écartés dans ADR-018 faute de lien matérialisé, sont désormais
disponibles via le lien explicite `offre_visites` (ADR-019) — avec la réserve que seules les
visites explicitement liées après la mise en place de ce lien sont comptées (aucun rattrapage
automatique de l'historique). Aucun taux de conversion par cause en V1 (ADR-020) — voir
`docs/KNOWN_LIMITATIONS.md`. Aucun écart moyen `dateEncaissementPrevue → dateEncaissementReelle`
(ADR-022) : la date prévue reste corrigible jusqu'à l'encaissement, elle ne représente donc pas
nécessairement la prévision initiale — mesurer cet écart serait trompeur tant qu'aucun historique
des corrections n'existe.

Pas de graphiques, pas de filtre temporel en V1 (y compris pour la projection annuelle, ADR-022 :
année civile fixe, pas de sélecteur) — les séries "par mois" s'affichent en liste simple.

## Fondations fiscales

**Fichiers** : `src/lib/dossierFiscalRepository.ts`, `profilFiscalRepository.ts`,
`historiqueAmorcageRepository.ts`, `rfrFoyerRepository.ts`, `referentielFiscalRepository.ts`,
`src/actions/profilFiscal.ts`/`historiqueAmorcage.ts`/`rfrFoyer.ts`, page `/fiscal`. Détail de la
décision : ADR-023. **Aucune estimation ni aucun calcul fiscal n'existe dans cette passe** —
uniquement la collecte de faits ; le calcul est construit par ADR-024 (moteur année courante) et
ADR-025 (projection pluriannuelle N+1 à N+5).

**Mono-dossier** : `dossier_fiscal` est une table à une seule ligne (`id = 'default'`), créée à la
demande par `obtenirDossierFiscalDefaut()`. `profil_fiscal`/`historique_amorcage`/`rfr_foyer` s'y
rattachent tous via `dossier_fiscal_id`, avec `UNIQUE(dossier_fiscal_id, annee)` /
`UNIQUE(dossier_fiscal_id, annee_rfr)` — le futur rattachement conseiller → dossier fiscal sera
additif, sans retoucher ces trois tables.

| Règle | Condition | Résultat |
|---|---|---|
| Profil fiscal — enregistrer | Toujours (formulaire `/fiscal`) | `enregistrerProfilFiscal(...)` — **toujours une insertion**, jamais une édition, y compris pour une correction rétroactive |
| Profil fiscal — résolution à une date D | Toujours | `chargerProfilFiscalADate(D)` : ligne la plus récente dont `dateDebutValidite <= D`, triée `dateDebutValidite DESC, creeLe DESC` |
| Profil fiscal — égalité de date | Deux lignes avec la même `dateDebutValidite` | La plus récemment créée (`creeLe`) fait foi ; aucune ligne jamais supprimée ni modifiée |
| Amorçage — enregistrer/corriger une année | Toujours (formulaire `/fiscal`) | `enregistrerHistoriqueAmorcage(...)` — upsert par `(dossierFiscalId, annee)`, remplace la ligne existante |
| Amorçage — lecture de couverture | Année demandée sans ligne | `chargerCouvertureAnnee` retourne `{ connu: false }` — **jamais** `{ montant: 0 }` |
| Amorçage — lecture de couverture | Année demandée avec ligne, y compris `montant = 0` | `{ connu: true, montantEncaisseCentimes, dateFinCouverture }` — zéro explicitement confirmé |
| RFR foyer — enregistrer/corriger une année | Toujours (formulaire `/fiscal`, entièrement optionnel) | `enregistrerRfrFoyer(...)` — upsert par `(dossierFiscalId, anneeRfr)` |
| Référentiel légal — insérer une règle | Script de seed uniquement, jamais une Server Action utilisateur | `insererRegleFiscale(...)` — rejette (`throw`) tout chevauchement `[début, fin[` avec une règle existante du même `(code, categorieActivite)` |
| Référentiel légal — résoudre une règle à une date D | Toujours | `resoudreRegle(code, categorieActivite, D)` retourne la règle applicable ou `undefined` (jamais une valeur par défaut ni une extrapolation) ; `statutVerification` toujours inclus, jamais filtré |

**`inconnu` comme vraie valeur** (généralisation d'ADR-009) : chaque champ à choix contraint de
`profil_fiscal` (`regimeFiscal`, `regimeComptable`, `regimeTva`, `periodiciteUrssaf`,
`affiliationRetraite`) admet `'inconnu'`, distinct de l'absence de ligne — Atlas n'en déduit jamais
un régime par défaut. `regimeComptable` est totalement découplé de la TVA : il concerne uniquement
la lecture des recettes BNC en déclaration contrôlée, jamais la détermination du CA de référence
TVA (`regimeTva`/`optionDebits` seuls).

**Aucune donnée monétaire ou fiscale en flottant** : `montantEncaisseCentimes`/`rfrFoyerCentimes`
en centimes entiers, `nombrePartsCentiemes` en centièmes entiers (1,5 part = `150`),
`regleFiscale.valeur` en entier dont `unite` fixe la représentation (`centimes`/`points_base`/
`jours`, ex. 25,6 % = `2560` points de base) — aucune conversion flottante côté JS.

**Onboarding "Ma situation fiscale"** (`/fiscal`) : trois formulaires (profil, amorçage, RFR)
au-dessus d'un résumé du profil actuel et d'un historique par année pour amorçage/RFR. En ADR-023,
le référentiel légal n'y était ni affiché ni consommé — la page ne faisait que collecter des faits.
Depuis ADR-024, la page affiche en plus la section "Vue {année}" qui consomme le référentiel via le
moteur fiscal (voir section suivante) ; les formulaires de collecte restent inchangés.

## Moteur fiscal — année courante (ADR-024)

**Fichiers** : `src/lib/fiscal/*`, section "Vue {année}" de `/fiscal`
(`src/components/fiscal/VueAnneeResume.tsx`). Premier moteur de calcul, borné à l'année civile en
cours — la projection N+1 à N+5 est un moteur séparé (ADR-025, voir section suivante). Aucune TVA
collectée/déductible, aucune déclaration automatique.

**Assiette annuelle** (`resoudreAssietteAnnuelle`) : jamais de déduction d'un début de couverture
depuis le seul fait qu'un premier encaissement Atlas existe. Sans ligne `historique_amorcage`
explicite pour l'année, tous les encaissements Atlas connus entrent dans `montantConnuCentimes`
mais `couverture` reste `"partielle"` et `periodesInconnues` couvre toute la période visible, même
la portion où des montants sont déjà connus — `PeriodeInconnue` signifie "exhaustivité non
garantie", pas "aucune donnée".

**Rattachement au taux applicable, tranche par tranche** (`resoudreTrancheAvecTaux`) : chaque
encaissement est résolu à sa propre date ; un changement de taux en cours d'année ne s'applique
jamais rétroactivement à tout le CA. Une tranche d'amorçage (un intervalle, pas une date) dont le
taux ou le régime change entre son début et sa fin est marquée `amorcage_non_ventilable` plutôt que
devinée.

| Règle | Condition | Résultat |
|---|---|---|
| Cotisations sociales | `regimeFiscal = 'micro_bnc'` **et** `affiliationRetraite = 'ssi_regime_general'` | Taux `taux_cotisations_bnc_general` appliqué tranche par tranche |
| Cotisations sociales — refus | Tout autre régime/affiliation (déclaration contrôlée, Cipav) | `regime_non_couvert` — jamais une approximation |
| Cotisations sociales — ACRE | ACRE actif à la date de la tranche | `regle_absente` (aucun barème ACRE dans le référentiel, ADR-023) — jamais le taux plein appliqué par défaut |
| CFP | `regimeFiscal = 'micro_bnc'` | Taux `taux_cfp_liberal_non_reglemente` (statut `a_confirmer` conservé dans la provenance, calculé quand même) |
| Versement libératoire | `regimeFiscal = 'micro_bnc'` **et** `optionVersementLiberatoire = true` à la date de la tranche | Taux `taux_versement_liberatoire_bnc` appliqué |
| Versement libératoire — jamais dérivé du RFR | RFR favorable mais option désactivée | Reste à 0 — le RFR n'active jamais l'option tout seul |
| Éligibilité RFR (`verifierEligibiliteRfr`) | Ligne `rfr_foyer` pour l'année N-2 présente | Contrôle informatif séparé, comparaison par produit en croix (jamais de division/arrondi) |
| Franchise TVA | `regimeTva = 'franchise'` | Marges avant seuil de base/majoré calculées |
| Franchise TVA — refus | `regimeTva` redevable ou inconnu | `regime_tva_non_supporte` — `montantRemunerationConseillerCentimes` n'a aucune sémantique HT/TTC modélisée, aucune couche TVA créée |
| Micro-BNC | Toujours (si `regimeFiscal = 'micro_bnc'`) | Recettes connues vs plafond plein ; statut N-1/N-2 seulement si leur couverture est complète, sinon indéterminé — jamais de verdict "sortie du micro" |
| Micro-BNC — année de création | `dateDebutActivite` dans l'année calculée | Plafond proratisé exposé comme valeur de référence du mécanisme légal des années de référence, jamais comme seuil de sortie immédiate ; `depasse` compare toujours au plafond plein |

**Arithmétique** (`arithmetiqueFiscale.ts`) : taux en points de base et prorata en jours calculés
exclusivement en `BigInt`, arrondi "moitié vers le haut" documenté et testé aux bornes — jamais
`Math.round(a * b / c)`, qui produirait un flottant JS intermédiaire.

**Contrat de résultat** (`ResultatFiscal<T>`, `src/types/resultatFiscal.ts`) : jamais un `number` nu.
`"calcule"` seulement si aucune raison n'existe, y compris l'incomplétude de l'assiette elle-même —
jamais `"calcule"` sur une couverture partielle même si toutes les tranches connues résolvent un
taux. `"indisponible"` seulement si aucune tranche n'a pu être résolue. Un `statutVerification`
`a_confirmer`/`recoupement` n'empêche jamais `"calcule"` : la provenance le porte, à l'UI de le
signaler.

**Projection fin d'année** (`calculerProjectionFinAnnee`) : trois blocs jamais fusionnés
silencieusement — encaissé réel (assiette annuelle), ventes finalisées non encaissées avec date
prévue restant dans l'année (`finaliseNonEncaisseRestantCentimes`, nouveau champ symétrique de
`encaissementsAttendusDepassesCentimes` sur `chargerProjectionAnnuelle`), compromis `en_cours` avec
date prévue restant dans l'année (réutilise `previsionnelRestantCentimes`, ADR-022). La somme des
trois n'est calculée que si les deux blocs "restant" sont tous deux connus ; une rémunération sans
date prévue n'est placée dans aucun bloc.

**UX "Vue {année}"** : cinq blocs — ce que j'ai encaissé, ce que je devrais provisionner, où j'en
suis par rapport aux seuils, ce qui pourrait encore arriver cette année, ce qu'Atlas ne sait pas
encore calculer et pourquoi. `ExplicationCalcul` affiche assiette + provenance sous chaque montant
calculé ; `libellesRaisons.ts` traduit chaque raison en phrase française sans jargon.

## Projection fiscale pluriannuelle — N+1 à N+5 (ADR-025)

**Fichiers** : `src/lib/fiscal/{runRate,historiqueMensuel,resolutionRegleProjection,
resolutionTrancheProjetee,projectionAnnuelle,projectionPluriannuelle,
consequencesFiscalesProjetees}.ts`, section "Projection {N+1}–{N+5}" de `/fiscal`
(`src/components/fiscal/ProjectionPluriannuelle.tsx`).

| Règle | Condition | Résultat |
|---|---|---|
| Pipeline vs tendance statistique | Toujours | Deux blocs strictement séparés, jamais additionnés — aucun champ agrégé n'existe sur `ProjectionAnneeFiscale` |
| Run-rate — seuil de fiabilité | Moins de 6 mois calendaires entièrement garantis (frontière `historique_amorcage` au dernier jour d'un mois) | `montantCentimes: undefined` — jamais un run-rate calculé sur un historique trop court ou une frontière partielle |
| Run-rate — moyenne | 6 mois garantis ou plus | Moyenne sur **tous** les mois garantis, série zero-remplie (un mois sans vente compte comme 0, jamais exclu du dénominateur) |
| Règle légale pour une date future — officielle | `dateFinValidite` explicitement connue et postérieure à la date demandée | `origine: "officielle"` |
| Règle légale pour une date future — hypothèse | Règle ouverte (`dateFinValidite = NULL`) ou dernière règle jamais publiée | `origine: "hypothese_reconduction"` — jamais matérialisée en base |
| Règle légale pour une date future — indisponible | Aucune règle historique pour ce code | `origine: "indisponible"` |
| Changement de règle en cours d'année projetée | Toujours | Chaque tranche (mois de run-rate ou élément de pipeline) résolue à sa propre date — jamais un dernier taux connu appliqué au total annuel |
| Hypothèse utilisateur — ventilable | Profil **et** chaque règle applicable identiques du 1er janvier au 31 décembre de l'année | Montant annuel taxé directement |
| Hypothèse utilisateur — non ventilable | Profil ou une règle change en cours d'année | `ventilation_requise` sur chaque composante — jamais une répartition devinée |
| Hypothèse utilisateur — persistance | Toujours | Lue depuis la query string du formulaire GET, jamais écrite en base, valable uniquement pour la requête courante |

**Contrat de résultat** (`ResultatFiscalProjete<T>`, `src/types/projectionFiscale.ts`) : sur-ensemble
de `ResultatFiscal<T>` (ADR-024), provenance élargie (`ProvenanceRegleProjection`) pour porter la
distinction officielle/hypothèse, toujours visible dans `ExplicationCalculProjection.tsx`.

## Moteur d'alertes déterministes du copilote (ADR-026)

**Fichiers** : `src/lib/alertes/{contexte,reglesDonnees,reglesCommercial,reglesFiscal,
reglesProjection,deduplication,priorite,moteur}.ts`, section "Ce qui mérite mon attention" en tête
de `/` (`src/components/alertes/AlerteCard.tsx`). Dérive à la lecture, sans aucune persistance, un
ensemble priorisé d'alertes à partir des résultats déjà exposés par ADR-022→025 — aucun nouveau
repository, aucune requête Drizzle dans les règles elles-mêmes.

| Règle | Condition | Résultat |
|---|---|---|
| Profil fiscal absent | `chargerProfilFiscalActuel()` renvoie `undefined` | Alerte `action_requise`, cause racine — supprime en déduplication toute alerte fiscale dépendante, jamais les alertes commerciales |
| Champ réellement inconnu | `regimeFiscal`/`regimeTva`/`affiliationRetraite` = `'inconnu'` | Alerte `action_requise` par champ, action vers `/fiscal#profil` |
| Régime connu mais non couvert | Régime réellement renseigné mais hors périmètre V1 (ex. déclaration contrôlée) | Alerte `information`/`attention`, **jamais** une action de changer de régime réel |
| Assiette incomplète | `AssietteAnnuelle.couverture === "partielle"` (jamais l'absence brute d'une ligne `historique_amorcage`) | Alerte `action_requise`, action vers `/fiscal#amorcage` — peut absorber "run-rate insuffisant" en déduplication |
| Rémunérations/dates manquantes | Compteurs agrégés existants (`chargerRemuneration()`/`chargerProjectionAnnuelle()`) | Alerte `attention` agrégée — V1 sans listing dossier par dossier |
| Règle légale absente | `RaisonIndisponibilite.type === "regle_absente"` rencontrée (ACRE inclus) | Alerte `attention` dédupliquée par code, jamais une action utilisateur |
| Run-rate insuffisant | 1 à 5 mois garantis (0 = absence légitime, pas une anomalie ; 6+ = déjà fiable) | Alerte `information` |
| Encaissement attendu dépassé | `nombreEncaissementsAttendusDepasses > 0` | Alerte `attention`, vocabulaire neutre imposé (jamais "retard"/"incident"/"anomalie") |
| Dépassement micro-BNC constaté | `microBnc.anneeCourante.statut === "connue" && depasse` | Alerte `attention`, jamais un verdict de sortie du régime |
| Deux années consécutives dépassées | Année courante et année précédente, connues, dépassent toutes deux | Alerte `attention`, combinaison de faits déjà calculés |
| VFL actif, RFR non vérifiable | `vflActif(profil)` et `verifierEligibiliteRfr()` indisponible pour `rfr_absent` | Alerte `attention`, action vers `/fiscal#rfr` — le calcul du VFL lui-même n'est jamais remis en cause |
| Dépassement projeté | Micro-BNC ou seuil TVA dépassé dans un scénario N+1→N+5 | Alerte `information` par année, pipeline et tendance statistique jamais additionnés |
| Règles futures hypothétiques | Au moins une `origine: "hypothese_reconduction"` sur l'horizon projeté | Une seule alerte globale N+1→N+5, jamais une par règle et par année |

**Déduplication** : par cause racine (type + code), jamais par comparaison de texte — un filet de
sécurité déduplique en dernier recours par identifiant déterministe puis par libellé strictement
identique. **Priorité** : score = poids fixe du niveau (toujours dominant) + poids fixe par type
d'alerte + tie-break sur l'identifiant déterministe — même principe que `tachePriority.ts`, aucun
score jamais affiché à l'UI. **Volontairement exclu de cette V1** : alerte de proximité de seuil
(les marges restent affichées en continu dans `/fiscal`, sans alerte proactive), listing individuel
pour les compteurs agrégés, recommandation d'optimisation fiscale.

## CRM vendeur / prise de mandat (ADR-027)

**Fichiers** : `src/lib/{prospectVendeurRepository,noteProspectVendeurRepository,
prospectVendeurFormulaire}.ts`, `src/actions/prospectVendeur.ts`,
`src/app/prospects-vendeurs/**`. Une opportunité commerciale de prise de mandat sur un bien
potentiel, avec un contact vendeur principal — en amont de `biens`, jamais un CRM contact
générique (un seul contact par opportunité, une seule opportunité par bien).

| Règle | Condition | Résultat |
|---|---|---|
| Statut dérivé | Jamais stocké | Cascade du jalon le plus avancé : `prospect < qualification < rendez_vous < estimation < mandat_propose < mandat_signe`, `perdu` prioritaire depuis n'importe quel état |
| Rendez-vous prévu vs réalisé | `rdvEstimationPrevuLe` seul posé | Ne fait **jamais** avancer le statut — seul `rdvEstimationRealiseLe` (tenu) le fait |
| Contact minimal | Création d'un prospect | `email`/`telephone` tous deux facultatifs, aucun invariant croisé — un lead de prospection terrain peut être créé sans coordonnée |
| Adresse vs secteur | Saisie du bien potentiel | `adresseBienPotentiel` (précise) et `secteurBienPotentiel` (approximatif) restent deux champs distincts, jamais fusionnés |
| Dernier contact | Note ajoutée ou jalon posé | Avance uniquement sur une vraie interaction (note de type ≠ `note_interne`, ou rendez-vous marqué réalisé) — jamais sur un simple jalon de pipeline |
| Perte | `marquerProspectVendeurPerduAction` | `motifPerte`/`datePerte` posés atomiquement, vocabulaire dédié (`MotifPerteProspectVendeur`), refusé si le mandat est déjà signé |
| Archivage | `archiverProspectVendeurAction` | Distinct de la perte (gestion administrative, ADR-012) — jamais compté dans le taux de conversion |
| Conversion en bien | `signerMandatProspectVendeurAction` | Transaction atomique (création du bien + `mandatSigneLe`/`bienId`) ; tout champ obligatoire de `biens` encore vide (dont l'adresse si seul un secteur était connu) est rejeté explicitement — aucune valeur inventée |
| Unicité de conversion | `bienId` | Contrainte `UNIQUE` — une opportunité par bien |
| Prochaine action | Tâche rattachée via `prospectVendeurId` (ADR-028) | Les anciens champs simples `prochaineAction`/`prochaineActionLe` ont été migrés en tâches puis supprimés — voir section "Tâches (ADR-028)" ci-dessus |

**Dashboard minimal** (`chargerPipelineVendeur()`, `dashboardRepository.ts`, section "Pipeline
vendeur" sur `/dashboard`) : compteurs par statut (prospects en cours, hors archivés), volume
d'estimations en cours, délai moyen prospect → mandat signé, et
`tauxConversionOpportunitesCloturees` = signés / (signés + perdus) **uniquement parmi les
opportunités déjà clôturées** — libellé UI explicite ("parmi les opportunités clôturées"), les
prospects encore actifs n'entrent jamais dans ce ratio.

**Hors périmètre V1** (documenté explicitement, pas un oubli) : séparation contact ↔ opportunité
(plusieurs propriétaires, un propriétaire multi-biens), relances automatiques, génération
d'e-mails, campagnes, automatisation de la génération de tâches (réservée à un futur ADR-029+,
`Tache.origine === 'automatique'` préparé mais inutilisé), intégration Google Calendar pour le
rendez-vous d'estimation, révocation d'un mandat déjà signé.

## Pack notaire (ADR-030)

**Fichiers** : `src/lib/documents/{packNotaire,genererZipPackNotaire}.ts`,
`src/app/api/biens/[id]/pack-notaire/route.ts`, `src/app/biens/[id]/pack-notaire/page.tsx`.
Contrôle documentaire pré-transmission et export ZIP — entièrement dérivé, aucune table.

| Règle | Condition | Résultat |
|---|---|---|
| Exigence checklist `manquant` | Toujours | `a_obtenir` — **jamais** `bloquant_technique` (règle produit non exhaustive juridiquement) |
| Exigence `perime` | Toujours | `a_verifier`, message factuel (date dépassée) — jamais la conclusion « transmission impossible » |
| Exigence `incoherent` (document `rejete`) | Toujours | `bloquant_technique`, document exclu |
| `chargeHonoraires` non renseigné | Toujours | `a_obtenir` |
| `compromisId`/`acquereurId`/`prospectVendeurId` divergent d'une référence **existante** | `compromisActuel`/`prospectVendeurOrigine` présent et différent | `bloquant_technique`, document exclu, message nommant la contradiction |
| `compromisId`/`acquereurId`/`prospectVendeurId` renseigné, aucune référence à comparer | `compromisActuel`/`prospectVendeurOrigine` absent | `a_verifier` seulement — jamais une contradiction démontrée |
| `coproprieteDeclaree`/`adresseDeclaree` divergents | Toujours | `a_verifier` — texte libre, jamais une preuve structurelle |
| Sélection automatique d'un document | `etatVerification = 'confirme'` **et** état checklist `present` | Inclus dans `selectionProposee` |
| Document `present` + `non_verifie`/`a_verifier` | Toujours | Visible dans `documentsDisponibles`, **jamais** auto-sélectionné |
| Export ZIP sans compromis en cours | `compromisActuel` absent | Refusé explicitement (409) — aucun export transactionnel sans contexte réel |
| Sélection soumise contenant un id interdit/inconnu | Toujours | Requête entière refusée (400), aucun ZIP généré |
| Fichier illisible à l'export | Toujours | Génération entière refusée (`ErreurGenerationPack`), aucun ZIP partiel |
| Taille cumulée de la sélection | `> MAX_TAILLE_PACK_OCTETS` (200 Mo) | Refusé avant toute lecture fichier — contrainte technique, pas légale |
| Nom d'export | Toujours | Dérivé uniquement de données structurées, jamais un renommage du fichier stocké (ADR-013) |

**Hors périmètre V1** : envoi email/notaire, OCR/LLM, création automatique de tâches, PDF serveur,
authentification, journalisation d'audit persistante.

## Communications / emails assistés (ADR-031)

**Fichiers** : `src/lib/communications/*.ts`, `src/components/communications/
BrouillonEmailFormulaire.tsx`, `src/app/communications/nouveau/page.tsx`. Brouillons éphémères,
aucune table.

| Règle | Condition | Résultat |
|---|---|---|
| Résolution de destinataire depuis une tâche | Toujours | Suit uniquement les FK/relations métier déjà réelles (`deriverCibleTache`) — jamais `titre`/`contexte` |
| Plusieurs destinataires structurellement possibles | Toujours | Choix humain explicite requis — jamais tranché arbitrairement côté serveur |
| Aucun destinataire déterminable structurellement | Toujours | Mode contenu seul, « Email impossible : adresse non renseignée » |
| Destinataire depuis un constat de checklist | Document sans rattachement personne non ambigu | Repli sur les candidats du bien — jamais une correspondance type de document → personne inventée |
| Contenu du brouillon | Toujours | Uniquement des faits structurés déjà en base ; un fait absent est omis, jamais un espace réservé |
| Contenu sensible d'un document | Toujours | Jamais intégré — seul le nom du type de pièce est mentionné |
| Couche de reformulation LLM | — | Hors périmètre ADR-031, aucune dépendance introduite |
| Envoi | Toujours | `mailto:` uniquement, reconstruit depuis le texte édité — jamais depuis le brouillon initial |
| Lien mailto trop long | `> ~1800 caractères` | Masqué, la copie reste le seul moyen proposé |
| Interaction post-envoi | Toujours | Jamais journalisée automatiquement (aucune confirmation d'envoi vérifiable avec `mailto:`) |
| Constat documentaire choisi | Toujours | Ne crée jamais de tâche automatiquement |
| Contact notaire | — | Non modélisé — `message_notaire` toujours en contenu seul, aucun champ `biens.notaireEmail` ajouté |

## Envoi Gmail réel (ADR-031-bis)

**Fichiers** : `src/lib/google/{capacites,mimeEmail,gmailClient}.ts`, `src/lib/envoiEmailRepository.ts`,
`src/actions/envoyerEmailGmail.ts`. Étend ADR-031 (moteur de contenu inchangé) d'un vrai envoi.

| Règle | Condition | Résultat |
|---|---|---|
| Scope Gmail demandé | Autorisation dédiée `/api/auth/google/gmail/login` | `gmail.send` seul, jamais couplé à Calendar dans ce code (autorisation incrémentale Google) |
| Statut `gmailAutorise` | Toujours | Dérivé uniquement du `scope` réellement stocké — jamais du fait que la route Gmail a été appelée |
| Envoi Gmail | Toujours | Précédé d'un écran de confirmation figé (À/Objet/Corps) — jamais à la génération du brouillon, au chargement de page ou à une navigation |
| Double soumission / retry | Même clé d'idempotence (`envois_email.id`, fournie par le client) | `INSERT ... ON CONFLICT DO NOTHING` — jamais un second appel Gmail |
| Réponse HTTP Gmail non-2xx reçue | Toujours | `echec` — résultat connu, une nouvelle tentative (nouvelle clé) est autorisée |
| Rupture réseau/timeout/réponse illisible après déclenchement de l'envoi | Toujours | `incertain` — jamais assimilé à `echec`, jamais un renvoi automatique, jamais un succès |
| Interaction ADR-027 (prospect vendeur) | Uniquement après `reussi_le` posé | Note `'email'` + `dernierContactLe` — jamais sur `incertain`/`echec` |
| Journal acquéreur/autre domaine | Toujours | Aucun — limite documentée, jamais écrit dans `taches` |
| Corps du message | Toujours | Jamais persisté dans `envois_email` — seul un `contenuHash` (SHA-256) de diagnostic est conservé |
| Clôture de tâche après envoi | Toujours | Proposée explicitement (`terminerTacheAction` réutilisée), jamais automatique |
| En-têtes du message (To/Subject) | Toujours | `\r`/`\n` rejetés explicitement (protection contre l'injection d'en-têtes) |
| Révocation Google | Toujours | Globale (Calendar + Gmail si les deux sont accordés) — libellé UI honnête, jamais partiel |
| Fallback mailto/copie | Toujours | Conservé dans tous les états, y compris Gmail disponible |

## Automatisations déterministes événement → action interne (ADR-032)

**Fichiers** : `src/lib/automatisations/*.ts`, `src/actions/automatisations.ts`,
`src/app/automatisations/page.tsx`. Distinct des alertes ADR-026 (jugement dérivé, jamais une
action) et des tâches ADR-028 (l'action produite elle-même, sans son propre mécanisme de
déclenchement avant cet ADR). Séparation stricte ÉVÉNEMENT (`evenements_metier`) / RÈGLE (code
TypeScript) / EXÉCUTION (`executions_automatisation`) / ACTION PRODUITE (`taches`).

| Règle | Condition | Résultat |
|---|---|---|
| Émission d'un événement | Toujours | Dans la **même transaction** que la mutation métier qui le déclenche — jamais un trou entre mutation et événement |
| Double submit de la mutation métier | Événement déjà enregistré (index unique partiel) | `ON CONFLICT DO NOTHING`, aucun second événement, aucune exécution préparée une seconde fois |
| Activation d'une règle | Lue au moment de l'émission de l'événement | Figée dans la transaction métier — une activation ultérieure ne traite jamais rétroactivement un événement déjà survenu |
| Nouvelle règle ajoutée au catalogue | Toujours | Démarre inactive (seed `active = false`) — jamais active du seul fait d'un déploiement |
| Traitement d'une exécution `a_traiter` | Toujours | Synchrone, juste après le COMMIT de la transaction métier — jamais dans la transaction elle-même, jamais un worker |
| Création de la tâche + succès de l'exécution | Toujours | Une seule transaction (verrouillage `FOR UPDATE` + `creerTache` + pose `tacheId`/`reussieLe`) — jamais deux écritures séparées |
| Échec de la construction/création de la tâche | Toujours | Transaction annulée dans son ensemble (aucune tâche orpheline), `echoueeLe` + message technique court posés séparément, hors de la transaction avortée |
| Exécution déjà résolue (`reussie`/`echouee`) | Nouveau passage sur la même ligne | No-op — jamais une seconde tâche |
| Suppression d'une entité source (compte rendu, prospect vendeur, compromis) | Un événement la référence encore | Refusée par Postgres (`NO ACTION`) — jamais un effacement silencieux de la trace d'audit |
| Action automatique produite | Toujours | `creer_tache` uniquement — `envoyer_email`/`envoyer_sms`/`transmettre_pack_notaire`/`modifier_offre`/`modifier_compromis`/`archiver`/`supprimer` n'existent dans aucune règle |
| Règle décidant de ne rien produire | `construireTache()` retourne `undefined` | Exécution marquée `reussie` sans `tacheId` — un résultat honnête, pas un échec |
| Provenance d'une tâche automatique | `tache.origine = 'automatique'` | Affichée ("Créée automatiquement — Règle : {nom}") sur toutes les listes de tâches |

**Les 4 règles V1** (`src/lib/automatisations/catalogueRegles.ts`) : `suivi_apres_visite`
(→ `visite_realisee`), `suivi_apres_rdv_estimation` (→ `rdv_estimation_realise`),
`preparation_apres_mandat` (→ `mandat_signe`), `preparation_dossier_notaire_apres_compromis`
(→ `compromis_signe`). Chacune produit au plus une tâche, jamais d'échéance artificielle.

**Hors périmètre V1** : toute action externe à conséquence, scheduler/échéances artificielles,
règles fondées sur un constat de checklist documentaire (ADR-029), retry automatique, constructeur
de règles no-code, modification/annulation d'une exécution déjà résolue.

## Moteur temporel et relances programmées (ADR-033)

**Fichiers** : `src/lib/automatisations/{calculOccurrencesInactivite,scanTemporel,
runScanAutomatisationRepository}.ts`, `src/app/api/automatisations/scan/route.ts`. Source d'événement
supplémentaire pour le moteur ADR-032 (inchangé) — une horloge/échéance, pas un second moteur de
règles.

| Règle | Condition | Résultat |
|---|---|---|
| Détection d'un scheduler interne à Atlas | Toujours | Aucun — `POST /api/automatisations/scan` doit être déclenché par un cron **externe** ; sans lui, le moteur temporel ne s'exécute jamais spontanément |
| Protection de l'endpoint | Toujours | `Authorization: Bearer <secret>` (`AUTOMATISATIONS_SCAN_SECRET`), jamais en query string, comparaison en temps constant |
| Ancre du cycle d'inactivité | Toujours | `dernierContactLe` s'il existe, sinon `creeLe` (un prospect jamais contacté entre dans le mécanisme) |
| Seuil franchi | `joursCivilsEcoules(ancre, maintenant) >= seuil` | Occurrence due — jamais une égalité stricte (un scan en retard doit encore détecter un seuil dépassé) |
| Double submit / scans concurrents sur la même occurrence | Même (règle, prospect, ancre) | Un seul événement, une seule tâche — contrainte DB (index unique partiel), jamais un verrou applicatif |
| Nouveau contact après une première relance | `dernierContactLe` change puis un nouveau seuil est franchi | Nouvelle occurrence acceptée, **même si** la tâche automatique du cycle précédent est encore ouverte — l'idempotence porte sur le cycle (l'ancre), jamais sur l'historique complet des relances |
| Prospect archivé, perdu, ou mandat déjà signé | Toujours | Exclu (`listerProspectsVendeurs()`, ADR-027 — statuts dérivés, jamais une interprétation de texte libre) |
| Activation de `inactivite_prospect_vendeur` | Aucun seuil valide configuré | Refusée explicitement (throw) — jamais une valeur implicite |
| Calcul du nombre de jours écoulés | Toujours | Jours civils dans le fuseau `Europe/Paris` (`joursCivilsEcoules`), jamais une division de millisecondes (fausse lors d'un changement d'heure été/hiver) |
| Action produite | Toujours | `creer_tache` uniquement — mêmes bornes qu'ADR-032, aucune action externe |
| Note interne (`note_interne`) sur un prospect vendeur | Toujours | N'est jamais un contact (ADR-027) — ne remet jamais `dernierContactLe` à zéro |
| Erreur sur un prospect pendant un scan | Toujours | Isolée (loggée, ignorée) — n'affecte jamais les autres prospects ni la complétion du run |
| Interruption du scan (crash) | Toujours | Aucune reprise à piloter manuellement — le scan suivant recalcule toutes les occurrences dues depuis zéro, les contraintes d'idempotence empêchent les doublons |

**Hors périmètre V1** : email/SMS automatique, LLM, règle fondée sur un constat de checklist
documentaire (ADR-029), relance acquéreur (aucun `dernierContactLe` structuré côté `acquereurs`),
tâche créée pour signaler qu'une autre tâche est en retard, retry automatique, timezone par
conseiller réellement configurable, choix définitif du cron externe.

## Archivage

**Fichiers** : `bienRepository.ts`/`clientRepository.ts` (`archiverBien`/`desarchiverBien`,
`archiverAcquereur`/`desarchiverAcquereur`, `listerBiensArchives`/`listerClientsArchives`),
`actions/archivageBien.ts`, `actions/archivageAcquereur.ts`. Détail de la décision : ADR-012.

| Règle | Condition | Résultat |
|---|---|---|
| Exclusion des listes actives | `archiveLe` non NULL | Absent de `listerBiens()`/`listerClients()` — donc du référentiel de matching, des `<select>` de création de tâche, et (pour un bien) de "Dossiers nécessitant une action" sur l'accueil |
| Exclusion des flux actifs pour une tâche liée à un acquéreur ou un prospect vendeur seul | `tache.acquereurId`/`tache.prospectVendeurId` renseigné mais l'entité correspondante est archivée | Exclue de "Autres tâches" sur l'accueil |
| Consultation directe toujours possible | — | `getBienById()`/`getClientById()` résolvent une entité archivée sans condition — fiche, édition, notes/tâches/comptes rendus/historique restent accessibles |
| Cache de matching déjà persisté | Une décision `memoire_contextuelle` existe déjà pour ce rendez-vous | Inchangée — un rendez-vous déjà résolu vers un bien depuis archivé reste préparable (la priorité validation humaine/cache > référentiel s'applique avant toute lecture du référentiel filtré) |
| Refus de création liée — note | `bien.archiveLe` non NULL | `ajouterNoteBienAction` n'insère rien (refus silencieux, formulaire déjà masqué côté UI) |
| Refus de création liée — compte rendu | `bien.archiveLe` ou `acquereur.archiveLe` non NULL | `enregistrerCompteRenduVisiteAction` n'insère rien (refus silencieux, formulaire remplacé par un message côté UI) |
| Refus de création liée — tâche | `bien.archiveLe`, `acquereur.archiveLe` ou `prospectVendeur.archiveLe` non NULL, si la cible correspondante est renseignée | `creerTacheAction` lève une erreur explicite (`throw`, pas un refus silencieux — cohérent avec le `throw` déjà existant sur le titre manquant dans ce fichier) |
| Restauration | Conseiller clique "Désarchiver" | `archiveLe` repassé à `NULL` — réapparaît immédiatement dans tous les flux actifs, aucune perte de données |

Jamais de suppression physique : un archivage est un `UPDATE`, jamais un `DELETE` — les FK réelles
(`notes_bien`, `comptes_rendus_visite`, `ON DELETE CASCADE`) ne se déclenchent donc jamais.

## Ce qui est volontairement déterministe et sans LLM

Tous les moteurs ci-dessus, plus la sélection d'extraits Mérimée "à raconter"
(`lib/araconter/selectionMerimee.ts`, sélection par présence d'une date explicite dans le texte
officiel, jamais de reformulation). Confirmation factuelle détaillée dans
`docs/KNOWN_LIMITATIONS.md` et justification dans ADR-008.
