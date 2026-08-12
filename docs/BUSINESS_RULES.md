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
`UPDATE` en place (même patron que `actions.statut`).

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

**Explicitement écarté** (donnée non instrumentée) : chiffre d'affaires, fiscalité, et toute notion
comptable/juridique de rémunération "acquise" — `remuneration` (ADR-021) instrumente les montants
saisis mais ne tranche aucune de ces questions, volontairement reportées à une passe dédiée — voir
ADR-018, ADR-021 et `docs/KNOWN_LIMITATIONS.md`. Le taux
et le délai visite → offre, écartés dans ADR-018 faute de lien matérialisé, sont désormais
disponibles via le lien explicite `offre_visites` (ADR-019) — avec la réserve que seules les
visites explicitement liées après la mise en place de ce lien sont comptées (aucun rattrapage
automatique de l'historique). Aucun taux de conversion par cause en V1 (ADR-020) — voir
`docs/KNOWN_LIMITATIONS.md`.

Pas de graphiques, pas de filtre temporel en V1 — les séries "par mois" s'affichent en liste
simple.

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
