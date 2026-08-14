# ADR-033 — Moteur temporel et relances programmées

**Statut :** Accepté
**Date :** 2026-08-14
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-032 a construit le moteur d'automatisations événement → action interne, mais toute source
d'événement y était jusqu'ici déclenchée par un geste conseiller explicite (visite marquée
réalisée, mandat signé, compromis signé). Aucune source ne dérivait un événement du simple passage
du temps — impossible, par exemple, de relancer automatiquement un prospect vendeur resté sans
contact au-delà d'un délai.

Cet ADR ajoute cette source manquante : une horloge / échéance, qui détecte des occurrences
temporelles dues et les traduit en `evenements_metier` consommables **par le moteur ADR-032
inchangé**. Aucun second moteur de règles n'est construit — le catalogue de règles, l'activation
explicite, `executions_automatisation`, l'idempotence d'exécution et la seule action autorisée
(`creer_tache`) restent strictement ceux d'ADR-032.

```
horloge / échéance
      ↓
événement métier temporel
      ↓
moteur ADR-032 (inchangé)
      ↓
création éventuelle d'une tâche
```

Un audit préalable du runtime/déploiement a été fait avant tout choix technique — voir "Runtime et
scheduler" ci-dessous. Un plan a ensuite été validé avec huit corrections obligatoires, la
principale portant sur un conflit d'index d'idempotence dans le plan initial.

## Runtime et scheduler

**Déploiement final non tranché** [Non vérifié] — aucun `vercel.json`/`railway.toml`/Dockerfile
applicatif dans le repo, ADR-002 (2026-08-07, largement obsolète) évoquait Vercel ou Railway sans
jamais choisir. Cet ADR ne suppose donc **aucun process Next.js vivant en permanence**.

Comparé et écarté : cron natif de plateforme (dépend d'un choix non fait) ; processus worker séparé
(ADR-005 confirme qu'aucun n'existe, ADR-032 a délibérément évité d'en créer un) ; `setInterval` ou
vérification opportuniste à chaque requête (ne survit à aucun redémarrage/redéploiement, aucune
garantie d'exécution) ; `pg_cron` (extension non installée dans l'image Docker locale
`postgres:16-alpine`, disponibilité incertaine sur un Postgres managé non choisi).

**Retenu : un endpoint HTTP neutre, `POST /api/automatisations/scan`, déclenché par un cron
EXTERNE** — jamais couplé à Vercel/Railway/GitHub Actions dans le code. Le fournisseur exact sera
configuré une fois l'hébergement choisi ; sans déclencheur externe configuré, le moteur temporel ne
s'exécute jamais spontanément (limite documentée, pas un bug). Cette neutralité est ce qui permet
de coder ADR-033 aujourd'hui sans attendre la décision d'hébergement.

**Protection** : premier endpoint "machine" d'Atlas (aucune authentification n'existe ailleurs en
dehors d'OAuth Google, ADR-006). `Authorization: Bearer <secret>` (`AUTOMATISATIONS_SCAN_SECRET`),
jamais en query string, comparaison en temps constant (`timingSafeEqual`, longueur vérifiée avant
pour éviter l'exception que lève la fonction sur des tailles différentes), jamais de secret
journalisé.

## Idempotence — le conflit d'index corrigé

Le plan initial ajoutait `UNIQUE(typeEvenement, prospectVendeurId, ancreCycle)` pour le nouvel
événement cyclique **sans modifier** l'index ponctuel existant `UNIQUE(typeEvenement,
prospectVendeurId)` (ADR-032) — celui-ci continuait de s'appliquer à `inactivite_prospect_vendeur`
et aurait bloqué à vie toute deuxième occurrence pour le même prospect après un nouveau contact.
Corrigé : l'index ponctuel exclut désormais explicitement le type cyclique, et le nouvel index lui
est dédié :

```sql
-- Réservé aux types ponctuels (rdv_estimation_realise, mandat_signe) :
CREATE UNIQUE INDEX evenements_metier_prospect_vendeur_unique
  ON evenements_metier (type_evenement, prospect_vendeur_id)
  WHERE prospect_vendeur_id IS NOT NULL AND type_evenement <> 'inactivite_prospect_vendeur';

-- Dédié au type cyclique :
CREATE UNIQUE INDEX evenements_metier_inactivite_prospect_vendeur_unique
  ON evenements_metier (type_evenement, prospect_vendeur_id, ancre_cycle)
  WHERE type_evenement = 'inactivite_prospect_vendeur';
```

`ancreCycle` (nouvelle colonne `evenements_metier.ancre_cycle`, `timestamptz` nullable) porte la
valeur qui a servi de base au calcul du seuil franchi : `dernierContactLe ?? creeLe`. C'est elle,
pas `prospectVendeurId` seul, qui identifie l'occurrence — un nouveau contact change l'ancre et
ouvre donc un nouveau cycle possible ; la même ancre rejouée (double submit, scans concurrents) ne
duplique jamais. Testé explicitement (`evenementMetierRepository.test.ts`) : ancre A acceptée,
même ancre A rejouée refusée, nouvelle ancre B acceptée — et l'ancien index ponctuel n'interfère
jamais avec le cycle temporel du même prospect.

## Fallback `creeLe` et renommage de la règle

`ancreCycle = dernierContactLe ?? creeLe` (validé) : un prospect jamais contacté doit pouvoir
entrer dans le mécanisme de relance, pas rester hors périmètre silencieusement. Cette sémantique
plus large que "silence après un premier contact" a motivé un renommage avant que le code ne se
fige : **`inactivite_prospect_vendeur`**, jamais `silence_prospect_vendeur` — le wording humain
("période sans interaction/contact") ne doit jamais laisser supposer qu'un contact précédent existe
forcément.

## Une ancienne tâche ouverte ne bloque jamais un nouveau cycle

Le plan initial proposait qu'une tâche automatique encore ouverte d'un cycle précédent fasse
retourner `undefined` à `construireTache()` pour le cycle suivant — **rejeté**. Un vrai nouveau
contact change `ancreCycle` et ouvre une occurrence métier à part entière ; si son propre seuil est
atteint, elle doit produire une tâche même si l'ancienne traîne encore, sinon l'occurrence est
définitivement perdue dès que l'ancienne tâche est un jour clôturée après coup. L'idempotence porte
sur le **cycle** (l'ancre), jamais sur l'historique complet des relances d'un prospect — et jamais
sur le titre de la tâche ni sur `origineCode + prospectId` seuls.

## Sémantique temporelle : trois notions distinctes

- **`ancreCycle`** = `dernierContactLe` ou `creeLe` — le fait qui a ouvert le cycle.
- **`survenuLe`** (colonne déjà existante d'`evenements_metier`, ADR-032) = le moment déterministe
  où le seuil est devenu atteint... en pratique posé à l'instant de l'INSERT, donc au moment du
  scan qui le détecte (voir limite documentée ci-dessous).
- **Le run de scan** (`runs_scan_automatisation.demarreLe`) = le moment où Atlas a effectivement
  cherché à détecter l'occurrence, potentiellement bien après le franchissement réel.

Un scan exécuté mercredi pour un seuil franchi lundi ne doit jamais laisser croire que le fait est
survenu mercredi — `ancreCycle` reste la donnée honnête pour reconstituer "depuis quand" le silence
dure, `survenuLe`/le run datent seulement la détection.

Tous les calculs de seuil utilisent `joursCivilsEcoules()` (`src/lib/temps.ts`, fuseau
`Europe/Paris` par défaut, paramètre explicite) — jamais une division de millisecondes, qui
déraillerait d'une heure lors d'un changement d'heure été/hiver. Testé explicitement de part et
d'autre du changement d'heure d'été (nuit du 28 au 29 mars 2026).

## Configuration : seuil produit explicite

`configurations_automatisation.seuilJoursInactivite` (nouvelle colonne, `integer` nullable, `CHECK
> 0` si renseigné) — nullable, aucune valeur implicite. Activer `inactivite_prospect_vendeur` sans
seuil valide configuré est **refusé explicitement** (`basculerAutomatisationAction`, throw) — jamais
un repli silencieux vers une constante cachée. La règle démarre inactive par défaut, comme les
quatre règles ADR-032 (seed `active = false, seuil_jours_inactivite = NULL`). Seuil visible et
modifiable depuis `/automatisations`, distinct de l'activation (`definirSeuilAutomatisationAction`,
ne touche jamais `active`).

## Journal des runs de scan

`runs_scan_automatisation` (nouvelle table) — **mutation contrôlée, jamais append-only strict** :
une ligne est insérée au démarrage (`demarreLe`) puis complétée à la fin (`termineLe` + compteurs,
ou `erreurTechnique`). Un run resté sans `termineLe` (crash pendant le scan) reste honnêtement
visible comme "en_cours" (`deriverEtatRunScanAutomatisation`) — jamais confondu avec un run
terminé. Aucune donnée personnelle : uniquement des compteurs agrégés (`nombreCandidats`,
`nombreOccurrencesCreees`) et un message d'erreur technique court.

Nécessaire parce que `evenements_metier`/`executions_automatisation` seuls ne répondent pas à "un
scan a-t-il eu lieu ?" quand il ne trouve rien de nouveau (le cas le plus fréquent une fois le
stock de silences rattrapé) — aucune ligne n'y est alors écrite. Dériver "dernier passage" depuis le
dernier `evenements_metier.survenuLe` serait trompeur : masquerait un scheduler cassé derrière un
événement vieux de plusieurs semaines. Jamais un `console.log` présenté comme audit (même leçon
qu'ADR-030).

## Scanner : calcul pur séparé de l'I/O

`calculOccurrencesInactivite.ts` — fonction pure (`calculerOccurrencesInactiviteDues(maintenant,
seuilJours, candidats, fuseau)`), aucun accès IO, `maintenant` toujours un paramètre explicite
(jamais un `new Date()` interne). `>= seuilJours`, **jamais `=== seuilJours`** : un scan en retard
doit encore détecter un seuil dépassé depuis plusieurs jours, pas seulement le jour exact du
franchissement — l'ancre de cycle (pas la date de détection) garantit qu'un scan manqué ne crée
jamais un événement par jour de retard, toujours un seul par cycle réel, jamais zéro.

`scanTemporel.ts` — couche I/O : lit la configuration, charge `listerProspectsVendeurs()` (déjà
existant, ADR-027 — exclut prospects archivés/perdus/mandat déjà signé, jamais un filtre
réinventé), appelle la fonction pure, puis émet chaque occurrence dans **sa propre transaction
courte** (`emettreEvenementEtPreparerExecutions`, ADR-032, inchangé) suivie du traitement synchrone
habituel (`traiterExecutionsEnAttente`, inchangé). Une erreur sur un prospect est isolée (catch par
occurrence, logguée) — n'affecte jamais les autres ni la complétion du run.

## Concurrence et reprise

Aucun verrou applicatif : la contrainte DB (index unique partiel sur l'ancre) reste la seule
défense, exactement comme ADR-032. Deux scans concurrents sur le même prospect : l'un gagne, l'autre
reçoit `evenement: undefined` — 1 événement, 1 exécution, 1 tâche. Testé explicitement
(`scanTemporel.test.ts`, deux scans en parallèle sur le même prospect).

Aucun état de progression persisté : un crash au milieu d'un scan portant sur des centaines de
prospects n'a aucune notion de "où reprendre" à gérer manuellement — le scan suivant recharge tous
les prospects actifs et recalcule toutes les occurrences dues depuis zéro ; les prospects déjà
traités ne redupliquent rien (index unique), les autres sont simplement (re)détectés. Testé
explicitement : un run resté "en_cours" (crash simulé) n'empêche jamais un scan ultérieur de
détecter une occurrence.

## Conséquences

- Migration `0021_loud_jubilee.sql` : `evenements_metier` (colonne `ancre_cycle`, index prospect
  ponctuel corrigé, index cyclique dédié, `CHECK type_evenement` étendu) ; `executions_automatisation`
  et `configurations_automatisation` (`CHECK regle_code` étendu, `seuil_jours_inactivite` sur cette
  dernière) ; nouvelle table `runs_scan_automatisation` ; seed de la 5ᵉ règle, inactive.
- Nouveaux fichiers : `src/lib/automatisations/{calculOccurrencesInactivite,scanTemporel,
  runScanAutomatisationRepository}.ts`, `src/app/api/automatisations/scan/route.ts`.
- Fichiers modifiés : `src/lib/temps.ts` (`joursCivilsEcoules`, refactor du calcul de différence de
  jours civils partagé avec `formatDateRelative`) ; `src/types/automatisation.ts` (types étendus,
  `RunScanAutomatisation`) ; `src/lib/automatisations/{evenementMetierRepository,
  configurationAutomatisationRepository,catalogueRegles}.ts` ; `src/actions/automatisations.ts`
  (`definirSeuilAutomatisationAction`, garde d'activation) ; `src/app/automatisations/page.tsx`
  (seuil + dernier run) ; `.env.local.example` (`AUTOMATISATIONS_SCAN_SECRET`).
- Tests : idempotence du cycle (ancre A/doublon/ancre B), non-interférence avec l'index ponctuel,
  fonction pure (seuil non atteint/atteint/dépassé, fallback `creeLe`), scanner I/O (règle
  inactive/non configurée → aucun run, création + absence de doublon au second scan, nouveau cycle
  malgré une tâche précédente ouverte, concurrence 1/1/1, erreur isolée par prospect, reprise après
  interruption), endpoint (401 absent/incorrect/mauvais schéma, 200 correct), garde d'activation
  Server Action, `joursCivilsEcoules` (dont changement d'heure été/hiver). Suite complète (88
  fichiers, 675 tests) passante ; build de production passant, route `/api/automatisations/scan`
  générée ; validation réelle par appel HTTP effectif (503 confirmé sur un serveur sans secret
  configuré).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- **Hors périmètre V1, réservé à des passes ultérieures** : email/SMS automatique ; LLM ; toute
  règle fondée sur un constat de checklist documentaire (ADR-029) ; relance acquéreur (prérequis
  manquant : aucun `dernierContactLe` structuré n'existe côté `acquereurs`) ; relance sur une offre
  sans décision au-delà d'un délai (candidate future, donnée déjà disponible) ; tâche créée pour
  signaler qu'une autre tâche est en retard (ADR-028 couvre déjà ce statut, créer une tâche pour ça
  serait du bruit) ; timezone par conseiller réellement configurable (fuseau déjà passé en paramètre
  explicite partout, seule sa source reste une constante) ; retry automatique d'une exécution
  `echouee` ou d'un run resté `en_cours` ; choix définitif du cron externe (dépend de l'hébergement,
  non tranché ici).
