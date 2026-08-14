# Handoff pour agent IA — Atlas (`apps/web`)

Document d'orientation pour Claude, ChatGPT ou tout futur agent de développement reprenant ce
projet. **Il ne remplace jamais le code comme source de vérité** — en cas de doute ou de
divergence apparente entre ce document et le code, le code a toujours raison ; corrige ce
document plutôt que de lui faire confiance aveuglément. Aucun secret n'est présent ici (ni dans
aucun fichier de `docs/`) — les noms de variables d'environnement sont cités, jamais leurs
valeurs.

## État actuel du projet

Produit mono-conseiller en construction active, 100% TypeScript/Next.js (`apps/web`), PostgreSQL
via Drizzle. Fonctionnalités réelles (persistées, testées) au 2026-08-14 : biens, acquéreurs,
prospects vendeurs, tâches (ADR-028, remplace l'ancienne table `actions`), notes de bien, comptes
rendus de visite, mémoire de matching Google Calendar, historique dérivé du bien, moteur
d'automatisations événement → tâche (ADR-032), moteur temporel/relances programmées (ADR-033) et
moteur canonique de compatibilité Bien ↔ Acquéreur (ADR-034, `src/lib/compatibilite/`).
Détail complet : `docs/ARCHITECTURE.md`, chronologie : `docs/CHANGELOG_V1.md`.

## Ne pas supposer

Ce qui **n'existe pas** dans le code aujourd'hui, malgré des ADR ou des commentaires qui les
évoquent comme cible future — ne jamais les traiter comme déjà construits :

- **Aucune API Python/FastAPI** (`apps/api/`) — annoncée par ADR-003, non construite.
- **Aucun worker** (`apps/worker/`), **aucun connecteur isolé** (`apps/worker/connectors/`) —
  annoncé par ADR-005. Le seul connecteur existant (Google Calendar) vit directement dans
  `apps/web/src/lib/google/`.
- **Aucun LLM, aucune génération de texte automatique** — annoncé par ADR-004 comme cible
  progressive. Vérifié par recherche exhaustive dans le code : zéro dépendance, zéro appel réseau
  vers un service de génération. Tous les moteurs (points d'attention, points forts, historique,
  sélection Mérimée) sont des règles déterministes sur champs structurés (ADR-008).
- **Aucun multi-utilisateur, aucune session, aucune authentification conseiller** — produit
  mono-conseiller assumé (ADR-006). `connexions_google` est une table à une seule ligne
  (`id = 'default'`). Le nom affiché dans `Sidebar.tsx` est codé en dur.
- **Jamais de mélange mocks/données réelles** — chaque catalogue (biens, acquéreurs, tâches)
  bascule intégralement sur Postgres dès qu'une ligne réelle existe pour lui ; ne jamais écrire de
  code qui suppose qu'un mock et une donnée réelle puissent coexister dans une même liste
  retournée à l'UI. Détail : `docs/DEMO_VS_REAL.md`.
- **Aucune édition ni suppression** pour notes, comptes rendus de visite, biens, acquéreurs —
  append-only ou création seule. Ne pas supposer qu'un formulaire d'édition existe déjà quelque
  part avant de vérifier.
- **`packages/`** (packages partagés du monorepo, annoncés par ADR-001) — n'existe pas, aucun code
  n'y vit.
- **Calcul fiscal limité au même périmètre de régime que ADR-024, étendu à N+1→N+5 par ADR-025** —
  `src/lib/fiscal/*` calcule cotisations/CFP/versement libératoire/plafond micro-BNC/franchise TVA
  pour l'année courante (ADR-024) et pour l'horizon N+1 à N+5 (ADR-025), mais uniquement pour
  `regimeFiscal = 'micro_bnc'` (jamais déclaration contrôlée), `affiliationRetraite =
  'ssi_regime_general'` pour les cotisations (jamais Cipav), et `regimeTva = 'franchise'` pour la
  TVA. Aucune période ACRE n'est calculée (barème absent du référentiel, ADR-023). La projection
  ADR-025 sépare toujours pipeline daté et tendance statistique (jamais additionnés) et ne persiste
  jamais les hypothèses utilisateur. Aucune TVA collectée/déductible, aucune déclaration automatique.
  Ne jamais supposer qu'un de ces calculs couvre un profil hors de ce périmètre sans vérifier
  `ResultatFiscal.statut`/`ResultatFiscalProjete.statut`.
- **Aucune persistance ni notification pour les alertes du copilote (ADR-026)** — `src/lib/alertes/*`
  dérive tout à la lecture depuis les résultats déjà exposés par ADR-022→025, recalculé à chaque
  chargement de `/`. Aucune table `alerte`, aucun cron, aucun push/email, aucune route `/alertes`
  dédiée (la section vit en tête de `/`). Aucune alerte de proximité de seuil (uniquement des faits
  déjà dépassés/constatés/projetés), aucune recommandation d'optimisation fiscale.
- **CRM vendeur (ADR-027) limité à une opportunité par bien, avec un seul contact** —
  `prospects_vendeurs` ne modélise ni personne physique/personne morale distincte de l'opportunité,
  ni indivision, ni propriétaire multi-biens (`bienId` porte une contrainte `UNIQUE`). Aucune
  automatisation (relance, e-mail, campagne), aucune intégration Google Calendar pour le rendez-vous
  d'estimation. Ne jamais supposer qu'un prospect vendeur peut être créé avec un statut choisi
  directement : il est toujours dérivé (`deriverStatutProspectVendeur`) d'une cascade de jalons
  datés, jamais stocké.
- **Moteur de tâches (ADR-028) sans automatisation ni idempotence** — `taches` remplace l'ancienne
  table `actions` : sept FK dédiées nullables (`bienId`/`acquereurId`/`prospectVendeurId`/
  `visiteId`/`offreId`/`compromisId`/`remunerationId`), au plus une renseignée (`CHECK` en base),
  jamais un couple `objetType`/`objetId` polymorphe. `origine`/`origineCode` préparent une future
  génération automatique de tâches (aucune règle actuelle n'en crée) — ne jamais supposer qu'un
  mécanisme de déduplication/idempotence existe déjà pour cette future automatisation, il n'est pas
  construit. `StatutTache` inclut `'en_attente'`, **réservé et jamais dérivé** aujourd'hui — ne pas
  le confondre avec l'absence d'échéance ("Sans échéance" en UI). Terminer une tâche liée à un
  prospect vendeur n'enregistre une vraie interaction (ADR-027) que si le conseiller coche
  explicitement la case prévue — jamais automatique, jamais pour les autres cibles.
- **Automatisations (ADR-032/033) limitées à 5 règles fixes, une seule action possible** —
  `creer_tache` uniquement ; `envoyer_email`, `envoyer_sms`, `transmettre_pack_notaire`,
  `modifier_offre`, `modifier_compromis`, `archiver`, `supprimer` ne sont câblables par aucune règle
  actuelle. Aucune règle fondée sur un constat de checklist documentaire (ADR-029), aucun retry
  automatique d'une exécution `echouee`/`a_traiter`. Les 5 règles démarrent **inactives** au seed —
  ne jamais supposer qu'une règle listée dans le catalogue est effectivement active sans vérifier
  `configurations_automatisation`. Une seule règle temporelle existe (`inactivite_prospect_vendeur`,
  ADR-033, seuil configurable en jours) — **aucun scheduler interne à Atlas** ne la déclenche : sans
  un cron externe appelant `POST /api/automatisations/scan`, elle ne s'exécute jamais spontanément.
  Relance acquéreur, relance sur offre restent des candidates non construites.
- **Compatibilité Bien ↔ Acquéreur (ADR-034) sans géographie, sans préférences pondérées, sans
  persistance** — `src/lib/compatibilite/` est un moteur canonique déterministe distinct de
  `src/lib/matching/` (jamais le même module : `matching/` résout un rendez-vous Calendar par
  correspondance floue, `compatibilite/` compare un bien et un acquéreur déjà identifiés sur des
  champs strictement structurés). `budgetMin` n'a aucune sémantique dans ce moteur — ne jamais
  supposer qu'un bien moins cher que `budgetMin` est signalé. Aucune comparaison géographique
  (aucun champ structuré de secteur recherché n'existe). Aucun score, aucune pondération, aucune
  automatisation déclenchée (ADR-032/033 non intégrées), aucun résultat persisté — recalculé à
  chaque affichage. Ne jamais supposer qu'un critère `a_verifier` signifie une incompatibilité.

## Conventions impératives

1. **`NULL` ≠ `false`** (ADR-009) — un booléen optionnel absent est `undefined`, jamais `false`
   par défaut. Toute nouvelle colonne nullable de ce type suit ce patron.
2. **Repositories = seule frontière IO** (ADR-007) — jamais de requête Drizzle en dehors de
   `src/lib/*Repository.ts` / `contexteRepository.ts`. Jamais de validation de règle métier dans
   un repository (elle vit dans la Server Action appelante).
3. **Données structurées uniquement, jamais d'analyse de texte libre** (ADR-008) — le contenu
   d'une note ou d'un compte rendu (`retour`) n'est jamais lu par un moteur de règles, jamais
   résumé, jamais interprété. S'il faut une information structurée, ajouter un champ structuré
   (comme `interet` sur les comptes rendus), pas une analyse de texte.
4. **Server Components par défaut** (ADR-007) — `"use client"` seulement si un état d'interaction
   est réellement nécessaire. Préférer un `<form action={serverAction}>` HTML natif à du fetch
   client.
5. **`text` sans FK vs `uuid` avec FK réelle** (ADR-010) — dépend uniquement de la question "ce
   champ peut-il pointer vers une entité encore mockée ?". Voir l'ADR avant d'ajouter une colonne
   de référence.
6. **Le SQL des migrations fait foi**, pas la définition Drizzle (ADR-006) — en cas de doute sur
   le schéma réel, lire `src/db/migrations/*.sql`, pas seulement `schema.ts`.
7. **Français partout** dans le code (noms de variables, fonctions, commentaires, messages UI) —
   convention déjà en place dans tout `src/`, à respecter pour rester cohérent.

## Architecture à respecter

Voir `docs/ARCHITECTURE.md` pour le détail complet. Résumé du flux : formulaire (Server Component)
→ Server Action (`src/actions/*.ts`, validation légère) → Repository (`src/lib/*Repository.ts`,
IO Postgres) → `redirect()` → page re-render.

## Fichiers importants

| Fichier | Rôle |
|---|---|
| `src/db/schema.ts` | Schéma Drizzle — voir `docs/DATA_MODEL.md` pour le détail table par table |
| `src/lib/matching/index.ts` | Point d'entrée du moteur de matching rendez-vous → bien/acquéreur |
| `src/lib/contexteRepository.ts` | Mémoire persistée du matching (validation humaine > cache > moteur) |
| `src/lib/google/agendaSource.ts` | `getAgendaSemaine()` — bascule Google Calendar / mocks |
| `src/lib/tachePriority.ts` | Moteur de priorité des tâches, réutilisé partout |
| `src/lib/compatibilite/evaluerCompatibilite.ts` | Moteur canonique de compatibilité Bien ↔ Acquéreur (ADR-034) — distinct de `matching/` |
| `src/lib/memoireDossier.ts` | Sélection des éléments affichés dans la Mémoire du dossier |
| `src/app/visites/[id]/preparer/page.tsx` | Page la plus riche de l'app — préparation + compte rendu |
| `apps/web/.env.local.example` | Liste exhaustive et à jour des variables d'environnement nécessaires |

## Pièges connus

- **`docs/` vit à la racine du monorepo**, pas sous `apps/web/` — un agent scopé à `apps/web/`
  peut conclure à tort qu'aucune documentation/ADR n'existe.
- Un id mocké (`"bien-001"`) passé à une requête Postgres filtrée par `uuid` provoque une erreur
  de cast si la garde `UUID_REGEX` n'est pas appliquée avant — toujours vérifier ce garde-fou en
  ajoutant une nouvelle fonction de repository acceptant un id externe.
- L'onglet "Visites → Effectuées" de la fiche bien **ne lit pas** `comptes_rendus_visite` malgré
  leur proximité conceptuelle — c'est une limite connue, pas une intégration existante (voir
  `docs/KNOWN_LIMITATIONS.md`).
- `PrepObjections.tsx` et plusieurs champs de `PreparationVisite` sont du code mort — ne pas
  supposer qu'ils sont câblés avant de vérifier avec `grep`.
- Les tests de repository (`*Repository.test.ts`) sont des tests d'intégration qui exigent un
  Postgres local démarré et migré — ils échoueront, pas seulement seront lents, sans base
  disponible.

## Décisions déjà prises — ne pas rouvrir sans nouvelle ADR

Voir `docs/adr/` (001 à 011). En particulier : mono-conseiller (006), repositories/Server
Components (007), pas de LLM pour les règles déterministes (008), `NULL ≠ false` (009),
`text`/FK selon le contexte (010), append-only pour notes/comptes rendus (011).

## Ce qu'il ne faut pas réintroduire

- Un cookie navigateur pour un secret Google (abandonné au profit du chiffrement en base, ADR-006).
- Une case à cocher HTML brute pour un booléen optionnel métier (toujours un sélecteur à 3 états —
  voir ADR-009).
- Une table générique "événements" polymorphe pour unifier notes/tâches/comptes rendus, ou un
  couple `objetType`/`objetId` sans FK pour `taches` — écarté explicitement à plusieurs reprises
  (ADR-006, ADR-011, ADR-028) au profit d'une table dédiée par concept / de FK nullables dédiées.
- Un résumé ou une extraction automatique depuis un champ de texte libre, même "juste pour
  l'affichage" (ADR-008).
- Un score numérique ou une pondération pour la compatibilité Bien ↔ Acquéreur, ou une fusion de
  `src/lib/matching/` et `src/lib/compatibilite/` en un seul module — ce sont deux moteurs distincts
  à des fins différentes (résolution floue de rendez-vous vs compatibilité commerciale déterministe
  sur champs structurés), écarté explicitement (ADR-034).
- De l'OCR, un LLM, ou un rattachement automatique/probabiliste sur les documents — ADR-029
  prépare le vocabulaire (rattachement `propose`/`confirme`/`rejete`) mais n'implémente rien de
  tel ; toute correction de classement reste un geste manuel explicite.
- Une durée légale de validité de diagnostic codée "de mémoire" — `documentsBien.dateFinValidite`
  reste purement déclarative tant qu'aucune source officielle n'a été auditée (ADR-029).
- Confondre `documentsBien.etatVerification` (jugement sur le classement d'UN document) avec
  l'état de contrôle d'une exigence de checklist (`present`/`manquant`/... dérivé, jamais stocké)
  — deux vocabulaires distincts, voir ADR-029.
- Une entité `dossier_vente` ou `copropriete` "pour donner un nom à l'UI" sans besoin
  d'intégrité/mutualisation réel — le dossier reste une vue composée dérivée de `bien` +
  `compromis` + parties liées (ADR-029, point 3).
- Une table `pack_notaire` ou toute persistance de sélection/export documentaire — le pack reste
  entièrement dérivé à la demande, y compris la sélection manuelle d'export (éphémère, jamais
  écrite en base — ADR-030).
- Une exigence de checklist `manquant` traitée comme `bloquant_technique` — la checklist ADR-029
  n'est pas juridiquement exhaustive, seule une contradiction structurelle FACTUELLEMENT démontrée
  (mauvais rattachement, classement `rejete`, fichier illisible) justifie un blocage technique
  (ADR-030).
- Une dépendance ZIP/PDF ajoutée sans vérifier au préalable l'absence de binding natif et la
  compatibilité avec le runtime Node.js par défaut des Route Handlers — voir l'audit `jszip`
  (ADR-030) comme référence de la démarche attendue.
- Un `console.log` présenté comme une piste d'audit — ce n'est pas une traçabilité, une vraie
  journalisation reste une évolution future explicite (ADR-030).
- Un destinataire d'email deviné depuis `titre`/`contexte` d'une tâche ou depuis un type de
  document — la résolution suit uniquement des FK/relations métier réelles, jamais un texte libre
  ni une correspondance type → personne codée en dur (ADR-031).
- Une interaction (`notesProspectVendeur`/`dernierContactLe`) marquée automatiquement après la
  génération d'un brouillon d'email ou sur un envoi Gmail `incertain`/`echec` — l'automatisation
  n'existe (ADR-031-bis) que sur `envoiEmail.reussiLe` réellement posé (réponse HTTP 2xx de Gmail
  avec un `id` de message valide), jamais avant, jamais sur un résultat ambigu. Avec `mailto:`
  seul (sans Gmail autorisé), aucune interaction n'est jamais journalisée automatiquement.
- `biens.notaireEmail` ou tout champ scalaire unique pour un contact notaire — écarté
  explicitement (ADR-031 et ADR-031-bis), une future modélisation devra supporter plusieurs
  contacts au niveau transaction/parties.
- Une couche LLM introduite "en même temps" qu'un moteur de contenu déterministe — ADR-004 exige
  Human-in-the-Loop et une sortie structurée typée ; un LLM ne reçoit jamais que du texte déjà
  entièrement déterminé par la couche 1, jamais les faits bruts.
- Un scope Gmail (`gmail.send`) demandé en même temps que Calendar dans la même route
  d'autorisation, ou une union de scopes codée en dur — ADR-031-bis s'appuie sur l'autorisation
  incrémentale native de Google (`include_granted_scopes=true`), deux routes distinctes.
- Un résultat d'envoi `incertain` (timeout/rupture réseau après déclenchement de l'appel Gmail)
  traité comme un `echec` (inviterait à tort un renvoi automatique) ou comme un succès —
  `envois_email` porte trois timestamps terminaux distincts, jamais deux fondus en un.
- Le corps complet d'un email envoyé stocké une seconde fois dans `envois_email` — seul un
  `contenuHash` (SHA-256) de diagnostic y est conservé, jamais le texte.
- Un champ `actionType: string` générique (ou équivalent) sur une règle d'automatisation pour
  "préparer" une future action externe — le type `ChampsTacheAutomatique` (ADR-032) est
  délibérément monomorphe, c'est la frontière de sécurité qui empêche `creer_tache` de glisser vers
  `envoyer_email` sans une nouvelle ADR explicite.
- Un `ON DELETE CASCADE` depuis `comptes_rendus_visite`/`prospects_vendeurs`/`compromis` vers
  `evenements_metier`, ou depuis `executions_automatisation.evenementId` — écarté explicitement
  (ADR-032 correction n°5) : la table est un audit append-only, une cascade effacerait
  silencieusement la trace qu'un événement a eu lieu.
- Une préparation d'exécution (`executions_automatisation`) créée **après** le COMMIT de la
  transaction métier plutôt que dans la même transaction que l'événement — réintroduirait
  exactement le trou crash qu'ADR-032 (correction n°2) a fermé.
- Une réévaluation de l'activation d'une règle au moment du traitement plutôt qu'à l'émission de
  l'événement — figée une fois pour toutes dans la transaction métier (ADR-032 correction n°3),
  jamais un effet rétroactif d'une activation tardive.
- Un index d'idempotence sur `(typeEvenement, prospectVendeurId)` réutilisé tel quel pour un
  événement **cyclique** (ADR-033) — bloquerait à vie toute deuxième occurrence pour le même
  prospect. Un type d'événement répétable dans le temps a besoin de sa propre colonne d'ancrage de
  cycle (voir `ancreCycle`, `evenements_metier`) et de son propre index dédié, jamais un partage
  avec l'index des types ponctuels.
- Une tâche automatique d'un cycle précédent encore ouverte utilisée pour bloquer la création
  d'une tâche pour un **nouveau** cycle (ADR-033) — écarté explicitement : un vrai nouveau contact
  ouvre une occurrence métier à part entière, qui ne doit jamais être perdue au prétexte qu'une
  ancienne relance traîne encore. Ne jamais dédupliquer une automatisation par titre de tâche, ni
  par `origineCode + cible` seuls sans tenir compte du cycle/de l'ancre.
- `new Date().getTime() / 86400000` (ou équivalent) pour compter des jours écoulés — casse lors
  d'un changement d'heure été/hiver. Toujours passer par `joursCivilsEcoules` (`src/lib/temps.ts`),
  qui compare des dates civiles dans un fuseau explicite, jamais une durée brute.
- Un scheduler ou un `setInterval` démarré dans le process Next.js pour déclencher le scan
  temporel — ADR-033 a explicitement écarté cette approche (aucune garantie de process persistant
  selon l'hébergement, non tranché). Le déclenchement reste un cron **externe** appelant
  `POST /api/automatisations/scan`.

## Procédure obligatoire avant toute modification

1. **Auditer le code réel concerné avant de proposer quoi que ce soit** — ne jamais se fier à ce
   document, à l'historique de conversation, ou aux noms de fichiers seuls. Lire les fichiers
   effectivement présents.
2. Vérifier si une ADR existante couvre déjà la question (`docs/adr/`) avant de proposer un
   changement de convention.
3. Pour toute nouvelle entité réelle : suivre le patron déjà établi (table + repository + Server
   Action + page), pas une variante ad hoc — voir ADR-007.
4. Ne jamais mélanger mock et réel dans un même retour de fonction.

## Commandes de validation

Depuis `apps/web/` :

```bash
npx tsc --noEmit -p tsconfig.json   # typecheck
pnpm test                            # vitest — nécessite Postgres local démarré et migré
pnpm build                           # build de production Next.js
```

Un Postgres local est nécessaire pour `pnpm test` (tests d'intégration repository) et pour tester
manuellement l'application — voir `apps/web/README.md`. Aucune de ces commandes ne doit être
sautée avant de considérer une tâche terminée.
