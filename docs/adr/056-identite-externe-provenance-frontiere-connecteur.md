# ADR-056 — Identité externe, provenance des données et frontière connecteur

**Statut :** Accepté
**Date :** 2026-09-08
**Décideurs :** Steven Gausset (CEO), CTO

> Rubriques : Contexte · Problème · Décision · Alternatives écartées · Modèle de données /
> contrats · Invariants · Stratégie de migration · Conséquences · Risques · Hors périmètre ·
> Questions ouvertes · Scalabilité · Réversibilité (ADR-051).
>
> Dépend de : **ADR-054** (appartenance) et **ADR-055** (modèle canonique). Une référence externe
> ne peut être posée que vers une entité canonique possédée par un workspace.

## Contexte

L'audit de septembre 2026 classe l'absence de modèle de provenance en risque **CRITICAL** n°1.
Faits vérifiés :

- aucune des 31 tables de `schema.ts` ne porte `source`, `id_externe`, `synchronise_le` ou une
  quelconque marque d'origine ;
- **deux exceptions, et elles sont instructives** :
  - `memoire_contextuelle` porte `source`, `type_element`, `identifiant_externe` et
    `UNIQUE(source, identifiant_externe)` — mais ADR-006 est explicite sur son rôle : mémoriser le
    résultat d'un **matching flou** d'un élément externe vers un bien/acquéreur, avec une priorité
    « validation humaine > cache > moteur » et une empreinte de contenu (SHA-256) pour détecter un
    changement ; ses `bien_id`/`client_id` sont du **texte sans FK** (ADR-010) ;
  - `visites.rendez_vous_calendar_id` est une simple référence vers la source externe, et le
    commentaire de `schema.ts` dit précisément pourquoi : « jamais la PK métier — la Visite possède
    son propre id ».
- ADR-005 (2026-08-07) fixe la cible : « chaque intégration est un connecteur isolé, derrière une
  interface commune », avec `pull`/`push` et « les données importées sont normalisées dans le schéma
  Atlas avant d'être stockées ». Elle situe ces connecteurs dans un `apps/worker/` **qui n'existe
  pas** — `docs/ARCHITECTURE.md` le constate noir sur blanc.
- Le seul port/adaptateur réellement construit du dépôt est `apps/web/src/lib/redaction/` :
  interface `RedacteurCommunication` (`contrat.ts`), aucun SDK dans `package.json`, `fetch` brut sur
  un **protocole** plutôt qu'un fournisseur, orchestration séparée (`orchestration.ts`), garde-fous
  à rejet total (`gardeFous.ts`), et repli propre quand rien n'est configuré (`redacteur.ts`
  retourne `undefined`, qui n'est pas une erreur).
- Les intégrations existantes, elles, ne respectent pas cette frontière : huit clients HTTP externes
  sont importés directement par `apps/web/src/app/visites/[id]/preparer/page.tsx` (lignes 27-36), et
  l'IGN est appelé depuis les Server Actions `creerBien.ts`, `modifierBien.ts`, `secteurRecherche.ts`.

## Problème

DOMIORA doit pouvoir recevoir le **même objet métier** depuis la saisie directe, un import CSV, un
CRM de réseau, un CRM tiers (Hektor, Apimo, Netty…), Gmail, Google Calendar ou une API partenaire —
sans que le domaine ne connaisse aucun de ces noms.

Le cas qui tranche tout, et qu'aucun modèle actuel ne sait traiter :

```text
CRM externe  : budget = 450 000
Conseiller   : corrige en 470 000 dans DOMIORA
CRM externe  : renvoie 450 000
```

Écraser la correction est une perte de confiance irréparable — le conseiller n'a plus aucune raison
de corriger quoi que ce soit. Ne jamais écraser est tout aussi faux : sans mécanisme, DOMIORA
diverge silencieusement de sa source. Il faut une **sémantique explicite**, décidée avant le premier
connecteur, pas découverte pendant.

## Décision

### 1. L'identité canonique DOMIORA est interne, et le reste toujours

Tout objet métier garde son `uuid` interne comme unique identité. **Un identifiant externe n'est
jamais une clé primaire, jamais une clé métier, jamais une contrainte d'unicité sur une table
canonique.** C'est déjà le choix explicite de `visites` face à `rendez_vous_calendar_id` ; il est
généralisé ici sans exception.

Conséquence directe : perdre un connecteur, changer de réseau ou couper une intégration ne détruit
aucune identité DOMIORA.

### 2. Une table dédiée `references_externes`, distincte de `memoire_contextuelle`

```text
references_externes
  id
  workspace_id             -> workspaces          (ADR-054 : table racine)
  fournisseur              'playiad' | 'hektor' | 'apimo' | 'google_calendar' | 'import_csv' | ...
  type_entite_externe      vocabulaire DU FOURNISSEUR, jamais réinterprété
  id_externe               identifiant chez le fournisseur
  type_entite_canonique    'contact' | 'bien' | 'projet_vendeur' | 'projet_acquereur' | 'mandat' | ...
  id_entite_canonique      uuid DOMIORA
  vue_pour_la_premiere_fois_le
  vue_pour_la_derniere_fois_le
  UNIQUE (workspace_id, fournisseur, type_entite_externe, id_externe)
```

**Décision explicite : ne PAS réutiliser `memoire_contextuelle`.** Les deux tables ressemblent à un
doublon et n'en sont pas :

| | `memoire_contextuelle` (ADR-006) | `references_externes` (ici) |
|---|---|---|
| Nature du lien | **hypothèse** produite par un moteur flou | **assertion** faite par un connecteur |
| Confiance | trois scores + `overall_confidence` | aucune — l'identité est affirmée ou absente |
| Validation | `auto`/`confirme`/`corrige`/`ignore` | pas de statut de validation |
| Invalidation | empreinte SHA-256 du contenu | inutile |
| Cible | texte sans FK (ADR-010, mode démo) | FK réelle vers une entité canonique |

Les fusionner mettrait deux vérités de nature différente dans une même table — un score de
confiance n'a aucun sens sur un `id` livré par une API, et une empreinte de contenu n'en a aucun sur
une assertion d'identité. Elles coexistent, chacune dans son rôle.

### 3. Une entité canonique peut porter plusieurs références externes — une référence externe ne pointe que vers une entité

Relation **N:1** confirmée et formalisée. Un contact DOMIORA peut légitimement correspondre à un id
Playiad, un id CRM tiers et un contact Google : ce sont trois faits vrais simultanément.

L'inverse est interdit : un `(workspace, fournisseur, type, id_externe)` ne peut désigner qu'une
seule entité canonique — garanti par la contrainte `UNIQUE` ci-dessus, jamais par une discipline
applicative. C'est ce qui rend le CAS 10 d'ADR-055 (le même humain reçu de plusieurs sources)
résoluble sans duplication d'identité.

### 4. Provenance **hybride** : entité par défaut, champ uniquement là où c'est nécessaire

Les trois options ont été évaluées sur leur coût réel :

- **A. Entité seule** — une ligne dit « ce contact vient de Playiad ». Coût quasi nul. **Incapable
  de résoudre le cas 450 000/470 000** : la correction porte sur un champ, pas sur l'entité.
- **B. Champ par champ** — une provenance pour chacune des ~200 colonnes métier. Résout tout, mais
  crée un schéma fantôme aussi gros que le schéma réel, à maintenir à chaque ajout de colonne.
  Disproportionné pour zéro connecteur en production.
- **C. Hybride** — **retenue.**

La forme retenue est délibérément minimale :

```text
synchronisations_entite
  workspace_id, fournisseur, type_entite_canonique, id_entite_canonique   (clé logique)
  source_de_verite         CHECK ('domiora','externe')   -- par (entité, fournisseur)
  mode                     CHECK ('read_only','pull','push','bidirectionnel')
  champs_verrouilles       text[]      -- noms de champs corrigés par un humain
  synchronise_le
  dernier_conflit_le?
  PRIMARY KEY (workspace_id, fournisseur, type_entite_canonique, id_entite_canonique)
```

`champs_verrouilles` est le seul élément de granularité champ, et il ne stocke **que les exceptions**
— pas la provenance de tous les champs. C'est la chose la moins chère qui résout le cas posé :

```text
1. Import initial      : budget = 450 000, champs_verrouilles = []
2. Correction humaine  : budget = 470 000, champs_verrouilles = ['budgetMax']
3. Pull suivant        : le connecteur propose 450 000
                         -> 'budgetMax' est verrouillé -> AUCUNE écriture
                         -> un CONFLIT est matérialisé, jamais résolu en silence
```

### 5. Sémantique des six notions, décidée une fois pour toutes

| Notion | Définition retenue |
|---|---|
| **source of truth** | Déclarée par (entité, fournisseur), jamais globale. `externe` = le fournisseur fait foi pour les champs non verrouillés. `domiora` = DOMIORA fait foi, le pull ne sert qu'à détecter des écarts |
| **imported value** | La valeur telle que reçue. Conservée **dans l'enregistrement de synchronisation ou le conflit**, jamais écrite en double dans la table métier |
| **local override** | Une valeur modifiée par un humain dans DOMIORA. Verrouille le champ concerné. **Un override n'est jamais levé automatiquement** — seul un geste humain explicite le retire |
| **last synced** | Instant de la dernière synchronisation aboutie pour cette entité et ce fournisseur |
| **conflict** | Le fournisseur propose, pour un champ verrouillé, une valeur différente de la valeur locale. Un conflit est un **fait visible** (matérialisable en tâche ou alerte, moteurs existants), jamais un log silencieux, jamais une résolution automatique |
| **human validation** | Prioritaire, toujours, sans condition |

**Rapport à ADR-006, explicité pour ne pas être détourné.** ADR-006 pose « validation humaine >
cache > moteur » pour arbitrer entre une décision humaine et un **recalcul déterministe** dont
DOMIORA est propriétaire. Ici il n'y a ni cache, ni recalcul, ni moteur : il y a une **assertion
d'un tiers**. Les invariants d'ADR-006 (empreinte de contenu, statuts de validation, seuils de
confiance) ne s'appliquent donc pas et ne sont pas repris. Seul le **principe** est repris, et il est
re-dérivé ici pour sa propre raison : une correction humaine est la seule information dont DOMIORA
sait avec certitude qu'elle a été voulue.

### 6. Capacités de synchronisation déclarées par connecteur

Chaque connecteur déclare, **par type d'entité**, l'une des quatre valeurs : `READ_ONLY`, `PULL`,
`PUSH`, `BIDIRECTIONNEL`.

Règle : **un connecteur qui n'a pas déclaré `PUSH` (ou `BIDIRECTIONNEL`) pour un type d'entité ne
peut structurellement jamais écrire vers l'extérieur pour ce type.** Ce n'est pas un réglage
d'exécution, c'est une propriété du connecteur, vérifiée avant tout appel.

Précédent direct : le connecteur Google Calendar actuel est en lecture seule par le **scope OAuth**
lui-même (`calendar.events.readonly`, `lib/google/agendaSource.ts`) — la capacité est déjà exprimée
comme une propriété, pas comme une intention.

### 7. Interface conceptuelle du connecteur — calquée sur le seul port éprouvé du dépôt

```text
interface Connecteur {
  readonly fournisseur: string
  readonly capacites: Map<TypeEntiteCanonique, 'read_only'|'pull'|'push'|'bidirectionnel'>

  resoudreIdentite(externe) -> ReferenceExterne | 'inconnu'     // jamais une fusion, jamais un score
  pull(portee)              -> EntiteCanonique[]                // déjà normalisées
  push(entite)              -> ResultatPush                     // refusé si capacité absente
}
```

Trois choix structurants, tous repris de `lib/redaction/` parce qu'ils y ont fait leurs preuves :

1. **Aucun SDK fournisseur dans `package.json`.** `fetch` brut, `AbortController` + timeout, erreurs
   catégorielles — patron de `gmailClient.ts` et `adaptateurCompatibleOpenAI.ts`. Ajouter une
   dépendance fournisseur est une décision d'architecture, pas un détail d'implémentation.
2. **Non configuré n'est pas en panne.** Un connecteur absent retourne « indisponible », et le
   produit reste entièrement utilisable — exactement `resoudreRedacteur()` retournant `undefined`.
3. **Orchestration séparée de l'adaptateur**, avec garde-fous systématiques et rejet total plutôt
   que correction partielle (`orchestration.ts` + `gardeFous.ts`). Une donnée douteuse est
   abandonnée entière, jamais « réparée ».

### 8. Aucun concept propriétaire ne franchit la frontière du Core

Interdit, sans exception : `PlayiadBuyer`, `HektorContact`, `ApimoProperty`, un enum de statut d'un
réseau, un code de type de mandat propriétaire, un champ `custom_field_17`. L'adaptateur **traduit**
vers les contrats canoniques d'ADR-055 (`Contact`, `ProjetAcquereur`, `Mandat`…) ; ce qui ne se
traduit pas est **abandonné explicitement**, jamais stocké « au cas où » dans un JSONB fourre-tout
lu par le domaine.

Un identifiant propriétaire, lui, est légitime — mais il vit dans `references_externes`, jamais sur
la table métier.

### 9. Frontière CORE / CONNECTOR / SYNC ENGINE, et sens des dépendances

| Couche | Possède | Peut importer | Ne doit **jamais** connaître |
|---|---|---|---|
| **CORE** (entités, invariants, repositories) | `contacts`, `biens`, projets, `mandats`, `taches`, documents… | rien des couches externes | l'existence d'un fournisseur, d'un protocole, d'une API |
| **CONNECTOR** (un par fournisseur) | protocole HTTP/OAuth, mapping externe → canonique | les **contrats** du Core (types), le SDK d'aucun autre connecteur | les moteurs d'intelligence, les autres connecteurs, l'UI |
| **SYNC ENGINE** | `references_externes`, `synchronisations_entite`, conflits, capacités, ordonnancement | Core + interface `Connecteur` | l'implémentation concrète d'un connecteur particulier |
| **INTELLIGENCE / AUTOMATIONS** | moteurs purs, règles, événements | le Core uniquement | tout fournisseur, toute référence externe |
| **NETWORK / VERTICAL PACKS** | vocabulaire, réglages et règles propres à un réseau | Core + capacités déclarées | le protocole d'un connecteur |

Sens des dépendances retenu :

```text
CONNECTORS ──> SYNC ENGINE ──> CORE <── INTELLIGENCE / AUTOMATIONS <── PACKS
```

Le Core ne dépend de personne. Tout le monde dépend du Core. C'est la seule règle à retenir, et
c'est **déjà** la discipline observée du dépôt : les moteurs purs (`lib/compatibilite/`,
`lib/opportunites/`, `lib/alertes/`) n'importent aucun client HTTP, et `evaluerCompatibilite()`
n'accède ni au réseau ni à la base (ADR-034 §1). Cette ADR ne crée pas la règle, elle la nomme et
l'étend aux connecteurs.

Le schéma d'ADR-005 (`apps/worker/connectors/` en Python) n'est **pas** repris : il décrit une
architecture qui n'a jamais existé (`docs/ARCHITECTURE.md`). La frontière décidée ici est logique,
pas physique — elle n'exige aucun nouveau workspace, aucun worker, aucun package. Le découpage
physique reste possible plus tard, sans rien invalider.

### 10. Les exceptions existantes sont constatées, gelées, et non refactorées ici

| Exception | Emplacement | Statut |
|---|---|---|
| 8 clients HTTP importés par un Server Component | `app/visites/[id]/preparer/page.tsx` (IGN, PRIM, Vélib, annuaire éducation, Overpass, Mérimée, DVF) | **Antérieure. Gelée.** Aucun refactor dans ce lot |
| IGN appelé depuis des Server Actions | `actions/creerBien.ts`, `modifierBien.ts`, `secteurRecherche.ts` (`resoudreCommuneBien`) | **Antérieure. Gelée.** Cas particulier : le `code_insee_commune` est une dépendance dure du critère géographique (ADR-035) |
| Google Calendar / Gmail | `lib/google/` | **Antérieure.** Déjà en module dédié avec adaptateur (`toRendezVous()`) — la plus proche de la cible |

Règle applicable **immédiatement** : toute intégration **nouvelle** respecte la frontière dès son
premier jour. Les exceptions ci-dessus ne créent aucun précédent et ne s'étendent pas.

## Alternatives écartées

**Réutiliser `memoire_contextuelle` pour toute la provenance.** Écartée en §2 : mélange une
hypothèse scorée et une assertion, et ses cibles sont du texte sans FK (ADR-010).

**Une colonne `source` sur chaque table métier.** Suffit pour « d'où vient cette ligne », mais ne
sait ni porter plusieurs origines (CAS 10), ni exprimer un verrou de champ, ni un conflit. Elle
donnerait l'illusion d'une provenance résolue.

**Provenance champ par champ complète (option B).** Écartée pour son coût structurel — un schéma
fantôme de la taille du schéma réel, pour zéro connecteur en production. Reste ouverte si un
fournisseur réel prouve le besoin ; `champs_verrouilles` est un sous-ensemble compatible et
n'interdit pas de l'étendre.

**Résolution automatique de conflit (« le plus récent gagne », « l'externe gagne »).** Écartée : le
seul cas où DOMIORA connaît l'intention est celui d'une correction humaine explicite. Toute autre
règle est une devinette, et ADR-008 interdit exactement ce type d'inférence.

**Écrire un connecteur d'abord, généraliser ensuite.** Tentant et plus rapide. Écarté par
l'expérience du dépôt lui-même : ADR-005 a décrit des connecteurs génériques en 2026-08 sans les
construire, et le seul connecteur réellement écrit (Google) a été posé dans `apps/web/src/lib/`
directement. Sans frontière décidée **avant**, le premier connecteur devient la norme par défaut.

**iPaaS (Zapier, Make).** Déjà écarté par ADR-005 ; rien de nouveau ne le remet en cause.

## Modèle de données / contrats

Voir §2 (`references_externes`), §4 (`synchronisations_entite`) et §7 (interface `Connecteur`).
Les deux tables sont des **tables racines** au sens d'ADR-054 §7 : elles naissent avec
`workspace_id`. Aucune n'est écrite par cette ADR.

Un enregistrement de conflit (forme non tranchée : table dédiée ou tâche du moteur existant) doit
porter au minimum : l'entité canonique, le fournisseur, le champ, la valeur locale, la valeur
proposée, l'instant. Voir Questions ouvertes.

## Invariants

1. L'identité canonique d'un objet métier est son `uuid` interne. Un identifiant externe n'est
   jamais une PK, jamais une clé métier, jamais une unicité sur une table canonique.
2. Un `(workspace, fournisseur, type externe, id externe)` désigne **au plus une** entité canonique
   (contrainte `UNIQUE`, pas une discipline applicative).
3. Une entité canonique peut porter plusieurs références externes.
4. **Un champ verrouillé par un humain n'est jamais écrasé par une synchronisation.**
5. Un conflit est matérialisé et visible ; il n'est jamais résolu automatiquement, jamais
   silencieux.
6. Un connecteur sans capacité `push`/`bidirectionnel` pour un type d'entité ne peut jamais écrire
   vers l'extérieur pour ce type.
7. **Aucun type, enum ou vocabulaire propriétaire d'un fournisseur n'existe dans le Core.**
8. Le Core ne dépend d'aucune couche externe. Les moteurs d'intelligence et d'automatisation ne
   connaissent ni fournisseur ni référence externe.
9. Aucun SDK fournisseur n'est ajouté à `package.json` sans décision d'architecture explicite.
10. Un connecteur non configuré n'est pas une panne : le produit reste entièrement utilisable.

## Stratégie de migration

**Entièrement additive.** Aucune table existante n'est modifiée, aucune colonne ajoutée à une table
métier. Les deux nouvelles tables sont inertes tant qu'aucun connecteur n'existe.

Séquence cible :

1. `references_externes` + `synchronisations_entite`, sans aucun connecteur. Inertes.
2. **Import CSV comme premier connecteur** — recommandé : il exerce la chaîne complète
   (résolution d'identité, normalisation, verrous, conflits) sans OAuth, sans réseau, sans
   dépendance à un tiers, et sans jamais appeler d'API externe.
3. Un connecteur réseau réel, en `READ_ONLY` d'abord, puis `PULL`. `PUSH` est un lot distinct
   qui exige que le sens `DOMIORA → externe` ait été validé pour chaque champ.
4. `memoire_contextuelle` reste inchangée dans son rôle actuel.

`envois_email` et `connexions_google` **ne deviennent pas** des connecteurs par cette ADR : ils
gardent leur forme et leurs invariants (ADR-031-bis, ADR-006/047).

## Conséquences

- Le risque CRITICAL n°1 de l'audit a une réponse décidée, non implémentée.
- ADR-005 est **partiellement remplacée** : son principe (« connecteur isolé, interface commune,
  données normalisées avant stockage ») est confirmé et précisé ; son implémentation annoncée
  (`apps/worker/connectors/` en Python) est explicitement abandonnée au profit d'une frontière
  logique dans `apps/web`. ADR-005 n'est pas réécrite (les ADR ne sont jamais réécrites
  rétroactivement, `docs/adr/README.md`).
- Le vocabulaire IAD/Playiad reste absent du Core — l'audit a confirmé zéro occurrence dans `src/`,
  et cette ADR en fait un invariant plutôt qu'un état de fait heureux.
- Un connecteur devient un lot **borné et testable sans réseau** : l'interface est étroite, et
  l'adaptateur peut être testé avec un double, comme `lib/redaction/` l'est déjà.
- Les intégrations existantes ne changent pas. Le produit ne change pas.

## Risques

| Risque | Portée | Atténuation décidée |
|---|---|---|
| `champs_verrouilles` s'avère insuffisant face à un fournisseur réel | Moyen | Sous-ensemble strict de la provenance par champ : extensible sans rien casser |
| Les conflits s'accumulent sans être traités | Moyen | Les matérialiser comme tâche/alerte (moteurs existants), jamais comme un log |
| Un connecteur `PUSH` écrit une donnée fausse chez un tiers | **Élevé** | `PUSH` est un lot distinct, jamais livré avec le `PULL` ; capacité déclarative vérifiée avant appel |
| Deux workspaces synchronisent le même compte externe | Moyen | `workspace_id` est dans la clé `UNIQUE` : les périmètres ne se croisent jamais |
| La frontière logique s'érode faute de package physique | **Élevé** | Un test structurel d'import (patron `gardeSessionAtlas.structurel.test.ts`, `reperesRelationnels.frontiere.test.ts`) peut l'exprimer — le dépôt sait déjà verrouiller une frontière par un test |
| Le premier connecteur devient la norme de fait | Élevé | C'est précisément pourquoi cette ADR précède tout connecteur |

## Hors périmètre, volontairement

Tout connecteur · toute intégration IAD/Playiad · tout appel d'API externe · toute migration SQL ·
le refactor des exceptions du §10 · un worker, une queue, un ordonnanceur · la résolution
automatique de doublons · l'export DOMIORA → externe (`PUSH`) · le webhook entrant · le format
d'import CSV · toute UI de gestion de connecteurs ou de conflits.

## Questions ouvertes

1. **Un conflit est-il une table dédiée ou une tâche du moteur existant ?** Une tâche le rend
   visible dans le cockpit sans rien construire (`taches` a déjà `origine = 'automatique'` et
   `origine_code` prévus pour cela, `schema.ts`) ; une table dédiée porte mieux la valeur proposée.
   Non tranché.
2. **`source_de_verite` par entité, ou par (entité, type de champ) ?** Le budget peut venir du CRM
   pendant que les notes viennent de DOMIORA. Commencer par entité ; ne pas exclure d'affiner.
3. **Le `PULL` est-il déclenché par cron (patron des 4 endpoints machine actuels), par webhook, ou
   à la demande ?** Dépend du fournisseur ; aucune raison de trancher avant d'en avoir un.
4. **Une entité importée peut-elle être supprimée chez le fournisseur ?** Le produit ne supprime
   rien (ADR-012) ; la réponse est probablement l'archivage, mais elle n'est pas décidée.
5. **`import_csv` est-il un « fournisseur » au sens de `references_externes` ?** Probablement oui
   (un import a un identifiant de ligne source), mais son `id_externe` est plus fragile qu'un id
   d'API.

## Scalabilité

`references_externes` croît linéairement avec le nombre d'entités synchronisées et de fournisseurs.
Toutes les lectures se font par la clé `UNIQUE` (index composite) ou par
`(type_entite_canonique, id_entite_canonique)` — deux accès indexés, aucun balayage. Le
`synchronisations_entite` est en 1:1 par (entité, fournisseur). Rien ici ne dépend d'une extension
propriétaire (ADR-051 §2). Le vrai enjeu de charge est l'ordonnancement des `pull` à grande échelle —
hors périmètre, et explicitement dépendant du premier connecteur réel.

## Réversibilité

C'est l'objet même de cette ADR. En gardant l'identité canonique interne (§1) et en interdisant tout
concept propriétaire dans le Core (§8), DOMIORA peut perdre n'importe quel fournisseur sans perdre
ses données ni son modèle : les tables métier restent complètes et lisibles, seule la table de
correspondance devient obsolète. À l'inverse, un schéma qui aurait épousé les identifiants d'un
réseau rendrait la sortie de ce réseau équivalente à une réécriture.
