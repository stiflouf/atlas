# ADR-004 — Stratégie IA : progressive, SDK-first, Human-in-the-Loop

**Statut :** Accepté
**Date :** 2026-08-07
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Atlas est un compagnon IA métier, pas un chatbot. L'IA doit préparer, proposer et organiser — jamais agir seule vers un client. La complexité IA doit croître progressivement pour ne pas surcharger l'architecture avant que les besoins soient connus.

## Décision

### SDK-first

Pas de framework d'orchestration imposé dès le départ. On part des SDK LLM directement (Anthropic SDK). Une couche d'orchestration (LangChain, LlamaIndex, etc.) sera introduite uniquement si la complexité des agents le justifie — pas par anticipation.

### Progressivité en trois phases

1. **POC — Réactif :** l'utilisateur déclenche une action, Atlas produit un résultat structuré (préparation de visite, résumé de dossier, brouillon de relance).
2. **Phase 2 — Semi-proactif :** Atlas détecte des situations (dossier stagnant, relance oubliée, délai approchant) et propose des actions.
3. **Phase 3 — Proactif :** Atlas anticipe sans être sollicité, suggère des opportunités, prépare la journée automatiquement.

### Human-in-the-Loop — principe non négociable

Aucune action à conséquence externe (envoi de mail, création d'événement calendrier, modification d'un dossier CRM) ne peut être exécutée sans validation explicite du conseiller. Atlas propose, le conseiller décide toujours.

Ce principe doit être visible dans l'UI : toute action suggérée par l'IA comporte un bouton de validation explicite.

## Conséquences

- Le code IA reste simple et lisible au POC (pas d'abstraction prématurée)
- Si on migre vers une couche d'orchestration, le changement est localisé dans `apps/worker/`
- Les outputs IA doivent être des **structures de données typées**, pas du texte brut — pour que l'UI puisse les afficher, modifier et valider proprement. Ce principe s'applique dès le Sprint 1 sur les mocks.
- Le design de l'UI doit prévoir les patterns de validation HITL dès les maquettes
