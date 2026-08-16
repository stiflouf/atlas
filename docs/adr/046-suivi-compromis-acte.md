# ADR-046 — Suivi fiable du Compromis jusqu'à l'acte authentique

**Statut :** Accepté
**Date :** 2026-08-16
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Un audit préalable en lecture seule a examiné en détail ce qui se passe entre `compromis_signe` et
`realise`/`annule`. L'audit a écarté toute automatisation temporelle (aucun délai métier n'est
établi, `dateActe` n'était même pas modifiable) et a identifié deux problèmes réels, ciblés :

1. `dateActe` (date d'acte prévue) est une donnée métier réelle — exploitée par la projection
   mensuelle du pipeline sur `/dashboard` — mais **immuable après création du compromis**, alors
   qu'un report d'acte est un scénario courant.
2. Le statut commercial affiché du Bien (`deriverStatutCommercial()`) pouvait devenir **faux**
   après l'annulation d'un compromis structuré : le jalon legacy `bien.compromisSigneLe` (ADR-014,
   antérieur aux entités Offre/Compromis) n'est jamais effacé par `changerStatutCompromisAction`
   (transition `annule`), laissant potentiellement un badge « Compromis signé » fantôme.

Une clarification UX mineure a été apportée à la tâche automatique de préparation du dossier.

**Hors périmètre, confirmé par l'audit** : aucun rappel J-x, aucune alerte temporelle, aucune fiche
Compromis, aucun nouvel événement métier, aucun branchement sur le scan temporel ADR-033.

## Décision

### 1. `dateActe` devient modifiable — nouvelle Server Action dédiée

`modifierDateActeAction` (`src/actions/compromis.ts`), volontairement **distincte** de
`changerStatutCompromisAction` : modifier une date prévue n'est pas une transition de statut.
Autorisée uniquement si `compromis.statut === "en_cours"` — refusée explicitement (throw) pour
`realise`/`annule`, qui représentent l'historique constaté. Relit le compromis à chaque appel
(protection contre une course GET/POST : un compromis devenu `realise`/`annule` entre l'affichage
du formulaire et sa soumission est refusé). `dateActe` reste nullable — un champ vide efface
explicitement la date (report sans nouvelle date connue), jamais remplacée par une estimation
inventée.

Nouvelle fonction repository `modifierDateActeCompromis(id, dateActe)` — ciblée par `compromis.id`
exclusivement, jamais par bien/acquéreur/offre.

### 2. UI minimale dans l'onglet Compromis du Bien

Pour un compromis `en_cours` : si `dateActe` est absente, affichage honnête « Date d'acte à
définir » avec un bouton « Renseigner la date » ; si présente, « Acte prévu le… » avec « Modifier la
date ». Un seul champ date, effaçable, réutilisant les conventions de formulaire existantes — aucune
modale, aucune refonte.

### 3. Statut commercial du Bien — priorité au modèle structuré

`deriverStatutCommercial()` (`src/lib/statutCommercialBien.ts`) : tout compromis structuré **non
annulé** (`en_cours`, ou un `realise` défensif sans `dateActeReelle` — cas normalement impossible)
fait désormais basculer vers `"compromis_signe"`, **indépendamment du jalon legacy**. Si tous les
compromis structurés d'un bien sont `annule`, ce test ne se déclenche jamais : le jalon legacy n'est
alors **plus consulté du tout** pour `"compromis_signe"` — c'est le cœur de la correction. Le jalon
legacy (`bien.compromisSigneLe`) reste un **fallback**, utilisé uniquement quand **aucun** compromis
structuré n'existe pour ce bien — compatibilité intacte pour les anciens dossiers antérieurs aux
entités Offre/Compromis. `"vendu"` (compromis `realise` + `dateActeReelle`) reste prioritaire sur
tout le reste, comportement inchangé.

**Aucune synchronisation destructive** : le champ `bien.compromisSigneLe` n'est jamais modifié par
cette ADR, ni en masse ni par un nouveau couplage sur `changerStatutCompromisAction` — la correction
vit entièrement dans la fonction de dérivation, jamais dans une écriture supplémentaire.

### 4. Clarification du wording de la tâche notarial

Le titre généré `"Préparer le dossier pour le notaire"` devient `"Préparer le dossier notarial"`,
avec un nouveau contexte : *« Rassembler les éléments nécessaires au suivi du compromis et à la
préparation du dossier notarial. »* — l'ancien wording laissait entendre un contact/envoi direct
vers un notaire, alors qu'Atlas ne connaît structurellement aucun contact notaire (aucune table,
aucun champ), et que la seule action disponible (« Préparer un email ») résout exclusivement
l'**acquéreur**, jamais un notaire. Aucun changement de comportement : déclencheur (`compromis_signe`),
activation par défaut (`false`), cible (`{type: "compromis", id}`), priorité, type, absence
d'échéance — tous inchangés. Les tâches déjà créées avec l'ancien titre ne sont jamais renommées
(ADR-032, non-rétroactif).

## Hors périmètre, volontairement

Rappel/alerte temporelle sur `dateActe` (J-x), branchement sur le scan temporel ADR-033, fiche
Compromis (`/compromis/{id}`), nouvel événement métier (`compromis_realise`/`acte_signe`/
`compromis_annule`), contact notaire structuré, email notaire, clôture automatique de tâche à
`realise`/`annule`, synchronisation destructive globale du jalon legacy, nouvelle vue dashboard
individuelle.

## Conséquences

- **0 migration** — le schéma est strictement inchangé, `compromis.dateActe` (déjà nullable) suffit.
- Fichiers modifiés : `src/actions/compromis.ts` (`modifierDateActeAction`), `src/lib/compromisRepository.ts`
  (`modifierDateActeCompromis`), `src/lib/statutCommercialBien.ts` (dérivation corrigée),
  `src/components/bien/BienTabs.tsx` (UI d'édition de date), `src/lib/automatisations/catalogueRegles.ts`
  (wording tâche notarial), et les fichiers de test associés.
- Nouveau fichier de test : `src/lib/automatisations/catalogueRegles.preparationDossierNotaire.test.ts`.
- `docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md`
  mis à jour. `docs/DATA_MODEL.md` **non modifié** — aucun changement de schéma.
- Dette retirée de `KNOWN_LIMITATIONS.md` : l'annulation structurée peut laisser un badge
  « Compromis signé » fantôme — résolue par cette ADR.
- Dettes qui restent, non traitées ici : aucun rappel temporel sur `dateActe` (aucune politique
  métier établie), aucune fiche Compromis, aucune communication vendeur post-signature.
