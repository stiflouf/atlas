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

## 3. Création d'une action → priorisation → terminaison

```mermaid
flowchart TD
    A["/actions/nouveau
    (éventuellement préempli
    ?bienId=... ou ?acquereurId=...)"] --> B["creerActionAction
    actions/creerAction.ts"]
    B --> C["creerAction()
    lib/actionRepository.ts"]
    C --> D[("INSERT actions
    statut = a_faire")]
    D --> E{"bien_id / acquereur_id
    renseigné ?"}
    E -- bien_id --> F["Accueil : section
    'Dossiers nécessitant une action'
    (regroupées par bien, actionPrioritaire)"]
    E -- acquereur_id ou aucun --> G["Accueil : section
    'Autres actions'
    (triées par scoreAction)"]
    E -- bien_id --> H["Fiche bien (/biens/[id])
    onglet Actions"]
    F --> I["Conseiller clique
    'Terminer'"]
    G --> I
    H --> I
    I --> J["terminerActionAction
    actions/terminerAction.ts"]
    J --> K["terminerAction()
    UPDATE statut=termine,
    termine_le=now() — même écriture SQL"]
    K --> L["Disparaît des listes actives
    (scoreAction = -Infinity)"]
    L --> M["Apparaît dans l'historique dérivé
    du bien si bien_id renseigné"]
```

### Détail étape par étape

1. **Création** — `/actions/nouveau` peut être atteint directement, ou préempli depuis la fiche
   bien/acquéreur (`?bienId=`/`?acquereurId=`) via un lien "+ Ajouter une action" — le conseiller
   reste libre de modifier l'association avant de soumettre.
2. **Association** — une action peut concerner un bien, un acquéreur, les deux, ou aucun des
   deux ; jamais de génération automatique depuis un compte rendu de visite ou une note.
3. **Priorisation** — `actionPriority.ts` (`docs/BUSINESS_RULES.md#priorité-des-actions`) trie
   toutes les vues (accueil, fiche bien, Mémoire du dossier) avec le même moteur.
4. **Terminaison** — `terminerAction()` pose `statut` et `termine_le` dans la **même** requête SQL
   (jamais deux écritures séparées, pour ne jamais avoir une action "terminée" sans date ou
   l'inverse). Un id non-UUID (action mockée) est silencieusement ignoré plutôt que de provoquer
   une erreur de cast Postgres.
5. **Historique** — une action terminée liée à un bien apparaît dans l'historique dérivé
   (`"Action terminée : {titre}"`), aux côtés des comptes rendus de visite du même bien.
