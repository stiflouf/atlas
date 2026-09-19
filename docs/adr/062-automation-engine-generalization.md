# ADR-062 — Généralisation du moteur d'automatisation : registre temporel, obsolescence, premières règles Mandat/Offre

**Statut :** Accepté — **IMPLÉMENTÉ** (2026-09-19, lot `AUTOMATION_ENGINE_GENERALIZATION_V1`, migrations `0047`/`0048`/`0049`).

**Date :** 2026-09-19
**Décideurs :** Steven Gausset (CEO), CTO

> Dépend de : **ADR-032** (moteur événementiel — événement → règle → exécution → tâche, idempotence
> par `UNIQUE(regle_code, evenement_id)`), **ADR-033** (moteur temporel — scan, `runs_scan_automatisation`,
> `ancreCycle`), **ADR-038** (reprise après crash), **ADR-060** (mandat canonique, `mandatCourantDuBien`,
> succession), **ADR-061** (cycle de vie Offre, événements `offre_*`/`compromis_realise`/`compromis_annule`,
> cible `evenements_metier.offre_id`).

## Contexte

ADR-061 a livré un cycle de vie Offre/Compromis fiable qui émet de vrais événements métier
(`offre_recue/acceptee/refusee/retiree/caduque`, `compromis_realise/annule`), en différant
explicitement leur consommation à ce lot. Le moteur événementiel (ADR-032) était déjà générique.
Son pendant temporel (ADR-033) ne l'était pas : une seule fonction câblée en dur
(`scannerInactiviteProspectVendeur`), un seul seuil nommé pour une seule règle
(`seuil_jours_inactivite`), zéro registre, zéro mécanisme d'obsolescence pour les tâches
automatiques (aucun n'existait, toutes règles confondues).

## Décision

| Clé | Décision |
|---|---|
| `TEMPORAL_ENGINE_MODEL` | registre explicite `SCANNERS_TEMPORELS: ScannerTemporel[]` (`scanTemporel.ts`) ; la route `/api/automatisations/scan` parcourt le registre et isole l'erreur de chaque scanner — elle ne référence plus aucun code de règle |
| `SCANNER_IMPLEMENTATION_STYLE` | pas d'abstraction "squelette" générique au-delà du registre lui-même — chaque scanner (`scanners/*.ts`) reste du TypeScript explicite suivant le déroulé déjà éprouvé par `inactivite_prospect_vendeur` (config → workspace → run → candidats → par occurrence → obsolescence → fin de run) |
| `THRESHOLD_CONFIG_MODEL` | colonne renommée `configurations_automatisation.seuil_jours` (depuis `seuil_jours_inactivite`) — générique, un sens par LIGNE (`regle_code` reste la PK), jamais une colonne par règle ni un JSON de paramètres structurés (pas de DSL, §RULE_ENGINE_STYLE) |
| `RULE_ENGINE_STYLE` | V1 = code TypeScript explicite + registre, confirmé inchangé : pas de JSON rules engine, pas d'éditeur de règles, pas de parseur d'expressions |
| `NEW_RULES_PIPELINE` | les 3 nouvelles règles passent par le pipeline événementiel EXISTANT (`emettreEvenementEtPreparerExecutions` → `executions_automatisation` → `catalogueRegles.construireTache`), jamais un chemin parallèle de création de tâche — hérite gratuitement idempotence, reprise et isolation d'erreur |
| `OCCURRENCE_IDENTITY` | `offre_sans_decision`/`offre_acceptee_sans_compromis` : `offreId` (stable toute la vie de l'offre — réutilise l'index partiel générique `evenements_metier_offre_unique`, aucun nouvel index). `mandat_expire_bientot` : `mandatId` (un renouvellement crée une nouvelle ligne `mandats`, donc une identité authentiquement nouvelle — nouvelle colonne + index partiel dédié, même patron que `offre_id`, ADR-061) |
| `MANUAL_CLOSE_POLICY` | **A** — une tâche fermée (humainement ou par obsolescence) n'est jamais rouverte tant que le même fait n'a pas changé. Obtenu STRUCTURELLEMENT par l'index unique d'idempotence (l'occurrence n'est créée qu'une fois, jamais rejouée) : aucune colonne ni logique dédiée |
| `OBSOLESCENCE_MODEL` | par scanner, ferme (`annulee_le`, jamais un DELETE) toute tâche automatique de sa règle dont la cible n'est plus dans le jeu de candidats du scan EN COURS — set-based (une ou deux requêtes, jamais une par tâche). Monotonie des seuils temporels garantit l'absence de fausse obsolescence |
| `OBSOLESCENCE_MANDAT_SPECIAL_CASE` | `mandat_expire_bientot` ne peut PAS utiliser "cible NOT IN candidats" (la cible tâche est `bienId`, l'identité d'occurrence est `mandatId` — un bien reste un candidat valide à travers un renouvellement). Jointure explicite tâche → exécution → événement pour retrouver le mandat d'origine de chaque tâche ouverte, fermeture par identifiants (`cloturerTachesParIds`) |
| `OFFER_EVENT_CONSUMPTION_STRATEGY` | **temporel uniquement** — aucune règle événementielle réactive sur `offre_acceptee`/`offre_recue`/etc. Seul le scan agit, après un court délai configurable. Évite un mécanisme hybride événement+temporel et son risque de double tâche, plus simple et pleinement déterministe (brief §21/§22) |
| `MANDATE_TASK_TARGET` | `mandat_expire_bientot` cible le **bien** (`taches.bien_id`, déjà existant) — aucune colonne `mandat_id` ajoutée à `taches` pour ce seul usage. `evenements_metier.mandat_id` existe (cible de l'événement, pour l'idempotence), sans lien avec `taches` |
| `MANDATE_EXPIRING_QUERY_MODEL` | `mandatsCourantsExpirantBientot` (mandatRepository.ts) — set-based, une requête pour N biens, même WHERE que `mandatCourantDuBien` (non résilié, non remplacé) plus la fenêtre `date_fin`, réduit en JS au premier par bien (même ordre déterministe) — comble le besoin documenté par ADR-060 §"Scalabilité" |
| `OFFER_QUERY_MODEL` | `offresEnCoursDepasseesSeuil` / `offresAccepteesSansCompromis` (offreRepository.ts) — set-based, la seconde via anti-jointure `notExists` (même style que `successeurDe`, mandatRepository.ts) |
| `TODAY_LINK_MODEL` | `TacheItem` accepte un `lienCibleOverride` optionnel, prenant le pas sur `deriverRouteFicheCible` — `app/page.tsx` résout en lot le bien de chaque tâche ciblant une offre (`bienIdsPourOffres`, volontairement NON scopée workspace, cohérence avec le reste de cette page déjà non scopée) et fournit `/biens/{bienId}` comme lien. Aucune fiche Offre créée |
| `MANDATE_EXPIRING_DEFAULT_THRESHOLD` | 30 jours |
| `OFFER_NO_DECISION_DEFAULT_THRESHOLD` | 2 jours |
| `ACCEPTED_OFFER_NO_COMPROMISE_DEFAULT_THRESHOLD` | 7 jours |
| `VISIT_TEMPORAL_RULES` | DEFERRED — Visit dépend de Calendar, pas encore mature (`VISIT_MATURITY`) |
| `AI_INCLUDED` | NO |
| `MIGRATION_INCLUDED` | YES — additif uniquement : `evenements_metier.mandat_id` (+ index + CHECK élargi), CHECK `regle_code` élargi sur `configurations_automatisation`/`executions_automatisation`/`runs_scan_automatisation`, renommage pur `seuil_jours_inactivite` → `seuil_jours`, seed des 3 nouvelles lignes de configuration (inactives) |

## Hors périmètre (différé, jamais silencieusement)

- `configurations_automatisation` PK mono-colonne (`regle_code` seul, dette multi-workspace déjà
  documentée, ADR-054) — inchangée, toujours dormante tant qu'un seul workspace existe.
- Index unique SQL partiel sur `offres.statut = 'acceptee'` — toujours différé (ADR-061 §7),
  toujours applicatif sous verrou du bien.
- Contre-offre, co-acquéreurs, financement/conditions suspensives, expiration automatique de
  `date_validite`, fiche `/offres/{id}` complète, provenance/connecteurs Offre — inchangés (ADR-061).
- Règles temporelles Visite (`visite_j_1`, `visite_sans_compte_rendu`) — DEFERRED jusqu'à
  `VISIT_MATURITY`.
- Refonte de Today en cockpit complet — seule la correction des liens et l'affichage des nouvelles
  tâches sont livrés ; pas de nouvelle mise en page.

## Conséquences

- Ajouter une future règle temporelle suit désormais un patron répétable : nouveau type
  d'événement (+ CHECK), éventuel nouveau champ cible sur `evenements_metier` si l'identité
  d'occurrence n'est portée par aucune colonne existante, un scanner dans `scanners/`, une entrée
  dans le registre, une entrée dans `catalogueRegles.ts`.
- L'obsolescence devient un service générique (`cloturerTachesAutomatiquesObsoletes`,
  `cloturerTachesParIds`, tacheRepository.ts) réutilisable par toute future règle temporelle ; les
  règles événementielles pures (ADR-032) n'en ont pas besoin (pas de notion de candidat récurrent).
