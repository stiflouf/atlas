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
clients externes, jamais recalculés). 8 règles indépendantes, chacune 0 ou 1 point :

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

## Priorité des actions

**Fichier** : `src/lib/actionPriority.ts` (`scoreAction`). Utilisée pour trier les actions sur
l'accueil, la fiche bien, et la "Mémoire du dossier" de la préparation de visite — un seul moteur,
jamais réimplémenté ailleurs.

- Poids de base par priorité déclarée : `haute: 30`, `normale: 20`, `basse: 10`.
- `+50` si l'échéance est dépassée (en retard).
- `+15` si l'échéance est dans 2 jours ou moins (imminente, non encore dépassée).
- Une action `statut === "termine"` obtient un score de `-Infinity` (toujours exclue des listes
  triées, jamais de suppression physique nécessaire pour la faire disparaître).
- À score égal, l'action créée le plus tôt (`creeLe` le plus ancien) passe devant.

## Mémoire du dossier (page de préparation de visite)

**Fichier** : `src/lib/memoireDossier.ts`. Trois fonctions pures, chacune limitée et triée
indépendamment — jamais de dépendance implicite à l'ordre déjà fourni par l'appelant.

| Fonction | Entrée | Règle | Maximum |
|---|---|---|---|
| `selectionnerActionsEnCours` | Actions du bien + actions de l'acquéreur | Fusionne les deux listes (statut `a_faire` uniquement), tague chaque action `origine: "bien" \| "acquereur"`, trie par `scoreAction` décroissant | 5 |
| `selectionnerHistoriqueRecent` | Actions du bien | Ne retient que les actions **terminées** (jamais les créations, déjà visibles dans "Actions en cours" pour les actions encore ouvertes), triées par `termineLe` décroissant | 3 |
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
| Chaque action du bien | Toujours | `"Action créée : {titre}"` |
| Chaque action terminée du bien | `statut === "termine"` et `termineLe` défini | `"Action terminée : {titre}"` |
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
- `prochaineEtape` (texte libre, optionnel) **ne crée jamais d'action automatiquement** — c'est un
  rappel textuel affiché dans la Mémoire du dossier ; créer une action à partir de cette
  information reste un geste manuel du conseiller (via "+ Ajouter une action").

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
`src/actions/ajouterDocumentBien.ts`, `src/app/api/documents/[id]/route.ts`. Détail de la
stratégie de stockage : ADR-013.

| Règle | Condition | Résultat |
|---|---|---|
| Type de fichier accepté | Toujours | Liste blanche stricte : `application/pdf`, `image/jpeg`, `image/png` — tout autre type MIME est refusé silencieusement (redirection sans insertion ni écriture disque) |
| Taille maximale | Toujours | 10 Mo (validation applicative) — au-delà de la limite framework (11 Mo, `next.config.ts`), la requête échoue avant même d'atteindre cette validation, voir `docs/KNOWN_LIMITATIONS.md` |
| Ajout sur un bien archivé | `bien.archiveLe` non NULL | Refusé — formulaire masqué côté UI, refus silencieux côté serveur si l'appel est contourné (même patron que Notes/Comptes rendus, ADR-012) |
| Documents existants d'un bien archivé | Toujours | Restent listés et téléchargeables (`getBienById()`/`getDocumentBienById()` résolvent toujours une entité archivée) |
| Nom physique sur disque | Toujours | Clé opaque générée côté serveur (`genererCleStockage()`) — jamais le nom original, jamais un chemin fourni par l'utilisateur (ADR-013) |
| Nom affiché au téléchargement | Toujours | `nomFichierOriginal` (métadonnée DB), restitué via `Content-Disposition: attachment` — le chemin physique n'est jamais révélé |
| Document introuvable (id invalide, métadonnée absente, fichier physique absent) | Toujours | `404`, sans distinction observable entre ces cas |
| Suppression | — | Aucune en V1 — voir ADR-013 |

## Statut commercial du bien

**Fichiers** : `src/lib/statutCommercialBien.ts` (`deriverStatutCommercial`),
`src/actions/statutCommercialBien.ts`. Détail de la décision : ADR-014.

Aucun statut stocké — dérivé en lecture depuis deux timestamps de jalons sur `biens` :

| Jalons | Statut dérivé |
|---|---|
| `offreEnCoursLe` NULL et `compromisSigneLe` NULL | `en_commercialisation` |
| `offreEnCoursLe` non NULL, `compromisSigneLe` NULL | `offre_en_cours` |
| `compromisSigneLe` non NULL (quel que soit `offreEnCoursLe`) | `compromis_signe` |

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
`UPDATE` en place (même patron que `actions.statut`).

| Règle | Condition | Résultat |
|---|---|---|
| Créer une offre | Bien et acquéreur réels, existants, non archivés ; montant > 0 | `enregistrerOffre(...)` **puis** `marquerOffreEnCours(bienId)` dans la même action — un seul geste |
| Créer une offre — refus | Bien/acquéreur introuvable, archivé, ou montant invalide | `throw` explicite (`ajouterOffreAction`) |
| Changer le statut | Offre `en_cours`, bien et acquéreur non archivés | `en_cours` → `acceptee`/`refusee`/`retiree` uniquement — jamais l'inverse, jamais entre deux valeurs finales |
| Changer le statut — refus | Offre introuvable, bien/acquéreur archivé, ou offre déjà dans un statut final | `throw` explicite (`changerStatutOffreAction`) |
| Couplage avec le statut commercial | Toujours | Créer une offre pose `offreEnCoursLe` ; changer son statut **ne modifie jamais** `offreEnCoursLe`/`compromisSigneLe` — gestes commerciaux volontairement séparés (ADR-014 non touchée) |
| Consultation | Toujours | `listerOffresPourBien()`/`listerOffresPourAcquereur()`/`getOffreById()` résolvent toujours, même sur un bien/acquéreur archivé |

**Historique dérivé** : un seul événement par offre, à la création (`"Offre reçue — {montant}"`),
**sans nommer l'acquéreur** (même convention que les visites — le détail vit dans l'onglet Offres).
Aucun événement pour un changement de statut : pas de date de transition fiable disponible (pas de
champ `statutModifieLe`, volontairement absent du modèle).

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
| Changer le statut | Compromis `en_cours`, bien et acquéreur non archivés | `en_cours` → `realise`/`annule` uniquement — jamais l'inverse |
| Changer le statut — refus | Compromis introuvable, bien/acquéreur archivé, ou compromis déjà dans un statut final | `throw` explicite (`changerStatutCompromisAction`) |
| Couplage avec le statut commercial | Toujours | Créer un compromis pose `compromisSigneLe` ; changer son statut **ne le modifie jamais** — geste commercial séparé (ADR-014 non touchée) |
| Consultation | Toujours | `listerCompromisPourBien()`/`listerCompromisPourAcquereur()`/`getCompromisById()` résolvent toujours, même sur un bien/acquéreur archivé |

**Historique dérivé** : un événement par compromis, à la création
(`"Compromis structuré — {prixConvenu}"`), **sans nommer l'acquéreur**. Libellé volontairement
distinct de l'événement générique ADR-014 (`"Compromis signé"`, dérivé de `compromisSigneLe`), qui
continue de coexister séparément — le premier est la création de l'entité détaillée, le second le
jalon commercial synthétique du bien. Aucun événement pour un changement de statut (pas de date de
transition fiable disponible).

## Archivage

**Fichiers** : `bienRepository.ts`/`clientRepository.ts` (`archiverBien`/`desarchiverBien`,
`archiverAcquereur`/`desarchiverAcquereur`, `listerBiensArchives`/`listerClientsArchives`),
`actions/archivageBien.ts`, `actions/archivageAcquereur.ts`. Détail de la décision : ADR-012.

| Règle | Condition | Résultat |
|---|---|---|
| Exclusion des listes actives | `archiveLe` non NULL | Absent de `listerBiens()`/`listerClients()` — donc du référentiel de matching, des `<select>` de création d'action, et (pour un bien) de "Dossiers nécessitant une action" sur l'accueil |
| Exclusion des flux actifs pour une action liée à un acquéreur seul | `action.acquereurId` renseigné mais absent de `listerClients()` (acquéreur archivé) | Exclue de "Autres actions" sur l'accueil |
| Consultation directe toujours possible | — | `getBienById()`/`getClientById()` résolvent une entité archivée sans condition — fiche, édition, notes/actions/comptes rendus/historique restent accessibles |
| Cache de matching déjà persisté | Une décision `memoire_contextuelle` existe déjà pour ce rendez-vous | Inchangée — un rendez-vous déjà résolu vers un bien depuis archivé reste préparable (la priorité validation humaine/cache > référentiel s'applique avant toute lecture du référentiel filtré) |
| Refus de création liée — note | `bien.archiveLe` non NULL | `ajouterNoteBienAction` n'insère rien (refus silencieux, formulaire déjà masqué côté UI) |
| Refus de création liée — compte rendu | `bien.archiveLe` ou `acquereur.archiveLe` non NULL | `enregistrerCompteRenduVisiteAction` n'insère rien (refus silencieux, formulaire remplacé par un message côté UI) |
| Refus de création liée — action | `bien.archiveLe` ou `acquereur.archiveLe` non NULL, si renseigné | `creerActionAction` lève une erreur explicite (`throw`, pas un refus silencieux — cohérent avec le `throw` déjà existant sur le titre manquant dans ce fichier) |
| Restauration | Conseiller clique "Désarchiver" | `archiveLe` repassé à `NULL` — réapparaît immédiatement dans tous les flux actifs, aucune perte de données |

Jamais de suppression physique : un archivage est un `UPDATE`, jamais un `DELETE` — les FK réelles
(`notes_bien`, `comptes_rendus_visite`, `ON DELETE CASCADE`) ne se déclenchent donc jamais.

## Ce qui est volontairement déterministe et sans LLM

Tous les moteurs ci-dessus, plus la sélection d'extraits Mérimée "à raconter"
(`lib/araconter/selectionMerimee.ts`, sélection par présence d'une date explicite dans le texte
officiel, jamais de reformulation). Confirmation factuelle détaillée dans
`docs/KNOWN_LIMITATIONS.md` et justification dans ADR-008.
