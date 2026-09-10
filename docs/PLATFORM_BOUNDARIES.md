# DOMIORA — Frontières de plateforme

Carte de lecture des couches conceptuelles de DOMIORA et de leurs frontières.

**Ce document ne décide rien.** Les décisions vivent dans les ADR ; il n'en reproduit ni les
règles, ni les invariants, ni les modèles de données. Il sert à situer une brique avant d'ouvrir
la bonne ADR.

- **ADR-054** — appartenance des données (workspace, identité, accès, secrets)
- **ADR-055** — modèle canonique (contact, projets, mandat, interaction)
- **ADR-056** — identité externe, provenance, frontière connecteur

État réellement construit à ce jour : `docs/ARCHITECTURE.md` et
`docs/audits/DOMIORA-STRATEGIC-ARCHITECTURE-AUDIT-2026-09.md`.
**Aucune de ces trois ADR n'est implémentée.**

---

## Le diagramme

```text
                    ┌───────────────────────────────────┐
                    │   NETWORK / VERTICAL PACKS        │
                    │   IAD · agence indépendante · …   │
                    │   vocabulaire et réglages         │
                    └─────────────────┬─────────────────┘
                                      │ dépend de
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
┌───────────────┐            ┌────────────────┐           ┌─────────────────┐
│ INTELLIGENCE  │            │  AUTOMATIONS   │           │      (UI)       │
│ Today         │            │  événements    │           │  pages, écrans  │
│ compatibilité │            │  règles        │           │                 │
│ opportunités  │            │  scan temporel │           │                 │
│ alertes       │            │  reprise       │           │                 │
│ mémoire rel.  │            │                │           │                 │
└───────┬───────┘            └────────┬───────┘           └────────┬────────┘
        │                             │                            │
        │        dépendent de         │                            │
        └─────────────┬───────────────┴────────────────────────────┘
                      ▼
        ┌───────────────────────────────────────────┐
        │                  CORE                     │
        │  contacts · projets · biens · mandats     │
        │  visites · offres · compromis · documents │
        │  tâches · rémunération                    │
        │                                           │
        │  NE DÉPEND DE PERSONNE.                   │
        └───────────────────▲───────────────────────┘
                            │ dépend de
                ┌───────────┴────────────┐
                │      SYNC ENGINE       │
                │  références externes   │
                │  provenance, verrous   │
                │  conflits, capacités   │
                └───────────▲────────────┘
                            │ dépend de
        ┌───────────────────┴────────────────────┐
        │              CONNECTORS                │
        │  CSV · réseau · CRM tiers · Gmail      │
        │  Calendar · IGN · portails · signature │
        │  1 adaptateur par fournisseur          │
        └───────────────────▲────────────────────┘
                            │
                ┌───────────┴────────────┐
                │   Systèmes externes    │
                └────────────────────────┘
```

**La seule règle à retenir : toutes les flèches pointent vers le CORE. Le CORE ne pointe vers
personne.**

Un connecteur connaît le Core ; le Core ignore qu'un connecteur existe. Un moteur d'intelligence
lit le Core ; il ignore d'où la donnée est venue. C'est ce qui rend un fournisseur remplaçable et
un moteur métier testable sans réseau.

---

## Qui possède quoi

| Couche | Possède | Ne doit **jamais** connaître |
|---|---|---|
| **CORE** | Les entités métier, leurs invariants, leur persistance | Un fournisseur, un protocole, une API, un identifiant externe |
| **SYNC ENGINE** | La correspondance interne ↔ externe, la provenance, les conflits, les capacités | L'implémentation d'un connecteur précis |
| **CONNECTORS** | Un protocole, une authentification, la traduction externe → canonique | Les autres connecteurs, les moteurs, l'UI |
| **INTELLIGENCE** | Les moteurs purs de décision et de lecture | Tout fournisseur, toute référence externe, toute I/O |
| **AUTOMATIONS** | Les événements métier, les règles, l'idempotence, la reprise | Tout fournisseur |
| **PACKS** | Le vocabulaire et les réglages propres à un réseau | Le protocole d'un connecteur |

Le détail normatif (ce que chaque couche peut importer, les invariants, les exceptions actuellement
tolérées) est en **ADR-056 §9 et §10**.

### Frontière logique, pas physique

Ces couches ne sont **pas** cinq packages. Le dépôt compte un seul workspace applicatif
(`apps/web`) et cette carte n'en crée aucun autre. La frontière est une règle de dépendance, tenue
par la revue et — là où c'est utile — par un test structurel, comme le dépôt le fait déjà pour
d'autres invariants (`gardeSessionAtlas.structurel.test.ts`,
`reperesRelationnels.frontiere.test.ts`).

Un découpage physique reste possible plus tard. Rien de ce qui est décidé ne l'exige ni ne l'interdit.

---

## Trois lectures du même produit

Les trois modes de fonctionnement visés n'utilisent pas des DOMIORA différents : **le même Core**,
avec plus ou moins de connecteurs actifs.

### 1. Conseiller de réseau (ex. IAD)

Le réseau détient déjà les mandats, une partie des contacts, et des données propres à son modèle
(filleuls, réseau, récurrence).

- **CORE** — complet, mais alimenté en partie par le connecteur réseau.
- **CONNECTORS** — un connecteur réseau, en lecture d'abord. Les mandats et contacts arrivent avec
  leur identifiant d'origine ; le conseiller corrige dans DOMIORA ce qui doit l'être, et ses
  corrections ne sont pas écrasées à la synchronisation suivante (ADR-056).
- **PACKS** — c'est ici, et seulement ici, que vivent les notions propres au réseau. Elles
  n'entrent jamais dans le Core.
- **INTELLIGENCE / AUTOMATIONS** — identiques à tous les autres modes.

Ce que DOMIORA n'a pas à ressaisir : ce que le réseau détient déjà.

### 2. Agence sans CRM

Aucune source externe de données métier.

- **CORE** — c'est le CRM. Seul mode où DOMIORA est la source de vérité de bout en bout.
- **CONNECTORS** — aucun, ou seulement les connecteurs de productivité (agenda, email).
- **SYNC ENGINE** — inerte. Le produit fonctionne entièrement sans lui.
- **INTELLIGENCE / AUTOMATIONS** — identiques.

C'est le mode dans lequel le produit fonctionne aujourd'hui.

### 3. Agence avec un CRM existant

Le CRM en place reste l'outil de saisie ; DOMIORA apporte la couche de pilotage.

- **CORE** — présent et complet, mais majoritairement alimenté par le connecteur. Il reste
  indispensable : les moteurs ne savent lire que le Core.
- **CONNECTORS** — un connecteur CRM tiers, souvent en lecture seule au départ.
- **SYNC ENGINE** — c'est le mode qui l'exerce le plus : source de vérité déclarée côté CRM,
  verrous de champs sur ce que le conseiller corrige dans DOMIORA, conflits rendus visibles.
- **INTELLIGENCE / AUTOMATIONS** — identiques.

Ce mode est la traduction technique de « couche d'intelligence au-dessus d'un CRM existant » : rien
dans le Core ne change, seule la provenance des données change.

---

## Ce qui existe déjà de cette frontière (ADR-056, migration `0039`)

La frontière est **logique, pas physique** : elle n'exige ni worker, ni package séparé. Ce qui est
posé aujourd'hui en est le strict nécessaire.

```
CONNECTEURS ──> SYNC ENGINE ──> CORE <── INTELLIGENCE / AUTOMATISATIONS <── PACKS
```

| Couche | Ce qui existe | Ce qui n'existe pas |
|---|---|---|
| **CONNECTEUR** | rien | aucun connecteur, aucun SDK fournisseur dans `package.json` |
| **SYNC ENGINE** | `references_externes`, `champs_verrouilles`, `lib/provenance/` | aucun moteur, aucune synchronisation exécutée, aucune table de conflit |
| **CORE** | inchangé | il ne connaît toujours aucun fournisseur |

**Le Core ne dépend de personne**, et c'est vérifié : un test structurel échoue si un moteur pur ou
un écran importe `lib/provenance/`, ou si une entité canonique gagne une colonne d'identifiant
fournisseur.

**Les capacités sont une propriété, pas un réglage.** Un connecteur déclare, par type d'entité,
`read_only` / `pull` / `push` / `bidirectionnel`. Sans `push`, il ne peut structurellement jamais
écrire vers l'extérieur — et **l'omission vaut refus**, jamais permission par défaut.

**Une correction humaine est prioritaire, sans condition.** Un champ verrouillé n'est jamais réécrit
par une synchronisation, même quand le fournisseur fait foi ; le désaccord devient un conflit, jamais
un log silencieux. Voir `docs/DATA_MODEL.md`.

## Ce que cette carte ne dit pas

- Ce qui est **construit** aujourd'hui : voir `docs/ARCHITECTURE.md` (état réel, avec sa mise en
  garde d'obsolescence) et l'audit de septembre 2026.
- Les **limites connues** : `docs/KNOWN_LIMITATIONS.md`.
- Les **règles métier** : `docs/BUSINESS_RULES.md`.
- Les **décisions** : les ADR. Ce document ne les résume pas — il indique laquelle ouvrir.
