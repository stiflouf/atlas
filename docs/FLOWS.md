# Parcours principaux — Atlas (`apps/web`)

Trois parcours bout-en-bout, avec les fichiers/fonctions réellement impliqués à chaque étape.
Détail des règles évoquées ici : `docs/BUSINESS_RULES.md`. Détail du schéma : `docs/DATA_MODEL.md`.

## 1. Google Calendar → préparation → compte rendu → historique du bien

```mermaid
flowchart TD
    A["Google Calendar
    getAgendaSemaine()
    lib/google/agendaSource.ts"] --> B{"Connexion Google
    valide ?"}
    B -- non / erreur --> M["Mocks
    data/agenda.ts
    source: demo / demo_erreur"]
    B -- oui --> C["listerEvenements()
    fenêtre 7 jours
    lib/google/calendarClient.ts"]
    C --> D["toRendezVous()
    lib/google/adapter.ts
    → RendezVous"]
    D --> E["construireContexte()
    lib/matching/index.ts
    → bien/acquéreur/type candidats"]
    E --> F["resoudreContextePersiste()
    lib/contexteRepository.ts
    validation humaine > cache > moteur"]
    F --> G["Accueil (/)
    CTA Préparer si confiance suffisante"]
    G --> H["/visites/[id]/preparer
    getRendezVousAvecContexte()"]
    H --> I["Points d'attention / Points forts
    + Mémoire du dossier
    (notes, actions, comptes rendus, historique)"]
    I --> J["Formulaire compte rendu
    enregistrerCompteRenduVisiteAction"]
    J --> K["comptes_rendus_visite
    (Postgres)"]
    K --> L["deriverHistoriqueBien()
    → onglet Historique de /biens/[id]"]
```

### Détail étape par étape

1. **Récupération** — `getAgendaSemaine()` lit d'abord `connexions_google` (Postgres). Sans
   connexion ou en cas d'erreur Google, repli sur les rendez-vous mockés (`data/agenda.ts`),
   avec une source explicitement différenciée (`demo` vs `demo_erreur`) — jamais présentée comme
   du réel.
2. **Matching** — `construireContexte()` calcule un bien, un acquéreur et un type métier
   candidats par des règles déterministes sur le titre/lieu
   (`docs/BUSINESS_RULES.md#matching-rendez-vous-bienacquéreurtype`).
3. **Résolution persistée** — uniquement pour les rendez-vous Google (id `gcal-...`) :
   `resoudreContextePersiste()` applique la priorité validation humaine > cache > recalcul
   (`memoire_contextuelle`). Les rendez-vous mockés portent déjà leur bien/acquéreur en dur et
   n'entrent jamais dans ce mécanisme.
4. **CTA "Préparer"** — affiché sur l'accueil dès que la confiance de résolution est suffisante
   (bien et acquéreur non ambigus).
5. **Préparation** — `/visites/[id]/preparer` réappelle `getRendezVousAvecContexte()`, résout le
   `Bien`/`ProfilAcquereur` réels via les repositories, calcule points d'attention/points forts
   (uniquement sur champs structurés), et assemble la Mémoire du dossier : comptes rendus
   précédents pour ce couple bien+acquéreur, notes récentes du bien, actions ouvertes, historique
   récent.
6. **Compte rendu** — le formulaire en bas de la page de préparation appelle
   `enregistrerCompteRenduVisiteAction`, qui valide `retour` (non vide) et `interet` (une des 4
   valeurs contrôlées) avant d'insérer dans `comptes_rendus_visite`.
7. **Historique** — au prochain chargement de `/biens/[id]`, `deriverHistoriqueBien()` inclut ce
   nouveau compte rendu comme événement `"Visite effectuée — {label}"`, aux côtés des événements
   liés aux actions du bien.

## 2. Création d'un bien/acquéreur → bascule démo → réel

```mermaid
flowchart TD
    A["/biens/nouveau ou /clients/nouveau
    formulaire"] --> B["creerBienAction /
    creerAcquereurAction"]
    B --> C["creerBien() / creerAcquereur()
    lib/bienRepository.ts / clientRepository.ts"]
    C --> D[("INSERT
    biens / acquereurs")]
    D --> E["Redirection vers
    la fiche créée"]
    E --> F["Prochain appel à
    listerBiens() / listerClients()"]
    F --> G{"Au moins une ligne
    réelle existe ?"}
    G -- oui --> H["Retourne UNIQUEMENT
    les lignes réelles
    — mocks totalement ignorés"]
    G -- non --> I["Retourne les mocks
    data/biens.ts / data/clients.ts"]
    H --> J["Matching (construireContexte)
    utilise désormais le référentiel réel"]
```

Détail complet de cette bascule (pourquoi elle est stricte, ce qui devient inaccessible côté
mocks) : `docs/DEMO_VS_REAL.md`.

## 3. Création d'une tâche → priorisation → terminaison (ADR-028)

```mermaid
flowchart TD
    A["/taches/nouveau
    (éventuellement préempli
    ?bienId=... / ?acquereurId=...
    / ?prospectVendeurId=...)"] --> B["creerTacheAction
    actions/creerTache.ts"]
    B --> C["creerTache()
    lib/tacheRepository.ts"]
    C --> D[("INSERT taches
    au plus une FK cible renseignée
    (CHECK taches_une_seule_cible_check)")]
    D --> E{"Cible renseignée ?"}
    E -- bien_id --> F["Accueil : section
    'Dossiers nécessitant une action'
    (regroupées par bien, tachePrioritaire)"]
    E -- acquereur_id / prospect_vendeur_id / aucune --> G["Accueil : section
    'Autres tâches'
    (triées par scoreTache)"]
    E -- bien_id --> H["Fiche bien (/biens/[id])
    onglet Tâches"]
    E -- acquereur_id --> H2["Fiche client (/clients/[id])"]
    E -- prospect_vendeur_id --> H3["Fiche prospect vendeur
    (/prospects-vendeurs/[id])"]
    F --> I["Conseiller clique
    'Terminer'"]
    G --> I
    H --> I
    H2 --> I
    H3 --> I
    I --> J["terminerTacheAction
    actions/terminerTache.ts"]
    J --> K["terminerTache()
    UPDATE terminee_le=now()
    (gel concurrent : WHERE terminee_le
    IS NULL AND annulee_le IS NULL)"]
    K --> K2{"prospect_vendeur_id renseigné
    ET case 'interaction' cochée ?"}
    K2 -- oui --> K3["ajouterNoteProspectVendeur()
    (ADR-027, opt-in explicite,
    écriture séquentielle distincte)"]
    K2 -- non --> L
    K3 --> L["Disparaît des listes actives
    (scoreTache = -Infinity)"]
    L --> M["Apparaît dans l'historique dérivé
    du bien si bien_id renseigné"]
```

### Détail étape par étape

1. **Création** — `/taches/nouveau` peut être atteint directement, ou préempli depuis une fiche
   bien/acquéreur/prospect vendeur (`?bienId=`/`?acquereurId=`/`?prospectVendeurId=`) via un lien
   "+ Ajouter une tâche" — le conseiller reste libre de modifier l'association avant de soumettre.
2. **Association** — une tâche concerne au plus une cible parmi bien, acquéreur, prospect vendeur,
   visite, offre, compromis, rémunération (sept FK dédiées, `CHECK` en base) — ou aucune ; jamais
   de génération automatique depuis un compte rendu de visite ou une note.
3. **Priorisation** — `tachePriority.ts` (`docs/BUSINESS_RULES.md#tâches-adr-028`) trie toutes les
   vues (accueil, fiches, Mémoire du dossier) avec le même moteur.
4. **Terminaison** — `terminerTache()` pose `terminee_le` par une écriture atomique protégée
   (`WHERE terminee_le IS NULL AND annulee_le IS NULL`) — un second appel concurrent ne touche
   aucune ligne et retourne `undefined`, jamais un écrasement silencieux. Un id non-UUID (tâche
   mockée) est silencieusement ignoré plutôt que de provoquer une erreur de cast Postgres.
   Terminer une tâche **ne signifie jamais** silencieusement "contact réalisé" : pour une tâche
   rattachée à un prospect vendeur, `terminerTacheAction` peut *optionnellement*, dans le même
   geste, enregistrer une vraie interaction (mécanisme ADR-027) si le conseiller coche
   explicitement la case prévue à cet effet — jamais automatique, jamais pour les autres cibles.
5. **Annulation** — `annulerTache()` (`annulerTacheAction`) pose `annulee_le` avec le même patron
   de gel concurrent, mutuellement exclusif avec `terminee_le`.
6. **Historique** — une tâche terminée ou annulée liée à un bien apparaît dans l'historique dérivé
   (`"Tâche terminée : {titre}"` / `"Tâche annulée : {titre}"`), aux côtés des comptes rendus de
   visite du même bien.
