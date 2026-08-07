# ADR-002 — Frontend : Next.js + TypeScript, web-first responsive

**Statut :** Accepté
**Date :** 2026-08-07
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Atlas doit fonctionner sur ordinateur et sur smartphone. Pas d'application native pour le POC. L'utilisation terrain (smartphone lors de visites) est un cas d'usage important — le design responsive n'est pas optionnel.

## Décision

- **Framework :** Next.js 14+ avec App Router
- **Langage :** TypeScript strict
- **Styling :** Tailwind CSS + Shadcn/ui (composants sur Radix UI)
- **Approche :** responsive dès le Sprint 1, pas de version desktop-only refactorée ensuite

Shadcn/ui : les composants sont copiés dans le repo (pas installés comme dépendance noire), ce qui facilite la personnalisation et l'évolution vers un design system maison.

## Alternatives écartées

**React SPA (Vite) :** pas de SSR, moins adapté à un dashboard métier dense en données.

**Remix :** excellent techniquement mais écosystème plus petit, moins de ressources disponibles.

**React Native / Expo :** trop lourd pour le POC. À reconsidérer si les usages terrain justifient une app native (notifications push, accès caméra, offline).

**PWA :** différé — à envisager en phase 2 si l'usage mobile sur le terrain est validé.

## Conséquences

- Tests sur mobile obligatoires dès le Sprint 1
- Navigation responsive à concevoir dès le départ (sidebar desktop / bottom nav ou menu hamburger mobile)
- Déploiement : Vercel (chemin de moindre résistance) ou Railway
