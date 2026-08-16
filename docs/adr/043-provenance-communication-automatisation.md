# ADR-043 — Provenance exacte d'une communication issue d'une automatisation

**Statut :** Accepté
**Date :** 2026-08-16
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Le rapport final d'ADR-042 documentait une limite : lors de la préparation du brouillon vendeur
(« Préparer un email » sur une tâche `retour_vendeur_apres_visite`), les faits de visite (date,
`interet`) étaient récupérés depuis *« le compte rendu le plus récent du Bien »*
(`listerComptesRendusPourBien(bien.id)[0]`), pas depuis le compte rendu ayant réellement déclenché
cette tâche précise.

Scénario concret : Visite A (Bien X, Acquéreur A, `pas_interesse`) produit une tâche vendeur TA.
Une Visite B ultérieure sur le même bien (Acquéreur B, `interesse`) produit une tâche TB distincte.
Ouvrir « Préparer un email » depuis TA affichait à tort la date et l'`interet` de B — la tâche la
plus ancienne se retrouvait contaminée par la visite la plus récente.

Un audit préalable en lecture seule a tranché la question centrale : **s'agissait-il d'un bug de
résolution (la provenance exacte existe déjà, mal exploitée) ou d'une donnée réellement
manquante ?** Réponse prouvée sur le code réel : **option A, bug de résolution uniquement.**

## Décision

### 1. La provenance existait déjà, sans être exploitée

Chaîne confirmée par lecture du schéma et du moteur (`moteur.ts`) :

```
tache.id
  → executions_automatisation.tache_id (FK, posée UNE FOIS par marquerExecutionReussie(),
                                          dans la MÊME transaction que la création de la tâche)
  → execution.evenement_id
  → evenements_metier (getEvenementMetierById(), déjà existante)
  → evenement.compteRenduVisiteId (pour visite_realisee — seule cible possible pour ce type)
```

Par construction du moteur ADR-032 (`traiterUneExecution`), chaque `creerTache()` génère un id
frais (`defaultRandom()`), jamais réutilisé par une seconde exécution — une tâche automatique porte
donc au plus une exécution qui l'a produite. Cette garantie est **fonctionnelle** (imposée par le
code), pas **structurelle** (aucun `UNIQUE(tache_id)` en base) — décision explicite de ne pas
durcir cette contrainte dans cette ADR (§2 ci-dessous).

### 2. Aucune migration, aucun durcissement SQL

**0 migration.** Aucune nouvelle table, colonne, FK sur `taches`, ni `UNIQUE(executions_automatisation.tache_id)`.
Le moteur garantit déjà par construction qu'une tâche automatique est rattachée à l'exécution
précise qui l'a produite ; ADR-043 se limite à exploiter cette garantie côté lecture.

### 3. Lecture fail-closed, jamais un choix arbitraire

Nouvelle fonction `getExecutionAutomatisationParTacheId(tacheId)`
(`executionAutomatisationRepository.ts`) : lit toutes les lignes `executions_automatisation` dont
`tache_id` correspond. **0 ligne** → `undefined` (tâche manuelle, ou provenance absente). **1
ligne** → retournée. **Plus d'1 ligne** → exception explicite (`Incohérence de données : N
exécutions référencent la tâche {id}`), jamais un `rows[0]` silencieux qui masquerait un état
impossible en usage normal.

### 4. Le correctif : `resoudreContexteCommunicationDepuisTache.ts`

Pour `origineCode === "retour_vendeur_apres_visite"`, la résolution suit désormais strictement :
`getExecutionAutomatisationParTacheId(tache.id)` → `getEvenementMetierById(execution.evenementId)`
→ vérification `evenement.typeEvenement === "visite_realisee"` → `getCompteRenduVisiteById(evenement.compteRenduVisiteId)`.
L'ancien appel à `listerComptesRendusPourBien(bien.id)[0]` a été supprimé de ce chemin (la fonction
elle-même reste utilisée ailleurs dans le repository, non supprimée).

**Fail-closed, aucun fallback** : tout maillon manquant (aucune exécution retrouvée, type
d'événement différent, compte rendu introuvable) laisse `dateVisite`/`interetVisiteValeur` absents
— jamais un repli vers un autre compte rendu du bien. Une donnée absente n'est jamais remplacée par
une donnée différente.

**État actuel, pas snapshot** : ADR-043 ne fige aucune copie des faits au moment de la création de
la tâche. Le principe retenu est *provenance historique exacte* + *état actuel de l'objet historique
exact* — si le compte rendu ayant déclenché TA était un jour modifié légitimement, TA refléterait sa
version actuelle, jamais un autre compte rendu. Aucun repository de modification des comptes rendus
n'existe aujourd'hui (`compteRenduVisiteRepository.ts` n'expose aucune fonction de mise à jour) — ce
scénario n'est donc pas applicable en pratique en V1, documenté sans test correspondant.

### 5. `suivi_apres_visite` (ADR-041) — vérifié, aucun correctif nécessaire

Audit ciblé du chemin `cibleType === "acquereur"` dans `resoudreContexteCommunicationDepuisTache()` :
il ne dérive **aucun** fait depuis une liste de comptes rendus — il retourne uniquement les faits de
base (`tacheContexte`). La cible d'une tâche `suivi_apres_visite` est directement l'`acquereurId`
exact de l'événement ayant produit la tâche (FK directe, jamais une liste), donc structurellement
sans ambiguïté à corriger. Vérifié par un test dédié (deux visites du même acquéreur/bien avec des
faits distincts, confirmant qu'aucun des deux n'apparaît jamais dans les faits résolus). Aucun
changement de code sur ce chemin.

### 6. Autres cas examinés, non concernés

Recherche ciblée des heuristiques `[0]`/tri-décroissant dans `communications/` : une seule autre
occurrence trouvée, dans `resoudreDestinatairesDepuisBien()` (`destinataireCommunication.ts`), qui
sélectionne le compromis `en_cours` du bien, sinon le plus récent, comme candidat destinataire.
**Non concernée** par l'invariant ADR-043 : cette fonction résout des **destinataires actuels**
(« qui est-il pertinent de contacter maintenant à propos de ce bien ? »), jamais des **faits
historiques rattachés à un événement précis** — la seule tâche automatique qui l'utilise
(`preparation_apres_mandat`, cible `{type: "bien"}`) ne référence elle-même aucun compromis dans son
événement déclencheur (`mandat_signe`) : il n'existe donc aucune provenance plus précise à
préserver. Documenté, non modifié.

## Hors périmètre, volontairement

`UNIQUE(executions_automatisation.tache_id)`, `execution_automatisation_id`/`evenement_id` sur
`taches`, nouveau champ sur l'événement `visite_realisee`, snapshot/versioning des comptes rendus,
nouvel événement métier, nouvelle automatisation, modification du template vendeur ou de la
politique par `interet`, email automatique, refonte de l'UI de communication, nettoyage de la dette
legacy `taches.visite_id`.

## Conséquences

- **0 migration.**
- Fichiers modifiés : `src/lib/automatisations/executionAutomatisationRepository.ts` (nouvelle
  fonction `getExecutionAutomatisationParTacheId`), `src/lib/communications/
  resoudreContexteCommunicationDepuisTache.ts` (source des faits de visite corrigée pour
  `retour_vendeur_apres_visite`, réutilise `getEvenementMetierById` déjà existante).
- Nouveau fichier de test : `src/lib/automatisations/executionAutomatisationRepository.test.ts` (0/1/
  plus d'1 ligne, fail-closed). `src/lib/communications/resoudreContexteCommunicationDepuisTache.test.ts`
  étendu (provenance absente, deux visites du même bien — test de régression principal prouvant que
  TA reste reliée à A même après création de B —, indépendance vis-à-vis de l'ordre d'insertion/de
  la date la plus tardive, vérification `suivi_apres_visite`).
- `docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md`
  mis à jour. `docs/DATA_MODEL.md` **non modifié** — aucun changement de schéma.
- La limite ADR-042 *« faits de visite dérivés du compte rendu le plus récent du bien »* est retirée
  de `KNOWN_LIMITATIONS.md` — résolue par cette ADR.
