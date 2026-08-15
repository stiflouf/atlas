# ADR-036 — Détection durable des transitions de compatibilité Bien ↔ Acquéreur

**Statut :** Accepté
**Date :** 2026-08-15
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-034/035 ont posé un moteur canonique de compatibilité (`evaluerCompatibilite()`), entièrement
dérivé à la lecture, sans aucune persistance du résultat. Cette décision reste valable : le moteur
ne connaît donc naturellement que l'état **courant** d'une paire bien/acquéreur, jamais son état
**précédent** — impossible de distinguer une paire qui vient de devenir compatible d'une paire qui
l'est depuis toujours.

Un audit préalable du moteur événementiel ADR-032/033 a confirmé, sur le code réel : `evenements_metier`
est déjà append-only, discriminé par cible plutôt que par un couple générique `{type, id}`, avec un
précédent direct pour la notion de cycle (`inactivite_prospect_vendeur`, ADR-033, `ancre_cycle`) ;
`src/actions/compromis.ts` (`ajouterCompromisAction`) démontre déjà, en production, qu'une mutation
métier et l'émission d'un événement peuvent partager une seule transaction Drizzle. Aucune des huit
Server Actions Bien/Acquéreur/Secteur n'ouvrait en revanche de transaction avant cette passe.

Cette ADR construit exclusivement la **détection fiable de la transition** vers `compatible` et son
enregistrement durable — jamais la moindre conséquence commerciale (tâche, email, règle
d'automatisation), réservée à une ADR ultérieure.

## Décision

### 1. Trois rôles, jamais confondus

```text
evaluerCompatibilite()                = source de vérité métier (ADR-034/035, inchangée)
compatibilites_bien_acquereur_etat    = mémoire technique de dernière observation
evenements_metier (nouveau type)      = historique append-only des transitions
```

La mémoire technique n'est **jamais** utilisée pour afficher ou décider qu'une paire est
compatible — uniquement pour répondre à "qu'avons-nous observé la dernière fois ?".

### 2. `compatibilites_bien_acquereur_etat` — clé composite, pas d'UUID de substitution

Clé primaire `(bien_id, acquereur_id)` directe — même précédent que `configurations_automatisation`
(`regle_code` en PK) : il n'existe pas de second axe d'identité pour une paire. Colonnes :
`dernier_statut` (`compatible`/`incompatible`/`a_verifier`, jamais détourné), `dans_perimetre_actif`
(booléen technique, distinct — voir section 5), `cycle_compatibilite` (entier, jamais un timestamp :
aucun ancrage métier externe n'existe pour ce type, contrairement à `ancre_cycle`), `observe_le`.

### 3. Formule de transition unifiée

```text
etat_effectif(ligne) = dans_perimetre_actif ET dernier_statut = 'compatible'
émettre un événement (et incrémenter le cycle) SSI etat_effectif(avant) = faux ET etat_effectif(après) = vrai
```

Couvre sans branche spéciale : `incompatible`/`a_verifier` → `compatible` ; une première
observation (aucune ligne d'état préexistante, y compris une paire née d'une création de bien ou
d'acquéreur après la mise en service — une vraie opportunité, pas une baseline) ; un désarchivage
toujours compatible (section 5). `compatible → compatible` ne reproduit jamais le même événement ;
`compatible → incompatible`/`a_verifier` ne produit jamais de "nouveau match" (l'état est mis à
jour, pour qu'un retour futur soit détectable) ; `compatible → incompatible → compatible` produit
un **second** événement, cycle incrémenté une seconde fois — la paire redevient une opportunité
après avoir cessé de l'être.

### 4. Handoff durable — jamais de fenêtre de perte après commit

```text
BEGIN
  mutation source (bien/acquéreur/secteur)
  enqueue d'une demande de resynchronisation (compatibilites_a_resynchroniser)
COMMIT
→ traitement synchrone immédiat (même requête)
→ filet de reprise : POST /api/compatibilite/scan (crash entre les deux)
```

La ligne de handoff est posée **dans la même transaction Drizzle** que la mutation source — jamais
après coup. Un crash exactement entre le commit et le traitement synchrone laisse une ligne
durablement en attente (`traitee_le IS NULL`), récupérée par le filet de reprise. Contrairement à
`evenements_metier`, `compatibilites_a_resynchroniser` est une **file**, pas un registre de faits :
un doublon y est inoffensif (retraiter une source déjà à jour est un no-op idempotent). Deux index
uniques partiels activent un coalescing des demandes non traitées ; la complétion se fait toujours
**par identité** (`id`), jamais par source, pour ne jamais absorber silencieusement une demande
arrivée pendant un traitement en cours. Un échec n'est jamais terminal (contrairement à
`executions_automatisation.echoueeLe`) : la ligne reste éligible au retraitement.

Ce mécanisme n'existe que parce qu'aucune règle ADR-032 ne référence encore ce type d'événement
(`reglesPourTypeEvenement()` retourne `[]`) — contrairement aux quatre types ADR-032, ADR-036 n'a
donc structurellement aucune étape à exécuter après commit pour que l'événement lui-même soit
fiable ; le handoff protège uniquement le **calcul de la transition**, jamais une tâche à créer.

### 5. Périmètre actif — jamais un détournement du vocabulaire ADR-034

Une entité archivée sort du périmètre commercial actif sans que ses statuts `compatible`/
`incompatible`/`a_verifier` en soient jamais altérés. `archiverBienAction`/`archiverAcquereurAction`
basculent `dans_perimetre_actif = false` pour toutes les paires déjà observées, **dans la même
transaction que l'archivage**, sans jamais appeler `evaluerCompatibilite()` (un simple `UPDATE`
déterministe, aucun fan-out, aucun risque d'échec lié aux données). `desarchiverBienAction`/
`desarchiverAcquereurAction` n'ont **aucune bascule inline symétrique** — décision technique
importante : poser `dans_perimetre_actif = true` avant la resynchronisation masquerait la
transition hors_perimetre → actif que `traiterPaire()` doit encore observer pour détecter
correctement un nouveau cycle. La bascule vers `true` est donc entièrement déléguée à
`ecrireEtatPaire()`, appelée par la resynchronisation mise en file au désarchivage.

### 6. Orchestration — une seule couche, deux fonctions symétriques

```ts
synchroniserCompatibilitesPourBien(bienId): 1 bien × tous les acquéreurs actifs persistés
synchroniserCompatibilitesPourAcquereur(acquereurId): 1 acquéreur × tous les biens actifs persistés
```

Secteurs chargés en une seule requête groupée (réutilise `listerSecteursPourAcquereurs`, ADR-035) —
jamais N+1, jamais d'appel IGN (le `codeInseeCommune` est déjà résolu et persisté). Chaque paire
est traitée dans sa propre transaction courte (verrou de ligne, isolation par paire — même
philosophie que `scanTemporel.ts`/`moteur.ts`, ADR-032/033) : une paire défectueuse n'annule jamais
le traitement des autres. Aucune écriture pour une paire dont le statut et le périmètre n'ont pas
changé. Un nouveau critère ajouté plus tard à `evaluerCompatibilite()` n'exige aucun changement de
cette couche, qui ne connaît que `statutGlobal`.

### 7. Aucun fallback mock dans la couche technique

`listerBiensActifsPersistes()`/`listerClientsActifsPersistes()` (nouvelles, colocées avec
`listerBiensArchives()`/`listerClientsArchives()`) interrogent la table réelle directement, sans
jamais basculer sur `data/biens.ts`/`data/clients.ts` — contrairement à `listerBiens()`/
`listerClients()`, dont le comportement produit existant (repli mock pour l'UI/le matching flou)
reste strictement inchangé. La synchronisation ADR-036 n'appelle jamais ces deux dernières.

### 8. Concurrence — garanties Postgres, jamais un `if (existe) return`

Verrou de ligne (`SELECT ... FOR UPDATE`) sur l'état technique de la paire avant décision de
transition (même patron que `verrouillerExecutionATraiter`, ADR-032). Backstop final : index unique
partiel `(type_evenement, bien_id, acquereur_id, cycle_compatibilite)` sur `evenements_metier` —
même en cas de faille du verrouillage applicatif, Postgres empêche structurellement un doublon
d'événement pour le même cycle.

### 9. `evenements_metier` étendu, pas une nouvelle table

```sql
ALTER TABLE evenements_metier
  ADD COLUMN bien_id uuid REFERENCES biens(id),
  ADD COLUMN acquereur_id uuid REFERENCES acquereurs(id),
  ADD COLUMN cycle_compatibilite integer;
```

Nouveau type `compatibilite_bien_acquereur_devenue_compatible` — vocabulaire aligné sur ADR-032
(fait au participe passé) et sur le vocabulaire de statut d'ADR-034, jamais un mot d'interprétation
commerciale ("match"). `CHECK` "une seule cible" réécrit pour traiter `(bien_id, acquereur_id)` posé
**ensemble** comme une cible logique unique ; nouveau `CHECK` imposant que les deux colonnes soient
toujours renseignées ensemble, jamais l'une sans l'autre. Payload minimal : `bienId`, `acquereurId`,
`cycleCompatibilite` — aucune PII, aucun snapshot des 7 critères (relus depuis les entités au
moment où ils sont réellement nécessaires, ADR-037).

### 10. Baseline explicite, jamais automatique

`/api/compatibilite/baseline` (secret dédié `COMPATIBILITE_BASELINE_SECRET`, distinct de
`COMPATIBILITE_SCAN_SECRET` : le identifiant du cron de reprise ne doit jamais pouvoir, même par
erreur de configuration, déclencher une baseline/rebuild). Mode `dry-run` par défaut (jamais une
écriture accidentelle si le corps de requête est absent/invalide) ; `apply` écrit silencieusement
`compatibilites_bien_acquereur_etat` — **jamais un événement**, quel que soit le statut observé.
Refuse par défaut (409) d'écraser une table déjà peuplée, sauf `confirmerEcrasementExistant: true`
explicite. Un rebuild reprend le cycle au maximum déjà observé dans `evenements_metier` pour chaque
paire (`MAX(cycle_compatibilite)`), jamais recalculé "à zéro" — ne peut donc jamais réémettre un
cycle déjà utilisé historiquement.

## Hors périmètre, volontairement

Aucune tâche, aucun email, aucune règle `catalogueRegles.ts` ne référence ce nouvel événement —
0 tâche et 0 email pour tout nouveau match dans cette ADR. Aucun snapshot des critères détaillés.
Aucun scan de fond périodique recalculant N×M (seul l'outil de baseline/rebuild, ponctuel et
manuel, existe). Une ADR ultérieure branchera l'exploitation commerciale de l'événement sans
modifier le moteur de compatibilité ni la détection de transition — il lui suffira d'ajouter une
entrée dans `catalogueRegles.ts`, exactement comme les règles ADR-032/033 existantes.

## Conséquences

- Migration `0023_milky_giant_girl.sql` : tables `compatibilites_bien_acquereur_etat` (PK
  composite) et `compatibilites_a_resynchroniser` (deux index uniques partiels) ; `bien_id`/
  `acquereur_id`/`cycle_compatibilite` sur `evenements_metier`, `CHECK`/index étendus.
- Nouveaux fichiers : `src/lib/compatibilite/{etatRepository,resynchronisationRepository,
  synchronisation,baseline}.ts`, `src/app/api/compatibilite/{scan,baseline}/route.ts`.
- Fichiers modifiés : `src/db/schema.ts` ; `src/lib/bienRepository.ts`/`clientRepository.ts`/
  `secteurRechercheRepository.ts` (paramètre `executeur` optionnel ajouté à neuf fonctions,
  `listerBiensActifsPersistes`/`listerClientsActifsPersistes` ajoutées) ; `src/lib/automatisations/
  evenementMetierRepository.ts` (nouveau type discriminé) ; `src/types/automatisation.ts` ;
  `src/actions/{creerBien,modifierBien,archivageBien,creerAcquereur,modifierAcquereur,
  archivageAcquereur,secteurRecherche}.ts` (transaction + enqueue).
- Tests : suite dédiée `src/lib/compatibilite/{synchronisation,baseline,
  resynchronisationRepository}.test.ts`, `src/app/api/compatibilite/{scan,baseline}/route.test.ts`,
  `src/actions/{archivageBien,archivageAcquereur}.test.ts` (nouveaux) — matrice de transitions,
  cycles, concurrence (verrou + backstop index, coalescing sans perte), reprise après crash
  simulé, baseline/rebuild, absence de réseau/tâche/email. Non-régression : cleanup étendu de
  `creerBien.test.ts`/`modifierBien.test.ts`/`secteurRecherche.test.ts` (les Server Actions
  concernées écrivent désormais des lignes techniques référençant bien/acquéreur, à purger avant
  suppression — même contrainte FK `NO ACTION` que pour `evenements_metier`).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- Hors périmètre, réservé à ADR-037 : règle d'automatisation réagissant au nouvel événement,
  création de tâche, envoi d'email, notification, scoring/ranking, snapshot des critères,
  historique exhaustif de chaque état transitoire entre deux synchronisations.
