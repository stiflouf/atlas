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
- **Historique des changements de statut disponible depuis ADR-020, mais pas rétroactif** :
  `dateDecision` produit désormais un événement d'historique par transition finale
  (`"Offre acceptée/refusée/retirée"`), mais uniquement pour les offres modifiées après la mise en
  place de cette fonctionnalité — les lignes déjà en `refusee`/`retiree` sans `dateDecision`
  n'affichent jamais ce second événement, sans rattrapage automatique.
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
- **Historique des changements de statut, `realise` et `annule` uniquement, pas rétroactif** :
  `realise` produit `"Vente finalisée"` (grâce à `dateActeReelle`, ADR-017), `annule` produit
  désormais `"Compromis annulé"` (grâce à `dateAnnulation`, ADR-020) — mais seulement pour les
  compromis annulés après la mise en place de cette fonctionnalité, sans rattrapage automatique
  des lignes déjà `annule` sans `dateAnnulation`.
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
- **Métriques et tableau de bord** : construits dans une passe ultérieure (ADR-018,
  `/dashboard`) — voir section dédiée ci-dessous.

## Dashboard commercial

- **Pas de CA, pas de fiscalité** — `remuneration` (ADR-021) instrumente désormais des montants de
  rémunération saisis, mais aucune notion comptable/juridique de chiffre d'affaires ou de
  reconnaissance fiscale n'est tranchée dans cette passe. Afficher un chiffre approximatif aurait
  été plus trompeur qu'une absence de métrique (ADR-018/ADR-021).
- **`prixConvenu` = volume de transaction, jamais le CA du conseiller** — rappelé dans l'UI à
  chaque métrique de volume, mais reste une donnée qu'un lecteur non averti pourrait mal
  interpréter hors contexte.

## Lien visite → offre (`offre_visites`)

- **Taux et délai visite → offre non rétroactifs** : `tauxVisiteOffre` et
  `delaiMoyenVisiteOffreJours` ne comptent que les visites explicitement liées à une offre après
  la mise en place de ce lien (ADR-019) — aucun rattrapage automatique de l'historique antérieur,
  ce serait de l'inférence. Le taux affiché est donc biaisé à la baisse tant que l'historique
  n'est pas rattaché manuellement, sans aucune limite de temps prévue pour ce rattrapage.
- **Aucun événement d'historique dédié** à la création ou au retrait d'un lien — seules la visite
  et l'offre elles-mêmes apparaissent dans l'historique du bien (ADR-019).
- **Aucune garde d'archivage sur la liaison** : un conseiller peut lier ou délier une visite et
  une offre même si le bien ou l'acquéreur est désormais archivé — choix volontaire (documenter un
  rapprochement entre faits existants n'est pas créer un nouveau fait commercial), mais qui
  diffère de la création d'une offre, elle bloquée sur une entité archivée.

## Motifs et dates de perte (ADR-020)

- **`dateDecision`/`motifPerte` (offres) et `dateAnnulation`/`motifAnnulation` (compromis) ne sont
  jamais rétroactifs, aucun backfill** : les offres `refusee`/`retiree` et compromis `annule`
  créés avant cette fonctionnalité restent valides sans date ni motif, et continuent de compter
  dans les totaux par étape (`offresRefusees`, `offresRetirees`, `compromisAnnules`) — mais sont
  silencieusement absents des répartitions par motif et des séries mensuelles, qui filtrent sur la
  colonne correspondante non nulle. Aucune tâche de rattrapage n'est prévue.
- **Un motif `NULL` historique n'est jamais reclassé vers `"autre"`** : la répartition par motif ne
  contient que les motifs explicitement renseignés — un motif inconnu reste invisible dans cette
  répartition plutôt que d'être fondu dans une catégorie fourre-tout qui fausserait sa taille
  réelle.
- **Aucun taux de conversion par cause en V1** : par exemple "des offres perdues pour désaccord de
  prix, combien redeviennent une offre acceptée sur le même bien plus tard" n'est pas construit
  dans cette passe — périmètre volontairement limité aux comptages/volumes/répartitions par motif
  et par mois.
- **Aucune déduction d'acteur depuis `refusee`/`retiree`** : ces deux statuts ne disent pas par
  eux-mêmes qui est à l'origine de la perte (acquéreur ou vendeur) — seul le motif explicitement
  choisi (`acquereur_se_retire`/`vendeur_se_retire`) le précise, et seulement si le conseiller l'a
  sélectionné.
- **`statutMandat` explicitement hors périmètre** : l'expiration ou la suspension d'un mandat
  n'est pas une perte commerciale au sens de ce funnel (visite → offre → compromis → vente) — c'est
  une notion orthogonale au cycle du mandat vendeur, analysable séparément plus tard si besoin.
- **Moyenne de visites avant vente exclut les ventes sans compte rendu** du dénominateur plutôt
  que de les compter comme 0 — une vente conclue sans compte rendu enregistré (visite non
  formalisée, vente par un tiers, etc.) reste donc invisible dans cette moyenne plutôt que de la
  tirer vers le bas (ADR-018).
- **Pas de filtre temporel, pas de graphiques** en V1 — le tableau de bord montre l'état courant
  (et les séries mensuelles en liste simple), pas d'évolution dans le temps comparée sur plusieurs
  périodes.
- **Agrégats non scindés par bien/acquéreur/conseiller** — un seul jeu de chiffres global (cohérent
  avec le modèle mono-conseiller, ADR-006), pas de vue par mandat ou par secteur.
- **Délais offre → compromis / compromis → acte non pondérés par le volume** — une vente à
  10 000 € et une vente à 500 000 € comptent également dans la moyenne des délais.

## Rémunération conseiller (ADR-021)

- **Encaissement unique en V1** : pas de paiement partiel, plusieurs versements, avoirs ni
  régularisations — une seule `dateEncaissementReelle` par rémunération, posée une fois pour toute
  la durée de vie de la ligne. Une future table `encaissements` pourrait introduire ces cas sans
  rupture de modèle, mais n'est pas construite dans cette passe.
- **Aucune notion comptable/juridique de "CA acquis"** — seulement trois états descriptifs
  (prévisionnelle / associée à une vente finalisée / encaissée), jamais une reconnaissance
  fiscale/comptable. Une future passe dédiée déterminera à quel moment une rémunération devient
  juridiquement/comptablement acquise et comment elle doit être traitée fiscalement.
- **Aucun calcul automatique** : ni `prixConvenu × taux`, ni `honoraires × pourcentage`, ni relation
  entre `montantHonorairesTotalCentimes` et `montantRemunerationConseillerCentimes` — uniquement des
  montants saisis à la main. Un conseiller qui saisit un montant incohérent avec le prix convenu du
  compromis n'est jamais corrigé ni alerté automatiquement.
- **Stockage en centimes propre à cette seule table** — divergence assumée avec
  `compromis.prixConvenu`/`offres.montant`, stockés en euros entiers ailleurs dans le schéma
  (première donnée financière précise d'Atlas, ADR-021).
- **Gel après encaissement, pas de correction rétroactive** : une fois `dateEncaissementReelle`
  posée, plus aucune correction des montants n'est possible depuis les actions existantes — une
  erreur de saisie constatée après encaissement nécessiterait une intervention directe en base ou
  une future passe encaissements/régularisations.
- **"Rémunération potentielle perdue" non construite** : un compromis annulé après création d'une
  rémunération prévisionnelle sort silencieusement du prévisionnel actif, sans qu'aucune métrique de
  dashboard n'agrège ces montants "perdus" — mentionné comme extension future possible, hors
  périmètre de cette passe.
- **Aucune extension de l'onglet Acquéreur** : la rémunération n'est visible que dans l'onglet
  Compromis de la fiche bien (`BienTabs.tsx`), pas dans `AcquereurFormulaire.tsx` — extension
  triviale à faire dans une passe ultérieure si besoin.

## Projection financière annuelle (ADR-022)

- **Sous-couverture silencieuse de "prévisionnel restant" et "encaissements attendus dépassés"** :
  les deux métriques dépendent entièrement de `dateEncaissementPrevue`, un champ optionnel que rien
  n'impose ni ne rappelle. Tant que son adoption reste faible, ces deux chiffres peuvent
  sous-estimer la réalité sans qu'aucun signal ne le révèle si le compteur de couverture n'est pas
  lu à côté — d'où l'affichage systématique de ce compteur, jamais un montant seul.
- **Aucun écart moyen `dateEncaissementPrevue → dateEncaissementReelle`** : la date prévue restant
  corrigible jusqu'à l'encaissement (ADR-021), elle ne reflète pas nécessairement la prévision
  initiale — un écart mesuré contre une valeur réécrite serait trompeur. Reporté à une éventuelle
  passe future d'historisation des corrections.
- **Un mois passé non nul dans la colonne "Prévisionnel" de la ventilation ne signifie pas un
  dépassement** au sens de "Encaissements attendus dépassés" — cette dernière est strictement
  réservée aux compromis `realise` ; un compromis encore `en_cours` dont la date prévue est déjà
  passée signale une vente qui traîne, pas un encaissement en attente.
- **Année civile fixe, pas de sélecteur** : aucun moyen de consulter une année passée ou future
  depuis le dashboard — cohérent avec l'absence de filtre temporel déjà actée en V1 (ADR-018), mais
  une limitation réelle pour qui voudrait comparer plusieurs années.

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
