# ADR-005 — Architecture d'intégrations : standalone POC, connecteurs futurs

**Statut :** Accepté
**Date :** 2026-08-07
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Le POC ne dépend d'aucun outil externe. À terme, Atlas devra se connecter à des tiers : Google Calendar, Google Maps, messagerie (Gmail, Outlook), CRM immobiliers, portails (SeLoger, Logic Immo), outils des réseaux (Century 21, Orpi, IAD, etc.).

La liste est longue et hétérogène. L'architecture doit permettre d'ajouter ces connecteurs proprement, sans contaminer le cœur de l'application.

## Décision

**POC :** zéro dépendance externe, toutes les données sont mockées.

**Architecture cible :** chaque intégration est un connecteur isolé, derrière une interface commune. Les connecteurs vivent dans `apps/worker/connectors/` et sont appelés par le worker — jamais directement par l'API.

```
apps/worker/
└── connectors/
    ├── google_calendar.py
    ├── gmail.py
    ├── seloger.py
    └── ...
```

Interface commune (protocole Python) :

```python
class Connector(Protocol):
    async def pull(self, user_id: str) -> ConnectorResult: ...
    async def push(self, payload: ConnectorPayload) -> ConnectorResult: ...
```

Les données importées sont normalisées dans le schéma Atlas avant d'être stockées — l'UI ne connaît jamais le schéma du CRM ou du portail.

## Alternatives écartées

**Intégrations directes depuis l'API :** crée un couplage fort entre la logique métier et les dépendances externes. Difficile à tester, difficile à faire évoluer.

**iPaaS (Zapier, Make) :** perd le contrôle sur la logique de transformation et les conditions de synchronisation. Trop tôt pour externaliser ça.

## Conséquences

- L'API reste propre : zéro appel vers des services tiers
- Chaque connecteur peut être développé, testé et désactivé indépendamment
- Les données CRM ou portail importées sont toujours normalisées — pas de schéma externe exposé dans l'UI
- Sprint 1 : aucun connecteur, aucune intégration
