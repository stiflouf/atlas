# Limites connues — Atlas (`apps/web`)

Inventaire honnête de ce qui reste incomplet, volontairement hors périmètre, ou identifié comme
dette technique pendant l'audit du code (2026-08-11). Rien ici n'est un jugement négatif sur les
choix faits — chaque limite listée correspond à une décision de scope assumée à un moment donné.

## Fonctionnalités encore mock-only

- **Onglet "Visites → Effectuées"** — pour un bien réel, lit désormais `comptes_rendus_visite`
  (date, acquéreur résolu via `getClientById`, intérêt, retour brut, prochaine étape) ; pour un
  bien mocké avec `DossierBien`, comportement inchangé (`dossier.visitesEffectuees`). Si
  l'acquéreur d'un compte rendu ne peut pas être résolu (cas normalement impossible, la FK de
  `comptes_rendus_visite` garantit son existence — ADR-010), l'UI affiche "Acquéreur indisponible"
  plutôt que d'inventer un nom.
- **Onglet "Visites → À venir"** — lit exclusivement le mock statique `data/agenda.ts`
  (`rendezVousDuJour`), jamais `getAgendaSemaine()`/Google Calendar. Un bien réel n'affichera donc
  jamais ses vraies visites à venir dans cet onglet, même avec Google Calendar connecté.
- **Préparation de visite curatée** — un seul exemple mocké (`data/preparations.ts`,
  `prep-rdv-001`). Tout autre couple bien/acquéreur retombe sur une préparation minimale
  (faits réels uniquement, aucune section qualitative).
- Détail complet de la logique démo/réel : `docs/DEMO_VS_REAL.md`.

## Code mort identifié

- **`src/components/visite/PrepObjections.tsx`** n'est importé nulle part dans le code — aucune
  page ne le rend. Fonctionnel en isolation (accordéon d'objections/réponses), mais inatteignable.
- **`PreparationVisite.objectionsProbables`, `.contextQuartier`, `.contexteHumain`** (types
  définis dans `src/types/preparation.ts`, valeurs présentes dans le mock
  `data/preparations.ts`) ne sont lus par aucune page — seul `.questionsASuggerer` est
  effectivement rendu dans `visites/[id]/preparer/page.tsx`.
- Le commentaire de `src/types/preparation.ts` anticipe un remplacement du mock par une
  génération IA ("quand on branchera la vraie IA") — cette IA n'existe pas dans le code (voir
  "Pas de LLM" ci-dessous). L'intention documentée ne doit pas être confondue avec l'état actuel.

## Absence d'édition et de suppression

- **Notes** (`notes_bien`) et **comptes rendus de visite** (`comptes_rendus_visite`) sont
  append-only par choix (ADR-011) : aucune Server Action de modification ou de suppression.
  Corriger une erreur de saisie nécessite une intervention directe en base.
- **Actions** peuvent être créées et terminées, mais pas éditées (titre, priorité, échéance
  figés après création) ni supprimées.
- **Biens et acquéreurs** ont une page d'édition (`/biens/[id]/modifier`, `/clients/[id]/modifier`,
  réservée aux entités réelles — un bien/acquéreur mocké n'a pas de bouton "Modifier"), mais
  **aucune suppression physique** n'existe pour l'un ni pour l'autre. `modifie_le` est rafraîchi
  explicitement à chaque édition (`modifierBien()`/`modifierAcquereur()`, mêmes validations
  serveur que la création — voir `docs/adr/007-repositories-server-components.md`). Depuis
  ADR-012, un bien/acquéreur peut être **archivé** (`/biens?archives=1`, `/clients?archives=1`) —
  une sortie réversible des flux actifs, toujours pas une suppression. Limites de ce mécanisme :
  aucune règle d'archivage automatique (ex. archiver un mandat expiré depuis longtemps) n'existe,
  l'archivage est toujours un geste manuel du conseiller ; aucun archivage groupé (un bien/
  acquéreur à la fois).
- **Documents** (`documents_bien`) : append-only comme Notes/Comptes rendus, **aucune suppression
  en V1**, ni de la métadonnée ni du fichier physique. Voir ADR-013 pour la justification et le
  garde-fou à respecter le jour où une suppression sera implémentée (`ON DELETE CASCADE` seul ne
  nettoiera jamais le fichier).

## Documents réels : stockage local V1

- **Pas de persistance garantie hors dev local.** `apps/web/stockage-documents/` n'a pas de volume
  dédié (contrairement à Postgres) — un futur déploiement serverless/conteneurisé sans volume
  monté perdrait les fichiers à chaque redéploiement. Non problématique aujourd'hui (aucune cible
  de déploiement n'existe), verrou explicite pour plus tard — voir ADR-013.
- **Aucune sauvegarde automatique** de ce répertoire (un `pg_dump` seul ne couvre pas les fichiers).
- **Deux limites de taille non alignées, comportement vérifié en conditions réelles** : un upload
  entre 10 et 11 Mo est rejeté proprement par la validation applicative (redirection silencieuse,
  aucune écriture) ; un upload dépassant 11 Mo (`serverActions.bodySizeLimit`, `next.config.ts`)
  échoue en erreur serveur (500) **avant** d'atteindre cette validation — pas de message utilisateur
  propre dans ce cas, seulement le crash générique de Next.js. Corriger ce cas proprement
  nécessiterait une validation côté client (taille du fichier avant soumission), hors périmètre V1.
- **Liste blanche de types de fichiers volontairement restreinte** (`application/pdf`,
  `image/jpeg`, `image/png`) — pas de Word/Excel, pas d'archives ZIP, pas de scans TIFF.
- **Un seul fichier par soumission** — pas d'upload multiple en une fois.

## Statut commercial du bien

- **Historique dérivé non append-only pour "Offre en cours"/"Compromis signé"** (ADR-014),
  contrairement à toutes les autres sources de l'historique dérivé (bien créé, actions, visites).
  Ces deux événements sont recalculés en direct depuis `offreEnCoursLe`/`compromisSigneLe` :
  **annuler un jalon efface rétroactivement l'événement correspondant de l'historique affiché**,
  comme s'il n'avait jamais existé — pas de journal immuable des transitions passées. Conséquence
  assumée du choix "timestamps de jalons plutôt qu'un enum" pour rester minimal (voir ADR-014).
- **Aucune donnée réelle ne permet de dériver automatiquement ces jalons** (aucune notion d'offre
  ou de compromis structurée dans `comptes_rendus_visite`/`actions`) — geste manuel du conseiller
  exclusivement, jamais automatisé.
- **Pas de "dernière activité" réelle** pour le bandeau "État du dossier" d'un bien réel,
  contrairement au mock (`dossier.derniereActivite`, valeur statique) — seul le badge de statut
  est affiché.

## Offres structurées

- **Transitions de statut non réversibles en V1** — une fois `acceptee`/`refusee`/`retiree`,
  aucune action ne permet de revenir à `en_cours` ni de changer vers un autre statut final. Une
  erreur de saisie nécessite une intervention directe en base (ADR-015).
- **Aucun historique des changements de statut** : ni dans l'onglet Offres (seul le statut courant
  est affiché, pas les dates de transition), ni dans l'historique dérivé du bien (un seul
  événement par offre, à la création — voir `docs/BUSINESS_RULES.md`). Conséquence du choix de ne
  pas ajouter de champ `statutModifieLe` non demandé (ADR-015).
- **Préparation de visite non enrichie** : la "Mémoire du dossier" (page de préparation) n'affiche
  pas encore les offres précédentes du couple bien/acquéreur — extension naturelle documentée mais
  non implémentée dans cette passe (ADR-015).
- **Bandeau "État du dossier" inchangé** : ne montre toujours que le badge générique
  (`en_commercialisation`/`offre_en_cours`/`compromis_signe`), pas le détail de l'offre en cours
  (montant, acquéreur) — consultable uniquement dans l'onglet Offres.

## Compromis structuré

- **Transitions de statut non réversibles en V1** — une fois `realise`/`annule`, aucune action ne
  permet de revenir à `en_cours`. Une erreur de saisie (y compris `dateActeReelle`) nécessite une
  intervention directe en base (ADR-016/ADR-017).
- **Historique des changements de statut limité à `realise`** : seule cette transition produit un
  événement daté (`"Vente finalisée"`, grâce à `dateActeReelle` — ADR-017) ; `annule` n'en produit
  toujours aucun, même limite qu'Offres (pas de champ de date de transition générique).
- **Sélection de l'offre acceptée non filtrée par acquéreur** : le formulaire "Ajouter un
  compromis" liste toutes les offres `acceptee` du bien, tous acquéreurs confondus (impossible de
  filtrer dynamiquement sans JS côté client) — si le conseiller choisit une offre d'un autre
  acquéreur que celui sélectionné, la Server Action refuse explicitement plutôt que d'ignorer
  silencieusement l'incohérence.
- **Un seul compromis actif à la fois par bien**, garde applicative (pas une contrainte SQL) — un
  bug applicatif pourrait théoriquement la contourner, contrairement à une contrainte d'unicité en
  base qui l'empêcherait structurellement.
- **Préparation de visite non enrichie** : contrairement à Offre, ce n'est pas considéré comme une
  extension naturelle — un bien avec compromis signé n'est normalement plus en phase de visite
  active (ADR-016).
- **Bandeau "État du dossier"** : affiche désormais un badge "Vendu" (ADR-017) mais toujours aucun
  détail (prix, acquéreur, dates) — consultable uniquement dans l'onglet Compromis.
- **Aucun couplage automatique** vers l'archivage du bien, `stadeProjet` de l'acquéreur, ou une
  quelconque commission/facturation lors d'une vente réalisée — gestes manuels volontairement
  séparés (ADR-017), pas des oublis.
- **Aucune métrique ni tableau de bord calculés** à partir de `dateActe`/`dateActeReelle` dans
  cette passe (pas de délai moyen, pas de CA prévisionnel/réalisé, pas de taux de conversion, pas
  d'analyse des ventes perdues) — cette passe prépare uniquement des données propres pour un
  pilotage futur, ne construit aucun calcul ni affichage agrégé (ADR-017).

## Limites du moteur de matching

- Entièrement déterministe, à base de mots-clés et de seuils fixes (`docs/BUSINESS_RULES.md`) —
  aucun apprentissage, aucune amélioration automatique avec l'usage.
- Sensible à la formulation exacte du titre/lieu de l'événement calendrier ; un intitulé inhabituel
  peut ne matcher aucun bien/acquéreur alors qu'un humain le reconnaîtrait immédiatement.
- L'**acquéreur** n'a pas de mécanisme de confirmation en cas d'ambiguïté (contrairement au bien,
  qui propose une bannière de choix) — un acquéreur ambigu reste simplement non résolu.

## Limites Google Calendar

- Lecture seule (`scope: calendar.events.readonly`) — Atlas n'écrit jamais dans Google Calendar.
- Uniquement le calendrier **primaire** du compte connecté (pas de calendriers secondaires/partagés).
- Fenêtre de lecture strictement **future** (7 jours à venir, `getAgendaSemaine()`) — aucun
  événement passé n'est jamais récupéré, ce qui exclut structurellement toute reconstruction
  automatique de visites passées depuis Google Calendar (justifiant que l'historique des visites
  passe par le compte rendu manuel, pas par une lecture rétroactive du calendrier).
- Une seule connexion possible à la fois (`connexions_google`, une ligne, produit mono-conseiller
  — ADR-006). Pas de webhook Google : chaque chargement de page relit l'agenda à la demande, pas
  de synchronisation en tâche de fond.

## Pas de LLM

Confirmation factuelle (recherche exhaustive dans `src/`, aucune dépendance dans `package.json`) :
aucune fonctionnalité actuelle n'utilise de modèle de langage. Tous les textes affichés sont soit
des faits bruts (bien, acquéreur, notes, retours), soit produits par des règles déterministes sur
champs structurés (`docs/BUSINESS_RULES.md`, ADR-008). ADR-004 prévoit un usage futur progressif —
non commencé à ce jour.

## Pas de multi-utilisateur

Produit mono-conseiller assumé (ADR-006) : aucune table utilisateur, aucune session, aucune
notion de "qui a fait quoi". `connexions_google` et le nom affiché dans `Sidebar.tsx`
("Steven Gausset", codé en dur) le confirment. Introduire un second conseiller nécessiterait une
refonte de plusieurs tables (au minimum `connexions_google`, `memoire_contextuelle`, et
potentiellement `actions`/`notes_bien`/`comptes_rendus_visite` pour savoir qui a écrit quoi).

## Dette technique identifiée dans le code

- **Filtrage par département dans `lib/patrimoine/merimeeClient.ts`** : dérivé du préfixe à 2
  chiffres du code postal — ne gère pas correctement la Corse (2A/2B). Non bloquant tant qu'aucun
  bien corse n'est traité (commentaire explicite dans le code).
- **API DVF (`lib/marche/dvfClient.ts`)** hébergée en préprod par le Cerema (`apidf-preprod.cerema.fr`)
  — testée fiable en usage réel mais sans garantie de disponibilité annoncée par le fournisseur.
- **Aucune pagination** sur les listes actuelles (biens, acquéreurs, actions, notes, comptes
  rendus) — chaque liste est chargée intégralement. Non problématique au volume de données actuel.
- **`NavItems.tsx`** (navigation principale) ne référence ni `/actions/nouveau` ni
  `/visites/[id]/preparer` — accès uniquement contextuel (liens depuis une fiche ou l'accueil),
  cohérent avec leur usage mais à garder en tête si un futur audit UX cherche ces routes dans le
  menu.
- **Tests** : mélange de tests purs (aucune dépendance externe) et de tests d'intégration qui
  exigent un Postgres local démarré et migré (`compteRenduVisiteRepository.test.ts`,
  `noteBienRepository.test.ts`, `actionRepository.test.ts`, `bienRepository.test.ts`,
  `clientRepository.test.ts`) — aucune configuration de CI n'a été trouvée dans le repo pour les
  exécuter automatiquement. **À confirmer** si une CI existe hors
  du repo (GitHub Actions, etc.).

## Architecture cible non construite

Rappel (détaillé dans `docs/ARCHITECTURE.md`) : ADR-003/004/005 décrivent une cible (API Python/
FastAPI, worker de connecteurs, stratégie LLM) qui n'existe pas dans le code aujourd'hui. Ce n'est
pas une limite du produit actuel, mais un écart à ne pas confondre avec l'état réel — voir aussi
`docs/AI_HANDOFF.md#ne-pas-supposer`.
