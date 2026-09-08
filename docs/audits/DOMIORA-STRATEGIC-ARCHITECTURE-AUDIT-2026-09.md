# DOMIORA — Audit stratégique d'architecture

**Date :** 2026-09-08
**Dépôt :** `/home/sgausset/atlas` (nom de code technique `atlas`, marque produit DOMIORA)
**Branche auditée :** `develop` @ `886aeff`
**Périmètre :** audit en lecture seule. Aucun fichier modifié hors ce rapport.
**Méthode :** lecture directe du code, du schéma Drizzle, des migrations SQL, des ADR et des tests.
Toute affirmation non vérifiable dans le dépôt est marquée `UNKNOWN` ou `[Non vérifié]`.

---

## 1. Executive Summary

### Où en est réellement DOMIORA ?

DOMIORA est une **application Next.js mono-conseiller, à un seul workspace applicatif
(`apps/web`), d'environ 70 000 lignes de TypeScript**, avec 31 tables PostgreSQL, 32 migrations,
53 ADR, 203 fichiers de tests unitaires/intégration (~1 682 cas) et 2 smoke tests Playwright.
Ce n'est pas un prototype : le tunnel commercial complet est implémenté et testé, de
`prospect vendeur → mandat → bien → visite → compte rendu → offre → compromis → acte →
rémunération → pack notaire`.

La qualité de modélisation est nettement au-dessus de la moyenne : jalons timestamp plutôt
qu'enums dérivés (ADR-014), append-only assumé (ADR-011), `NULL ≠ false` (ADR-009), idempotence
des automatisations garantie par contrainte SQL (`UNIQUE(regle_code, evenement_id)`), file de
resynchronisation transactionnelle (ADR-036), reprise après crash (ADR-038). Chaque décision
structurante est justifiée dans le code lui-même et adossée à une ADR.

### DOMIORA est-il un CRM IAD ou un moteur immobilier générique ?

**Ni l'un ni l'autre : c'est aujourd'hui un moteur immobilier générique mono-instance.**

Le couplage IAD est **quasi inexistant** : zéro occurrence de « IAD », « Playiad », « filleul »,
« parrain », « généalogie » ou « récurrence » dans `src/`, dans `schema.ts`, dans les migrations,
dans les routes ou dans les composants UI. Les seules occurrences vivent dans 7 fichiers de
documentation, toutes en position de *hors périmètre* ou d'exemple de réseau tiers.

Le vocabulaire métier est générique (bien, acquéreur, prospect vendeur, mandat, visite, offre,
compromis, rémunération). Le seul élément réellement franco-spécifique est **le moteur fiscal
micro-BNC/BIC** (`src/lib/fiscal/`, 17 modules + table `regle_fiscale` de référentiel versionné),
qui est spécifique au statut d'indépendant français — pas à IAD.

**La dépendance structurelle réelle n'est pas IAD : c'est le mono-conseiller.** Aucune table
`utilisateurs`, aucun `userId`, aucun `tenantId`, aucun `ownerId` sur aucune des 31 tables.
`connexions_google` et `dossier_fiscal` sont explicitement des tables à ligne unique
(`id = 'default'`). Le nom du conseiller vient d'une variable d'environnement
(`ATLAS_ADVISOR_DISPLAY_NAME`), l'autorisation d'une allowlist à **une seule** adresse
(`ATLAS_ALLOWED_EMAIL`, ADR-047).

### Quelle proportion du Core cible existe déjà ?

**Environ 70 %.** 7 des 11 objets Core cibles existent comme entités réelles et testées
(Property, SellerProject, Visit, Offer, Task, Document, Matching). 4 sont partiels ou absents :
**Contact** (aucune entité unifiée : personne et projet sont confondus), **BuyerProject** (fusionné
dans `acquereurs`), **Mandate** (colonnes sur `biens`, pas d'entité), **Interaction** (fragmentée
en 4 tables sans vue unifiée).

### Quelle proportion de l'intelligence différenciante existe déjà ?

**Environ 45 %, entièrement déterministe.** Le cockpit « Aujourd'hui », le moteur d'opportunités,
le moteur d'alertes, le moteur de compatibilité, le moteur d'automatisations événementiel + scan
temporel et la mémoire relationnelle existent et sont testés. Ce sont des **moteurs de règles purs
et déterministes** (ADR-008 : jamais de LLM sur du texte libre) — pas des systèmes apprenants ni
contextuels au sens ML. Le seul appel LLM du produit est une **reformulation** de brouillon
d'email, isolée derrière une interface (`RedacteurCommunication`), avec liste blanche de faits et
8 garde-fous de rejet. L'intelligence manager/réseau est **totalement absente**.

### Quelle dette empêcherait l'ouverture à d'autres réseaux ?

Trois blocages structurels, par ordre de gravité :

1. **Aucun modèle de provenance des données.** Aucune table métier ne porte `source`,
   `id_externe`, `synchronise_le` ou `champs_verrouilles`. La seule exception est
   `memoire_contextuelle` (dédiée au matching Calendar) et `visites.rendez_vous_calendar_id`.
   Un connecteur IAD/CRM tiers ne peut donc **pas** écrire dans DOMIORA sans inventer un modèle
   d'identité externe et de résolution de conflit qui n'existe nulle part.
2. **Aucun modèle d'utilisateur ni de tenant.** Toute ligne appartient implicitement à l'unique
   conseiller. Multi-réseau implique multi-conseiller, ce qui touche les 31 tables.
3. **Les intégrations vivent dans le domaine, pas derrière une frontière.** Huit clients d'API
   externes sont importés directement par un Server Component
   (`src/app/visites/[id]/preparer/page.tsx`), et l'IGN est appelé depuis les Server Actions
   `creerBien`/`modifierBien`/`secteurRecherche`. Il n'existe ni dossier `connectors/`, ni
   interface `Connector`, ni port/adaptateur générique — sauf pour la rédaction assistée, qui est
   le seul contre-exemple propre.

---

## 2. Current Architecture (observée, pas souhaitée)

```
                        ┌──────────────────────────────────────────────┐
                        │  Navigateur — HTML natif, formulaires POST    │
                        └───────────────────┬──────────────────────────┘
                                            │
                        ┌───────────────────▼──────────────────────────┐
                        │  src/proxy.ts  (ex-middleware, Next 16)      │
                        │  PRIVATE BY DEFAULT — session Atlas exigée   │
                        │  sauf /connexion + 2 routes OAuth            │
                        │  + 4 endpoints machine (Bearer dédié)        │
                        └───────────────────┬──────────────────────────┘
                                            │
   ┌────────────────────────────────────────▼──────────────────────────────────────┐
   │  apps/web  (SEUL workspace applicatif — pas d'apps/api, worker, packages/)     │
   │                                                                               │
   │  src/app/**            Server Components (pages) + 16 route handlers          │
   │    │                   ⚠ importe DIRECTEMENT 8 clients d'API externes         │
   │    │                     (visites/[id]/preparer/page.tsx)                     │
   │    ▼                                                                          │
   │  src/actions/*.ts      Server Actions ("use server"), minces (ADR-007)        │
   │    │                   exigerSessionAtlas() en 2e couche                      │
   │    ▼                                                                          │
   │  src/lib/                                                                     │
   │    ├── *Repository.ts        SEULS fichiers autorisés à importer @/db/*       │
   │    ├── compatibilite/        moteur PUR bien×acquéreur (ADR-034/035/036)      │
   │    ├── opportunites/         moteur PUR d'opportunités (VALUE-01)             │
   │    ├── alertes/              moteur PUR d'alertes (ADR-026)                   │
   │    ├── automatisations/      catalogue de règles + moteur + scan + reprise    │
   │    ├── relations/            mémoire relationnelle acquéreur (read model pur) │
   │    ├── communications/       brouillon déterministe + contexte + destinataire │
   │    ├── redaction/            ⭐ SEUL port/adaptateur du dépôt (LLM)            │
   │    ├── documents/            checklist dérivée, pack notaire, cohérence       │
   │    ├── fiscal/               17 modules de calcul purs (micro-BNC, TVA, CFP)  │
   │    ├── matching/             résolution floue RDV Calendar → bien/acquéreur   │
   │    ├── google/               OAuth + Calendar (RO) + Gmail (send)             │
   │    └── geo|geocodage|transports|ecoles|commerces|marche|patrimoine|araconter  │
   │                              8 clients HTTP bruts, sans interface commune     │
   │    ▼                                                                          │
   │  src/db/schema.ts      31 tables Drizzle, 32 migrations SQL commitées         │
   │  src/data/             mocks démo (bascule stricte mock↔réel, jamais fusion)  │
   └───────────────────────────────┬───────────────────────────────────────────────┘
                                   │
                     ┌─────────────▼──────────────┐
                     │  PostgreSQL (Railway)      │
                     │  + filesystem documentaire │
                     │    (ATLAS_DOCUMENT_STORAGE_DIR)
                     └────────────────────────────┘

   Déclencheurs externes (cron, hors application) ──Bearer──> /api/automatisations/scan
                                                              /api/automatisations/reprise
                                                              /api/compatibilite/scan
                                                              /api/compatibilite/baseline

   ⚠ Aucun worker, aucune queue, aucun broker, aucun cache. Tout est synchrone
     dans la requête HTTP, avec filet de rattrapage transactionnel en base.
```

### Stack technique réellement utilisée

| Élément | Réalité vérifiée |
|---|---|
| Monorepo | Turborepo + pnpm workspaces ; **un seul** workspace actif (`apps/web`), pas de `packages/` |
| Framework | Next.js 16.3.0 (App Router, Server Components, Server Actions), React 19.2.8 |
| Langage | TypeScript strict |
| Base | PostgreSQL via Drizzle ORM 0.45 + driver `postgres` 3.4 |
| Auth | Google OIDC (`google-auth-library`) + allowlist 1 adresse + `iron-session` |
| Style | Tailwind CSS 4, composants maison (`src/components/ui/`, 20 primitives), pas de Shadcn |
| Images | `sharp` (optimisation photos bien, ADR-052) |
| Tests | Vitest (unitaires purs + intégration Postgres réelle), Playwright (2 smoke) |
| Déploiement | Railway (`ops/railway/`), `infra/docker-compose.yml` pour le dev local |
| CI | **Aucune** — pas de `.github/`, aucun pipeline dans le dépôt |

### Commandes disponibles

`pnpm dev` / `pnpm build` / `pnpm lint` (racine, via turbo) ;
dans `apps/web` : `db:generate`, `db:migrate`, `db:seed:demo`, `test` (vitest), `test:e2e`,
`test:e2e:ui`.

**Non exécutés pendant cet audit** (consigne « ne rien modifier / ne toucher aucune base ») :
`pnpm test` exige un PostgreSQL local migré (`atlas_test`) et écrit en base. Le statut vert/rouge
de la suite est donc `UNKNOWN` à cette date.

---

## 3. Domain Model

31 tables. Colonne « Maturité » : **Solide** = entité complète + invariants SQL + tests ;
**Correcte** = fonctionnelle, limites documentées ; **Embryon** = existe mais peu exploitée.

| Table | Rôle métier | Relations principales | Maturité | Générique / IAD |
|---|---|---|---|---|
| `biens` | Bien en commercialisation. Porte aussi le mandat (`statut_mandat`, `date_mandat`), les jalons commerciaux (`offre_en_cours_le`, `compromis_signe_le`) et `code_insee_commune` | ← notes, documents, photos, visites, offres, compromis, tâches ; ↔ `prospects_vendeurs.bien_id` (UNIQUE) | Solide | Générique |
| `acquereurs` | **Personne ET projet d'achat fusionnés** : identité + budget + critères + `stade_projet` | ← secteurs, repères, visites, offres, compromis, documents, tâches | Correcte | Générique |
| `prospects_vendeurs` | Projet vendeur amont : lead → qualifié → estimation → mandat proposé → signé → conversion en bien | → `biens` (UNIQUE) ; ← notes, tâches, documents | Solide | Générique |
| `secteurs_recherche_acquereur` | Communes recherchées (code INSEE canonique IGN) | → `acquereurs` CASCADE | Solide | Générique |
| `reperes_relationnels_acquereur` | Mémoire relationnelle explicite (préférence contact/relationnelle, centre d'intérêt) + autorisation d'usage | → `acquereurs` CASCADE | Embryon (ADR-053 : volontairement non consommé) | Générique |
| `visites` | Visite planifiée/réalisée/annulée, matérialisée depuis un RDV Calendar | → `biens`, `acquereurs` ; ← `comptes_rendus_visite.visite_id` | Correcte | Générique |
| `comptes_rendus_visite` | Compte rendu append-only : `interet` contrôlé + `retour` libre + `prochaine_etape` | → `biens`, `acquereurs`, `visites` (SET NULL) | Solide | Générique |
| `offres` | Offre structurée immuable (montant/date/acquéreur figés), statut seul mutable | → `biens`, `acquereurs` ; ← `offre_visites`, `compromis` | Solide | Générique |
| `offre_visites` | Jonction N:N offre ↔ compte rendu (ADR-019) | CASCADE des deux côtés | Solide | Générique |
| `compromis` | Compromis structuré, `date_acte` prévue vs `date_acte_reelle`, index unique partiel « 1 seul en cours par bien » | → `biens`, `acquereurs`, `offres` (SET NULL) | Solide | Générique |
| `remuneration` | Rémunération conseiller par compromis (centimes), prévu vs réel | → `compromis` UNIQUE CASCADE | Solide | Générique (montant, pas de barème réseau) |
| `documents_bien` | Dossier documentaire : 30 types fermés, dates de validité, rattachements multiples cumulables, état de vérification | → `biens` CASCADE ; → `compromis`/`acquereurs`/`prospects_vendeurs` SET NULL | Solide | Générique |
| `photos_bien` | Galerie ordonnée, photo principale **dérivée** du tri (pas de flag) | → `biens` CASCADE | Solide | Générique |
| `notes_bien` | Notes libres append-only sur un bien | → `biens` CASCADE | Correcte | Générique |
| `notes_prospect_vendeur` | Interaction vendeur typée (`appel`/`email`/`sms`/`rendez_vous`/…) — fait avancer `dernier_contact_le` | → `prospects_vendeurs` CASCADE | Solide | Générique |
| `taches` | Tâche métier, statut **dérivé** de `terminee_le`/`annulee_le`, **7 FK de cible** avec CHECK « au plus une » | → biens, acquéreurs, prospects, comptes rendus, offres, compromis, rémunération | Solide | Générique |
| `evenements_metier` | Journal des faits métier (6 types), cibles discriminées, 5 index uniques partiels d'idempotence | → comptes rendus, prospects, compromis, (bien+acquéreur) | Solide | Générique |
| `executions_automatisation` | Snapshot d'exécution d'une règle sur un événement, `UNIQUE(regle, evenement)`, compteur de tentatives | → `evenements_metier`, `taches` SET NULL | Solide | Générique |
| `configurations_automatisation` | Activation par règle (absence de ligne = INACTIF) + seuil produit | PK = `regle_code` | Solide | Générique |
| `runs_scan_automatisation` | Journal technique des passages du scanner temporel | — | Correcte | Générique |
| `compatibilites_bien_acquereur_etat` | Dernier statut observé par paire + `cycle_compatibilite` (idempotence d'événement) | PK composite (bien, acquéreur) | Solide | Générique |
| `compatibilites_a_resynchroniser` | File d'attente transactionnelle de resynchronisation, index partiels de coalescing | → biens XOR acquéreurs | Solide | Générique |
| `envois_email` | Audit **technique** d'un envoi Gmail (id = clé d'idempotence fournie par l'appelant), 3 états terminaux dont `incertain` | — | Solide | Générique |
| `memoire_contextuelle` | Mémoire du matching RDV externe → bien/acquéreur, avec `source` + `identifiant_externe` + confiances + statut de validation humaine | `bien_id`/`client_id` **en texte, sans FK** | Correcte | **Générique — seul modèle de provenance du dépôt** |
| `connexions_google` | Refresh token chiffré AES-256-GCM, **une seule ligne** (`id='default'`) | — | Correcte | Générique, mono-conseiller |
| `transmissions_dossier_notaire` | Déclaration de transmission du pack notaire + snapshot JSONB immuable | → `compromis` NO ACTION | Solide | Générique |
| `dossier_fiscal` | Racine mono-dossier (`id='default'`) | ← profil, historique, RFR | Correcte | France (indépendant) |
| `profil_fiscal` | Instantané fiscal complet historisé, append-only, résolution « profil à la date D » | → `dossier_fiscal` | Solide | France |
| `historique_amorcage` | Historique de démarrage d'activité (amorçage des seuils) | → `dossier_fiscal` | Correcte | France |
| `rfr_foyer` | Revenu fiscal de référence du foyer | → `dossier_fiscal` | Correcte | France |
| `regle_fiscale` | Référentiel fiscal versionné + statut de vérification par source | — | Solide | France |

### Ce qui n'existe PAS en base

`utilisateurs`, `equipes`, `managers`, `filleuls`, `contacts` (unifiés), `mandats` (entité),
`interactions` (unifiées), `notifications`, `proprietaires`/`vendeurs` (hors prospect),
`connecteurs`, `sources_externes`, `mappings_externes`, `objectifs`, `annonces`/`portails`.

---

## 4. Feature Inventory

Statut : **A** implémenté et utilisable · **B** partiel · **C** documenté/ADR seulement · **D** absent.

| Feature | Statut | Evidence (fichiers principaux) | Tests | Générique / IAD |
|---|---|---|---|---|
| Compatibilité bien × acquéreur (ADR-034) | **A** | `lib/compatibilite/evaluerCompatibilite.ts` (fonction pure, 7 critères, agrégation sans score), `criteres.ts` | `evaluerCompatibilite.test.ts` (529 l.) | Générique |
| Secteurs de recherche acquéreur (ADR-035) | **A** | `secteursRechercheAcquereur` (table), `actions/secteurRecherche.ts`, `lib/geocodage/` | `secteurRecherche.test.ts` | Générique (IGN = France) |
| Transitions de compatibilité (ADR-036) | **A** | `lib/compatibilite/synchronisation.ts`, `resynchronisationRepository.ts`, `traitementResynchronisation.ts`, `/api/compatibilite/scan` + `/baseline` | `synchronisation.test.ts` (370 l.), `orchestration.test.ts`, `baseline.test.ts` | Générique |
| Tâche automatique « nouveau match » (ADR-037) | **A** | `lib/automatisations/catalogueRegles.ts` (règle `nouveau_match_bien_acquereur`) | `catalogueRegles.nouveauMatch.test.ts` | Générique |
| Reprise durable des exécutions (ADR-038) | **A** | `lib/automatisations/reprise.ts`, `/api/automatisations/reprise`, colonnes `nombre_tentatives`/`derniere_tentative_le` | `reprise.test.ts` | Générique |
| Cockpit « Aujourd'hui » (ADR-039) | **A** | `src/app/page.tsx` (334 l.) : 4 StatTiles + RDV du jour + RDV à venir + dossiers à action + opportunités + alertes + tâches sans bien | `app/page.test.tsx`, `TacheItem.test.tsx`, `AgendaCard.test.tsx` | Générique |
| Cycle de vie Visite (ADR-040/041) | **A** | table `visites`, `actions/visite.ts` (matérialiser/reporter/annuler), `lib/visiteRepository.ts` | `visite.annulerReporter.test.ts`, `visiteRepository.test.ts` | Générique |
| Retour vendeur après visite (ADR-042) | **A** | règle `retour_vendeur_apres_visite`, résolution vendeur **exclusivement** via `prospects_vendeurs.bien_id` | `catalogueRegles.retourVendeur.test.ts` | Générique |
| Provenance des communications automatiques (ADR-043) | **A** | `getExecutionAutomatisationParTacheId` (fail-closed), `UNIQUE(tache_id)` ajouté par ADR-047 | `executionAutomatisationRepository.test.ts` | Générique |
| Design System | **A** | `brand/DESIGN-SYSTEM-V1.md`, `FONDATIONS.md`, `IMPLEMENTATION-DS-V1.md`, `src/components/ui/` (20 primitives), migration achevée (≈15 commits `feat(design-system)`) | `Badge.test.tsx`, `Button.test.tsx`, `ButtonLink.test.tsx`, `Pagination.test.tsx`, `ChampRecherche.test.tsx` | Générique |
| Navigation | **A** | `components/layout/NavItems.tsx` — 7 entrées : Aujourd'hui, Tableau de bord, Biens, Clients, Prospects vendeurs, Fiscal, Automatisations | via smoke e2e | Générique |
| Tâches (ADR-028) | **A** (sans édition) | table `taches`, `actions/creerTache|terminerTache|annulerTache`, `lib/tachePriority.ts` | 5 fichiers de tests | Générique |
| Gestion des biens | **A** | CRUD complet + archivage + photos + documents + statut commercial + pack notaire | `bienRepository.*.test.ts` (4 fichiers), `creerBien`, `modifierBien` | Générique |
| Acquéreurs | **A** | CRUD + archivage + secteurs + repères + compatibilité | `creerAcquereur.test.ts` + `.securite.test.ts`, `modifierAcquereur.test.ts` | Générique |
| Contacts (au sens carnet d'adresses unifié) | **D** | Aucune entité `contacts` ; `/clients` = acquéreurs uniquement, `/prospects-vendeurs` séparé | — | — |
| Documents | **A** | `documents_bien` + `lib/documents/checklistDossier.ts` (dérivée, jamais stockée) + pack notaire ZIP + traçabilité transmissions | `checklistDossier.test.ts`, `packNotaire.test.ts`, `genererZipPackNotaire.test.ts`, `transmissionDossierNotaire.*.test.ts`, e2e dédié | Générique |
| Gmail (envoi) | **A** | `lib/google/gmailClient.ts`, `mimeEmail.ts`, `actions/envoyerEmailGmail.ts`, table `envois_email` idempotente | `gmailClient.test.ts`, `mimeEmail.test.ts`, `envoyerEmailGmail.test.ts` | Générique |
| Google Calendar (lecture) | **A** | `lib/google/agendaSource.ts`, `calendarClient.ts`, `adapter.ts` — scope `calendar.events.readonly`, **aucune écriture, aucune synchro bidirectionnelle** | `agendaSource.demoProduction.test.ts`, `oauth.test.ts` | Générique |
| Automatisations (ADR-032/033) | **A** | 7 règles, activation explicite par ligne, moteur transactionnel + scan temporel, page `/automatisations` | `moteur.test.ts`, `scanTemporel.test.ts`, `calculOccurrencesInactivite.test.ts` | Générique |
| Moteur d'alertes (ADR-026) | **A** | `lib/alertes/` : règles données, commercial, fiscal, projection + priorité + déduplication | 5 fichiers de tests | Générique |
| Moteur d'opportunités (VALUE-01) | **A** | `lib/opportunites/regles.ts` : relance mandat, suivi visite, match à exploiter — dérivé à la lecture, jamais persisté | `moteur.test.ts` (389 l.) | Générique |
| Mémoire relationnelle acquéreur (VALUE-03/06) | **B** | `lib/relations/memoireAcquereur.ts` (read model pur, 11 types d'événements) ; `reperes_relationnels_acquereur` **délibérément non consommée** (ADR-053) | `memoireAcquereur.test.ts`, `politiqueReperesCommunication.test.ts`, `reperesRelationnels.frontiere.test.ts` | Générique |
| Communications assistées (ADR-031, VALUE-04/05) | **A** | brouillon déterministe (`genererBrouillonEmail.ts`) + reformulation LLM optionnelle derrière interface + 8 garde-fous de rejet | `genererBrouillonEmail.test.ts`, `redaction.test.ts`, `reperesCommunication.frontiere.test.tsx` | Générique |
| Préparation de visite enrichie | **B** | `visites/[id]/preparer/page.tsx` agrège IGN, PRIM, Vélib, annuaire éducation, Overpass, Mérimée, DVF ; mais la **partie curatée reste mockée** (`data/preparations.ts`, 1 seul exemple) | `preparer/page.test.tsx` | Générique (sources France) |
| Dashboard commercial (ADR-018) | **A** | `/dashboard` : Résultats, Rémunération, Projection, Pipeline, Pipeline vendeur, Activité, Délais, Pertes — agrégation 100 % SQL | `dashboardRepository.test.ts`, `dashboardPipelineVendeur.test.ts` | Générique |
| Moteur fiscal (ADR-023/024/025) | **A** | `lib/fiscal/` : 17 modules purs (micro-BNC, TVA franchise, cotisations, CFP, versement libératoire, run-rate, projection pluriannuelle) + référentiel versionné | ~14 fichiers de tests | **France, pas IAD** |
| Historique / journal par entité | **A** | `lib/historiqueBien.ts` (dérivé), `deriverJournalProspectVendeur`, `memoireDossier.ts` | `historiqueBien.test.ts`, `memoireDossier.test.ts` | Générique |
| Recherche + pagination serveur (ADR-048) | **A** | sur `/biens`, `/clients`, `/prospects-vendeurs` (`q`, `page`), ordre déterministe | `*Repository.recherche.test.ts` (3 fichiers) | Générique |
| Sécurisation pilote (ADR-047) | **A** | `src/proxy.ts` private-by-default + `exigerSessionAtlas()` en 2e couche + secrets Bearer sur endpoints machine | `sessionAtlas.test.ts`, `allowlist.test.ts`, `gardeSessionAtlas.structurel.test.ts`, `*.securite.test.ts` | Générique |
| Jeu de démonstration déterministe | **A** | `scripts/seed-demo.mjs`, identité conseiller configurable | `seed-demo.test.ts` | Générique |
| Multi-utilisateur / équipes / managers | **D** | Aucune table, aucune colonne. ADR-047 le déclare explicitement hors périmètre | — | — |
| Connecteurs CRM / réseau / portails | **D** | Aucun code. ADR-005 en parle comme cible, `connectors/` n'existe pas | — | — |
| Import/export CSV, synchronisation Playiad | **D** | Aucune occurrence dans `src/` | — | — |
| Signature électronique / bons de visite | **D** | Aucune intégration. ADR-045/049 mentionnent la signature comme **fait déclaré** par le conseiller, jamais un flux outillé | — | — |
| Notifications (push/email sortant automatique) | **D** | Aucune table, aucun envoi automatique — une automatisation crée une **tâche**, jamais un email | — | — |

---

## 5. IAD Coupling Audit

Recherche exhaustive `iad|playiad|filleul|parrain|généalogie|récurrence|conseiller IAD` sur
`src/`, `schema.ts`, `src/db/migrations/*.sql`, routes, composants, tests, docs, ADR.

| # | Occurrence | Emplacement | Nature | Classement |
|---|---|---|---|---|
| 1 | « Un remplacement de Playiad » (ce que DOMIORA n'est pas) | `docs/DEVELOPER_ONBOARDING.md:46` | Doc, cadrage négatif | **4 — texte isolable** |
| 2 | « conseillers/filleuls/managers de partager temporairement un dossier » | `README.md:338` | Vision produit future, non implémentée | **1 — légitime dans un futur PACK réseau** |
| 3 | « outils des réseaux (Century 21, Orpi, IAD, etc.) » | `docs/adr/005-integrations.md:9` | ADR de cible, IAD cité comme un réseau parmi d'autres | **1 — légitime dans CONNECTORS** |
| 4 | « synchronisation IAD/SeLoger/Leboncoin/Bien'ici » = hors périmètre | `docs/adr/052-photos-bien.md:16` | Exclusion explicite de périmètre | **1 — légitime dans CONNECTORS** |
| 5 | « récurrence — pas un moteur de tâches » | `docs/adr/027-crm-vendeur.md:132` | Mot français générique (relance récurrente), **pas** la récurrence IAD | **4 — faux positif lexical** |
| 6 | « récurrence » dans la liste des non-objectifs | `docs/adr/028-moteur-taches.md:246` | Idem | **4 — faux positif lexical** |
| 7 | « Aucune récurrence : une tâche ne se recrée jamais » | `docs/KNOWN_LIMITATIONS.md:557` | Idem | **4 — faux positif lexical** |

**Occurrences dans `src/` : 0. Dans `schema.ts` : 0. Dans les migrations : 0. Dans les variables
d'environnement : 0. Dans les composants UI : 0. Dans les tests : 0.**

Aucun élément classé **2 (à généraliser dans CORE)** ni **3 (couplage architectural
problématique)** n'a été trouvé.

### Conclusion de l'étape 4

**DOMIORA Core n'est PAS dépendant d'IAD.** Le couplage IAD est **LOW**, et purement documentaire.

**Mais ce n'est pas la bonne question à se poser.** L'audit fait apparaître deux couplages
structurels réels, qui bloquent l'ouverture multi-réseau bien avant qu'un quelconque vocabulaire
IAD ne pose problème :

| Couplage réel | Preuve | Gravité |
|---|---|---|
| **Mono-conseiller / mono-tenant** | Aucun `userId`/`tenantId` sur les 31 tables ; `connexions_google` et `dossier_fiscal` en ligne unique `id='default'` ; `ATLAS_ALLOWED_EMAIL` allowlist à 1 adresse (`lib/auth/allowlist.ts`) ; nom conseiller en variable d'env | **CRITICAL** |
| **Absence de provenance des données** | Aucune colonne `source`/`id_externe`/`synchronise_le` sur aucune table métier ; seule `memoire_contextuelle` porte `(source, identifiant_externe)` et elle ne sert qu'au matching Calendar | **CRITICAL** |

Un troisième couplage, plus léger : **la France est câblée dans le domaine** (code INSEE IGN
obligatoire pour le critère géographique du matching, moteur fiscal micro-BNC, DVF Cerema,
annuaire éducation). Ce n'est pas IAD, mais c'est une frontière géographique implicite, à
assumer explicitement le jour d'une internationalisation.

---

## 6. Core Gap Analysis

| Concept Core cible | Statut | Équivalent actuel | Problèmes de modélisation constatés |
|---|---|---|---|
| **Contact** | **MISSING** | Aucun. Une personne existe soit comme `acquereurs`, soit comme `prospects_vendeurs`, soit nulle part (le vendeur d'un bien créé directement n'existe pas) | Pas d'identité de personne réutilisable. Un même individu vendeur puis acquéreur est deux lignes sans lien. Aucune déduplication possible. `documents_bien` doit porter 3 FK distinctes (`acquereur_id`, `prospect_vendeur_id`, `compromis_id`) faute d'un `contact_id` unique |
| **SellerProject** | **EXISTS** | `prospects_vendeurs` | Le nom trahit le lead ; l'entité porte en réalité tout le projet vendeur jusqu'à la conversion. Après conversion en `biens`, le projet vendeur cesse d'être le porteur du dossier — le vendeur n'est plus qu'un `bien_id` remontant. Un bien créé hors conversion **n'a aucun vendeur** (limite assumée ADR-042) |
| **BuyerProject** | **PARTIAL** | `acquereurs` (+ `secteurs_recherche_acquereur`) | **Personne et projet fusionnés dans une seule ligne.** Un acquéreur ne peut pas avoir deux projets (résidence principale + investissement), ni un projet ré-ouvert après un achat. `stade_projet` est un statut du projet posé sur la personne |
| **Property** | **EXISTS** | `biens` | Modèle solide. Mais le bien porte des faits de trois natures : caractéristiques physiques, conditions de mandat (`statut_mandat`, `date_mandat`, `charge_honoraires`), et jalons commerciaux (`offre_en_cours_le`, `compromis_signe_le`) |
| **Mandate** | **PARTIAL** | 3 colonnes sur `biens` + `mandat_signe_le`/`mandat_propose_le` sur `prospects_vendeurs` + type de document `mandat` | **Pas d'entité.** Impossible de représenter : un mandat exclusif puis simple sur le même bien, une date d'expiration, un renouvellement, un mandat co-détenu, un numéro de mandat réseau. `statut_mandat` ∈ {actif, suspendu, expire} sans date de fin |
| **Visit** | **EXISTS** | `visites` + `comptes_rendus_visite` | Solide, mais **aucune création native** : une visite ne naît que de la matérialisation d'un RDV Calendar (ADR-041). Aucune heure persistée (jour civil seulement). Dette : `taches.visite_id` pointe vers `comptes_rendus_visite`, pas `visites` |
| **Offer** | **EXISTS** | `offres` (+ `offre_visites`) | Solide. Immuabilité + transitions unidirectionnelles + motifs de perte |
| **Interaction** | **PARTIAL** | Fragmentée : `notes_prospect_vendeur` (typée, côté vendeur), `notes_bien` (libre), `comptes_rendus_visite`, `envois_email` (technique) | **Aucune interaction côté acquéreur** : pas de table de notes/appels/emails sur `acquereurs`. Aucune vue unifiée en base — `memoireAcquereur.ts` la reconstruit à la lecture depuis 6 sources. `dernier_contact_le` n'existe que sur le prospect vendeur |
| **Task** | **EXISTS** | `taches` | Solide. 7 FK de cible + CHECK « au plus une ». Pas d'édition, pas de récurrence, pas d'assignation (mono-conseiller) |
| **Document** | **EXISTS** | `documents_bien` (+ `photos_bien`) | Solide et riche. Mais **ancré sur le bien** (`bien_id` NOT NULL) : un document purement acquéreur (CNI, attestation de financement) doit obligatoirement être rattaché à un bien |
| **Matching** | **EXISTS** | `lib/compatibilite/` + `compatibilites_bien_acquereur_etat` + file de resync | Le meilleur module du dépôt : fonction pure, 7 critères, agrégation sans score ni pondération, transitions détectées, idempotence par cycle. Limite assumée : **aucun score, aucun classement** — verdict ternaire uniquement (compatible / à vérifier / incompatible) |

**Score Core : 7 EXISTS / 3 PARTIAL / 1 MISSING → ≈ 70 %.**

Aucun refactor n'est proposé ici : constat uniquement, conformément à la consigne.

---

## 7. Intelligence Gap Analysis

| Brique | Données disponibles | Logique métier | Logique IA | UI | Tests |
|---|---|---|---|---|---|
| **DOMIORA Today** (cockpit) | RDV Calendar (ou mock), tâches, biens, acquéreurs, prospects, compatibilités, comptes rendus | ✅ Composition de 4 sources : tri par `scoreTache` (poids priorité + retard + imminence), `produireAlertes`, `detecterOpportunites`, agenda du jour | ❌ Aucune | ✅ `src/app/page.tsx` (7 sections + 4 StatTiles) | ✅ `page.test.tsx` + tests des moteurs |
| **Priorisation** | `taches.priorite`, `echeance`, `creee_le` | ✅ `tachePriority.ts` : score entier (30/20/10 + 50 retard + 15 imminent), tie-break sur ancienneté | ❌ | ✅ ordre d'affichage, score **jamais montré** au conseiller (choix ADR-039) | ✅ `tachePriority.test.ts` |
| **Recommandations d'action** | prospects, visites, comptes rendus, compatibilités, tâches ouvertes | ✅ 3 règles d'opportunité + déduplication contre les tâches ouvertes ; 4 familles de règles d'alerte (données, commercial, fiscal, projection) | ❌ | ✅ `OpportuniteCard`, `AlerteCard` | ✅ `opportunites/moteur.test.ts` (389 l.), 5 fichiers alertes |
| **Compréhension du contexte** | RDV Calendar, catalogues bien/acquéreur | ✅ `lib/matching/` : correspondance floue titre/lieu → bien + acquéreur + type métier avec confiances ; `memoire_contextuelle` priorise **validation humaine > cache > recalcul** | ❌ (règles textuelles déterministes, ADR-008) | ✅ `ConfirmationBienRdv` | ✅ tests matching |
| **Scoring** | — | ⚠️ **Deux scorings seulement** : priorité de tâche (entier) et confiance de matching (réel 0-1). **Aucun scoring d'acquéreur, de bien, de vendeur, ni de probabilité de vente** | ❌ | ❌ jamais affiché | partiel |
| **Matching intelligent** | biens, acquéreurs, secteurs INSEE | ✅ `evaluerCompatibilite()` pure, 7 critères, agrégation « un incompatible suffit » | ❌ **volontairement** (ADR-008/034 : zéro texte libre lu) | ✅ onglet compatibilité + carte opportunité | ✅ 529 l. + 370 l. + baseline |
| **Détection de situation** | `evenements_metier` (6 types) | ✅ Événements émis dans la **même transaction** que la mutation métier ; scan temporel pour les faits « d'absence » (inactivité) ; transitions de compatibilité par cycle | ❌ | ✅ `/automatisations` (journal + activation) | ✅ `evenementMetierRepository.test.ts`, `scanTemporel.test.ts` |
| **Suivi vendeur** | `prospects_vendeurs` (7 jalons timestamp), `notes_prospect_vendeur`, `dernier_contact_le` | ✅ `prospectVendeurParcours.ts`, `prospectVendeurProchaineEtape.ts`, `deriverStatutProspectVendeur`, règles `inactivite_prospect_vendeur` + `retour_vendeur_apres_visite`, section « Pipeline vendeur » du dashboard | ❌ | ✅ `/prospects-vendeurs` + fiche | ✅ 5 fichiers |
| **Automatisation** | `evenements_metier` + `configurations_automatisation` | ✅ 7 règles, activation explicite (absence de ligne = inactif), idempotence SQL, reprise après crash, journal de scan | ❌ | ✅ `/automatisations` | ✅ `moteur.test.ts`, `reprise.test.ts`, 4 tests de catalogue |
| **Événements métier** | ✅ table dédiée, 6 types, 5 index uniques partiels | ✅ Point fort majeur du dépôt | — | journal visible | ✅ |
| **Règles** | — | ✅ Catalogue TypeScript unique (`catalogueRegles.ts`) + moteurs purs par domaine. **Aucun DSL, aucune règle éditable par l'utilisateur** — seule l'activation et un seuil sont paramétrables | ❌ | ✅ toggles | ✅ |
| **Mémoire relationnelle** | `reperes_relationnels_acquereur` + 6 sources de faits | ✅ `memoireAcquereur.ts` : read model pur, 11 types d'événements, ordre déterministe ; `repriseContactAcquereur.ts` | ❌ | ✅ fiche acquéreur, contexte de communication | ✅ 3 fichiers + test de frontière en base réelle |
| **Historique des interactions** | notes vendeur typées, comptes rendus, envois email, tâches terminées | ⚠️ Reconstruit à la lecture, **pas de table d'interactions**. Rien côté acquéreur en base | ❌ | ✅ journaux dérivés | ✅ |
| **Management intelligent** | **aucune donnée** | ❌ **ABSENT** | ❌ | ❌ | ❌ |

### Réponse directe : qu'est-ce que le cockpit « Aujourd'hui » aujourd'hui ?

**C'est un moteur de règles déterministe multi-sources, pas une simple liste de tâches, et pas
encore un système réellement contextuel.**

- **Ce n'est pas une liste de tâches** : la page compose 4 flux indépendants (agenda live,
  dossiers à action, alertes, opportunités) et deux d'entre eux — opportunités et alertes — sont
  **calculés à la lecture, jamais persistés**, à partir de faits que le conseiller n'a jamais
  saisis comme tâches.
- **C'est bien un moteur de règles** : `produireAlertes()` (4 familles de règles) +
  `detecterOpportunites()` (3 règles avec déduplication contre les tâches ouvertes) +
  `scoreTache()`. Toutes pures, toutes testées, toutes explicables — chaque carte porte son
  `raison` en clair.
- **Ce n'est pas encore contextuel** : aucune notion d'heure de la journée (au-delà du
  « Bonjour/Bonsoir »), aucune adaptation à la charge réelle du conseiller, aucun apprentissage
  de ce qu'il ignore ou traite, aucun regroupement par intention, aucun scoring transversal entre
  les 4 flux — les sections sont juxtaposées, jamais arbitrées entre elles. Le plafond d'alertes
  est une constante (`NB_ALERTES_PRIORITAIRES = 5`).

---

## 8. Connector Audit

| Intégration | Existe | Où | Frontière | Risque |
|---|---|---|---|---|
| **Google Calendar** (lecture seule) | ✅ | `lib/google/agendaSource.ts`, `calendarClient.ts`, `adapter.ts`, `oauth.ts` | **Module dédié + adaptateur `toRendezVous()`** vers un type interne `RendezVous`. Point d'entrée unique `getAgendaSemaine()`, repli honnête (`google_calendar` / `demo` / `demo_erreur`), jamais de mock présenté comme réel en production | **Faible-moyen.** Bonne isolation, mais pas d'interface `SourceAgenda` générique : un second fournisseur (Outlook) exigerait d'introduire l'abstraction. Aucune écriture, aucune synchro bidirectionnelle |
| **Gmail** (envoi) | ✅ | `lib/google/gmailClient.ts`, `mimeEmail.ts`, `actions/envoyerEmailGmail.ts` | Module dédié + table d'audit `envois_email` avec **clé d'idempotence fournie par l'appelant** et 3 états dont `incertain` (rupture réseau après déclenchement) | **Moyen.** Le fournisseur est en dur (`fournisseur` par défaut `'gmail'`), pas d'interface `EnvoyeurEmail`. Le fait CRM est posé **séparément** de l'audit technique, ce qui est le bon découpage |
| **LLM de rédaction** | ✅ | `lib/redaction/contrat.ts`, `orchestration.ts`, `adaptateurCompatibleOpenAI.ts`, `gardeFous.ts`, `prompt.ts` | **⭐ Seule vraie architecture port/adaptateur du dépôt** : interface `RedacteurCommunication`, aucun SDK dans `package.json`, `fetch` brut sur le protocole OpenAI-compatible, configuré par `DOMIORA_REDACTION_BASE_URL` + `DOMIORA_REDACTION_MODELE`, liste blanche de faits garantie par le **type** (`Pick<>`), 8 garde-fous à rejet total | **Faible.** Vendor lock-in explicitement neutralisé (protocole, pas fournisseur). Modèle européen/auto-hébergé = changement de variable d'env |
| **IGN Géoplateforme** (géocodage) | ✅ | `lib/geocodage/ignClient.ts`, `resolutionBien.ts`, `lib/geo/` | **⚠️ Appelé depuis les Server Actions du domaine** : `creerBien.ts`, `modifierBien.ts`, `secteurRecherche.ts`, et depuis la route `/api/geocodage/communes` | **Élevé.** Le `code_insee_commune` est une **dépendance dure du moteur de matching géographique** : sans IGN, le critère secteur n'est pas évaluable. Un fournisseur français est câblé dans le chemin d'écriture métier |
| **PRIM Île-de-France Mobilités** | ✅ | `lib/transports/primClient.ts` (`PRIM_API_KEY`) | **Aucune** — importé directement par le Server Component `visites/[id]/preparer/page.tsx` | **Moyen.** Périmètre IDF uniquement, clé API dédiée |
| **Vélib Smovengo** | ✅ | `lib/transports/velibClient.ts` | Aucune — même page | Faible (donnée d'agrément) |
| **Annuaire de l'éducation (data.education.gouv.fr)** | ✅ | `lib/ecoles/annuaireEducationClient.ts` | Aucune — même page | Faible |
| **Overpass / OpenStreetMap** | ✅ | `lib/commerces/overpassClient.ts` | Aucune — même page | Moyen (service communautaire, pas de SLA) |
| **Mérimée (patrimoine, data.gouv.fr)** | ✅ | `lib/patrimoine/merimeeClient.ts` | Aucune — même page | Faible. **Dette connue** : filtrage département par préfixe de code postal, casse en Corse (2A/2B) |
| **DVF Cerema** (transactions comparables) | ✅ | `lib/marche/dvfClient.ts` | Aucune — même page | **Moyen.** API en **préproduction** (`apidf-preprod.cerema.fr`), aucune garantie de disponibilité annoncée |
| **Stockage documentaire** | ✅ | `lib/stockageDocuments.ts`, `stockagePhotosBien.ts` | Module dédié, chemin reconstruit **uniquement** ici depuis `ATLAS_DOCUMENT_STORAGE_DIR` + clé opaque serveur | **Faible.** Réversibilité prévue par ADR-050/051 : passer en stockage objet ne touche qu'un module |
| **Playiad / CRM tiers / portails / import CSV / signature** | ❌ | — | — | Aucun code |

### Verdict frontières

- **Isolé derrière une interface : 1 intégration sur 12** (rédaction LLM).
- **Isolé dans un module dédié sans interface : 4** (Calendar, Gmail, stockage documents, stockage photos).
- **Directement incorporé au domaine ou à l'UI : 7** (IGN dans les Server Actions ; PRIM, Vélib,
  écoles, Overpass, Mérimée, DVF importés par un Server Component).

**Vendor lock-in réel identifié :**
1. **Google** — identité (OIDC), agenda et envoi d'email reposent tous sur le même fournisseur.
   Perdre Google, c'est perdre l'authentification **et** l'agenda **et** l'email.
2. **IGN** — dépendance dure du matching géographique, dans le chemin d'écriture.
3. **Railway** — hébergement + volume persistant documentaire ; explicitement traité comme
   « pragmatique, jamais structurel » par ADR-051, mais aucune abstraction n'a été construite.
4. **DVF préprod Cerema** — dépendance à un endpoint sans engagement de service.

---

## 9. Competitor Functional Matrix

DOMIORA vs le socle CRM observé chez un autre conseiller IAD.

| Fonction | DOMIORA | Evidence | Strategic Value | Note |
|---|---|---|---|---|
| Contacts | **PARTIAL** | `acquereurs` + `prospects_vendeurs` séparés, pas d'entité contact | **CORE** | Manque structurel n°1 |
| Biens | **YES** | `biens` + fiche complète + photos + documents + statut commercial | **CORE** | Au-dessus du besoin |
| Acquéreurs | **YES** | `acquereurs` + secteurs + critères structurés | **CORE** | Personne/projet à séparer |
| Rapprochements | **YES** | moteur pur 7 critères + transitions + tâche automatique de nouveau match | **DIFFERENTIATOR** | Nettement plus rigoureux qu'un simple filtre |
| Propositions d'achat | **YES** | `offres` immuables + motifs de perte + lien visite→offre | **CORE** | |
| Kanban | **NO** | Aucune vue kanban ; `/dashboard` « Pipeline vendeur » est un tableau de comptages | **OPTIONAL** | Vue, pas capacité. À juger sur l'usage réel, pas sur la parité |
| Audit d'annonce | **PARTIAL** | `pointsForts/moteur.ts` + `pointsAttention/moteur.ts` produisent des points forts/vigilance à partir de champs structurés ; aucune analyse d'annonce publiée | **DIFFERENTIATOR** | La brique existe, l'objet « annonce » n'existe pas |
| Filleuls | **NO** | Aucune donnée | **CONNECTOR** (pack IAD) | Donnée détenue par le réseau, jamais saisie manuellement |
| Réseau | **NO** | Aucune donnée | **CONNECTOR** | Idem |
| Classement | **NO** | Aucune donnée | **SHOULD NOT COPY** | Classement inter-conseillers = donnée réseau, contraire au positionnement « pilote d'activité » |
| Récurrence (revenus) | **NO** | Aucune donnée. `remuneration` ne modélise que l'honoraire d'une transaction | **CONNECTOR** (pack IAD) | Modèle de rémunération propre à un réseau |
| Objectifs | **NO** | Aucune table `objectifs`, aucun champ cible | **CORE** | Manque réel : le dashboard mesure sans référentiel de cible |
| KPI | **YES** | `/dashboard` : Résultats, Rémunération, Projection, Pipeline, Pipeline vendeur, Activité, Délais, Pertes — agrégation 100 % SQL | **CORE** | Plus complet que la moyenne |
| Simulateur production | **PARTIAL** | `lib/fiscal/runRate.ts` + `projectionAnnuelle.ts` + `projectionFinAnnee.ts` projettent le réalisé ; aucun simulateur d'hypothèses saisies | **OPTIONAL** | La projection existe, la simulation « et si » non |
| Simulateur développement | **NO** | — | **SHOULD NOT COPY** | Outil de recrutement de réseau, hors positionnement DOMIORA |
| Simulateur récurrence | **NO** | — | **SHOULD NOT COPY** | Idem |
| Simulateur travaux | **NO** | — | **OPTIONAL** | Utile à l'estimation, sans lien avec le pilotage |
| Modèles (templates) | **PARTIAL** | `genererBrouillonEmail.ts` génère un brouillon déterministe par intention + reformulation assistée ; **aucun modèle éditable par l'utilisateur** | **DIFFERENTIATOR** | Approche supérieure : le contenu naît des faits, pas d'un modèle figé |
| Documents | **YES** | 30 types fermés, checklist dérivée, pack notaire ZIP, traçabilité des transmissions, correction de classement | **CORE** | Point fort majeur |
| Import / synchronisation Playiad | **NO** | Aucun code | **CONNECTOR** | Le vrai chantier d'ouverture |
| Récap quotidien | **YES** | Cockpit « Aujourd'hui » (ADR-039) | **DIFFERENTIATOR** | Le cœur du produit |
| Bons de visite / signature | **NO** | Aucune intégration ; la signature n'est qu'un fait déclaré | **CONNECTOR** | Terrain : friction réelle chez le conseiller |
| Partage réseau | **NO** | Aucun code ; évoqué au `README.md:338` | **CONNECTOR** | Suppose le multi-utilisateur |

**Lecture stratégique :** sur 22 fonctions observées, DOMIORA en couvre 7 en YES et 4 en PARTIAL.
Les 11 NO se répartissent en **5 CONNECTOR** (données que le réseau détient — jamais à ressaisir),
**3 SHOULD NOT COPY** (outils de réseau, hors positionnement), **2 OPTIONAL** et **1 CORE**
(objectifs). Autrement dit : **l'écart fonctionnel avec le CRM concurrent n'est presque jamais un
écart de Core** — c'est un écart de connecteur.

---

## 10. Top Architectural Risks

| # | Risque | Sévérité | Preuve dans le dépôt |
|---|---|---|---|
| 1 | **Aucun modèle de provenance des données.** Aucune entité métier ne sait d'où elle vient ni quand elle a été synchronisée. Un connecteur ne peut ni écrire, ni détecter un conflit, ni protéger un champ édité localement | **CRITICAL** | Aucune colonne `source`/`id_externe`/`synchronise_le` dans `schema.ts` sur les 31 tables. Seule exception : `memoire_contextuelle(source, identifiant_externe)`, dédiée au matching Calendar, avec `bien_id`/`client_id` en **texte sans FK** |
| 2 | **Mono-tenant structurel.** Aucune notion d'utilisateur en base ; l'appartenance d'une ligne est implicite | **CRITICAL** | Aucun `userId`/`tenantId` ; `connexions_google` et `dossier_fiscal` en ligne unique `id='default'` ; `lib/auth/allowlist.ts` (une seule adresse) ; `ATLAS_ADVISOR_DISPLAY_NAME` ; ADR-047 §« hors périmètre » ; `KNOWN_LIMITATIONS.md#pas-de-multi-utilisateur` |
| 3 | **Pas d'entité Contact : identité de personne éclatée.** Un individu n'a pas d'existence propre ; vendeur et acquéreur sont deux mondes sans pont | **HIGH** | `documents_bien` porte 3 FK de rattachement personne/dossier faute d'un `contact_id` ; `prospects_vendeurs` et `acquereurs` dupliquent nom/prénom/email/téléphone sans lien ; aucune déduplication |
| 4 | **Intégrations appelées depuis l'UI et depuis les Server Actions.** Pas de couche connecteur | **HIGH** | `src/app/visites/[id]/preparer/page.tsx` importe 8 clients HTTP externes (lignes 27-36) ; `actions/creerBien.ts:22` et `modifierBien.ts` appellent `resoudreCommuneBien()` (IGN) dans le chemin d'écriture. Aucun dossier `connectors/`, aucune interface `Connector` — écart explicitement constaté par `docs/ARCHITECTURE.md` face à ADR-005 |
| 5 | **Pas d'entité Mandat.** Le mandat est réduit à 3 colonnes sur `biens` | **HIGH** | `biens.statut_mandat` ∈ {actif, suspendu, expire} sans date de fin ; `biens.date_mandat` unique ; `prospects_vendeurs.mandat_signe_le`. Impossible de représenter exclusivité, renouvellement, expiration, numéro réseau — or c'est **exactement** l'objet qu'un connecteur réseau synchronise en premier |
| 6 | **Interactions fragmentées et absentes côté acquéreur.** L'historique relationnel est reconstruit à chaque lecture depuis 6 sources | **HIGH** | `lib/relations/memoireAcquereur.ts` (read model pur) ; aucune table de notes/appels sur `acquereurs` ; `dernier_contact_le` n'existe que sur `prospects_vendeurs`. Une mémoire relationnelle sérieuse ne peut pas se construire sur une trace qui n'existe pas |
| 7 | **Aucune CI.** 1 682 cas de tests et 32 migrations sans exécution automatisée | **HIGH** | Pas de `.github/`, aucun pipeline dans le dépôt. `KNOWN_LIMITATIONS.md` le note et laisse la question ouverte. Les tests d'intégration exigent un Postgres local migré — donc rien ne garantit qu'ils tournent avant un déploiement |
| 8 | **Traitement asynchrone simulé par des endpoints HTTP à secret.** Pas de worker, pas de queue | **MEDIUM** | 4 routes machine (`/api/automatisations/scan`, `/reprise`, `/api/compatibilite/scan`, `/baseline`) avec secrets Bearer dédiés, exclues du proxy. Le déclencheur cron est **hors dépôt** — sa configuration réelle est `UNKNOWN`. Le fonctionnement des relances temporelles dépend d'un ordonnanceur invérifiable ici |
| 9 | **`taches.visite_id` référence `comptes_rendus_visite`, pas `visites`.** Dette de nommage devenue dette de modèle | **MEDIUM** | `schema.ts` : `visiteId: uuid("visite_id").references(() => comptesRendusVisite.id)`. `KNOWN_LIMITATIONS.md#cycle-de-vie-dune-visite` confirme que `deriverRouteFicheCible()` n'a jamais été étendue — ces tâches n'ont aucun lien « Voir la fiche » |
| 10 | **Documentation d'état désynchronisée du code.** Un lecteur (humain ou agent) peut conclure faux | **MEDIUM** | `KNOWN_LIMITATIONS.md#pas-de-llm` affirme « aucune dépendance LLM, recherche exhaustive » alors que `lib/redaction/adaptateurCompatibleOpenAI.ts` appelle un modèle depuis le commit `c7f70d6`. `docs/ARCHITECTURE.md` est daté du 2026-08-11, soit ~40 commits en arrière |
| 11 | **Bascule mock ↔ réel toujours active en production.** Le comportement du produit dépend de la présence de lignes en base | **MEDIUM** | `bienRepository.ts`, `clientRepository.ts`, `tacheRepository.ts`, `agendaSource.ts` importent `@/data/*`. Le garde-fou existe (`estProduction()` neutralise le repli agenda) et la règle « jamais de fusion » est testée (`*.demoProduction.test.ts`), mais du code de démonstration reste dans le chemin de production |
| 12 | **France câblée dans le domaine.** Pas un risque immédiat, un plafond futur | **LOW** | `code_insee_commune` (IGN) obligatoire pour le critère secteur du matching ; `lib/fiscal/` entièrement micro-BNC/TVA France ; DVF, Mérimée, annuaire éducation, PRIM (IDF seulement) |

**Non trouvés — risques cherchés et écartés :** abstractions prématurées (aucune : chaque ADR
justifie explicitement le refus d'abstraire avant besoin) ; logique métier dans l'UI (les moteurs
sont purs et testés hors React — la seule fuite est l'appel d'API externes depuis une page) ;
dépendances circulaires (règle « seuls les `*Repository.ts` importent `@/db/*` », vérifiée) ;
dette de migrations (32 migrations linéaires, `meta/` cohérent, aucune migration destructive
observée).

---

## 11. Assets To Preserve

Briques à **ne pas réécrire**. Chacune est générique, testée, et déjà alignée avec le
positionnement cible.

1. **Le moteur de compatibilité** (`src/lib/compatibilite/`). Fonction pure, zéro I/O, zéro
   `Date.now()`, 7 critères indépendants, agrégation sans score. C'est déjà le CORE/Matching de
   l'architecture cible. 529 lignes de tests. **Ne pas y ajouter de pondération sans décision
   produit explicite** — l'absence de score est un choix, documenté ADR-034.

2. **L'architecture d'événements métier + automatisations** (`evenements_metier`,
   `executions_automatisation`, `configurations_automatisation`, `lib/automatisations/`).
   Émission dans la transaction métier, idempotence par contrainte SQL, activation explicite
   (absence = inactif), reprise après crash, journal de scan. C'est le socle exact dont la couche
   AUTOMATIONS cible a besoin, et il est déjà multi-règles.

3. **La file de resynchronisation transactionnelle** (`compatibilites_a_resynchroniser` +
   `traitementResynchronisation.ts`). Le patron « insérer la demande dans la même transaction que
   la mutation, traiter en synchrone juste après, balayage de rattrapage en filet » est
   réutilisable tel quel pour la synchronisation d'un connecteur externe.

4. **Le port/adaptateur de rédaction** (`lib/redaction/`). Interface `RedacteurCommunication`,
   aucun SDK, protocole plutôt que fournisseur, liste blanche de faits **garantie par le type**,
   8 garde-fous à rejet total, repli sur le brouillon déterministe. C'est le modèle exact à
   répliquer pour tous les futurs connecteurs.

5. **La séparation repository / Server Action / Server Component** (ADR-007). Règle simple,
   respectée dans tout le dépôt : seuls les `*Repository.ts` importent `@/db/*`. Elle donne déjà
   une frontière CORE nette.

6. **Le modèle documentaire** (`documents_bien`, `photos_bien`, `lib/documents/`). 30 types
   fermés, checklist **dérivée jamais stockée**, correction de classement sans ré-upload,
   pack notaire avec snapshot JSONB immuable, traçabilité des transmissions. Rare et solide.

7. **Les invariants de sécurité ADR-047.** `src/proxy.ts` private-by-default + `exigerSessionAtlas()`
   en seconde couche dans chaque Server Action, avec un test **structurel**
   (`gardeSessionAtlas.structurel.test.ts`) qui verrouille la règle pour toute action future.
   Le multi-utilisateur devra s'y greffer, jamais le contourner.

8. **Les tests de frontière** (`reperesRelationnels.frontiere.test.ts`,
   `reperesCommunication.frontiere.test.tsx`). Ils verrouillent en base réelle des décisions
   produit négatives (« cette donnée ne doit sortir nulle part »). Ce patron protège exactement
   les invariants qu'un refactor casse en silence.

9. **Les jalons timestamp plutôt que statuts stockés** (ADR-012/014/028 : `archive_le`,
   `offre_en_cours_le`, `compromis_signe_le`, `terminee_le`/`annulee_le`, statut **dérivé**).
   Source de vérité unique, aucun état divergent possible. À conserver dans toute évolution.

10. **La discipline documentaire du code lui-même.** `schema.ts` explique le *pourquoi* de chaque
    colonne et de chaque contrainte, avec la décision négative associée. C'est ce qui a rendu cet
    audit possible en lecture seule — c'est un actif, pas du bruit.

---

## 12. Recommended Next Architectural Decision

Trois décisions, à prendre **avant** toute reprise du développement. Pas une roadmap.

### Décision 1 — Poser le modèle de provenance et d'identité externe (ADR à écrire)

**La question à trancher :** quand une donnée entre dans DOMIORA autrement que par la saisie du
conseiller, qu'est-ce qui est vrai ?

Concrètement, la décision porte sur : (a) où vit l'identité externe — colonnes sur chaque entité,
ou table de mapping unique sur le patron déjà éprouvé de `memoire_contextuelle(source,
identifiant_externe)` ; (b) qui gagne en cas de conflit entre une valeur importée et une valeur
éditée localement ; (c) si une entité importée peut être modifiée dans DOMIORA.

**Pourquoi maintenant :** c'est le seul verrou qui rend l'architecture CONNECTORS cible
*possible*. Tant qu'il n'est pas posé, le premier connecteur écrit inventera sa propre convention,
et les suivants la dupliqueront. À l'inverse, une fois posé, il est **additif** : aucune des 31
tables n'a besoin d'être refondue, et les moteurs purs ne sont pas touchés.

**Précédent interne à réutiliser :** `memoire_contextuelle` fait déjà exactement cela pour Google
Calendar, avec priorité **validation humaine > cache > recalcul** (ADR-006). La décision consiste
largement à généraliser ce principe déjà accepté.

### Décision 2 — Trancher Contact / Personne vs Projet (ADR à écrire)

**La question à trancher :** DOMIORA modélise-t-il des **personnes** qui portent des **projets**,
ou continue-t-il à modéliser des projets qui embarquent une identité ?

Aujourd'hui `acquereurs` est les deux à la fois, `prospects_vendeurs` est les deux à la fois, et
la même personne des deux côtés est deux lignes sans lien. Un connecteur CRM tiers livrera
toujours des contacts d'un côté et des projets de l'autre : sans cette décision, le mapping sera
arbitraire et irréversible.

**Pourquoi avant de coder :** c'est la seule décision de cette liste qui **ne peut pas** être
prise de façon additive plus tard. Chaque nouvelle fonctionnalité écrite sur `acquereurs` (mémoire
relationnelle, communications, matching) augmente le coût de la séparation. C'est le point de
non-retour le plus proche.

**Note d'audit :** la décision naturellement liée — faut-il une entité `Mandat` et une table
`Interaction` unifiée ? — devrait être instruite **dans la même ADR**, parce qu'elle dépend de la
même réponse : si une personne devient une entité de premier rang, l'interaction et le mandat
trouvent naturellement leur porteur.

### Décision 3 — Décider si le pilote reste mono-conseiller, et jusqu'à quand

**La question à trancher :** le multi-utilisateur est-il un chantier *à venir* ou un chantier
*jamais* ? Les deux réponses sont défendables ; ce qui ne l'est pas, c'est de continuer sans
choisir.

Si la réponse est « à venir », alors **toute nouvelle table créée d'ici là doit porter la colonne
d'appartenance dès sa création**, même inutilisée — le coût est nul aujourd'hui et se compte en
migrations de données plus tard. Si la réponse est « jamais » (une instance par conseiller,
isolation par déploiement), alors cela doit être écrit noir sur blanc, parce que cela invalide
d'emblée « partage réseau », « intelligence manager » et « classement » du benchmark, et cela
simplifie radicalement la Décision 1.

**Ce qui existe déjà pour vous aider :** ADR-047 a construit une authentification propre et un
test structurel qui verrouille `exigerSessionAtlas()` dans chaque Server Action. Le point
d'accroche existe ; ce qui manque est la décision, pas le code.

**Ce qu'il ne faut PAS décider maintenant :** quel réseau connecter en premier, quelle vue Kanban
ajouter, s'il faut un scoring IA. Ces questions n'ont de réponse stable qu'après les trois
décisions ci-dessus.

---

## 13. Unknowns

Liste explicite de ce qui n'a **pas** pu être vérifié dans ce dépôt.

1. **Statut d'exécution de la suite de tests.** `pnpm test` n'a pas été lancé (il exige un
   PostgreSQL local migré et écrit en base — interdit par la consigne d'audit). Le nombre de
   fichiers et de cas est mesuré ; le taux de réussite est `UNKNOWN`.
2. **Existence d'une CI hors dépôt.** Aucun `.github/` ni fichier de pipeline. Une CI hébergée
   ailleurs (GitHub Actions configurée côté organisation, Railway checks) est possible mais
   invérifiable ici. `KNOWN_LIMITATIONS.md` pose déjà la question sans y répondre.
3. **Configuration réelle du cron.** Les 4 endpoints machine attendent un déclencheur externe.
   `ops/railway/functions` existe mais son contenu n'a pas été inspecté en détail ; la planification
   effective (fréquence, secret réellement configuré) est `UNKNOWN`.
4. **État de la base de production.** Aucune connexion n'a été ouverte. Le schéma décrit est celui
   de `schema.ts` + migrations ; sa conformité avec la base Railway réelle est `UNKNOWN`.
5. **Contenu de `backups/railway/`.** Répertoire non lisible (permission refusée). Nature et
   fraîcheur des sauvegardes `UNKNOWN`.
6. **Le CRM concurrent (étape 8).** Aucun accès direct : la matrice repose **exclusivement** sur la
   liste de fonctions fournie dans la mission. Le périmètre réel de chaque fonction chez le
   concurrent est `UNKNOWN` — la colonne DOMIORA est vérifiée, la colonne concurrent ne l'est pas.
7. **Validation de bout en bout du flux OAuth.** ADR-047 indique que le flux `/connexion` → Google
   → callback n'a jamais été testé avec de vraies credentials. Aucun élément du dépôt ne permet de
   dire si cela a été fait depuis.
8. **Le fournisseur LLM effectivement configuré.** `DOMIORA_REDACTION_BASE_URL` et
   `DOMIORA_REDACTION_MODELE` ne sont renseignés nulle part dans le dépôt. Le modèle réellement
   utilisé en production (ou l'absence totale de configuration, qui désactive proprement la
   fonctionnalité) est `UNKNOWN`.
9. **Volumétrie et performances réelles.** Aucun test de charge, aucune métrique dans le dépôt.
   L'objectif « 10 000+ utilisateurs » d'ADR-051 est explicitement un objectif d'architecture,
   jamais une mesure — cet audit ne peut ni le confirmer ni l'infirmer.
10. **Le pilote a-t-il eu lieu ?** Le dépôt décrit un « pilote mono-conseiller » comme priorité
    (ADR-047/051, `docs/PILOT_RUNBOOK.md`) et contient un jeu de démonstration déterministe. Si le
    pilote a réellement tourné avec un conseiller, et ce qu'il a produit comme retour terrain,
    n'est pas déductible du code.
11. **Contenu détaillé de `brand/DESIGN-SYSTEM-V1.md`.** Existence et migration des composants
    vérifiées ; la conformité complète de chaque composant au document ne l'a pas été.
12. **Contenu détaillé des ADR 001-033 et 044-046.** Lus par leur titre, leur trace dans le code et
    leur section correspondante de `KNOWN_LIMITATIONS.md`. Seules les ADR 005, 047, 051, 052, 053
    ont été lues intégralement.

---

*Rapport produit en lecture seule le 2026-09-08 sur `develop` @ `886aeff`. Aucun fichier du dépôt
n'a été modifié, aucune migration exécutée, aucune base touchée, aucun commit créé.*
