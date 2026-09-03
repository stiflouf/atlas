# Handoff pour agent IA — Atlas (`apps/web`)

Document d'orientation pour Claude, ChatGPT ou tout futur agent de développement reprenant ce
projet. **Il ne remplace jamais le code comme source de vérité** — en cas de doute ou de
divergence apparente entre ce document et le code, le code a toujours raison ; corrige ce
document plutôt que de lui faire confiance aveuglément. Aucun secret n'est présent ici (ni dans
aucun fichier de `docs/`) — les noms de variables d'environnement sont cités, jamais leurs
valeurs. Porte d'entrée équivalente pour un ingénieur humain :
[`docs/DEVELOPER_ONBOARDING.md`](DEVELOPER_ONBOARDING.md).

## État actuel du projet

Produit mono-conseiller en construction active, 100% TypeScript/Next.js (`apps/web`), PostgreSQL
via Drizzle. Fonctionnalités réelles (persistées, testées) au 2026-08-16 : biens, acquéreurs,
prospects vendeurs, tâches (ADR-028, remplace l'ancienne table `actions`), notes de bien, comptes
rendus de visite, mémoire de matching Google Calendar, historique dérivé du bien, moteur
d'automatisations événement → tâche (ADR-032), moteur temporel/relances programmées (ADR-033),
moteur canonique de compatibilité Bien ↔ Acquéreur (ADR-034, `src/lib/compatibilite/`), secteurs
de recherche géographique acquéreur / critère géographique du moteur de compatibilité (ADR-035),
détection durable des transitions de compatibilité vers un événement métier append-only (ADR-036),
une règle d'automatisation ADR-032 exploitant cet événement pour créer une tâche commerciale
"nouveau match", désactivée par défaut (ADR-037), un filet générique de reprise après crash pour
les `executions_automatisation` restées bloquées (ADR-038), un raffinement ciblé du cockpit
commercial quotidien existant `/` — lien « Voir la fiche », badge « En retard », état vide (ADR-039)
—, une entité métier minimale `visites` (statuts `planifiee`/`realisee`/`annulee`, distincte du
compte rendu après-coup, ADR-040), et sa fiche `/visites/{id}` désormais autonome de Google
Calendar avec matérialisation strictement par Server Action (POST), plus un suivi post-visite
(`suivi_apres_visite`) contextuel à l'intérêt exprimé, ciblant l'acquéreur (ADR-041), et une règle
indépendante `retour_vendeur_apres_visite` créant une tâche vendeur (résolution exclusive par
`getProspectVendeurParBien`, jamais de fallback acquéreur) avec brouillon d'email déterministe à
whitelist stricte, désactivée par défaut (ADR-042), une correction de la provenance des faits
historiques d'une communication automatique — résolution désormais exacte via
`tache → exécution → événement`, fail-closed, jamais « le compte rendu le plus récent » (ADR-043),
une route canonique `/offres/nouveau` avec formulaire Offre partagé (`OffreFormulaire`) permettant
un préremplissage Bien/Acquéreur/compte rendu verrouillé et revalidé depuis la fiche Visite —
`interet = interesse` ne crée jamais automatiquement une Offre (ADR-044), et une route canonique
`/compromis/nouveau` avec formulaire Compromis partagé (`CompromisFormulaire`) permettant un
préremplissage Bien/Acquéreur/Offre verrouillé et revalidé depuis une Offre acceptée, prix convenu
jamais copié depuis le montant de l'offre — `offre.statut = "acceptee"` ne crée jamais
automatiquement un Compromis, et une Offre acceptée ne peut être l'origine que d'au plus un
Compromis (ADR-045), et enfin `dateActe` désormais modifiable (report/effacement) tant que le
compromis reste `en_cours`, un statut commercial du Bien où le modèle structuré (`compromis.statut`)
prévaut désormais sur le jalon legacy `bien.compromisSigneLe` (corrige un badge « Compromis signé »
fantôme possible après annulation structurée), et un wording clarifié pour la tâche automatique de
préparation du dossier notarial (ADR-046).
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
- **Authentification Atlas mono-conseiller depuis ADR-047** — identité Google (OIDC) + allowlist à
  une seule adresse (`ATLAS_ALLOWED_EMAIL`), session cookie chiffrée (`iron-session`,
  `src/lib/auth/sessionAtlas.ts`), `src/proxy.ts` en PRIVATE BY DEFAULT + `exigerSessionAtlas()`
  dans chaque Server Action/Route Handler utilisateur. **Toujours aucun multi-utilisateur** : une
  seule identité autorisée, aucun `userId`/`tenantId`, aucune notion de "qui a fait quoi" au-delà de
  l'identifiant Google unique posé en session — produit mono-conseiller assumé (ADR-006).
  `connexions_google` (autorisations Calendar/Gmail, distinctes de l'authentification Atlas) reste
  une table à une seule ligne (`id = 'default'`). Le nom affiché dans `Sidebar.tsx` est codé en dur.
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
- **Compatibilité Bien ↔ Acquéreur (ADR-034/035) sans préférences pondérées, sans persistance du
  résultat** — `src/lib/compatibilite/` est un moteur canonique déterministe distinct de
  `src/lib/matching/` (jamais le même module : `matching/` résout un rendez-vous Calendar par
  correspondance floue, `compatibilite/` compare un bien et un acquéreur déjà identifiés sur des
  champs strictement structurés). `budgetMin` n'a aucune sémantique dans ce moteur — ne jamais
  supposer qu'un bien moins cher que `budgetMin` est signalé. Aucun score, aucune pondération,
  aucun résultat détaillé persisté — `evaluerCompatibilite()` reste recalculé à chaque affichage.
  Ne jamais supposer qu'un critère `a_verifier` signifie une incompatibilité.
- **Transitions de compatibilité détectées durablement (ADR-036)** —
  `src/lib/compatibilite/{etatRepository,resynchronisationRepository,synchronisation,baseline}.ts`
  détectent quand une paire *devient* compatible et émettent un événement append-only
  (`compatibilite_bien_acquereur_devenue_compatible`, `evenements_metier`), sans jamais persister le
  détail des 7 critères. Ne jamais confondre `compatibilites_bien_acquereur_etat` (mémoire technique
  de dernière observation, jamais une source de vérité) avec le résultat réel du moteur
  (`evaluerCompatibilite()`).
- **Une règle ADR-032 exploite désormais cet événement, mais désactivée par défaut (ADR-037)** —
  `nouveau_match_bien_acquereur` (`catalogueRegles.ts`) crée une tâche ciblant l'**acquéreur**
  (jamais le bien — `taches` impose au plus une cible) tant que l'événement reste `compatible` au
  moment du traitement, l'entité non archivée, et qu'aucune offre `en_cours`/compromis
  `en_cours`/`realise`/**visite `planifiee` (ADR-040)**/tâche déjà ouverte n'existe pour cette paire
  précise. Une visite `realisee`/`annulee` ne bloque jamais indéfiniment. **Tant que cette règle
  n'est pas activée explicitement depuis `/automatisations`, 0 tâche est créée** — ne jamais
  supposer le contraire. Aucun email, aucun Gmail dans cette ADR.
- **`visites` (ADR-040) est une entité distincte de `comptes_rendus_visite`, jamais fusionnée** —
  `visites.statut` (`planifiee`/`realisee`/`annulee`) répond à « que s'est-il passé ? »,
  `comptesRendusVisite.interet` continue seul de répondre à « quel est le retour de l'acquéreur ? ».
  Une visite naît **uniquement** via `materialiserVisiteAction` (Server Action, ADR-041 — **jamais**
  dans le rendu de `/visites/[id]/preparer`, qui est purement en lecture depuis cette ADR) —
  idempotente au niveau DB sur `rendez_vous_calendar_id`. Ne jamais supposer une création native
  indépendante de Calendar, elle n'existe pas. Aucune inférence depuis une date passée :
  `date_prevue < maintenant` ne signifie jamais `realisee`.
- **`/visites/{idAtlas}` (ADR-041) est une vraie fiche, plus une redirection** — lit exclusivement
  PostgreSQL (visite, bien, acquéreur, compte rendu lié via `visite_id`), aucune dépendance à
  Google Calendar dans son noyau ; reste consultable si Calendar est déconnecté ou l'événement
  d'origine supprimé. Ne jamais y ajouter d'appel Calendar « juste pour l'heure » — décision
  assumée, `date_prevue` reste un jour civil sans heure en V1.
- **`suivi_apres_visite` (ADR-041) cible désormais l'acquéreur, jamais la Visite ni le compte
  rendu** — titre adapté à `interet` (intéressé/à réfléchir/inconnu produisent une tâche,
  `pas_interesse` n'en produit aucune, `undefined` honnête ADR-032). `taches.visite_id` référence
  toujours un **compte rendu**, jamais `visites.id`, mais uniquement pour les tâches créées **avant**
  ADR-041 — `deriverRouteFicheCible()` (ADR-039) n'a jamais été étendue pour ce type de cible
  (nom de colonne trompeur hérité d'avant l'entité `visites`, jamais renommé, jamais migré).
- **`retour_vendeur_apres_visite` (ADR-042) est une règle indépendante de `suivi_apres_visite`,
  jamais fusionnée** — même événement déclencheur (`visite_realisee`), mais cible le **vendeur**,
  résolu **exclusivement** via `getProspectVendeurParBien()` (jamais
  `resoudreDestinatairesDepuisBien()`, qui peut retourner l'acquéreur d'un compromis en cours).
  Désactivée par défaut, aucun fallback : bien sans vendeur structuré → 0 tâche, jamais une erreur.
  Contrairement à `suivi_apres_visite`, les **quatre** valeurs d'`interet` produisent une tâche
  (y compris `pas_interesse`). **L'acquéreur n'est jamais nommé** dans aucun contenu généré (titre,
  contexte, objet/corps d'email). Le brouillon (`IntentionCommunication =
  "retour_vendeur_apres_visite"`) ne lit jamais `retour`/`prochaineEtape` (notes internes,
  `FaitsCommunication` ne porte structurellement pas ces champs) — uniquement adresse du bien, date
  de visite, valeur d'`interet`. `origineCode` (posé par le moteur ADR-032) distingue cette tâche de
  toute autre tâche `prospectVendeur` avant toute résolution de contexte de communication — ne
  jamais supposer que « toute tâche prospectVendeur » porte cette intention. Gmail inchangé
  (ADR-031-bis) : aucun envoi automatique nulle part.
- **La date/`interet` du brouillon `retour_vendeur_apres_visite` viennent de l'événement EXACT
  ayant créé la tâche, jamais du compte rendu le plus récent du bien (ADR-043)** —
  `getExecutionAutomatisationParTacheId(tache.id)` (`executionAutomatisationRepository.ts`, lecture
  fail-closed : 0 ligne → `undefined`, 1 → utilisée, plus d'1 → exception explicite, jamais un choix
  arbitraire) → `getEvenementMetierById(execution.evenementId)` → `evenement.compteRenduVisiteId` →
  compte rendu exact. Aucun `UNIQUE(tache_id)` en base (décision explicite ADR-043) — la garantie
  « au plus une exécution par tâche automatique » vient uniquement de la discipline du moteur
  (`traiterUneExecution`, `moteur.ts`). Ne jamais réintroduire `listerComptesRendusPourBien(bien.id)[0]`
  ni une autre heuristique « le plus récent » pour une communication issue d'une tâche automatique
  événementielle — vérifié : `suivi_apres_visite` n'a pas ce problème (sa cible acquéreur est une FK
  directe, aucune liste jamais interrogée).
- **`/offres/nouveau` (ADR-044) est LA route canonique de création d'Offre, jamais un second
  formulaire** — `OffreFormulaire` (`src/components/offre/OffreFormulaire.tsx`) est partagé entre
  cette route et l'onglet « Offres » de `BienTabs` : même Server Action (`ajouterOffreAction`), même
  contrat. Le verrouillage Bien/Acquéreur/compte rendu ne s'active QUE si toute la chaîne de
  `searchParams` est cohérente (revalidée serveur, même patron que `/taches/nouveau`) — un maillon
  cassé retombe sur le mode non verrouillé, jamais une substitution devinée. Ne jamais supposer
  qu'`interet = interesse` crée une offre : aucun couplage automatique n'existe, ni dans un sens ni
  dans l'autre (la création d'une offre ne modifie jamais `interet`, ne termine jamais la tâche
  `suivi_apres_visite`). `listerOffresEnCoursPourPaire()` (`offreRepository.ts`) alimente un
  avertissement de doublon (jamais un blocage définitif — plusieurs offres `en_cours` pour la même
  paire restent autorisées après confirmation explicite `confirmerNouvelleOffreMalgreExistante`,
  revalidée côté serveur). Relation Offre ↔ Visite exclusivement via `offre_visites` (ADR-019,
  déjà existante) — ne jamais ajouter `offres.visite_id`. `TacheItem` reste générique, aucun bouton
  Offre n'y a été ajouté (décision explicite).
- **`/compromis/nouveau` (ADR-045) est LA route canonique de création de Compromis, même patron
  qu'`/offres/nouveau`** — `CompromisFormulaire` (`src/components/compromis/CompromisFormulaire.tsx`)
  est partagé entre cette route et l'onglet « Compromis » de `BienTabs`, même Server Action
  `ajouterCompromisAction`. Rappel de modèle important : créer un Compromis EST déjà l'acte de
  signature dans Atlas V1 (`dateSignature` obligatoire, `compromis_signe` émis à la création) — ne
  jamais chercher un état « compromis non signé ». Ne jamais supposer qu'`offre.statut = "acceptee"`
  crée un compromis : action explicite obligatoire. Verrouillage Acquéreur+Offre uniquement si
  bienId/acquereurId/offreId forment une chaîne cohérente (offre correspondant exactement au bien
  et à l'acquéreur, `acceptee`) — jamais une substitution devinée. Le montant de l'offre n'est
  **jamais** copié dans `prixConvenu` (référence affichée seulement) — le prix peut légitimement
  différer entre acceptation et signature. `getCompromisParOffreId()` (`compromisRepository.ts`,
  fail-closed 0/1/plus d'1, aucun `UNIQUE(offre_id)` en base) refuse toute réutilisation d'une Offre
  déjà associée à un compromis — **sans confirmation possible pour contourner**, contrairement au
  doublon Offre×Offre d'ADR-044 (ici une provenance structurée unique, pas une nouvelle proposition
  commerciale). La garde historique « un seul compromis `en_cours` par bien » reste un blocage dur
  inchangé.
- **`dateActe` (prévue) est modifiable uniquement pour un compromis `en_cours` (ADR-046)** —
  `modifierDateActeAction`/`modifierDateActeCompromis`, volontairement séparées de
  `changerStatutCompromisAction`/`marquerCompromisRealise` : un report de date n'est jamais une
  transition de statut, et `dateActeReelle` (constatée) reste la seule posée par la transition
  `realise`, toujours immuable ensuite. `dateActe` reste nullable et effaçable — jamais une
  estimation inventée pour combler un report sans nouvelle date connue.
- **`deriverStatutCommercial()` (`statutCommercialBien.ts`) donne priorité au modèle structuré sur
  le jalon legacy depuis ADR-046** — dès qu'un compromis structuré non `annule` existe pour un bien,
  il détermine seul `"compromis_signe"`, indépendamment de `bien.compromisSigneLe` (qui n'est
  **jamais** effacé par `changerStatutCompromisAction`, transition `annule` — comportement
  volontairement inchangé, la correction vit entièrement dans la dérivation). Le jalon legacy reste
  un fallback, consulté **uniquement** en l'absence totale de compromis structuré pour ce bien —
  ne jamais le supposer fiable dès qu'au moins un compromis structuré existe. `"vendu"` reste
  toujours prioritaire, inchangé.
- **Tâche `preparation_dossier_notaire_apres_compromis` : titre « Préparer le dossier notarial »
  depuis ADR-046** (auparavant « … pour le notaire ») — wording uniquement, aucun changement de
  comportement. Ne jamais supposer qu'Atlas contacte un notaire : aucun contact notaire structuré
  n'existe, « Préparer un email » sur cette tâche résout toujours l'**acquéreur**, jamais un
  notaire ni un vendeur inventé.
- **Reprise après crash des `executions_automatisation` bloquées (ADR-038)** —
  `POST /api/automatisations/reprise` (secret `AUTOMATISATIONS_REPRISE_SECRET`, distinct de
  `AUTOMATISATIONS_SCAN_SECRET`) rejoue les exécutions restées `a_traiter`, sûr par construction
  car `traiterUneExecution()` (`moteur.ts`) crée déjà la tâche et pose `reussieLe` dans **une seule**
  transaction — jamais de tâche orpheline possible. Ne jamais supposer un statut `en_cours`/une
  lease : ils n'existent pas et ne sont pas nécessaires pour les effets actuels (100 % DB, aucun
  Gmail/Calendar). `nombre_tentatives`/`derniere_tentative_le` sont purement observationnels,
  **jamais** la source de l'idempotence. Plafond fixe `MAX_TENTATIVES_AUTOMATISATION = 5` —
  au-delà, `echouee` définitivement, jamais un retry automatique (comme pour toute autre erreur
  technique réelle).
- **`/` est déjà le cockpit commercial quotidien (ADR-039), jamais une seconde route à créer** —
  ne jamais construire un nouveau tableau de bord `/aujourdhui`, `/taches` ou `/cockpit` : l'audit
  ADR-039 a confirmé que la page existante centralise déjà alertes/agenda/tâches. Le lien « Voir la
  fiche » (`deriverRouteFicheCible()`, `src/types/tache.ts`) ne couvre que les cibles bien/acquéreur/
  prospect vendeur ; la tâche `nouveau_match_bien_acquereur` (ADR-037) résout vers l'**acquéreur**,
  jamais un lien Bien reconstruit par parsing du titre. Aucune priorisation par IA, aucun score
  affiché, aucun graphique — le tri reste entièrement `tachePriority.ts`, inchangé.
- **Géographie (ADR-035) limitée à la granularité commune/arrondissement, jamais un rayon** —
  `bien.codeInseeCommune` (citycode IGN, une chaîne, jamais un entier) est le seul identifiant
  géographique lu par le moteur ; `ville`/`codePostal` du bien ne sont **jamais** comparés à un
  secteur recherché, même quand `codeInseeCommune` est `NULL`. La résolution du bien est non
  bloquante et systématiquement recalculée à chaque édition (jamais de `codeInseeCommune` périmé).
  L'ajout d'un secteur acquéreur est, lui, strictement validé côté serveur avant écriture (aucune
  confiance dans les valeurs soumises par le client). Les entrées génériques "ville entière"
  Paris/Lyon/Marseille sont exclues de la recherche — ne jamais supposer qu'un citycode générique
  équivaut à "tous les arrondissements". Aucun quartier, aucun IRIS, aucun rayon kilométrique.

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
8. **`develop` déploie le showroom, `main` déploie la production réelle de Steven** — deux projets
   Railway distincts, dont les deux environments s'appellent `production` : le nom « production »
   ne désigne donc jamais à lui seul la bonne cible. Ne jamais `git push origin main`, ni écrire
   quoi que ce soit sur `sparkling-rejoicing`, dans un lot visant `develop`/`domiora-demo` — même
   avec une suite entièrement verte. Matrice, identifiants et checklist de vérification avant
   écriture Railway : `docs/PILOT_RUNBOOK.md#0-environnements-branches-et-autorisations-décriture-source-canonique`
   (source canonique unique, jamais recopiée ailleurs).

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
| `src/lib/compatibilite/evaluerCompatibilite.ts` | Moteur canonique de compatibilité Bien ↔ Acquéreur (ADR-034/035) — distinct de `matching/` |
| `src/lib/geocodage/ignClient.ts` | Client IGN Géoplateforme unique — géocodage adresse, recherche de communes, re-vérification serveur (ADR-035) |
| `src/lib/secteurRechercheRepository.ts` | Secteurs de recherche acquéreur — ajout/suppression/listing simple et batché (ADR-035) |
| `src/lib/compatibilite/synchronisation.ts` | Détecte les transitions de compatibilité (ADR-036) et émet l'événement durable — jamais appelée directement par une Server Action, uniquement via `traitementResynchronisation.ts` |
| `src/lib/compatibilite/resynchronisationRepository.ts` | Handoff durable (file d'attente de resynchronisation) — enqueue transactionnel, coalescing, complétion par identité (ADR-036) |
| `src/lib/compatibilite/baseline.ts` | Outil de baseline/rebuild explicite — jamais d'événement, jamais automatique (ADR-036) |
| `src/app/api/compatibilite/scan/route.ts` | Filet de reprise du handoff (ADR-036) — même patron d'authentification que `/api/automatisations/scan` |
| `src/lib/automatisations/catalogueRegles.ts` | Catalogue de règles ADR-032/033/037/041/042 — dont `nouveau_match_bien_acquereur` (ADR-037), `suivi_apres_visite` (politique par `interet`, cible acquéreur, ADR-041) et `retour_vendeur_apres_visite` (cible vendeur via `getProspectVendeurParBien` uniquement, ADR-042), toutes désactivées par défaut |
| `src/lib/automatisations/executionAutomatisationRepository.ts` | Dont `existeExecutionAvecTacheOuvertePourPaire()` (ADR-037), `listerExecutionsATraiter()`/`incrementerTentativeExecution()` (ADR-038) et `getExecutionAutomatisationParTacheId()` (provenance exacte tache → exécution, fail-closed, ADR-043) |
| `src/lib/automatisations/reprise.ts` | Filet de reprise après crash (ADR-038) — réutilise `traiterExecutionsEnAttente()` (`moteur.ts`) telle quelle, jamais une seconde implémentation |
| `src/app/api/automatisations/reprise/route.ts` | Endpoint de reprise (ADR-038) — même patron d'authentification que `/api/automatisations/scan`, secret dédié |
| `src/app/page.tsx` | Cockpit commercial quotidien « Aujourd'hui » (ADR-026/039) — seule route de ce type, ne jamais en dupliquer une deuxième |
| `src/components/aujourd-hui/TacheItem.tsx` | Composant canonique de rendu d'une tâche (cockpit + fiches bien/acquéreur/prospect vendeur) — lien « Voir la fiche », badge « En retard » (ADR-039) |
| `src/types/tache.ts` | `deriverCibleTache()` (ADR-028) et `deriverRouteFicheCible()` (ADR-039) — dérivées, jamais une requête ni un parsing de titre |
| `src/lib/visiteRepository.ts` | Entité `visites` (ADR-040) — matérialisation idempotente (`materialiserVisite`), transitions gardées (`marquerVisiteRealisee`/`annulerVisite`), report (`modifierDatePrevueVisite`), signal ADR-037 (`existeVisitePlanifieePourPaire`) |
| `src/actions/visite.ts` | `materialiserVisiteAction` (ADR-041, POST, seul point d'écriture créant une visite) ; `annulerVisiteAction`/`reporterVisiteAction` (ADR-040, `redirectTo` optionnel depuis ADR-041) |
| `src/app/visites/[id]/page.tsx` | Fiche Visite réelle (ADR-041) — lecture PostgreSQL exclusive, aucune dépendance Calendar, plus une redirection ; lien contextuel « Créer une offre » (ADR-044, jamais conditionné à `interet`) |
| `src/lib/memoireDossier.ts` | Sélection des éléments affichés dans la Mémoire du dossier |
| `src/app/visites/[id]/preparer/page.tsx` | Page la plus riche de l'app — préparation + compte rendu ; purement en lecture depuis ADR-041 (aucune matérialisation dans son rendu) |
| `src/app/offres/nouveau/page.tsx` | Route canonique de création d'Offre (ADR-044) — préremplissage Bien/Acquéreur/CR revalidé serveur, verrouillage uniquement si tout le contexte est cohérent |
| `src/components/offre/OffreFormulaire.tsx` | Formulaire Offre partagé (ADR-044) — utilisé par `/offres/nouveau` ET l'onglet « Offres » de `BienTabs`, même Server Action `ajouterOffreAction` |
| `src/lib/offreRepository.ts` | Dont `listerOffresEnCoursPourPaire()` (avertissement doublon, ADR-044) |
| `src/app/compromis/nouveau/page.tsx` | Route canonique de création de Compromis (ADR-045) — préremplissage Bien/Acquéreur/Offre revalidé serveur, verrouillage uniquement si tout le contexte est cohérent |
| `src/components/compromis/CompromisFormulaire.tsx` | Formulaire Compromis partagé (ADR-045) — utilisé par `/compromis/nouveau` ET l'onglet « Compromis » de `BienTabs`, même Server Action `ajouterCompromisAction` |
| `src/lib/compromisRepository.ts` | Dont `getCompromisParOffreId()` (garde offre-déjà-utilisée, fail-closed, ADR-045) et `modifierDateActeCompromis()` (report/effacement de la date d'acte prévue, ADR-046) |
| `src/lib/statutCommercialBien.ts` | `deriverStatutCommercial()` — modèle structuré prioritaire sur le jalon legacy `bien.compromisSigneLe` depuis ADR-046 |
| `src/proxy.ts` | Proxy Next.js 16 (ADR-047, remplace `middleware.ts` déprécié) — PRIVATE BY DEFAULT, ne protège JAMAIS les Server Actions à lui seul |
| `src/lib/auth/sessionAtlas.ts` | Session Atlas (ADR-047) — `exigerSessionAtlas()` à appeler en première ligne de CHAQUE Server Action/Route Handler utilisateur, distincte de `src/lib/google/connexion.ts` (autorisations Calendar/Gmail) |
| `src/lib/auth/googleIdentite.ts` | Flux d'identité Atlas (OIDC, ADR-047) — distinct de `src/lib/google/oauth.ts` (scopes métier) |
| `src/actions/gardeSessionAtlas.structurel.test.ts` | Garantit par analyse AST que TOUTE Server Action exportée sous `src/actions/` commence par `await exigerSessionAtlas()` — échoue si une nouvelle action oublie la garde |
| `src/lib/prospectVendeurRepository.ts` | `predicatVue()` (ADR-048) — prédicat métier UNIQUE actif/perdu/converti/archivé, partagé par `listerProspectsVendeurs*()` ET `rechercherProspectsVendeurs()` ; ne jamais dupliquer cette logique ailleurs |
| `src/types/pagination.ts` | Type `PageResultat<T>` (ADR-048), partagé par `rechercherBiensPage()`/`rechercherAcquereursPage()` |
| `src/lib/documents/packNotaire.ts` | `determinerCompromisActuel()`/`chargerContextePackNotaire()` (extraits ADR-049) — source unique de la sélection du compromis contextuel, partagée par le Route Handler ZIP, la page Pack et `enregistrerTransmissionDossierNotaireAction` ; ne jamais réintroduire une 3ᵉ copie de cette logique |
| `src/lib/transmissionDossierNotaireRepository.ts` | Transmissions Pack Notaire (ADR-049) — idempotence par `cleIdempotence` (`ON CONFLICT DO NOTHING`), immuable (aucune fonction de modification/suppression) |
| `src/actions/transmissionDossierNotaire.ts` | `enregistrerTransmissionDossierNotaireAction` (ADR-049) — revalide intégralement Compromis/Bien/documents/taille côté serveur, calcule SHA-256 avant tout INSERT |
| `src/lib/stockageDocuments.ts` | Stockage documentaire (ADR-050) — SEUL point de lecture de `ATLAS_DOCUMENT_STORAGE_DIR` dans tout le projet ; `verifierDisponibiliteStockageDocuments()` fail-closed en production (jamais de création automatique de la racine) ; `ErreurStockageDocumentsIndisponible` distincte d'un document précis absent (`undefined`) |
| `apps/web/.env.local.example` | Liste exhaustive et à jour des variables d'environnement nécessaires |
| `src/components/ui/Button.tsx` | CTA partagé (`primary`/`secondary`/`ghost`/`danger`), sur les tokens `globals.css` ; utilisé pour toute nouvelle hiérarchie d'actions (une seule primary pleine par bloc) |
| `src/components/bien/BienTabs.tsx` (barre d'onglets) | `role="tablist"`/`role="tab"`, auto-scroll de l'onglet actif, dégradé de bord si contenu caché ; un nouvel onglet doit garder ce patron, jamais un `<div role="button">` brut |
| `src/app/globals.css` | Source unique des tokens couleur (`@theme inline`, Tailwind v4) — direction artistique premium : `accent` = navy profond (pas indigo), `champagne`/`champagne-light` réservés aux détails/identité, `page`/`surface` crème chaud. Toute nouvelle classe couleur doit utiliser un token existant, jamais un hex inline, sauf besoin réellement nouveau (alors ajouter le token ici, pas un cas isolé) |
| `src/lib/branding.ts` + `src/components/layout/BrandMark.tsx` | Source unique du nom produit et du monogramme — le nom "Atlas" fait l'objet d'une vérification marque en cours, jamais une chaîne littérale ailleurs dans l'UI |
| `src/db/resoudreDatabaseUrlTest.ts` | Garde-fou test/production (stabilisation V1 Candidate) — SEUL point de résolution de la `DATABASE_URL` utilisée par `pnpm test`/`pnpm test:e2e` ; ignore délibérément une `DATABASE_URL` ambiante non reconnue comme locale de dev, jamais lue pour s'en servir |
| `apps/web/vitest.setup.ts` | `setupFiles` Vitest — fixe `DATABASE_URL` via `resoudreDatabaseUrlTest()` AVANT le chargement de chaque fichier de test ; les `process.env.DATABASE_URL ??= ...` déjà présents dans ~90 fichiers de test deviennent des no-op, jamais besoin de les modifier un par un |
| `apps/web/e2e/` | Infrastructure E2E Playwright (stabilisation V1 Candidate) — `env.ts` (config serveur E2E dédiée), `session.ts` (injection d'une vraie session Atlas scellée, jamais un contournement d'auth), `nettoyage.ts` (purge post-smoke respectant les FK), `coeur.smoke.spec.ts`/`documents-adr049.smoke.spec.ts` (les deux seuls smoke, jamais une suite E2E étendue) |

## Pièges connus

- **`docs/` vit à la racine du monorepo**, pas sous `apps/web/` — un agent scopé à `apps/web/`
  peut conclure à tort qu'aucune documentation/ADR n'existe.
- **Les onglets de `BienTabs.tsx` sont `role="tab"` depuis la passe design RC2** — un test
  Playwright qui les cible via `getByRole("button", { name: "Documents" })` échoue silencieusement
  (élément introuvable) ; utiliser `getByRole("tab", ...)`. Les deux smoke E2E existants ont été
  corrigés pour cette raison.
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
- **Ne jamais lire `process.env.ATLAS_DOCUMENT_STORAGE_DIR` en dehors de `src/lib/stockageDocuments.ts`**
  (ADR-050) — toute nouvelle fonctionnalité documentaire doit passer par `ecrireDocument`/
  `lireDocument`/`verifierDisponibiliteStockageDocuments`, jamais reconstruire un chemin fichier
  ailleurs. Une commande shell lancée depuis un autre `cwd` peut créer un `stockage-documents/`
  parasite silencieusement — toujours vérifier le répertoire de travail avant d'exécuter des tests
  documentaires manuellement.
- **Toute nouvelle Server Action exportée sous `src/actions/*.ts` doit commencer par
  `await exigerSessionAtlas();`** (ADR-047) — `src/actions/gardeSessionAtlas.structurel.test.ts`
  échoue sinon (analyse AST, pas un simple grep). Le Proxy (`src/proxy.ts`) ne protège jamais les
  Server Actions à lui seul.
- **Toute nouvelle requête `ORDER BY <colonne temporelle> DESC LIMIT 1` sur une table à fort volume
  d'écritures séquentielles doit inclure un tie-break déterministe** (ex. `, desc(id)`) — deux
  lignes insérées à quelques millisecondes d'intervalle (`defaultNow()`) peuvent partager un
  timestamp identique ; sans second critère, la ligne retournée devient non déterministe sous
  charge (cause racine de la flakiness historique de `scanTemporel.test.ts`, corrigée dans
  `runScanAutomatisationRepository.ts` — stabilisation V1 Candidate).
- **Un test d'intégration qui compte des occurrences dans un rendu global (cockpit, dashboard) doit
  utiliser des données rendues uniques par exécution** (suffixe `Date.now()` ou équivalent) — un
  process interrompu avant son `afterAll` (kill/OOM) peut laisser une ligne orpheline au même
  libellé littéral qu'une exécution suivante, faisant compter deux occurrences là où le test en
  attend une (cause racine observée sur `page.test.tsx`, stabilisation V1 Candidate).

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
  écrite en base — ADR-030). Nuance depuis ADR-049 : `transmissions_dossier_notaire` persiste un
  **snapshot d'une transmission déclarée** (fait historique immuable, jamais recalculé), pas la
  logique de calcul du pack elle-même — ne pas confondre les deux, et ne pas réintroduire de
  persistance dans `calculerPackNotaire`/`genererZipPackNotaire` sous prétexte que la table existe.
- Une exigence de checklist `manquant` traitée comme `bloquant_technique` — la checklist ADR-029
  n'est pas juridiquement exhaustive, seule une contradiction structurelle FACTUELLEMENT démontrée
  (mauvais rattachement, classement `rejete`, fichier illisible) justifie un blocage technique
  (ADR-030).
- Une dépendance ZIP/PDF ajoutée sans vérifier au préalable l'absence de binding natif et la
  compatibilité avec le runtime Node.js par défaut des Route Handlers — voir l'audit `jszip`
  (ADR-030) comme référence de la démarche attendue.
- Un `console.log` présenté comme une piste d'audit — ce n'est pas une traçabilité. La traçabilité
  des transmissions du Pack Notaire est désormais réelle et structurée (`transmissions_dossier_
  notaire`, ADR-049) ; pour tout autre besoin d'audit non couvert, ne pas improviser un `console.log`
  comme substitut.
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
- Une détection des entrées génériques Paris/Lyon/Marseille basée sur l'absence du champ `banId`
  dans la réponse IGN — heuristique testée puis explicitement écartée (ADR-035) : des communes
  rurales ordinaires en sont également dépourvues, ce qui les aurait exclues à tort. La liste
  `CODES_INSEE_VILLE_A_ARRONDISSEMENTS` (3 citycodes fixes, documentés) est la seule source de
  vérité pour cette exclusion.
- Un `codeInsee`/`nomCommune`/`codePostal` de secteur acquéreur persisté depuis les valeurs soumises
  par le formulaire client sans re-vérification IGN côté serveur, ou un champ `codeInsee` typé/validé
  comme un entier/`^\d{5}$` — rejetterait les codes Corse `2A`/`2B` valides (ADR-035).
- Une colonne JSON/JSONB pour stocker la liste des secteurs recherchés d'un acquéreur — écarté au
  profit d'une table dédiée `secteurs_recherche_acquereur`, cohérent avec l'absence totale de
  JSON/JSONB ailleurs dans le schéma (ADR-035).
- Un rayon kilométrique, une distance GPS, ou une expansion automatique "Tout Paris" → 20
  arrondissements sans convention officielle démontrée sans heuristique — hors périmètre V1,
  explicitement écarté (ADR-035).

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
pnpm test:e2e                        # smoke Playwright (2 scénarios) — jamais dans pnpm test/CI
```

Un Postgres local est nécessaire pour `pnpm test` (tests d'intégration repository, base `atlas_test`
dédiée résolue automatiquement — voir `src/db/resoudreDatabaseUrlTest.ts`) et pour tester
manuellement l'application — voir `apps/web/README.md`. Aucune de ces commandes ne doit être
sautée avant de considérer une tâche terminée.
