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
- **Onglet "Visites → À venir"** — **levé par ADR-040** pour un bien réel : lit désormais `visites`
  (statut `planifiee`, triées par `datePrevue`), matérialisées lors du passage par
  `/visites/[id]/preparer`. Pour un bien mocké avec `DossierBien`, comportement inchangé (mock
  statique `data/agenda.ts`). Reste néanmoins dépendant de la matérialisation : un rendez-vous
  Calendar jamais préparé une seule fois par le conseiller ne produit encore aucune ligne `visites`
  (aucun import automatique de tout le calendrier, ADR-040).
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
- **Tâches** (ADR-028) peuvent être créées, terminées ou annulées, mais pas éditées (titre,
  priorité, échéance, cible figés après création) ni supprimées.
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
- **Documents** (`documents_bien`) : le **fichier physique** reste append-only, **aucune
  suppression en V1**. Voir ADR-013 pour la justification et le garde-fou à respecter le jour où
  une suppression sera implémentée (`ON DELETE CASCADE` seul ne nettoiera jamais le fichier).
  Depuis ADR-029, les **métadonnées de classement** (bien rattaché, catégorie, type, dates,
  rattachements, provenance, état de vérification) sont corrigibles sans ré-upload
  (`corrigerClassementDocumentBienAction`) — voir "Dossier documentaire (ADR-029)" ci-dessous.

## Documents réels : stockage local V1

- **Pas de persistance garantie hors dev local.** `apps/web/stockage-documents/` n'a pas de volume
  dédié (contrairement à Postgres) — un futur déploiement serverless/conteneurisé sans volume
  monté perdrait les fichiers à chaque redéploiement. Non problématique aujourd'hui (aucune cible
  de déploiement n'existe), verrou explicite pour plus tard — voir ADR-013.
- **Aucune sauvegarde automatique** de ce répertoire (un `pg_dump` seul ne couvre pas les fichiers).
- **Deux limites de taille non alignées, comportement vérifié en conditions réelles** : un upload
  entre 10 et 11 Mo est rejeté proprement par la validation applicative (`throw` explicite depuis
  ADR-029, aucune écriture) ; un upload dépassant 11 Mo (`serverActions.bodySizeLimit`, `next.config.ts`)
  échoue en erreur serveur (500) **avant** d'atteindre cette validation — pas de message utilisateur
  propre dans ce cas, seulement le crash générique de Next.js. Corriger ce cas proprement
  nécessiterait une validation côté client (taille du fichier avant soumission), hors périmètre V1.
- **Liste blanche de types de fichiers volontairement restreinte** (`application/pdf`,
  `image/jpeg`, `image/png`) — pas de Word/Excel, pas d'archives ZIP, pas de scans TIFF.
- **Un seul fichier par soumission** — pas d'upload multiple en une fois.

## Dossier documentaire (ADR-029)

- **`typeDocument` est un vocabulaire PRODUIT, pas un référentiel juridique.** La liste
  (`TYPES_DOCUMENT`, `src/types/documentBien.ts`) reprend notamment le retour terrain d'une clerc
  de notaire pour la copropriété — aucune de ces pièces n'est une obligation légale codée, aucune
  source officielle n'a été auditée. Ne jamais présenter la checklist comme une liste légalement
  exhaustive.
- **Aucune durée légale de validité des diagnostics n'est codée.** `dateFinValidite` est purement
  déclarative (saisie manuelle) ; sans elle, l'exigence correspondante reste `a_verifier`, jamais
  déduite d'une durée par type de diagnostic. Un futur référentiel des durées légales devra suivre
  le même patron que `regle_fiscale` (source datée, statut de vérification) — non construit ici.
- **Pas d'entité `copropriete` dédiée.** `biens.nomCopropriete` et
  `documentsBien.coproprieteDeclaree`/`adresseDeclaree` sont de simples champs texte, comparables
  uniquement à l'œil par le conseiller — aucune détection automatique d'incohérence entre la
  copropriété/l'adresse déclarée d'un document et celle du bien. Le rattachement à trois états
  (`propose`/`confirme`/`rejete`) évoqué pour une future passe anti-mauvais-dossier n'existe pas.
- **Aucun OCR, aucun LLM, aucun rattachement automatique/probabiliste** — toute correction de
  classement ou de rattachement est un geste manuel explicite du conseiller.
- **Multi-acquéreurs non supporté.** `offres`/`compromis` portent un `acquereurId` scalaire — le
  rattachement documentaire par personne hérite de cette limite, une indivision/plusieurs
  acquéreurs sur un même compromis ne peut pas être représentée.
- **Un seul vendeur par bien.** `prospectVendeurId` sur un document ne peut référencer que le
  prospect ayant réellement converti ce bien (`prospects_vendeurs.bienId`, UNIQUE, ADR-027) —
  aucune indivision vendeur/plusieurs propriétaires n'est modélisée (même limite qu'ADR-027).
- **Correction de `bienId` via un champ texte libre** (identifiant du bien), pas un sélecteur —
  fonctionnel mais peu ergonomique pour réattribuer un document à un autre bien depuis l'UI ; une
  vraie recherche/sélection de bien serait une amélioration UX naturelle, non implémentée ici.
- **`chargeHonoraires` (`biens`) V1 volontairement binaire** (`vendeur`/`acquereur`) — aucune
  répartition réelle (montants/pourcentages par partie) n'est modélisée, `partagee` n'existe donc
  pas dans le vocabulaire. Ne pas confondre avec `remuneration.montantRemunerationConseillerCentimes`
  (ADR-021, part du conseiller) : deux faits distincts.
- **Checklist V1 volontairement minimale** (`REGLES_CHECKLIST`, `src/lib/documents/
  checklistDossier.ts`) : un noyau de règles par famille (les 7 pièces copropriété du retour
  terrain — règlement, EDD, PV AG, pré-état daté, fiche synthétique, carnet d'entretien,
  procédures syndic — ont chacune une exigence dédiée), mais pas une couverture exhaustive de
  tout le vocabulaire `typeDocument` (ex. `avenant`, `offre_pret`, `projet_acte` n'ont pas encore
  d'exigence de checklist associée). Étendre `REGLES_CHECKLIST` est additif, sans migration.
- **Aucune génération automatique de tâche depuis un constat documentaire** (ex. "pré-état daté
  manquant") — la checklist produit uniquement des constats affichés, la chaîne constat → règle
  d'automatisation → tâche ADR-028 reste un futur ADR, jamais un dual-write ici.

## Pack notaire (ADR-030)

- **Aucun ZIP en mémoire n'est écrit sur disque, mais aucune persistance non plus** : si la
  génération échoue en cours de route (fichier illisible, ex. suppression concurrente du fichier
  physique entre le chargement des métadonnées et la lecture), le conseiller doit relancer
  l'export depuis le début — aucune reprise partielle.
- **Résolu par ADR-047** : `POST /api/biens/[id]/pack-notaire` exige désormais une session Atlas
  (`exigerSessionAtlas()`) — l'agrégation de pièces sensibles en un seul point d'accès n'est plus
  atteignable anonymement. Reste vrai : cette protection est mono-conseiller (une seule identité
  autorisée), pas un contrôle d'accès par destinataire/tiers — l'envoi effectif à un notaire externe
  reste hors périmètre.
- **`MAX_TAILLE_PACK_OCTETS` (200 Mo) est une contrainte technique Atlas V1**, pas une règle
  métier ni légale — un dossier légitimement plus volumineux (nombreuses pièces copropriété par
  exemple) devra être exporté en plusieurs packs, aucun découpage automatique n'existe.
- **Aucune journalisation persistante** des générations/transmissions de pack — une vraie
  traçabilité (qui, quand, quel pack, quels documents) reste une évolution future ; l'authentification
  minimale existe désormais (ADR-047) mais rien n'enregistre encore qui a généré quel pack.
- **`REGLES_CHECKLIST` non exhaustive** (voir "Dossier documentaire (ADR-029)" ci-dessus) se
  répercute directement sur le pack : un type de document non couvert par une exigence n'apparaît
  jamais dans `selectionProposee`/`documentsDisponibles` via la checklist, mais reste listé comme
  n'importe quel autre document du bien dans `documentsDisponibles` (sélection manuelle toujours
  possible).
- **Pas de découpage par famille/lot** : un seul ZIP par génération, pas de pack partiel
  pré-configuré (ex. "uniquement les pièces copropriété").

## Communications / emails assistés (ADR-031)

- **Aucun envoi réel** : `mailto:` ouvre le client mail du conseiller, hors du contrôle d'Atlas —
  aucune confirmation d'envoi vérifiable, donc **aucune interaction n'est journalisée
  automatiquement** (ni `notesProspectVendeur`/`dernierContactLe`, ni ailleurs). Le conseiller doit
  ajouter lui-même une note s'il souhaite tracer l'échange.
- **Aucun journal d'interaction structuré pour `acquereurs`/`comptesRendusVisite`** — un email
  préparé pour un acquéreur n'est jamais écrit nulle part (ni dans `acquereurs.notes`, champ libre
  non typé, ni dans `taches`).
- **Aucun contact notaire structuré** : `message_notaire` est toujours en contenu seul, aucun
  destinataire n'est jamais résolu — `biens.notaireEmail` a été explicitement écarté (arbitrage
  ADR-031), une future modélisation notaire devra vivre au niveau transaction/parties.
- **Brouillon entièrement éphémère** : aucune sauvegarde, un rafraîchissement de page perd les
  modifications en cours — aucune fonctionnalité "reprendre plus tard" en V1.
- **Changer de ton régénère tout le texte** depuis les données du dossier — toute modification
  manuelle déjà faite est remplacée, jamais fusionnée.
- **Lien `mailto:` limité en longueur** (~1800 caractères) — au-delà, seule la copie du texte est
  proposée ; pas de troncature automatique du corps.
- **Résolution "tâche → rémunération" non câblée** : `remunerationRepository` n'expose aucun lookup
  par id de rémunération, une tâche rattachée à une rémunération retourne toujours 0 candidat.
- **Couche LLM de reformulation entièrement hors périmètre** : aucune dépendance, aucune clé API,
  aucun fournisseur choisi — la couche 1 (templates) reste seule en V1.

## Envoi Gmail réel (ADR-031-bis)

- **Révocation Google globale** : un refresh token couvre l'union des scopes accordés — impossible
  de révoquer Gmail seul en gardant Calendar (ou l'inverse) sans repasser par un consentement
  complet. Le bouton "Déconnecter" reflète cela honnêtement (libellé explicite une fois Gmail
  accordé) mais ne le résout pas.
- **Statut `gmailAutorise` optimiste, pas une vérification live** : reflète le dernier consentement
  accordé — si l'accès a été révoqué directement depuis le compte Google du conseiller, le badge
  reste "autorisé" jusqu'au prochain échec réel d'envoi.
- **Aucune reprise automatique d'un état `incertain`** : une tentative dont le résultat réel est
  inconnu (timeout/rupture réseau après déclenchement de l'envoi) reste `incertain` indéfiniment en
  base — aucun job de réconciliation ne vérifie a posteriori auprès de Gmail si l'email est
  réellement parti. Le conseiller doit vérifier manuellement.
- **Aucun journal d'interaction pour `acquereurs`/autres domaines** : un envoi confirmé vers un
  acquéreur n'est tracé nulle part au niveau CRM (contrairement à `prospectsVendeurs`) — seul
  `envois_email` (technique) en garde la preuve.
- **Une seule tentative "en vol" par écran de confirmation** : la clé d'idempotence protège une
  resoumission du même écran, mais deux écrans de confirmation ouverts en parallèle (deux onglets)
  pour le même destinataire/objet généreraient deux clés distinctes, donc potentiellement deux
  envois réels — pas de garde inter-onglets construite (aurait nécessité une heuristique de
  contenu explicitement écartée, voir ADR-031-bis).
- **Vérification Google de l'application** : `gmail.send` est un scope "Sensitive" — un usage en
  production hors mode test peut nécessiter une vérification par Google, indépendamment de ce
  code, à traiter comme un prérequis opérationnel avant toute mise en production réelle.

## Automatisations déterministes événement → action interne (ADR-032)

- **Seulement 4 règles, 4 événements** — `visite_realisee`, `rdv_estimation_realise`,
  `mandat_signe`, `compromis_signe`. Aucun événement structuré n'existe encore pour un constat de
  checklist documentaire (ADR-029), une offre, ou une perte de mandat/compromis — étendre le
  catalogue est additif (ajouter un type d'événement + une règle), mais rien n'existe aujourd'hui
  au-delà de ces 4 cas.
- **Aucun scheduler, aucune échéance artificielle** — toute règle du type "aucun contact depuis N
  jours" nécessiterait un mécanisme temporel qui n'existe pas dans Atlas (ADR-005, aucun worker) ;
  explicitement hors périmètre, pas seulement non prioritaire.
- **Seule action possible : `creer_tache`** — aucune action externe à conséquence (email, SMS,
  transmission notaire, modification d'offre/compromis, archivage, suppression) n'est câblable sans
  une nouvelle ADR ; le type `ChampsTacheAutomatique` est structurellement monomorphe, l'étendre
  nécessiterait de changer ce type lui-même.
- **Aucun retry automatique** — une exécution `echouee`, ou une exécution `a_traiter` laissée par un
  crash entre le COMMIT métier et le traitement synchrone qui suit, reste dans cet état
  indéfiniment tant qu'aucune reprise manuelle n'est déclenchée. La page `/automatisations` rend
  l'état visible, ne le résout jamais elle-même.
- **Suppression d'une entité source bloquée tant qu'un événement la référence** — conséquence
  directe et assumée de l'append-only de `evenements_metier` (`NO ACTION`, ADR-032 correction n°5) :
  un compte rendu de visite, un prospect vendeur ou un compromis ayant déclenché un événement ne
  peut plus être supprimé physiquement. Aucun mécanisme n'existe pour "détacher" un événement d'une
  entité avant sa suppression — non construit, la suppression physique de ces entités n'existe déjà
  pas ailleurs dans Atlas (archivage seulement, ADR-012).
- **Fenêtre de course résiduelle sur `rdv_estimation_realise`** — la détection de "transition
  réelle" (date absente → renseignée) est calculée dans la Server Action, avant l'ouverture de la
  transaction, pas via une garde `WHERE ... IS NULL` dans le repository (qui casserait la correction
  légitime de cette date) : deux requêtes concurrentes sur le même prospect pourraient toutes deux
  se croire "la première" transition. L'index unique partiel sur `evenements_metier` reste le filet
  de sécurité qui empêche malgré tout un doublon d'événement.
- **Aucune modification ni annulation d'une exécution déjà résolue** — une fois `reussie` ou
  `echouee`, une ligne `executions_automatisation` est figée ; corriger une tâche produite par
  erreur se fait au niveau de la tâche elle-même (ADR-028), jamais en rejouant l'exécution.

## Moteur temporel et relances programmées (ADR-033)

- **Aucun déclencheur intégré à Atlas** — `POST /api/automatisations/scan` existe et fonctionne,
  mais rien dans le code ne l'appelle périodiquement : sans un cron **externe** configuré (choix
  qui dépend d'un hébergement lui-même non tranché, voir ADR-002), le moteur temporel ne s'exécute
  jamais spontanément. Ce n'est pas un oubli — c'est le choix délibéré d'un endpoint neutre plutôt
  que de coupler le code à une plateforme précise.
- **Une seule règle temporelle** (`inactivite_prospect_vendeur`) — relance acquéreur et relance sur
  offre sans décision restent des candidates non construites (voir ADR-033, la première nécessite
  un chantier de modélisation préalable : aucun `dernierContactLe` structuré n'existe côté
  `acquereurs`).
- **Aucun scheduler, aucune échéance secondaire** — pas de notion de relance répétée ou croissante
  (ex. "relancer à nouveau si toujours sans réponse après 14 jours") ; un seul seuil, un seul cycle
  par période de silence.
- **Aucun retry automatique d'un run resté `en_cours`** (crash pendant le scan) ou d'une exécution
  `echouee` — le run reste visible comme tel sur `/automatisations`, sa reprise éventuelle est un
  scan ultérieur ordinaire (déclenché par le prochain appel du cron externe), jamais un mécanisme
  dédié de relance de run.
- **`survenuLe` date la détection, pas nécessairement le franchissement réel du seuil** — un scan
  exécuté plusieurs jours après le franchissement pose `survenuLe` au moment du scan ; `ancreCycle`
  reste la donnée honnête pour reconstituer depuis quand le silence dure réellement.
- **Le secret de l'endpoint (`AUTOMATISATIONS_SCAN_SECRET`) n'a ni rotation ni rate-limiting
  construits** — un secret unique, statique, sans expiration ; à traiter comme tout autre secret V1
  d'Atlas (aucune gestion de secrets avancée n'existe ailleurs non plus).
- **`joursCivilsEcoules` utilise un fuseau constant (`Europe/Paris`)** — passé en paramètre
  explicite partout (préparé pour un futur fuseau par conseiller), mais sa seule source aujourd'hui
  reste `FUSEAU_HORAIRE_APP`, une constante de module — aucune configuration par conseiller
  n'existe (mono-conseiller assumé, ADR-006).

## Statut commercial du bien

- **Historique dérivé non append-only pour "Offre en cours"/"Compromis signé"** (ADR-014),
  contrairement à toutes les autres sources de l'historique dérivé (bien créé, tâches, visites).
  Ces deux événements sont recalculés en direct depuis `offreEnCoursLe`/`compromisSigneLe` :
  **annuler un jalon efface rétroactivement l'événement correspondant de l'historique affiché**,
  comme s'il n'avait jamais existé — pas de journal immuable des transitions passées. Conséquence
  assumée du choix "timestamps de jalons plutôt qu'un enum" pour rester minimal (voir ADR-014).
- **Aucune donnée réelle ne permet de dériver automatiquement ces jalons** (aucune notion d'offre
  ou de compromis structurée dans `comptes_rendus_visite`/`taches`) — geste manuel du conseiller
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

## Fondations fiscales (ADR-023)

- **Le référentiel `regle_fiscale` a été seedé sans être ni affiché ni consommé** dans cette passe —
  corrigé par ADR-024, voir la section dédiée ci-dessous pour les limites du moteur de calcul.
- **Aucune validation croisée d'incohérence de profil** : le formulaire laisse saisir, par exemple,
  `regimeComptable` renseigné avec un `regimeFiscal = 'micro_bnc'` (où il n'a aucun sens) sans
  avertissement — les règles croisées documentées dans `docs/DATA_MODEL.md` sont portées par
  `src/actions/profilFiscal.ts` mais restent partielles en V1.
- **Mono-dossier, pas de rattachement conseiller** : `dossier_fiscal` est une table à une seule
  ligne (`id = 'default'`), cohérent avec l'absence de multi-utilisateur déjà actée (ADR-006) — voir
  "Pas de multi-utilisateur" ci-dessous.
- **Historique de `profil_fiscal` non exposé en V1** : `chargerHistoriqueProfilFiscal()` existe
  dans le repository mais aucune page ne l'affiche — seul le profil actuel (`chargerProfilFiscalActuel`)
  est visible sur `/fiscal`. Un futur écran d'audit pourrait l'exposer sans changement de schéma.

## Moteur fiscal — année courante (ADR-024)

- **Cotisations sociales limitées au régime général** : seul `affiliationRetraite =
  'ssi_regime_general'` a un code de taux dans le référentiel (`taux_cotisations_bnc_general`) — un
  profil `cipav` retourne systématiquement `regime_non_couvert`, jamais une approximation. Ajouter
  la Cipav nécessite un nouveau code de référentiel, pas seulement un changement de code applicatif.
- **Déclaration contrôlée entièrement hors périmètre du moteur social/CFP/VFL** : ces trois calculs
  ne fonctionnent que pour `regimeFiscal = 'micro_bnc'` — un profil en déclaration contrôlée voit
  ces trois lignes marquées "Indisponible", sans aucune estimation de repli.
- **ACRE non calculé** : aucun barème dans le référentiel (limite ADR-023 non résolue par ADR-024).
  Une tranche tombant dans une période ACRE active retourne `regle_absente` plutôt que le taux
  plein — le montant de cotisations affiché peut donc être `"Indisponible"`/`"partiel"` pour un
  conseiller bénéficiaire de l'ACRE, jusqu'à ce que le référentiel soit complété.
- **TVA redevable entièrement hors périmètre** : `calculerFranchiseTva` ne fonctionne que pour
  `regimeTva = 'franchise'` — `montantRemunerationConseillerCentimes` n'a aucune sémantique HT/TTC
  modélisée, un profil redevable retourne toujours `"Indisponible"`. Aucune couche TVA/facturation
  n'existe dans le code.
- **Granularité de l'amorçage** : `historique_amorcage` est un montant unique par année, sans date
  journalière. Si un changement de taux légal tombe à l'intérieur de la période qu'il couvre, la
  tranche correspondante devient `amorcage_non_ventilable` (ni calculée, ni devinée) — limite
  structurelle du modèle de données ADR-023, pas un bug du moteur.
- **Micro-BNC : aucun verdict de sortie de régime** : le moteur expose des faits (recettes connues
  vs plafond, par année, avec leur couverture) mais ne calcule jamais le mécanisme légal complet des
  deux années consécutives de dépassement ni ses conséquences (bascule de régime, rétroactivité) —
  réservé à une passe ultérieure quand ce mécanisme aura été audité spécifiquement.
- **`chargerProjectionAnnuelle()` reste ancrée sur `CURRENT_DATE`** : `calculerProjectionFinAnnee`
  n'a donc de sens que pour l'année civile en cours, jamais une année passée ou future — un appel
  avec une autre année que l'année courante donnerait des blocs "restant" incohérents avec le bloc
  "encaissé". La projection N+1 à N+5 (ADR-025) est un moteur séparé (`calculerProjectionPluriannuelle`),
  qui ne réutilise pas `calculerProjectionFinAnnee`.
- **Projection pluriannuelle (ADR-025) : run-rate mono-dossier, jamais additionné au pipeline** :
  `evaluerRunRate` est calculé une seule fois pour tout l'horizon N+1→N+5 (même profondeur
  historique appliquée à chaque année projetée), et reste strictement séparé du pipeline daté dans
  l'UI et dans le type `ProjectionAnneeFiscale` — aucun total combiné n'est jamais exposé. Aucune
  saisonnalité (ventilation mensuelle plate). Le badge "règle officielle" (par opposition à
  "hypothèse de reconduction") n'est aujourd'hui observable dans l'UI que pour les codes exposés
  avec détail de provenance (cotisations/CFP/VFL) — tous seedés sans `dateFinValidite` en V1, donc
  toujours "hypothèse de reconduction" pour une année future tant qu'aucune version bornée n'est
  publiée. Le seul code réellement borné (`plafond_micro_bnc`) n'a pas de détail de provenance
  affiché dans `ProjectionPluriannuelle.tsx`, même choix d'UI que `VueAnneeResume.tsx` (ADR-024).
  Aucune hypothèse utilisateur n'est persistée (paramètres de simulation valables uniquement pour la
  requête courante).
- **`remuneration` n'est pas cloisonnée par dossier fiscal** : cohérent avec le mono-dossier V1
  (ADR-023) — tous les encaissements Atlas appartiennent implicitement à l'unique dossier `'default'`
  aujourd'hui. Le jour où `dossier_fiscal` cesse d'être mono-ligne, `listerEncaissementsAnnee` et
  `chargerProjectionAnnuelle()` devront être revus pour filtrer par dossier (aucun des deux ne le
  fait actuellement).

## Moteur d'alertes du copilote (ADR-026)

- **Aucune alerte de proximité de seuil** : les marges avant seuil micro-BNC/TVA restent affichées
  factuellement en continu dans `/fiscal` (`franchiseTva.margeAvantSeuilBaseCentimes`/
  `margeAvantSeuilMajoreCentimes`), mais aucune alerte proactive ne se déclenche en approchant d'un
  seuil — décision produit assumée, un seuil produit explicite (ex. "80 % du plafond") reste à
  décider avant toute passe ultérieure.
- **A4/A5 (rémunérations et dates manquantes) restent des compteurs agrégés** : dérivés des mêmes
  compteurs déjà exposés par `chargerRemuneration()`/`chargerProjectionAnnuelle()`, sans nouvelle
  requête ni listing dossier par dossier — l'action associée pointe vers la vue `/dashboard`
  existante, jamais vers une liste filtrée de dossiers précis.
- **Aucune persistance, aucune notification** : chaque alerte est recalculée à chaque chargement de
  `/`, jamais stockée ni historisée ; aucun cron, aucun push, aucun email. Une alerte disparaît dès
  que sa cause disparaît, sans trace de son ancienne existence.
- **Aucune recommandation d'optimisation fiscale** : le moteur expose des faits (constatés ou
  projetés), jamais une suggestion d'action fiscale (ex. décaler un encaissement, changer de régime).
- **Le poids par type d'alerte (`priorite.ts`) est une convention produit interne non documentée
  ailleurs que dans le code** — modifier l'ordre relatif de deux types nécessite d'éditer
  `POIDS_TYPE` directement, aucune configuration externe n'existe.

## CRM vendeur (ADR-027)

- **Un seul contact par opportunité, une seule opportunité par bien** : `prospects_vendeurs` ne
  modélise pas de personne physique/personne morale séparée de l'opportunité — plusieurs
  propriétaires sur un même bien (indivision) ou un même propriétaire avec plusieurs biens en
  cours nécessiteront une séparation contact ↔ opportunité dans une passe ultérieure, non construite
  ici. `bienId` porte une contrainte `UNIQUE` qui matérialise cette limite en base.
- **Aucune intégration Google Calendar pour le rendez-vous d'estimation** : `rdvEstimationPrevuLe`/
  `rdvEstimationRealiseLe` restent de simples champs sur `prospects_vendeurs`, non reliés à
  `memoireContextuelle` (dont `typeMetier` inclut déjà `'estimation'`, prêt pour une passe
  ultérieure) ni à la logique de matching (`src/lib/matching.ts`).
- **Aucune automatisation** : ni relance automatique, ni génération d'e-mail personnalisé, ni
  campagne, ni post de communication à la signature — le modèle pose les signaux bruts
  (`dernierContactLe`, tâches liées via `prospectVendeurId`, ADR-028) qu'une future passe pourra
  lire, rien n'est codé ici.
- **Aucune révocation de mandat déjà signé** : une fois `mandatSigneLe`/`bienId` posés, le
  prospect reste dans cet état terminal — pas de chemin pour "annuler" une signature déjà
  enregistrée (le bien créé, lui, reste géré normalement via ses propres statuts).

## Tâches (ADR-028)

- **Aucune génération automatique de tâche aujourd'hui** : `origine`/`origineCode` (identifiant
  machine stable) préparent une future automatisation (relances, ADR-029+) mais aucune règle
  actuelle ne crée de tâche `'automatique'` — toute tâche existante est `'manuelle'`.
- **Idempotence/déduplication non implémentées** : une future passe d'automatisation générant des
  tâches (ex. une relance après N jours de silence) devra explicitement gérer la déduplication (ne
  pas recréer une tâche déjà ouverte pour la même cause) — `origineCode` est le champ prévu pour
  retrouver une tâche déjà générée, mais aucun mécanisme de vérification n'existe encore.
- **`en_attente` (`StatutTache`) est réservé et inutilisé** : prévu pour une future vraie notion
  métier d'attente (client/notaire/document) — `deriverStatutTache()` ne le dérive jamais
  aujourd'hui, une tâche ouverte sans échéance reste `a_faire`.
- **Terminer une tâche liée à un prospect vendeur n'enregistre une interaction que si le
  conseiller le demande explicitement** (case à cocher opt-in, `terminerTacheAction`) — omettre de
  cocher ne signale jamais un contact réalisé, y compris pour une tâche de type `appel`/`relance`.
  Aucun mécanisme équivalent n'existe pour les tâches liées à un bien, un acquéreur, une visite,
  une offre, un compromis ou une rémunération — ces domaines n'ont pas encore de journal
  d'interactions structuré.
- **Aucune récurrence** : une tâche ne se recrée jamais automatiquement après avoir été terminée
  ou annulée.
- **La tâche « nouveau match » (ADR-037) cible l'acquéreur, jamais le bien** (ADR-039) : le lien
  « Voir la fiche » du cockpit résout donc uniquement vers la fiche acquéreur — le bien associé
  n'est pas une seconde cible structurée de la tâche (`taches_une_seule_cible_check`), et n'a donc
  aucun lien dédié depuis le cockpit.

## Compatibilité Bien ↔ Acquéreur (ADR-034)

- **`src/lib/matching/` n'est PAS le moteur de compatibilité commerciale** — ce sont deux modules
  distincts : `matching/` résout un rendez-vous Google Calendar vers un bien/acquéreur par
  correspondance floue (texte de titre/lieu) ; `compatibilite/` compare un bien et un acquéreur déjà
  identifiés sur des champs strictement structurés, jamais de texte libre. Ne jamais confondre l'un
  avec l'autre ni supposer qu'ils partagent une quelconque logique.
- **Aucune sémantique pour `budgetMin`** : un bien moins cher que le budget minimum indiqué par
  l'acquéreur n'est jamais signalé incompatible — décision explicite, le champ reste dans le modèle
  sans être lu par le moteur.
- **Géographie couverte depuis ADR-035** — voir la section dédiée ci-dessous pour ses limites
  propres (granularité commune/arrondissement uniquement, pas de rayon, backfill non exhaustif...).
- **Aucune préférence pondérée** : les champs actuels ne sont interprétés que comme des contraintes
  explicites (minimum/requis) — pas de scoring, pas de poids, pas de `"nice to have"` implicite, pas
  d'inférence depuis les notes.
- **Résultat non persisté, jamais mis en cache** : recalculé à chaque affichage de la fiche bien ou
  acquéreur — aucune table `resultats_matching`, aucun `matching_score`, rien à synchroniser. Un
  nouveau bien ou une nouvelle exigence acquéreur n'a donc aucun effet différé à surveiller : le
  résultat est déjà à jour dès le prochain chargement de la page.
- **Le moteur canonique lui-même ne déclenche toujours rien** : `evaluerCompatibilite()` reste une
  pure fonction de lecture, jamais un événement ni un effet de bord. La détection de *transition*
  vers `compatible` (ADR-036) et son exploitation commerciale optionnelle (tâche "nouveau match",
  ADR-037, désactivée par défaut) vivent entièrement en dehors de ce moteur — voir les sections
  dédiées ci-dessous.
- **Aucune édition ni suppression d'un critère individuel** : le moteur est une pure lecture, il n'y
  a rien à éditer — seuls les champs structurés du bien/acquéreur eux-mêmes (formulaires existants)
  influencent le résultat.

## Secteurs de recherche géographique (ADR-035)

- **Granularité V1 = commune/arrondissement, jamais plus fine** : aucun quartier, aucun IRIS, aucun
  rayon kilométrique, aucune notion GPS/distance/temps de trajet. Un acquéreur qui recherche "le
  bord de Seine à Houilles" doit sélectionner la commune entière — pas de sous-découpage.
- **Aucun regroupement "Tout Paris"/"Tout Lyon"/"Tout Marseille"** : sélectionner tous les
  arrondissements d'une de ces trois villes reste un geste manuel, arrondissement par
  arrondissement — aucune expansion automatique depuis l'entrée générique "ville entière" (exclue
  de la recherche, voir `docs/BUSINESS_RULES.md`). Une future fonctionnalité pourrait proposer un
  raccourci explicite "Tout Paris", non construit ici.
- **`ville`/`codePostal` du bien ne participent jamais à la compatibilité géographique**, même
  lorsque `codeInseeCommune` est `NULL` — ce sont des champs de saisie libre historiques, jamais
  fiables comme identifiant. Un bien dont l'adresse est mal saisie mais dont `ville`/`codePostal`
  "semblent" correspondre à un secteur recherché reste `a_verifier`, jamais silencieusement
  `compatible`.
- **Résolution automatique du bien non exhaustive** : dépend de la qualité de l'adresse saisie et de
  la disponibilité/qualité de la réponse IGN au moment de l'enregistrement — une adresse
  incomplète, ambiguë, ou un score IGN insuffisant laisse `codeInseeCommune = NULL` durablement (pas
  de nouvelle tentative automatique tant que le conseiller ne réédite pas le bien). Le backfill
  ponctuel (`scripts/backfill-code-insee-commune.mjs`) traite les biens existants au moment où il est
  lancé, mais n'est pas un mécanisme récurrent — un bien qui reste non résolu après le backfill le
  reste jusqu'à une prochaine édition manuelle ou un nouveau passage du script.
- **Un secteur de recherche n'est pas éditable en place** : corriger `nomCommune`/`codePostal` d'un
  secteur impose de le supprimer puis de le rechercher/sélectionner à nouveau — décision explicite
  pour ne jamais laisser un couple `codeInsee`/`nomCommune` incohérent.
- **Aucun historique des secteurs recherchés** : supprimer un secteur ne laisse aucune trace — pas
  de journal d'anciennes recherches, conformément au principe de minimisation (rien n'est conservé
  au-delà de "où l'acquéreur recherche actuellement").
- **Automatisation liée à un changement de compatibilité géographique** : ajouter/supprimer un
  secteur déclenche une resynchronisation technique (ADR-036) qui peut, si la règle
  `nouveau_match_bien_acquereur` (ADR-037) est activée, produire une tâche "nouveau match" — jamais
  d'email ni de notification dans tous les cas (ADR-037 s'arrête à la tâche).

## Transitions de compatibilité (ADR-036)

- **Effet commercial désormais branché, mais désactivé par défaut (ADR-037)** : l'événement
  `compatibilite_bien_acquereur_devenue_compatible` est consommé par la règle
  `nouveau_match_bien_acquereur` (`src/lib/automatisations/catalogueRegles.ts`) — voir la section
  dédiée ci-dessous pour son comportement et ses limites propres. Tant qu'elle n'est pas activée
  explicitement depuis `/automatisations`, aucune tâche n'est produite.
- **Aucun snapshot des critères persisté** : l'événement ne porte que `bienId`/`acquereurId`/
  `cycleCompatibilite` — consulter le détail des 7 critères au moment d'un événement passé implique
  de rappeler `evaluerCompatibilite()`, dont le résultat peut avoir changé depuis (les données
  source ont pu être modifiées entre-temps). Décision assumée de minimisation, pas une limite
  technique à lever.
- **Paires jamais retouchées après le déploiement restent figées sur leur baseline** : sans scan de
  fond périodique recalculant l'ensemble du système (délibérément absent, pour ne jamais reproduire
  un balayage N×M), une paire dont ni le bien ni l'acquéreur ne sont plus jamais modifiés ne sera
  jamais réévaluée — y compris si une troisième entité (un nouveau secteur, par exemple) aurait pu
  théoriquement en changer le résultat sans mutation directe de l'une des deux. Cette situation
  n'existe pas aujourd'hui (tout critère du moteur ADR-034/035 dépend uniquement du bien et de
  l'acquéreur eux-mêmes, jamais d'un tiers), mais deviendrait une vraie limite si un futur critère
  en dépendait.
- **Le balayage de reprise (`/api/compatibilite/scan`) dépend d'un cron externe**, comme
  `/api/automatisations/scan` (ADR-033) — sans déclencheur configuré, seul le traitement synchrone
  immédiatement après chaque mutation ferme la boucle ; une demande restée en attente après un
  crash exact entre le commit et ce traitement synchrone ne serait alors récupérée qu'au prochain
  appel manuel de l'endpoint.
- **La baseline/le rebuild sont un geste manuel** (`/api/compatibilite/baseline`), jamais déclenchés
  automatiquement par une migration ou un déploiement — un opérateur qui ne l'exécute jamais après
  la mise en service se prive de la détection de transitions pour les paires déjà compatibles au
  moment de l'installation (elles restent silencieusement sans ligne d'état jusqu'à leur première
  vraie mutation).

## Automatisation commerciale du nouveau match (ADR-037)

- **Levée par ADR-040** : la règle vérifie désormais une vraie visite `planifiee` pour la paire
  précise (`existeVisitePlanifieePourPaire()`) avant de produire une tâche — une visite `realisee`
  ou `annulee`, elle, ne bloque jamais indéfiniment un futur cycle légitime (seul le statut
  `planifiee` compte, jamais une simple existence historique).
- **Le filet de reprise générique existe désormais (ADR-038)** — voir la section dédiée ci-dessous ;
  une exécution `nouveau_match_bien_acquereur` restée `a_traiter` après un crash est reprise comme
  n'importe quelle autre règle, sans traitement spécial.
- **Anti-spam inter-cycle simple** : au plus une tâche ouverte à la fois par paire pour cette règle —
  si le conseiller laisse une tâche ouverte indéfiniment, un nouveau cycle réel ne relance jamais de
  rappel supplémentaire tant que celle-ci n'est pas résolue (terminée ou annulée).
- **Aucune échéance automatique** : cohérent avec toutes les règles ADR-032/033 existantes
  (`ChampsTacheAutomatique` ne porte aucun champ d'échéance) — une tâche "nouveau match" reste "Sans
  échéance" jusqu'à ce que le conseiller en fixe une manuellement.

## Reprise durable des exécutions d'automatisation bloquées (ADR-038)

- **Seules les exécutions `a_traiter` sont reprises automatiquement** — une exécution `echouee`
  (une vraie erreur technique a été levée et capturée) reste **définitivement terminale** : aucune
  classification fiable transitoire/permanente n'existe aujourd'hui (`categoriserErreur()` ne lit
  aucun code SQLSTATE), un retry automatique risquerait une boucle silencieuse sur une erreur
  réellement permanente. Un retry manuel éventuel n'existe pas non plus — chantier séparé, non
  construit ici.
- **Plafond fixe non configurable** (`MAX_TENTATIVES_AUTOMATISATION = 5`, constante de code) — au-delà,
  l'exécution devient `echouee` avec le message *"Nombre maximal de tentatives de reprise atteint"*,
  même si la cause sous-jacente (ex. panne DB passagère) s'est entre-temps résolue. Aucune remise à
  zéro automatique du compteur.
- **`nombre_tentatives` n'est pas une preuve exhaustive** : un hard crash peut empêcher l'écriture
  de l'incrément lui-même dans de rares cas — le compteur reste une estimation observable des
  tentatives effectivement enregistrées, jamais la source de la garantie d'idempotence (portée par
  ailleurs, voir `docs/BUSINESS_RULES.md`).
- **Stratégie valable uniquement parce que les effets actuels sont 100 % transactionnels
  PostgreSQL** — aucune des 6 règles n'appelle Gmail/Calendar/une API externe aujourd'hui (vérifié).
  Le jour où une règle produira un effet non transactionnel, cette stratégie de reprise ne suffira
  plus **pour cette règle spécifiquement** : réévaluer l'idempotence/reprise ADR-038 avant de
  l'ajouter, jamais supposer que la reprise générique la couvre déjà.
- **Le balayage de reprise (`/api/automatisations/reprise`) dépend d'un cron externe**, comme les
  autres endpoints de ce type (ADR-033/036) — sans déclencheur configuré, seul le traitement
  synchrone immédiatement après chaque mutation ferme la boucle.

## Cockpit commercial « Aujourd'hui » (ADR-039)

- **Lien « Voir la fiche » limité aux trois types de cible ayant une fiche navigable** (bien,
  acquéreur, prospect vendeur) — une tâche liée à une visite, une offre, un compromis ou une
  rémunération n'affiche aucun lien direct depuis le cockpit (ces entités ne sont consultables que
  depuis la fiche bien qui les héberge) ; aucune page dédiée n'existe encore pour elles.
- **Le bien associé à une tâche « nouveau match » n'a pas de lien dédié** — voir la limitation
  correspondante dans la section « Tâches (ADR-028) » ci-dessus.
- **Aucune priorisation ni résumé par IA** : le tri reste entièrement déterministe (`tachePriority.ts`,
  inchangé par cette ADR) — pas de score affiché au conseiller, jamais de classement heuristique
  opaque.
- **Pas de statistiques commerciales sur cette page** (volume, CA, taux de conversion) — voir
  « Dashboard commercial » ci-dessus pour l'état de ce chantier séparé.

## Cycle de vie d'une visite (ADR-040/041)

- **Aucune création native indépendante de Calendar** : une visite Atlas naît uniquement via
  `materialiserVisiteAction` (Server Action, ADR-041), déclenchée depuis `/visites/[id]/preparer`
  pour un rendez-vous Calendar déjà résolu — aucun formulaire « Nouvelle visite » indépendant.
  Documenté comme limite V1 assumée, pas un oubli.
- **Aucune heure/durée persistée** : `visites.date_prevue` est un simple jour civil (`date` SQL),
  jamais un instant précis — décision assumée en ADR-041 (Calendar reste seul détenteur de
  l'heure/durée précises en V1). La fiche `/visites/{id}` n'affiche donc jamais d'heure. À
  réévaluer si Atlas devient un jour propriétaire de la planification ou permet une création
  native de visites.
- **`taches.visite_id` référence toujours un compte rendu, jamais `visites.id`, pour les tâches
  créées avant ADR-041** : la règle `suivi_apres_visite` cible désormais l'**acquéreur** pour toute
  nouvelle tâche (ADR-041) — mais les tâches déjà créées par son ancienne version restent inchangées,
  toujours ciblées sur un compte rendu. `deriverRouteFicheCible()` (ADR-039) n'a jamais été étendue
  pour le type de cible `"visite"` — ces tâches historiques n'affichent donc toujours aucun lien
  « Voir la fiche » depuis le cockpit. Faire cibler `visites.id` par une règle est un changement de
  modèle distinct, volontairement hors périmètre ADR-040/041.
- **Aucune synchronisation Calendar bidirectionnelle** : reporter ou annuler une visite dans Atlas
  ne modifie jamais l'événement Google Calendar d'origine, et une modification/suppression côté
  Calendar n'est jamais répercutée activement sur une visite déjà matérialisée. Calendar reste une
  source externe de planification en lecture seule ; seule l'action explicite du conseiller
  (matérialisation, report, annulation) fait foi côté Atlas.
- **Historique non rétroactif** : les `comptes_rendus_visite` créés avant ADR-040 restent avec
  `visite_id = NULL` définitivement — aucun backfill par proximité de date ou toute autre
  heuristique, conformément au principe déjà appliqué à `offre_visites` (ADR-019).
- **Aucune suppression automatique d'une tâche « nouveau match » devenue redondante** : si une
  visite est planifiée après qu'une tâche de ce type a déjà été ouverte pour la même paire, la
  tâche existante n'est ni terminée ni masquée automatiquement — analysé et volontairement non
  traité en ADR-041 (bénéfice non démontré face au risque d'un couplage caché entre deux
  mécanismes).
- **`visite_realisee` reste construit autour du compte rendu, pas explicitement autour de la
  Visite** : le contrat d'émission (`compteRenduVisiteId` uniquement) est inchangé depuis ADR-032 —
  la transition `visites.statut → 'realisee'` en est aujourd'hui une conséquence systématique
  (un seul site d'appel dans tout le code, `marquerVisiteRealisee`), jamais une garantie imposée
  par une contrainte DB inter-tables (non exprimable en `CHECK` Postgres classique).

## Retour vendeur après visite (ADR-042)

- **Aucune tâche vendeur si le vendeur n'est pas structurellement identifié** : un bien créé
  directement (`/biens/nouveau`, hors conversion d'un prospect vendeur) n'a aucun vendeur
  résolvable — `retour_vendeur_apres_visite` ne produit alors jamais de tâche, jamais de fallback
  vers l'acquéreur, jamais d'erreur. Limite V1 assumée : aucun mécanisme de rattachement a
  posteriori d'un vendeur à un bien existant n'a été ajouté par cette ADR.
- **Aucun nettoyage automatique de la tâche** si une offre ou un compromis survient ensuite sur le
  même bien — le conseiller la termine manuellement s'il la juge dépassée, même choix que pour les
  tâches `nouveau_match_bien_acquereur` (ADR-041).
- **Plusieurs visites du même bien produisent chacune leur propre tâche vendeur** : aucune
  déduplication au-delà de l'idempotence standard ADR-032 (`UNIQUE(regle_code, evenement_id)`) —
  chaque `visite_realisee` est un fait métier distinct légitimement porteur de son propre retour.

## Provenance des communications automatiques (ADR-043)

- **Pas de `UNIQUE(executions_automatisation.tache_id)` en base** : la garantie « au plus une
  exécution par tâche automatique » repose sur la discipline du moteur (`traiterUneExecution`),
  jamais sur une contrainte SQL — décision explicite de ne pas durcir dans cette ADR. La lecture de
  provenance (`getExecutionAutomatisationParTacheId`) reste fail-closed (lève une exception explicite
  si plus d'une ligne est trouvée) plutôt que de s'appuyer aveuglément sur cette garantie.
- **Aucun mécanisme de modification d'un compte rendu de visite** n'existe aujourd'hui
  (`compteRenduVisiteRepository.ts` n'expose aucune fonction de mise à jour) — le principe « état
  actuel de l'objet historique exact » posé par ADR-043 n'a donc aucun scénario réel à couvrir en
  V1 : à réévaluer si une modification de compte rendu est un jour ajoutée.
- **Seule `retour_vendeur_apres_visite` bénéficie de la provenance exacte tache → exécution →
  événement** : les autres intentions automatiques (`suivi_apres_visite` notamment) ne dérivent
  aujourd'hui aucun fait depuis une liste d'entités — n'ont donc structurellement aucun bug
  équivalent à corriger (vérifié, pas supposé). Si une future intention automatique dérive un jour
  des faits depuis une liste triée, appliquer le même principe de provenance exacte plutôt que
  « le plus récent ».

## De la visite à l'offre (ADR-044)

- **Aucune fiche Offre navigable** (`/offres/{id}` n'existe pas) — une offre reste toujours affichée
  en carte inline, dans l'onglet « Offres » de la fiche Bien ou sur la fiche Acquéreur (lecture
  seule). Limite V1 assumée, non nécessaire pour l'objectif de cette ADR (préremplissage
  contextuel, pas navigation).
- **Aucun bouton « Créer une offre » dans `TacheItem`** — décision explicite ADR-044 : le composant
  reste générique (Terminer/Voir la fiche/Préparer un email pour toutes les règles), le point
  d'entrée contextuel reste la fiche Visite (`/visites/{id}`), qui possède déjà tout le contexte
  structuré nécessaire.
- **Pas de garde DB contre les offres `en_cours` multiples pour la même paire** — la politique
  « avertir + confirmation explicite » vit uniquement dans `ajouterOffreAction` (application), pas
  dans une contrainte `UNIQUE` : cohérent avec la décision explicite de ne pas modifier le schéma
  dans cette ADR, mais un accès direct à la base (hors Server Action) pourrait toujours créer un
  doublon sans avertissement.
- **`dateValidite` reste purement informative** — aucune expiration automatique, aucun rappel
  cockpit lorsqu'elle est dépassée (limite déjà présente avant ADR-044, non traitée ici).

## De l'Offre acceptée au Compromis (ADR-045)

- **Le parcours manuel depuis le formulaire Compromis « direct » (`<select>` Acquéreur et Offre
  indépendants, sans passer par la carte Offre acceptée) reste non synchronisé côté client** — un
  couple incohérent échoue toujours seulement côté serveur, comportement historique délibérément
  conservé (le préremplissage/verrouillage ne s'applique qu'au parcours contextuel via
  `/compromis/nouveau`). La rupture UX notée dans ADR-044 est résolue pour le point d'entrée
  recommandé (carte Offre acceptée → « Créer le compromis »), pas pour la sélection manuelle libre.
- **Aucune fiche Compromis navigable** (`/compromis/{id}` n'existe pas) — un compromis reste
  toujours affiché en carte inline, dans l'onglet « Compromis » de la fiche Bien ou sur la fiche
  Acquéreur (lecture seule). Limite V1 assumée, cohérente avec l'absence de fiche Offre (ADR-044).
- **Pas de garde DB contre la réutilisation d'une Offre par plusieurs Compromis** — la politique
  « une Offre acceptée, origine d'au plus un Compromis » vit uniquement dans `ajouterCompromisAction`
  (application), pas dans une contrainte `UNIQUE(offre_id)` : décision explicite ADR-045, un accès
  direct à la base pourrait toujours créer une incohérence. `getCompromisParOffreId()` détecterait
  alors plusieurs lignes et lèverait une exception explicite plutôt que de choisir arbitrairement.
## Suivi du Compromis jusqu'à l'acte authentique (ADR-046)

- **Aucun rappel/alerte temporel sur `dateActe`** (approche, dépassée, absente) — décision explicite :
  aucun délai métier n'est établi dans le produit, et le scan temporel ADR-033 n'est aujourd'hui pas
  un framework générique déjà prêt pour Compromis (il n'expose qu'une seule fonction, dédiée à
  l'inactivité prospect vendeur). `dateActe` reste une donnée affichée et désormais modifiable, mais
  purement informative — aucun signal si elle passe inaperçue.
- **Aucune fiche Compromis navigable** (inchangé depuis ADR-045) — un compromis reste toujours
  affiché en carte inline.
- **Aucune communication vendeur après la signature d'un compromis** — la chaîne de communication
  vendeur s'arrête au retour de visite (ADR-042) ; un vendeur n'est jamais notifié automatiquement,
  ni même via une tâche suggérée, que son bien est sous compromis, réalisé, ou que le compromis est
  tombé.
- **Aucun événement métier pour `realise`/`annule`** — le tunnel événementiel ADR-032 s'arrête
  structurellement à `compromis_signe`. Aucune automatisation n'en dépend aujourd'hui, donc aucun
  besoin démontré, mais toute future automatisation post-signature nécessiterait ce chantier au
  préalable.
- **Pas de garde DB contre la réutilisation d'une Offre par plusieurs Compromis** (inchangé depuis
  ADR-045) — politique purement applicative, aucun `UNIQUE(offre_id)`.

## Traçabilité des transmissions du Pack Notaire (ADR-049)

- **Déclarative, non vérifiée techniquement par Atlas** — Atlas ne transporte aucun fichier ; une
  transmission enregistrée signifie seulement que le conseiller a explicitement déclaré l'avoir
  transmise par son propre canal. Aucune preuve technique que l'envoi a réellement eu lieu.
- **Aucune confirmation de réception** — rien ne permet de savoir si/quand l'étude a effectivement
  reçu le dossier. Pas de lecture Gmail entrante, pas de détection d'accusé de réception.
- **Le SHA-256 snapshoté ne garantit pas que les octets effectivement remis au tiers étaient
  nécessairement identiques** à ceux présents dans Atlas au moment T — le canal de transport reste
  entièrement externe et hors du contrôle d'Atlas.
- **Aucun contact notaire structuré** — le destinataire (étude, interlocuteur, email) est snapshoté
  par transmission, jamais géré via un carnet d'adresses ou une table dédiée (décision V1 explicite,
  ADR-049).
- **Aucun accès externe** — pas de mini-espace étude, pas de token, pas de magic link. Un notaire
  n'a et n'aura, dans le périmètre ADR-049, aucun moyen de consulter Atlas.
- **L'historique du manifeste persiste, mais le fichier source peut devenir indisponible** si le
  stockage documentaire n'est pas durable (voir point ci-dessous) — le SHA-256/nom/taille restent
  lisibles, le contenu binaire original peut ne plus être retéléchargeable.
- **Stockage documentaire de production non démontré comme persistant** (dette déjà connue depuis
  ADR-047, réaffirmée par ADR-049) — `stockage-documents/` est un répertoire filesystem local ; un
  redéploiement sans volume monté peut faire disparaître les fichiers sources. À configurer/vérifier
  avant toute utilisation avec des données réelles.
- Aucune de ces valeurs ne constitue une preuve juridique irréfutable, un recommandé électronique, ou
  un accusé de réception légal — wording opérationnel uniquement, jamais présenté autrement dans l'UI.

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

Produit mono-conseiller assumé (ADR-006). Depuis ADR-047, Atlas a une vraie authentification
(identité Google + allowlist à **une seule** adresse, session cookie chiffrée) — mais ceci ne
constitue toujours pas du multi-utilisateur : aucune table utilisateur, aucun `userId`/`tenantId`,
aucune notion de "qui a fait quoi" au-delà de l'identifiant Google unique posé en session.
`connexions_google` (une seule ligne possible) et le nom affiché dans `Sidebar.tsx`
("Steven Gausset", codé en dur) le confirment toujours. Introduire un second conseiller
nécessiterait une refonte de plusieurs tables (au minimum `connexions_google`,
`memoire_contextuelle`, et potentiellement `taches`/`notes_bien`/`comptes_rendus_visite` pour
savoir qui a écrit quoi) — ADR-047 rend Atlas raisonnablement exposable pour **un** conseiller,
pas pour plusieurs sur la même instance.

## Sécurisation du pilote mono-conseiller (ADR-047)

- **Aucune validation réelle du flux OAuth de bout en bout** n'a été possible dans l'environnement
  de développement où cette ADR a été implémentée (pas de vraies credentials Google Cloud
  Console) : le flux `/connexion` → Google → `/api/auth/atlas/callback` → session doit être validé
  manuellement en conditions réelles avant le premier jour de pilote.
- **`ATLAS_ALLOWED_EMAIL` reste une allowlist à une seule adresse, jamais un annuaire** — décision
  explicite (ADR-047) pour ne pas donner l'illusion d'un support multi-utilisateur qui n'existe pas
  réellement (voir "Pas de multi-utilisateur" ci-dessus).
- **Aucune UI de gestion de session** (liste des connexions actives, révocation à distance) — la
  seule action possible est se connecter/se déconnecter soi-même.
- **Aucun mécanisme RGPD outillé** (export/suppression/anonymisation automatisés) — seule une
  procédure manuelle documentée existe à ce stade (voir l'audit ADR-047).

## Dette technique identifiée dans le code

- **Filtrage par département dans `lib/patrimoine/merimeeClient.ts`** : dérivé du préfixe à 2
  chiffres du code postal — ne gère pas correctement la Corse (2A/2B). Non bloquant tant qu'aucun
  bien corse n'est traité (commentaire explicite dans le code).
- **API DVF (`lib/marche/dvfClient.ts`)** hébergée en préprod par le Cerema (`apidf-preprod.cerema.fr`)
  — testée fiable en usage réel mais sans garantie de disponibilité annoncée par le fournisseur.
- **Recherche + pagination serveur résolues sur `/biens`, `/clients`, `/prospects-vendeurs`
  (ADR-048)** — `q`/`page` en plus des filtres `archives`/`vue` existants, ordre déterministe
  `creeLe DESC, id DESC`. **Toujours sans pagination** : tâches (aucune page de liste n'existe),
  notes, comptes rendus (listes toujours scopées à un bien/acquéreur, volume naturellement borné),
  et les `<select>` de contexte sur `/offres/nouveau`/`/compromis/nouveau`/`/taches/nouveau`
  (friction réelle déjà observée — pollution par des lignes de test dans le sélecteur — mais un
  problème de sélection contextuelle distinct d'une page de liste, hors périmètre ADR-048).
- **`NavItems.tsx`** (navigation principale) ne référence ni `/taches/nouveau` ni
  `/visites/[id]/preparer` — accès uniquement contextuel (liens depuis une fiche ou l'accueil),
  cohérent avec leur usage mais à garder en tête si un futur audit UX cherche ces routes dans le
  menu.
- **Tests** : mélange de tests purs (aucune dépendance externe) et de tests d'intégration qui
  exigent un Postgres local démarré et migré (`compteRenduVisiteRepository.test.ts`,
  `noteBienRepository.test.ts`, `tacheRepository.test.ts`, `bienRepository.test.ts`,
  `clientRepository.test.ts`) — aucune configuration de CI n'a été trouvée dans le repo pour les
  exécuter automatiquement. **À confirmer** si une CI existe hors
  du repo (GitHub Actions, etc.).

## Architecture cible non construite

Rappel (détaillé dans `docs/ARCHITECTURE.md`) : ADR-003/004/005 décrivent une cible (API Python/
FastAPI, worker de connecteurs, stratégie LLM) qui n'existe pas dans le code aujourd'hui. Ce n'est
pas une limite du produit actuel, mais un écart à ne pas confondre avec l'état réel — voir aussi
`docs/AI_HANDOFF.md#ne-pas-supposer`.
