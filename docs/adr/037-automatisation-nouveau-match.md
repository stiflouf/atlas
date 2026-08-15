# ADR-037 — Automatisation commerciale du nouveau match Bien ↔ Acquéreur

**Statut :** Accepté
**Date :** 2026-08-15
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-036 produit un événement append-only fiable (`compatibilite_bien_acquereur_devenue_compatible`,
`bienId`/`acquereurId`/`cycleCompatibilite`) à chaque fois qu'une paire redevient réellement
compatible, sans jamais créer de tâche, d'email ni d'exécution d'automatisation — décision
volontaire. Cette passe branche cet événement sur le moteur ADR-032 existant via une seule règle,
sans jamais toucher au synchroniseur ADR-036 ni au moteur canonique ADR-034/035.

Un audit préalable a confirmé, sur le code réel : `taches` impose au plus une cible parmi sept
colonnes dédiées (`CHECK`, jamais un couple bien+acquéreur simultané) ; l'activation figée ADR-032
garantit déjà qu'aucun événement antérieur à l'existence/activation d'une règle ne produit de tâche
rétroactive ; `ChampsTacheAutomatique` ne porte aucun champ d'échéance et aucune des règles
existantes n'en fixe une ; `resoudreContexteCommunicationDepuisTache()` (ADR-031) résout une cible
`bien` vers le vendeur/l'acquéreur d'un compromis, jamais vers un acquéreur candidat — preuve
directe que la tâche doit cibler l'acquéreur, pas le bien.

## Décision

### 1. Une seule règle, un seul déclencheur

```ts
{
  code: "nouveau_match_bien_acquereur",
  typeEvenement: "compatibilite_bien_acquereur_devenue_compatible",
  construireTache: async (evenement) => { ... },
}
```

Ajoutée à `CATALOGUE_REGLES_AUTOMATISATION` (`src/lib/automatisations/catalogueRegles.ts`) —
aucune règle côté bien, aucune règle côté acquéreur, aucune tâche miroir. Séquence inchangée :
`evaluerCompatibilite()` (ADR-034/035) → transition + événement durable (ADR-036) → règle ADR-032 →
tâche (ADR-037). Le synchroniseur ADR-036 reste totalement ignorant de cette règle.

### 2. Activation figée, désactivée par défaut

Seedée `active = false` (migration `0024`), exactement le patron des 5 règles précédentes. Le
mécanisme déjà vérifié par audit s'applique sans modification : `emettreEvenementEtPreparerExecutions()`
lit `configurations_automatisation` **au moment précis** de l'insertion de l'événement — un
événement survenu avant l'existence ou l'activation de cette règle ne produit et ne produira
**jamais** de tâche, quelle que soit la date d'activation ultérieure. Testé explicitement.

### 3. Cible = acquéreur, jamais une double cible

`ChampsTacheAutomatique.cible = { type: "acquereur", id: acquereurId }`. Le bien apparaît dans le
`contexte` (texte), jamais comme seconde cible en base — la contrainte `taches_une_seule_cible_check`
(ADR-028) n'est pas touchée. Conséquence directement vérifiée : `resoudreContexteCommunicationDepuisTache()`
résout alors exactement et sans ambiguïté cet acquéreur pour l'action "Préparer un email" déjà
existante (ADR-031) — testé explicitement (1 seul candidat, le bon).

### 4. Titre, description, type, priorité, échéance

```text
titre    = "Nouveau match — contacter {Prénom Nom} pour {référenceBien}"
contexte = "Atlas a détecté une nouvelle compatibilité avec ce bien. Vérifier les critères puis contacter l'acquéreur si pertinent."
type     = "appel"
priorite = "normale"
echeance = aucune
```

Noms/référence relus depuis `getBienById`/`getClientById` au moment de la construction, jamais
ajoutés au payload append-only de l'événement ADR-036. Aucune échéance V1 : `ChampsTacheAutomatique`
n'a jamais porté ce champ et les 5 règles existantes n'en fixent aucune — décision de cohérence
stricte avec l'existant, pas une extension de contrat pour cette seule règle.

### 5. Revalidation complète au moment de l'exécution

L'événement ADR-036 signifie *"cette paire est devenue compatible à un instant donné"*, jamais
*"produire une tâche quelle que soit la situation actuelle"*. `construireTache()` relit,
exclusivement via `evaluerCompatibilite()` (ADR-034/035) et les repositories réels — jamais
`compatibilites_bien_acquereur_etat`, jamais un mock, jamais l'IGN :

```text
bien introuvable OU acquéreur introuvable           → undefined (terminal, jamais de retry infini)
bien.archiveLe OU acquereur.archiveLe                → undefined
evaluerCompatibilite() !== "compatible"              → undefined (incompatible OU a_verifier)
offre "en_cours" sur cette paire                     → undefined
compromis "en_cours" ou "realise" sur cette paire    → undefined (un compromis "annule" ne bloque jamais)
tâche ouverte déjà issue de cette règle pour cette paire → undefined (§6)
sinon                                                → ChampsTacheAutomatique
```

Chaque branche retourne `undefined` pour un cas métier honnête — jamais une exception. Seule une
erreur technique réellement inattendue (panne DB, etc.) continue à se propager et à faire échouer
l'exécution (`echoueeLe`, mécanisme ADR-032 inchangé) — jamais confondue avec ces cas.

**Aucune vérification sur les comptes rendus de visite** : `comptesRendusVisite` ne représente que
des rapports **déjà réalisés**, jamais une notion de visite programmée/en cours — bloquer sur un
ancien rapport créerait une interdiction éternelle non voulue sans aucun signal fiable pour la
borner. Limite assumée, documentée (`KNOWN_LIMITATIONS.md`), jamais un état inventé.

### 6. Anti-spam inter-cycle — distinct de l'idempotence ADR-032

```text
UNIQUE(regle_code, evenement_id)  →  idempotence ADR-032 : 1 événement × 1 règle = 1 exécution max
existeExecutionAvecTacheOuvertePourPaire(...) → règle commerciale ADR-037 complémentaire
```

Ne crée jamais de seconde tâche ouverte pour la même paire tant qu'une précédente (d'un cycle
antérieur) n'est pas résolue par le conseiller — sans jamais réutiliser, modifier ou réouvrir la
tâche existante. Identité recherchée : **provenance structurée déjà réelle du moteur ADR-032**,
jamais une analyse de texte —

```sql
executions_automatisation (regle_code = 'nouveau_match_bien_acquereur')
  → evenement_id → evenements_metier.bien_id / acquereur_id  (identité de la paire)
  → tache_id     → taches.terminee_le / annulee_le           (tâche encore ouverte ?)
```

Nouvelle fonction `existeExecutionAvecTacheOuvertePourPaire()`
(`src/lib/automatisations/executionAutomatisationRepository.ts`) — un simple `INNER JOIN` sur des
relations déjà réelles, **aucune nouvelle colonne, aucune migration** pour ce besoin. L'exécution en
cours de traitement (son propre `tacheId` pas encore posé) est structurellement exclue par
l'`INNER JOIN`, jamais un faux positif sur elle-même. Un cycle suivant après une tâche **terminée**
(pas seulement ouverte) produit normalement une nouvelle tâche — nouvelle opportunité commerciale.

### 7. Idempotence et concurrence — moteur existant, sans ajout

`UNIQUE(regle_code, evenement_id)` + `ON CONFLICT DO NOTHING` (déjà en base) et le verrou
`FOR UPDATE` de `verrouillerExecutionATraiter()` (déjà en place) suffisent intégralement — aucun
verrou applicatif, aucun second index d'idempotence ADR-037. Testé explicitement (double traitement
séquentiel et concurrent de la même exécution → 1 tâche maximum).

### 8. Provenance

Aucun nouveau composant UI. `TacheItem.tsx` affiche déjà *"Créée automatiquement — Règle :
{LABEL_REGLE_AUTOMATISATION[origineCode]}"* pour toute tâche `origine = 'automatique'` — l'ajout de
l'entrée `nouveau_match_bien_acquereur → "Nouveau match Bien × Acquéreur"` au catalogue suffit.

### 9. Explicabilité et minimisation

Aucun snapshot des 7 critères, aucun score, aucun code INSEE dans la tâche. Le conseiller remonte à
l'explication complète et **à jour** depuis la fiche acquéreur (section "Biens compatibles",
ADR-034, recalculée à la lecture). Trois responsabilités restent séparées : l'événement ADR-036
conserve le fait historique de la transition ; la tâche représente l'action présente ; la fiche
acquéreur/bien reste la seule source d'explication détaillée.

### 10. Performance

Un événement porte exactement une paire. `construireTache()` charge uniquement `getBienById`,
`getClientById`, `listerSecteursPourAcquereur` (un seul acquéreur), `listerOffresPourBien`/
`listerCompromisPourBien` (filtrés côté appelant sur cet acquéreur) — aucun N×M, aucun scan.

## Hors périmètre, volontairement

Aucun email, aucun Gmail, aucun message généré par IA, aucun scoring/ranking, aucune double cible de
tâche, aucun nouveau mécanisme de reprise générique pour les exécutions ADR-032 bloquées à
`a_traiter` après un crash (dette préexistante, documentée, non aggravée), aucune personnalisation
complexe des délais.

## Conséquences

- Migration `0024_blue_roland_deschain.sql` : `CHECK` étendus (`configurations_automatisation`,
  `executions_automatisation`) pour le 6e code de règle ; seed
  `('nouveau_match_bien_acquereur', false)`. Aucune modification du schéma `taches`.
- Fichiers modifiés : `src/db/schema.ts`, `src/types/automatisation.ts`, `src/lib/automatisations/
  catalogueRegles.ts` (nouvelle règle), `src/lib/automatisations/executionAutomatisationRepository.ts`
  (nouvelle fonction `existeExecutionAvecTacheOuvertePourPaire`).
- Tests : `src/lib/automatisations/catalogueRegles.nouveauMatch.test.ts` (17 cas — activation
  figée/absence de rattrapage, cible acquéreur, contenu, idempotence/concurrence, revalidation
  complète, archivage, entité absente, relation commerciale avancée, anti-spam inter-cycle,
  résolution "Préparer un email", non-régression append-only).
- `docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md`
  mis à jour en conséquence. `docs/DATA_MODEL.md` non modifié (aucun changement de modèle
  persistant au-delà d'une extension de `CHECK` déjà couverte par la table des migrations).
- Hors périmètre, réservé à une ADR ultérieure : email/notification automatique, reprise générique
  des exécutions ADR-032 bloquées, personnalisation des délais par règle, scoring/ranking des
  matchs.
