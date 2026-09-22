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

## Feedback des formulaires (`FORM_FEEDBACK_V1`, 2026-09-21)

- **Périmètre converti** — les erreurs de saisie et les refus métier attendus des formulaires
  centraux reviennent dans le formulaire comme message local (`role="alert"`), la saisie est
  conservée par le navigateur (aucune navigation), le bouton est désactivé pendant l'envoi
  (`BoutonSoumettre`, `useFormStatus`). Contrat : `EtatFormulaire` + `ErreurSaisie` +
  `avecFeedbackFormulaire` (`src/lib/formulaires/etatFormulaire.ts`), primitives
  `FormulaireAvecEtat`/`BoutonSoumettre` (`src/components/formulaires/`). Actions converties (26) :
  tâche (création), offre (création, décision), lien visite ↔ offre, compromis (création, décision,
  date d'acte), rémunération (création, correction, encaissement — saisie uniquement), prospect
  vendeur (création, modification, jalons, signature du mandat, perte, note), acquéreur (création,
  modification), bien (création, modification), document (ajout, correction de classement). Les
  parseurs `lib/*Formulaire.ts` lèvent `ErreurSaisie` pour un champ absent, un format ou un nombre
  invalide.
- **Non converti, volontairement** — `mandat.ts` (panneau Mandat : refus déjà rendus localement par
  la convention `?mandat=<refus>`), `statutCommercialBien.ts` (actions legacy dont les boutons sont
  masqués par l'UI sur un bien archivé), `terminerTache`/`annulerTache` (formulaires inline de
  Today/fiches), `modifierContact`, fiscal, automatisations, `historiqueAmorcage`,
  `repereRelationnel` ; `secteurRecherche`, Gmail, photo, bon de visite, retour vendeur et
  `PlanifierVisiteForm` étaient déjà conformes.
- **Ce qui continue à lever (fail-closed, error.tsx reste le repli)** : session absente et
  workspace (gardes inchangées, avant toute validation), erreurs DB/stockage/infrastructure, les
  invariants « Contact canonique introuvable » (prospect vendeur, acquéreur), les états
  comptables impossibles de la rémunération (compromis annulé, doublon, déjà encaissée, compromis
  non réalisé, date d'acte réelle absente), et le validateur de cohérence des rattachements
  documentaires (`lib/documents/coherenceRattachementDocument.ts`, 5 `throw` — sélections
  contraintes par l'UI). `error.tsx` ne montre toujours jamais `error.message`.
- **Saisie** : conservée parce qu'aucune navigation n'a lieu ; les champs ne sont pas des
  composants contrôlés — un rechargement volontaire de la page la perd, comme avant.

## Documents réels : stockage local, désormais configurable (ADR-050)

- **Code compatible avec un stockage persistant configuré** — `ATLAS_DOCUMENT_STORAGE_DIR`
  (lue uniquement dans `src/lib/stockageDocuments.ts`) permet de pointer vers un volume monté ;
  obligatoire et absolue en production, avec fail-closed explicite (jamais de création automatique
  de la racine, jamais de repli silencieux) si absente/relative/inexistante.
- **La persistance réelle dépend entièrement de la configuration externe** (volume Railway ou
  équivalent réellement attaché) — le code seul ne peut pas la garantir. Tant qu'aucun volume n'a
  été attaché et validé par un redéploiement réel, ne pas considérer le stockage comme persistant en
  production.
- **Aucune sauvegarde externe démontrée/configurée.** Un volume persistant n'est pas une stratégie
  de backup — reste entièrement à définir côté exploitation (voir checklist ADR-047).
- **La checklist ADR-029 ne détecte toujours pas un fichier physiquement disparu** — un document dont
  la ligne DB existe mais dont le fichier a disparu (ex. avant configuration du volume) reste affiché
  "present" tant que ses métadonnées sont intactes ; seule une tentative de lecture réelle
  (téléchargement, Pack, transmission ADR-049) révèle l'absence, désormais distinguée honnêtement
  d'un stockage indisponible (503) plutôt que masquée.
- **Fichier orphelin possible** si l'écriture disque réussit puis que l'`INSERT` DB échoue ensuite —
  aucun rollback/cleanup, dette non traitée par ADR-050 (aucun chemin de code de production
  n'exécute de `DELETE` documentaire à ce jour).
- **Deux limites de taille non alignées, comportement vérifié en conditions réelles** : un upload
  entre 10 et 13 Mo est rejeté proprement par la validation applicative (depuis `FORM_FEEDBACK_V1`,
  message local dans le formulaire, aucune écriture — vérifié en smoke avec un PDF de 10,5 Mo) ; un
  upload dépassant 13 Mo (`serverActions.bodySizeLimit` et `proxyClientMaxBodySize`,
  `next.config.ts`, alignés par `FORM_FEEDBACK_V1` : le Proxy tronquait auparavant à 10 Mo, ce qui
  envoyait tout upload de 10 à 13 Mo — documents comme photos — vers error.tsx) échoue en erreur
  serveur (500) **avant** d'atteindre cette validation — pas de message utilisateur propre dans ce
  cas. Corriger ce cas proprement nécessiterait une validation côté client (taille du fichier avant
  soumission), hors périmètre V1.
- **Liste blanche de types de fichiers volontairement restreinte** (`application/pdf`,
  `image/jpeg`, `image/png`) — pas de Word/Excel, pas d'archives ZIP, pas de scans TIFF.
- **Un seul fichier par soumission** — pas d'upload multiple en une fois.
- **`/api/documents/[id]` (téléchargement générique) n'est pas scopé workspace** — `getDocumentBienById`
  résout par id seul, sans vérifier `biens.workspace_id` ; une session valide peut télécharger
  n'importe quel document dont elle devine l'UUID, y compris d'un autre workspace. Gap pré-existant,
  confirmé par audit (`VISIT_SIGNED_FORM_V1`, 2026-09-20), non corrigé par ce lot (hors périmètre —
  corriger `documentBienRepository.ts`/la route générique toucherait tout le domaine Documents, pas
  seulement le bon de visite). Contournement local pour le bon de visite signé uniquement : son
  téléchargement passe par une route DÉDIÉE et workspace-safe (`/api/bons-visite/{id}/document`,
  `getDocumentBonVisitePourTelechargement`), jamais par cette route générique.

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

## Moteur temporel et relances programmées (ADR-033, généralisé AUTOMATION_ENGINE_GENERALIZATION_V1)

- **Aucun déclencheur intégré à Atlas** — `POST /api/automatisations/scan` existe et fonctionne,
  mais rien dans le code ne l'appelle périodiquement : sans un cron **externe** configuré (choix
  qui dépend d'un hébergement lui-même non tranché, voir ADR-002), le moteur temporel ne s'exécute
  jamais spontanément. Ce n'est pas un oubli — c'est le choix délibéré d'un endpoint neutre plutôt
  que de coupler le code à une plateforme précise. La route délègue désormais à un REGISTRE
  (`SCANNERS_TEMPORELS`, `scanTemporel.ts`) qui exécute chaque scanner activé et isole ses erreurs —
  elle ne connaît plus aucun code de règle en dur (voir ADR-062).
- **Quatre règles temporelles** (`inactivite_prospect_vendeur`, `mandat_expire_bientot`,
  `offre_sans_decision`, `offre_acceptee_sans_compromis`) — la relance acquéreur reste une candidate
  non construite (nécessite un chantier de modélisation préalable : aucun `dernierContactLe`
  structuré n'existe côté `acquereurs`). `offre_acceptee_sans_compromis` est volontairement
  TEMPORELLE UNIQUEMENT (ADR-062) : aucune règle événementielle réactive sur `offre_acceptee`
  n'existe en parallèle, pour éviter tout risque de double tâche sur une même offre.
- **Le paramètre de seuil (`configurations_automatisation.seuil_jours`) est générique** — une
  colonne, une signification par ligne (par `regle_code`), plus un nom lié à une seule règle. V1
  reste volontairement simple : un seul seuil entier par règle, jamais un jeu de paramètres
  structurés ni un constructeur de règles (aucun DSL, ADR-062).
- **`mandat_expire_bientot` cible le BIEN, pas le mandat** — `taches` ne porte aucune colonne
  `mandat_id` (jamais ajoutée pour ce seul usage) ; la tâche produite pointe vers la fiche du bien,
  son contexte textuel précise l'échéance. `evenements_metier.mandat_id` existe en revanche (cible
  de l'événement, pour l'idempotence par mandat), sans lien avec `taches`.
- **Obsolescence des tâches automatiques, nouvelle en V1** — chaque scanner ferme (jamais ne
  supprime) les tâches automatiques de sa règle dont la cause a disparu, au scan suivant. Une tâche
  fermée par un humain n'est jamais rouverte par un scan ultérieur tant que le même fait n'a pas
  changé (politique A, brief §41) — mécanisme structurel (l'identité d'occurrence est portée par
  l'index unique partiel de `evenements_metier`), aucune colonne dédiée. Ce mécanisme n'existe QUE
  pour les 4 règles temporelles — aucune règle événementielle (ADR-032) n'a d'équivalent.
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

- **Cycle de vie Offre livré par ADR-061 (`OFFER_LIFECYCLE_FOUNDATION_V1`, migration `0046`)** :
  décisions atomiques sous verrou du bien (`deciderOffre`), acceptation exclusive (les autres offres
  en cours passent `refusee` / `autre_offre_acceptee`), état `caduque` (geste humain explicite),
  une seule acceptation active par bien via les writers, `offres` source de vérité du statut
  commercial (`offre_acceptee` ajouté), fin du dual-write `biens.offre_en_cours_le`, événements
  `offre_*` / `compromis_realise` / `compromis_annule`, lectures et écritures Offre/Compromis
  scoped par le workspace. `AUTOMATION_ENGINE_GENERALIZATION_V1` (ADR-062) a depuis consommé une
  partie de ces événements (`offre_sans_decision`, `offre_acceptee_sans_compromis`, deux règles
  temporelles) et fait apparaître les tâches produites sur Aujourd'hui, avec un lien fonctionnel
  vers le bien qui héberge l'offre. Ce qui reste **non livré** : co-acquéreurs, pont acquéreur →
  Contact/projet canonique (`offres.acquereur_id` reste sur `acquereurs`), contre-offre,
  conditions suspensives / financement, expiration automatique de `date_validite` (jamais de
  transition automatique), fiche `/offres/{id}` complète, un vrai cockpit Aujourd'hui (au-delà de
  l'affichage correct des tâches existantes), provenance/connecteurs Offre, et
  l'**index unique SQL partiel sur `statut = 'acceptee'`** (différé : les lignes historiques
  incohérentes restent lisibles, jamais réparées ; les writers refusent toute nouvelle incohérence).
- **`date_decision` d'une offre `caduque` porte la date de l'acceptation initiale** (jamais écrasée) :
  la date de la caducité n'existe que comme `survenu_le` de l'événement `offre_caduque`.
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

- **Création native depuis l'UI — livrée par `VISIT_NATIVE_ENTRY_V1`** (2026-09-21, aucune
  migration) : `creerVisiteAction` (`src/actions/creerVisite.ts`, seul appelant de production de
  `creerVisite`) + formulaire unique `PlanifierVisiteForm` hébergé par `/visites/nouvelle`
  (`?bienId=&acquereurId=&retour=`), atteint depuis la fiche Bien (onglet Visites, CTA et état vide),
  la fiche Acquéreur (hero, section Visites) et les deux surfaces de matching (« Planifier une
  visite » sur chaque match compatible / à vérifier, jamais sur un incompatible — moteur inchangé).
  La Visite créée est `planifiee`, `rendez_vous_calendar_id = NULL`, workspace-safe et refusée sur
  Bien/acquéreur archivé (message local, jamais une page d'erreur) ; redirection vers
  `/visites/{id}` (jamais `/preparer`). `retour` est un enum fermé `bien | acquereur` (retour
  contextuel de la fiche Visite), jamais une URL relue. Les listes de choix et le préremplissage
  passent par des lecteurs SCOPÉS workspace dédiés (`listerBiensActifsDuWorkspace`/
  `getBienDuWorkspace`, `listerAcquereursActifsDuWorkspace`/`getAcquereurDuWorkspace` — filtrage SQL,
  aucun repli mock) : un bien ou un acquéreur d'un autre workspace n'y est jamais rendu, pas même par
  un id préempli dans l'URL. `listerBiens()`/`listerClients()` (lecteurs globaux à repli démo)
  restent inchangés pour leurs appelants legacy (Today, dashboard, matching). Ce qui reste : aucune
  préparation enrichie pour une Visite native (`/preparer` toujours Calendar-id-based, voir
  ci-dessous), aucune page liste `/visites`.
- **Aucune heure/durée persistée** : `visites.date_prevue` est un simple jour civil (`date` SQL),
  jamais un instant précis — décision assumée en ADR-041 (Calendar reste seul détenteur de
  l'heure/durée précises en V1). La fiche `/visites/{id}` n'affiche donc jamais d'heure, et le
  formulaire natif (`VISIT_NATIVE_ENTRY_V1`) ne propose qu'une « Date de visite » — aucun faux champ
  heure/durée qui serait perdu. Sur Aujourd'hui, une Visite DOMIORA du jour est présentée comme un
  événement de la journée (« Journée »), avant les rendez-vous Calendar horodatés.
- **`taches.visite_id` référence toujours un compte rendu, jamais `visites.id`, pour les tâches
  créées avant ADR-041** : la règle `suivi_apres_visite` cible désormais l'**acquéreur** pour toute
  nouvelle tâche (ADR-041) — mais les tâches déjà créées par son ancienne version restent inchangées,
  toujours ciblées sur un compte rendu. `deriverRouteFicheCible()` (ADR-039) n'a jamais été étendue
  pour le type de cible `"visite"` — ces tâches historiques n'affichent donc toujours aucun lien
  « Voir la fiche » depuis le cockpit. **`VISIT_AUTOMATION_V1`** (ADR-063) a ajouté une colonne
  **distincte** `taches.visite_canonique_id` (type de cible `"visiteCanonique"`, navigable,
  `/visites/{id}`) pour ses propres règles (`visite_j_1`/`visite_sans_compte_rendu`) — sans jamais
  toucher `taches.visite_id` ni les tâches historiques qui le portent, qui restent exactement dans
  cet état. Faire cibler `visites.id` par `suivi_apres_visite`/renommer `visite_id` reste un
  changement de modèle distinct, volontairement hors périmètre.
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
- **Scoping workspace du domaine Visite** — **livré par `VISIT_NATIVE_LIFECYCLE_V1`** (2026-09-19,
  ADR-063) : `visiteRepository.ts`/`compteRenduVisiteRepository.ts` joignent désormais
  `biens.workspace_id` sur les fonctions destinées à l'être. `listerVisites()`/`listerComptesRendus()`
  restent délibérément non scopées (lecteurs globaux, même exception documentée que les lecteurs
  Today/opportunités ailleurs dans ce dépôt) — un cross-workspace y reste possible par construction,
  jamais utilisé pour une fiche individuelle.
- **Visite native (indépendante de Calendar)** — **livré par `VISIT_NATIVE_LIFECYCLE_V1`** :
  `rendez_vous_calendar_id` est désormais nullable (index unique partiel, migration 0050) ; une
  Visite peut exister sans rendez-vous Calendar (`creerVisite`). Le chemin Calendar
  (`materialiserVisite`) reste inchangé pour l'appelant et converge vers la même primitive de
  création.
- **`/visites/{id}/preparer` reste Calendar-id-based (limitation assumée)** — n'a **pas** été migré
  vers `visite.id` par `VISIT_NATIVE_LIFECYCLE_V1` : cette page fait de la préparation enrichie
  (géocodage, transports, écoles, marché, mémoire du dossier) qui n'a de sens démontré que pour une
  visite planifiée via Calendar. Une Visite native se réalise/s'annule/se reporte directement depuis
  `/visites/{id}`, qui affiche désormais un formulaire de compte rendu inline quand
  `rendezVousCalendarId` est absent. Réévaluer seulement si un besoin de préparation enrichie pour
  les visites natives est démontré. **Inchangé par `VISIT_NATIVE_ENTRY_V1`** : la création native
  contourne cette route (jamais de redirection vers `/preparer`), qui reste réservée aux rendez-vous
  Calendar.
- **Visites DOMIORA sur Aujourd'hui — livré par `VISIT_NATIVE_ENTRY_V1`** : `/` lit désormais les
  Visites du jour du workspace de session (`visitesDuJour`, une seule requête jointe visites ⋈ biens
  ⋈ acquereurs ⟕ contacts, jamais un getById par Visite) et les fusionne avec l'agenda Calendar
  (`fusionnerAgendaDuJour`) : une Visite matérialisée depuis Calendar remplace son événement (jamais
  deux fois le même rendez-vous, lien `/visites/{id}` préféré à `/preparer`), une Visite native
  apparaît même sans Google Calendar connecté, une Visite `annulee`/`realisee` n'est plus un
  rendez-vous actif et son événement Calendar ne réapparaît pas pour autant. Limites : seules les
  Visites du **jour** sont lues (pas de « à venir » natif sur 7 jours, la section « à venir » reste
  100 % Calendar) ; le widget agenda Calendar lui-même (`getAgendaSemaine`) est inchangé.
- **Bon de visite signé** — **livré par `VISIT_SIGNED_FORM_V1`** (2026-09-20, migration 0051) :
  `bons_visite`/`signatures_bon_visite`, signature tactile native (canvas, provider `"domiora"`),
  document PDF final immuable + hash SHA-256, `documents_bien.visite_id`, versioning (v1/v2...),
  téléchargement dédié workspace-safe (`/api/bons-visite/{id}/document`). Le texte du bon (V1,
  `src/lib/bonVisite/templateBonVisite.ts`) est une configuration produit minimale, volontairement
  neutre juridiquement — **à faire relire par un juriste avant tout usage au-delà de ce lot**, aucune
  affirmation eIDAS/signature qualifiée n'est faite.
- **Fichier orphelin possible sur signature perdante (dette P3, non bloquante)** — `signerBonVisite`
  écrit le PDF final et l'image de signature sur disque **avant** d'ouvrir la transaction DB
  (filesystem et transaction Postgres ne sont pas atomiques ensemble). Le côté perdant d'une double
  signature concurrente (§22, ADR-063) a donc pu écrire ses fichiers sans qu'aucune ligne
  `signatures_bon_visite`/`documents_bien` ne les référence jamais. Conséquence bornée et sans
  danger fonctionnel : dans le chemin normal, aucune ligne `bons_visite.statut = 'signe'` ne peut
  pointer vers un fichier absent (le document est posé dans la MÊME transaction que le passage à
  `'signe'`) et aucun fichier orphelin n'est jamais exposé (le téléchargement résout uniquement via
  une ligne `documents_bien` réellement rattachée). Aucun nettoyage automatique de ces octets morts
  n'existe — même dette, non retraitée, que celle déjà documentée pour l'upload générique
  (`ADR-050`, section Documents ci-dessus). Hors périmètre de ce lot.
- **Automatisation Visite** — **livrée par `VISIT_AUTOMATION_V1`** (2026-09-20, migration 0052) :
  `visite_j_1` (rappel J-1, occurrence cyclique — un report ouvre légitimement une nouvelle
  occurrence) et `visite_sans_compte_rendu` (relance après seuil configurable, occurrence
  ponctuelle) sont désormais des règles réelles, câblées sur `visitesPlanifieesPourDate`/
  `visitesPlanifieesPasseesSeuil` (lecteurs set-based, workspace-safe), avec obsolescence
  automatique (annulation, réalisation, report) et fermeture humaine jamais ressuscitée (politique
  A, comme le reste du domaine). Les tâches produites ciblent `taches.visite_canonique_id` (nouvelle
  colonne dédiée, distincte de l'ancien `taches.visite_id` qui référence en réalité un compte
  rendu) et apparaissent nativement dans la liste de tâches de Today avec un lien direct
  `/visites/{id}` — le widget agenda (`getAgendaSemaine`) reste, lui, 100 % Calendar-sourcé,
  volontairement non touché par ce lot. Aucune règle ne consomme l'événement `bon_visite_signe`
  (posé pour un futur lot uniquement, aucune automation Bon signé dans ce lot) ; `compte_rendu_sans_retour_vendeur`
  n'a volontairement pas été construite (redondante — voir l'entrée "Retour vendeur" ci-dessous).
- **Acquéreur legacy sur la Visite** — même modèle que Mandat/Offre/Compromis
  (`acquereur_id` scalaire) ; confirmé non bloquant pour la maturité du domaine (ADR-063,
  `BUYER_LEGACY_BLOCKER = NO`). Le bon de visite introduit cependant une distinction nouvelle entre
  le projet acquéreur (Visite) et le(s) signataire(s) effectivement présent(s) (bon de visite),
  jamais fusionnés dans une seule colonne : `signatures_bon_visite` porte son propre snapshot
  identité (`contact_id` nullable), indépendant de `acquereurs.id`.
- **Prestataire de signature externe non intégré** — V1 livre uniquement la signature tactile
  native (`provider = "domiora"`, `CHECK` fermé à cette seule valeur). Le schéma
  (`external_signature_id` nullable) accueille un futur fournisseur (OTP, e-signature qualifiée)
  sans redesign, mais aucun n'est câblé — décision produit volontairement différée.

## Retour vendeur après visite (ADR-042, ADR-063)

- **Fait CRM canonique depuis `SELLER_FEEDBACK_INTERACTION_V1`** (2026-09-20, migration 0053,
  ADR-063) : `enregistrerRetourVendeurVisite` crée une **Interaction** réelle (`interactions.visite_id`
  + `nature_metier = 'retour_vendeur_post_visite'`) par vendeur canonique et clôture — dans la même
  transaction — la tâche `retour_vendeur_apres_visite` si elle est encore ouverte. La tâche n'est
  **plus** l'unique preuve que le retour a eu lieu ; elle reste "travail à faire", l'Interaction devient
  l'historique. `retour_vendeur_apres_visite` (ADR-042) reste par ailleurs câblée sur `visite_realisee`
  (contrat inchangé), certifiée idempotente (`catalogueRegles.retourVendeur.test.ts`), inchangée par
  ce lot.
- **Résolution vendeur strictement canonique, aucun repli legacy** : `vendeursCanoniquesDuBien` résout
  exclusivement via le mandat **courant** du bien et ses parties de rôle `mandant` (`parties_mandat`,
  ADR-060) — jamais via `prospects_vendeurs` (le modèle legacy que la RÈGLE DE TÂCHE
  `retour_vendeur_apres_visite` continue, elle, d'utiliser). **Un bien dont le mandat courant n'a
  encore aucune partie `mandant` renseignée ne peut donc pas recevoir de retour vendeur Interaction**
  (`aucun_vendeur_canonique`), même si la tâche legacy, elle, a bien été créée. Décision délibérée :
  le type de lecture `ProspectVendeur` (`getProspectVendeurParBien`) n'expose pas `contactId` — seul le
  type d'écriture le porte — inventer un pont que la couche de lecture ne surface pas aurait été un
  raccourci non fiable. **Cas résorbé par défaut depuis `VISIT_NATIVE_ENTRY_V1` (sous-lot
  `MANDATE_PARTIES_AUTOFILL_V1`, 2026-09-21)** : la signature d'un prospect vendeur porteur d'un
  Contact canonique pose la partie `mandant` dans la même transaction (voir « Mandat » ci-dessous) ;
  le vendeur est alors résolu automatiquement, sans ajout manuel. Restent sans partie : les mandats
  antérieurs à ce lot (aucun backfill), les biens créés directement (`/biens/nouveau`, sans prospect)
  et les prospects legacy sans Contact.
- **Seed de démonstration canonique — livré par `DEMO_SEED_CANONICAL_V1`** (2026-09-21,
  `scripts/seed-demo.mjs`, aucun code produit modifié) : Contacts, projets vendeur, mandats + parties
  `mandant`, visites natives (aujourd'hui / demain / passée sans CR / réalisées), bon signé avec PDF et
  hash réels, retour vendeur en Interaction, offres, compromis, documents, photo, états de
  compatibilité confirmés par le moteur, règles activées, rejouable (périmètre ciblé). Limites :
  aucune tâche automatique seedée (elles naissent d'un scan réel, `POST /api/automatisations/scan`),
  aucune connexion Google, aucune donnée fiscale ; le texte du bon signé est reproduit dans le
  script (le `.mjs` ne peut pas importer `templateBonVisite.ts`) — à faire évoluer ensemble.
  `seed-demo.test.ts` purge désormais `compatibilites_bien_acquereur_etat` et
  `compatibilites_a_resynchroniser` (dette observée lors de `VISIT_NATIVE_ENTRY_V1`, fermée).
- **Idempotence par index unique partiel, pas par tâche** : un double submit ne crée jamais deux
  Interactions "officielles" pour le même (visite, vendeur) — mais une Interaction manuelle
  authentique et ultérieure sur la même Visite reste possible et n'est jamais bloquée (testé).
- **Aucun événement métier `retour_vendeur_effectue`** : réévalué lors de ce lot et toujours écarté —
  aucun consommateur downstream démontré aujourd'hui (l'Interaction elle-même est déjà persistée et
  interrogeable, `listerInteractionsPourVisite`). Voir ADR-063 `VISIT_EVENTS_V1`.
- **Aucun nettoyage automatique de la tâche** si une offre ou un compromis survient ensuite sur le
  même bien — le conseiller la termine manuellement s'il la juge dépassée, même choix que pour les
  tâches `nouveau_match_bien_acquereur` (ADR-041).
- **Plusieurs visites du même bien produisent chacune leur propre tâche vendeur** : aucune
  déduplication au-delà de l'idempotence standard ADR-032 (`UNIQUE(regle_code, evenement_id)`) —
  chaque `visite_realisee` est un fait métier distinct légitimement porteur de son propre retour.
- **Aucune garde d'archivage explicite** : `enregistrerRetourVendeurVisite` n'exclut pas un Bien
  archivé après la visite — cohérent avec la politique déjà assumée ailleurs dans ce domaine
  (historique conservé, jamais bloqué par un archivage ultérieur), pas une garde oubliée.

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
- **Garde DB contre la réutilisation d'une Offre par plusieurs Compromis : `UNIQUE(offre_id)` depuis
  ADR-047** (cette limitation est fermée) ; `getCompromisParOffreId()` reste fail-closed pour une
  incohérence antérieure à la contrainte.
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
- **Réutilisation d'une Offre par plusieurs Compromis : fermée par `UNIQUE(offre_id)` (ADR-047).**

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
- **Stockage documentaire : code prêt (ADR-050), configuration externe encore à effectuer et
  valider.** `ATLAS_DOCUMENT_STORAGE_DIR` permet de pointer vers un volume persistant, avec
  fail-closed en production — mais tant qu'un volume Railway réel n'a pas été attaché et testé par un
  redéploiement effectif, la persistance en production reste supposée, pas démontrée.
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

## LLM : une seule utilisation, optionnelle et encadrée

**Cette section affirmait « Pas de LLM » ; c'est devenu faux.** Une rédaction assistée a été
introduite depuis (`apps/web/src/lib/redaction/`). Correction factuelle, chaque point vérifié dans
le code :

- **Une seule utilisation existe** : reformuler un brouillon d'email **déjà produit par un
  générateur déterministe** (`lib/communications/genererBrouillonEmail.ts`). Point d'entrée unique :
  la Server Action `apps/web/src/actions/reformulerBrouillon.ts`. Aucun autre chemin du produit
  n'appelle un modèle.
- **ADR-008 reste entièrement valide** : aucune règle métier n'est décidée par un modèle. Les
  moteurs (`compatibilite/`, `opportunites/`, `alertes/`, `pointsForts/`, `pointsAttention/`,
  `fiscal/`) restent déterministes et ne lisent aucun texte libre. Le modèle est un **rédacteur**,
  jamais une source de faits, jamais une décision.
- **Toujours aucune dépendance LLM dans `package.json`** (`apps/web/package.json`) : l'adaptateur
  est écrit en `fetch` brut sur le protocole OpenAI-compatible
  (`lib/redaction/adaptateurCompatibleOpenAI.ts`), choisi comme protocole et non comme fournisseur.
- **Désactivée par défaut** : `resoudreRedacteur()` (`lib/redaction/redacteur.ts`) retourne
  `undefined` tant que `DOMIORA_REDACTION_BASE_URL` **et** `DOMIORA_REDACTION_MODELE` ne sont pas
  définies. Ce n'est pas une panne — Communications reste entièrement utilisable, et l'action n'est
  affichée que si elle peut aboutir (`redactionAssisteeDisponible()`).
- **Ce que le modèle reçoit est verrouillé par le type** : `FaitsAutorisesRedaction`
  (`lib/redaction/contrat.ts`) est un `Pick<>` sur cinq champs, construit champ par champ (jamais un
  spread). Aucune donnée de la base, aucune note, aucun repère relationnel (ADR-053 §4), aucun
  contexte de tâche interne ne lui parvient. Les faits sont **re-résolus côté serveur**, jamais
  acceptés depuis le formulaire.
- **Sortie acceptée en entier ou rejetée en entier** : `lib/redaction/gardeFous.ts` valide la
  reformulation ; en cas d'échec le brouillon déterministe est conservé, jamais corrigé
  partiellement.
- **Aucun envoi n'est déclenché** par cette action : elle rend deux chaînes de texte que le
  conseiller reste libre de modifier ou d'ignorer.

Limites connues de cette brique :

- **Les trois variables d'environnement ne sont documentées nulle part** :
  `DOMIORA_REDACTION_BASE_URL`, `DOMIORA_REDACTION_MODELE` et `DOMIORA_REDACTION_CLE_API` sont
  absentes de `apps/web/.env.local.example` et de `docs/DEVELOPER_ONBOARDING.md`. Une instance ne
  peut pas activer la fonctionnalité sans lire `lib/redaction/redacteur.ts`.
- **Le fournisseur réellement configuré en production n'est pas déductible du dépôt** — aucune
  valeur n'y figure, et aucune ne doit y figurer.
- **D'autres documents portent encore l'affirmation obsolète « aucun LLM »** :
  `docs/DEVELOPER_ONBOARDING.md`, `docs/AI_HANDOFF.md`, `docs/BUSINESS_RULES.md`. Ils n'ont pas été
  corrigés par la passe qui a corrigé cette section.

## Pas de multi-utilisateur

Produit mono-conseiller assumé (ADR-006). Depuis ADR-047, Atlas a une vraie authentification
(identité Google + allowlist à **une seule** adresse, session cookie chiffrée). **Le
fonctionnement reste strictement mono-conseiller**, et rien de ce qui suit ne le change.

Correction factuelle depuis la migration `0032` (ADR-054, fondation d'appartenance) : la phrase
« aucune table utilisateur, aucun `userId`/`tenantId` » n'est plus exacte au sens littéral. Ce qui
existe désormais, et ce qui n'existe toujours pas :

- **Existe** : les tables `workspaces` (une ligne, `'default'`) et `workspace_membres`, une colonne
  `workspace_id` (`NOT NULL`, **sans `DEFAULT` depuis la migration `0033`**) sur les 9 tables
  racines, et une résolution explicite du périmètre à l'écriture — depuis la session
  (`exigerWorkspaceCourant`) ou depuis un contexte d'exécution machine
  (`resoudreWorkspaceExecutionMachine`, qui échoue bruyamment si plusieurs workspaces existent).
  L'appartenance `owner` est bootstrappée de façon idempotente au callback OIDC, et rattrapée à la
  première écriture pour une session ouverte avant l'introduction du mécanisme.
- **N'existe pas** : aucune requête de lecture ne filtre par workspace, aucun sélecteur de
  workspace, aucune UI, aucun rôle au-delà de `'owner'`, aucun moteur de permissions.
  `workspace_membres` n'est lue par aucun chemin d'**authentification** — l'allowlist à une seule
  adresse reste seule maîtresse de qui peut entrer ; l'appartenance ne sert qu'à nommer le
  périmètre d'écriture.
- **Dette connue, à payer au passage multi-workspace** : `configurations_automatisation` garde sa PK
  `regle_code` seule, ce qui empêcherait deux workspaces de configurer la même règle. C'est la seule
  contrainte d'unicité du schéma dans ce cas (vérifié table par table).
- **Toujours pas de "qui a fait quoi"** : aucune colonne d'auteur sur `taches`/`notes_bien`/
  `comptes_rendus_visite`, et aucun backfill d'auteur ne serait honnête sur l'historique.
- **Toujours mono-conseiller côté secrets** : `connexions_google` ne porte volontairement aucun
  `workspace_id` (ADR-054 §6 — un token OAuth est personnel à une identité, jamais un actif
  partagé). Le nom affiché vient d'`ATLAS_ADVISOR_DISPLAY_NAME`, propriété d'instance.
- **`dossier_fiscal` (+ `profil_fiscal`, `historique_amorcage`, `rfr_foyer`) : tranché** — ces
  données appartiennent à l'**identité** du conseiller, jamais au workspace (ADR-054 §6 bis). Motif :
  l'accès étant binaire par workspace (§5), les y rattacher exposerait le régime micro-BNC et le
  revenu fiscal du foyer au premier collaborateur ajouté. La forme exacte du rattachement à
  l'identité reste hors périmètre tant qu'un second membre n'existe pas.
- **`memoire_contextuelle` : toujours non tranchée** (question ouverte 4 bis d'ADR-054), sans
  colonne et sans modification de son `UNIQUE`. Un doute ne doit pas devenir un modèle permanent.

Introduire un second conseiller reste donc un chantier à part entière : activer le filtrage par
workspace dans toutes les lectures, trancher les appartenances laissées ouvertes, rattacher
`connexions_google` à l'identité, et décider si une colonne d'auteur est nécessaire.

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
  `creeLe DESC, id DESC`. Sur `/clients` et `/prospects-vendeurs`, `q` cherche l'identité
  **effective** (Contact pour un dossier rattaché — ADR-057, addendum), sur nom, prénom, email et
  téléphone ; toujours pas de nom complet concaténé ni de normalisation (contrairement à `/contacts`,
  ADR-058). **Toujours sans pagination** : tâches (aucune page de liste n'existe),
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
  du repo (GitHub Actions, etc.). **Toujours vrai après la passe de stabilisation V1 Candidate** :
  aucune CI n'a été ajoutée dans cette passe (délibérément hors périmètre).
- **DB de test désormais dédiée et garantie** (stabilisation V1 Candidate) — `pnpm test` ne peut
  plus utiliser implicitement une `DATABASE_URL` déjà présente dans le shell (risque fermé, voir
  `src/db/resoudreDatabaseUrlTest.ts` + `vitest.setup.ts`) : base `atlas_test` locale dédiée par
  défaut, `ATLAS_TEST_DATABASE_URL` pour surcharger explicitement, refus loud si la variable
  ambiante ressemble à autre chose que la convention de dev locale documentée.
- **Flakiness de classe corrigée et validée** (stabilisation V1 Candidate) : tie-break déterministe
  sur `getDernierRunScanPourRegle()`, horloge contrôlée (`vi.useFakeTimers({toFake:["Date"]})`) au
  lieu d'un `setTimeout` arbitraire dans `clientRepository.test.ts`/`bienRepository.test.ts`,
  fixture de `page.test.tsx` (cockpit) rendue unique par exécution. Validé par 3 exécutions
  complètes consécutives 100 % vertes + stress ciblé (10 exécutions supplémentaires, 0 échec).
- **Infrastructure E2E minimale ajoutée** (Playwright, `apps/web/e2e/`) : deux smoke tests
  (tunnel cœur Atlas ; documents/Pack Notaire/transmission ADR-049), jamais exécutés par `pnpm
  test`, jamais dans une CI (absente, voir ci-dessus). Session Atlas injectée via les vraies
  primitives `iron-session`/`optionsSessionAtlas()`, jamais un contournement d'authentification.
  Commandes : `pnpm test:e2e` / `pnpm test:e2e:ui`.
- **Ordre du journal de scan : limite LEVÉE** (migration `0040`). Le tie-break posé par la
  stabilisation V1 Candidate était `ORDER BY demarre_le DESC, id DESC` : déterministe, mais fondé
  sur un uuid aléatoire — à `demarre_le` égal, c'était le plus grand uuid qui passait pour « le
  dernier run », pas celui réellement démarré en dernier. L'égalité est atteignable : `demarre_le`
  vaut `now()`, donc le `transaction_timestamp()`, et deux scans concurrents démarrent à quelques
  centaines de microsecondes d'écart (344 µs mesurées). **Le dernier run est désormais défini par
  `demarre_le` décroissant, puis `ordre` décroissant** — une séquence allouée à l'INSERT, seule
  notion d'ordre TOTAL que ce journal possède. Verrouillé par
  `runScanAutomatisationRepository.test.ts`, dont deux cas échouent si un ordre fondé sur l'uuid
  est réintroduit.

## Modèle canonique en coexistence (ADR-055)

`contacts`, `projets_acquereur`, `projets_vendeur` et `parties_projet` existent en base et sont
alimentés par les créations réelles, des deux côtés. **Rien ne les lit.** Le matching, le tunnel
commercial, le pipeline vendeur, la signature de mandat, les tâches et l'UI consomment toujours
`acquereurs` et `prospects_vendeurs`, qui restent la source de vérité.

Limites qui en découlent, toutes assumées le temps de la transition :

- **Les lignes antérieures ne sont rattachées à rien.** `contact_id` et `projet_acquereur_id` sont
  `NULL` sur tout l'historique : aucun backfill n'a été fait, parce qu'aucune règle automatique ne
  peut distinguer deux saisies de la même personne de deux personnes mal saisies (ADR-055 §H).
- **Une modification diverge.** `modifierAcquereur()` n'écrit que la ligne historique, et aucun
  geste vendeur (qualification, estimation, mandat, perte, archivage) ne propage quoi que ce soit
  vers `projets_vendeur`. Les copies canoniques gardent les valeurs de la création. Sans lecteur
  canonique cette divergence est invisible — elle devra être résolue par le lot qui bascule les
  lectures, jamais par une synchronisation bidirectionnelle.
- **Aucune relation projet ↔ bien.** `projets_vendeur` ne pointe vers aucun bien : la frontière
  (un projet, plusieurs biens ? un bien, plusieurs projets successifs ?) est renvoyée au lot
  Property/Mandat. `prospects_vendeurs.bien_id` reste `UNIQUE` et posé uniquement à la signature.
- **`mandats` a un cycle de vie canonique (ADR-060, lots `MANDATE_LIFECYCLE_FOUNDATION_V1` et
  `MANDATE_CANONICAL_UI_V1`)** : type, numéro, terme, exclusivité, résiliation, mandat courant,
  writers scoped workspace, signature sérialisée, et depuis le lot UI la fiche Bien, la fiche
  prospect et le point d'attention lisent le canonique dès qu'il existe (précédence par entité,
  `presentationMandatBien`), avec Modifier / Résilier / Enregistrer le mandat existant / parties.
  Ce qui reste **non livré** : le **renouvellement humain** (seul le primitif
  `creerMandatSuccesseur` existe, sans clôture de l'ancien : la relation `remplace_mandat_id` suffit
  au mandat courant), toute **automatisation** d'échéance (`mandat_expire_bientot`, `mandat_expire`,
  `mandat_resilie`) et toute surface Today — les calculs sont possibles via `date_fin` et le statut
  dérivé, rien ne les consomme encore ; les colonnes legacy `biens.statut_mandat` / `date_mandat`
  restent stockées (mortes en lecture pour un bien à mandat canonique) et le point d'attention garde
  un repli legacy quand l'appelant ne fournit pas de statut effectif.
- **La date de signature et la prise d'effet sont confondues** : une seule date est saisie
  (`date_debut`, ADR-060 §5) ; `signe_le` viendra par décision dédiée si une prise d'effet
  différée est constatée.
- **Les parties de mandat (`parties_mandat`, ADR-060 §16) se gèrent depuis la fiche Bien** (lot
  `MANDATE_CANONICAL_UI_V1`) : ajout par recherche Contact, deux rôles `mandant` / `representant`,
  changement de rôle, retrait ; parties affichées pour le mandat courant seulement (celles des
  mandats historiques ne sont pas chargées — un read model batch sans consommateur). Ce qui reste
  non livré : la proposition depuis `parties_projet` (rien n'est copié depuis le projet), toute
  **personne morale** (une SCI ou une indivision est représentée par un Contact humain
  `representant`, aucune entité Organisation), tout rôle au-delà des deux valeurs, et toute règle
  « au moins un mandant » (workflow futur, jamais une contrainte de base). Aucun backfill : les
  mandats antérieurs n'ont aucune partie.
- **Mandant principal posé automatiquement à la signature Prospect → Mandat — livré par
  `VISIT_NATIVE_ENTRY_V1` (sous-lot `MANDATE_PARTIES_AUTOFILL_V1`, 2026-09-21, aucune migration)** :
  `signerMandatProspectVendeur` pose, DANS sa transaction et via `ajouterPartieMandat` (verrous
  mandat → contact, garde Contact actif ADR-059 §10, `UNIQUE(mandat, contact)`), une partie
  `mandant` pour le Contact canonique que le prospect porte (`prospects_vendeurs.contact_id`, déjà
  repointé vers le survivant par le moteur de fusion ; si une fusion s'intercale, `contact_fusionne`
  laisse simplement le mandat sans partie — ADR-059 §10, jamais une réécriture vers le survivant,
  jamais une partie vers l'absorbé). Seul le vendeur réellement connu de ce
  flux est posé — aucun co-vendeur deviné ; un prospect legacy sans Contact garde un mandat sans
  partie ; l'idempotence vient de la signature elle-même (« une signature par prospect à vie »).
  Résultat enrichi (`partieMandant`). Non couvert : `creerBienAction` (`/biens/nouveau`, aucun
  vendeur connu) et `enregistrerMandatExistant`.
- **`mandat_signe` cible toujours le prospect** (idempotence « une signature par prospect à vie ») :
  un renouvellement ne pourra pas ré-émettre l'événement avant que la cible `mandat_id` existe (lot
  automatisations).
- **Aucun mandat pour l'historique** : les biens antérieurs à la migration `0037` n'en ont aucun.
- **`interactions` a trois écrivains délibérés, aucune conversion d'historique.** Envoi Gmail
  réussi (`finaliserEnvoiGmail`), retour vendeur après visite (`SELLER_FEEDBACK_INTERACTION_V1`) et
  échange noté à la main depuis la fiche Contact (`CRM_TIMELINE_V1`, 2026-09-22). Une note vendeur
  saisie depuis le dossier prospect garde son foyer (`notes_prospect_vendeur`, dont le `type` pilote
  `dernier_contact_le`) ; `envois_email` n'a ni contact ni contenu — seulement un hash. **Aucune
  donnée historique n'a été convertie** : le faire produirait des doublons sans provenance.
- **Une interaction ne dit pas qui l'a menée** (`INTERACTION_AUTHOR_DEBT`, ouvert, P3) : le produit
  est mono-conseiller et aucun modèle d'identité interne n'existe. Un échange noté depuis la fiche
  Contact n'a donc pas d'auteur. À traiter avec le multi-membre — jamais en réutilisant un `sub`
  Google comme clé métier, aucune migration posée en attendant.
- **Journal prospect vendeur et Historique Contact : deux écritures, une lecture** (`CRM_TIMELINE_V1`,
  stratégie B). « Noter un échange » sur un **dossier prospect vendeur** écrit toujours
  `notes_prospect_vendeur` ; « Noter un échange » sur une **fiche Contact** écrit `interactions`. La
  fiche Contact fusionne les deux **à la lecture seulement** (`listerTimelineContact`) ; le journal du
  dossier prospect, lui, n'affiche pas les interactions canoniques. Aucune double écriture, aucune
  migration des notes vers `interactions`. Une note legacy porte `cree_le` comme seule date : un
  échange antidaté depuis le dossier prospect apparaît à sa date de saisie.
- **Rapprochement Gmail ↔ note legacy volontairement conservateur.** Un envoi Gmail laisse
  historiquement une note « `Email envoyé — Objet : …` » dans le journal vendeur ET une interaction.
  La timeline ne masque la note que si le contact, le format exact, un vrai envoi Gmail, l'objet
  normalisé et un horodatage compatible (≤ 10 min, garde jamais suffisante seule) concordent, une
  note par interaction. Deux vrais emails proches restent deux items ; en cas de doute les deux
  s'affichent — un doublon visible est préféré à un email effacé. Rien n'est nettoyé en base.
- **Aucune synchronisation des emails entrants.** L'Historique ne connaît que les envois Gmail faits
  depuis DOMIORA ; un email reçu n'apparaît que s'il est noté à la main (« Email reçu »).
- **La mémoire relationnelle n'existe pas** : elle sera un read model dérivé, jamais une table.
  `memoire_contextuelle` n'est ni remplacée, ni touchée.
- **La couche provenance existe mais est vide.** `references_externes` et `champs_verrouilles`
  (migration `0039`) n'ont aucun écrivain en production : **aucun connecteur n'existe**, aucune
  synchronisation ne tourne, et aucun identifiant existant n'y a été converti. `mode` et
  `source_de_verite` sont des types, pas des lignes : `synchronisations_entite` attend le premier
  connecteur.
- **Un conflit n'est pas encore matérialisé.** `deciderApplicationValeurExterne()` sait dire
  « conflit », mais rien ne l'enregistre ni ne l'affiche : ni table dédiée, ni tâche, ni écran. La
  forme reste une question ouverte d'ADR-056. Tant qu'aucun connecteur ne tourne, aucun conflit ne
  peut survenir.
- **L'interaction canonique tirée d'un envoi Gmail ne couvre qu'une partie du portefeuille.** Elle
  n'est créée que si la ligne destinataire porte un `contact_id`, donc uniquement pour les
  acquéreurs et prospects vendeurs créés depuis le lot ADR-055. Les lignes antérieures restent
  silencieuses : l'envoi réussit, l'audit est correct, aucun échange n'est enregistré. La couverture
  réelle dépend donc de l'âge du portefeuille, et elle n'a pas été mesurée.
- **Un seul type d'échange, une seule direction.** Seul l'email SORTANT envoyé par l'API Gmail
  produit une interaction. Un `mailto:` (le chemin par défaut de l'écran de communication) n'en
  produit aucune, faute d'identifiant de message et de preuve d'envoi. L'entrant n'existe pas.
- **Une interaction d'email peut être perdue sans que rien ne le signale.** L'écriture canonique
  suit l'audit dans une transaction séparée, et son échec est journalisé sans jamais invalider
  l'envoi (même principe qu'ADR-028). Si elle échoue, l'email est parti, l'audit le dit, et aucun
  échange n'est enregistré — aucun rattrapage n'existe. C'est le prix assumé de ne jamais faire
  mentir l'audit d'envoi.
- **Le pipeline d'application traite UNE mutation, pour UNE entité.** `appliquerMutationExterne()`
  ne couvre que le projet acquéreur et huit de ses champs. Contact, projet vendeur, bien, mandat et
  interaction ne sont pas synchronisables : la généralisation attend que le patron soit prouvé par
  un connecteur réel, pas par cinq copies de la même fonction.
- **La source de vérité est passée par l'appelant, pas persistée.** ADR-056 §5 la veut déclarée par
  (entité, fournisseur) ; `synchronisations_entite` n'existe pas, donc le pipeline la reçoit dans
  son contexte. Tant qu'aucun connecteur ne tourne, personne ne peut la contredire — mais rien
  n'empêche aujourd'hui deux appels de la déclarer différemment pour la même entité.
- **Une fenêtre de concurrence subsiste sur le verrou.** Le pipeline lit le verrou et écrit dans la
  même transaction, en `READ COMMITTED` : un verrou posé par un humain **après** cette lecture et
  validé **avant** l'écriture ne serait pas vu, et la valeur externe passerait. Fermer la fenêtre
  demanderait de sérialiser les deux chemins d'écriture (verrou et valeur), ce qu'aucun d'eux ne
  fait aujourd'hui. La fenêtre est actuellement théorique : `verrouillerChamp()` n'a encore aucun
  appelant applicatif, et aucun connecteur ne tourne. À rouvrir dès que l'un des deux existe.
- **Le refus d'un invariant métier et l'entité introuvable rendent la même chose.**
  `modifierChampProjetAcquereur()` retourne `undefined` dans les deux cas ; le pipeline, qui a déjà
  relu l'entité dans sa transaction, en conclut le refus métier. C'est exact aujourd'hui, et ce ne
  le resterait pas si un second appelant utilisait cette primitive sans relire d'abord.
- **Trois identifiants externes antérieurs restent hors de cette couche** :
  `visites.rendez_vous_calendar_id` (corrélation temporaire, nullable depuis
  `VISIT_NATIVE_LIFECYCLE_V1`, `UNIQUE` partiel `WHERE ... IS NOT NULL`),
  `envois_email.gmail_message_id` (audit technique, ADR-031-bis) et `memoire_contextuelle`
  (hypothèse scorée). Constatés et gelés (ADR-056 §10), ils ne créent aucun précédent.
- **Aucun auteur sur un verrou** : DOMIORA sait qu'un humain a corrigé une valeur, pas lequel.
  Même dette que sur les interactions, à traiter avec le multi-membre.
- **`notes_prospect_vendeur` n'est pas migrée** : son vocabulaire est déjà celui des futures
  `interactions` (ADR-055 §G), qui ne sont ni du projet ni de la personne.
- **L'isolation inter-workspaces des parties de projet est applicative**, pas structurelle :
  `parties_projet` est une feuille sans `workspace_id` (ADR-054 §7), donc c'est
  `ajouterPartieProjet()` qui refuse une relation traversant deux périmètres. Une écriture SQL
  directe la laisserait passer.
- **Un projet peut n'avoir aucune partie.** Le schéma ne l'interdit pas (une partie référence le
  projet, donc le projet est écrit en premier) ; l'invariant est tenu par le flux de création.

## Lecture canonique des critères acquéreur (ADR-055 §B, lot « read bridge »)

Le moteur de compatibilité lit désormais `projets_acquereur` dès qu'un dossier `acquereurs` est
rattaché, et `acquereurs` sinon — au niveau de l'agrégat, jamais champ par champ. Ce qui reste
ouvert :

- **Les secteurs de recherche restent legacy.** `secteurs_recherche_acquereur` est toujours une
  feuille de `acquereurs`, chargée par l'id du dossier. Le modèle de lecture est donc **hybride** :
  critères canoniques, secteurs historiques. Assumé et documenté, jamais implicite.
- **Limite LEVÉE** (critères, puis identité) : pour un acquéreur rattaché, le formulaire écrit les
  critères dans le projet canonique et l'identité dans le Contact, et recharge les deux depuis eux.
  La divergence d'identité acquéreur n'existe plus (ADR-057).
- **Limite LEVÉE (vendeur)** : un prospect rattaché lit et écrit son identité sur son Contact, comme
  un acquéreur. Les deux faiblesses du même chemin sont fermées — l'action exige le workspace
  courant, et le writer est transactionnel et filtré par périmètre.
- **Limite LEVÉE** : un `contacts.prenom` NULL n'est plus traduit en chaîne vide par la projection
  acquéreur. `ProfilAcquereur.prenom` est optionnel, comme `ProspectVendeur.prenom` et
  `Contact.prenom` — une personne connue par son seul nom (ADR-055 §A) le reste jusqu'à l'écran.
  La conversion en `""` subsiste uniquement à la frontière d'un input HTML contrôlé, jamais dans un
  repository ni dans une règle.
- **Les dossiers non rattachés peuvent désormais l'être, à la main** (ADR-055 §H) : deux gestes
  explicites depuis la fiche, jamais un rapprochement déduit. Aucun backfill de masse n'existe et
  n'est prévu : `contacts` n'a toujours ni unicité ni index sur email ou téléphone.
- **Aucun rattachement des interactions et références externes historiques.** Une interaction créée
  avant le rattachement reste liée à ce qu'elle portait ; rien n'est rerouté vers le contact
  nouvellement lié. Les deviner par email serait exactement la fusion qu'ADR-055 §H interdit.
- **Aucun geste « changer de contact ».** Un dossier déjà rattaché ne peut pas être re-pointé :
  l'opération emporterait son historique relationnel et mérite ses propres garanties.
- **Aucune déduplication, même assistée.** Le produit ne signale pas encore deux contacts
  probablement identiques ; la recherche de candidats sert uniquement au rattachement.
- **`/contacts` mêle Contacts canoniques et dossiers historiques non rattachés, sans jamais les
  rapprocher** (ADR-058, `rechercherPersonnes()`). Le Contact est le résultat canonique ; un dossier
  `acquereurs.contact_id IS NULL` ou `prospects_vendeurs.contact_id IS NULL` est un résultat
  secondaire, marqué « Non rattaché », avec un lien vers sa fiche et vers le bloc de rattachement.
  Conséquences assumées : une même identité apparente (même nom, même email, même téléphone) peut
  produire **plusieurs cartes** — un Contact et un dossier, deux dossiers, deux Contacts et un
  dossier — et la page n'affiche aucun signal « probablement la même personne ». Seul l'humain
  rattache, depuis la fiche du dossier ; la liste ne le fait jamais. Les dossiers **archivés** ou
  perdus non rattachés apparaissent aussi : la recherche porte sur la personne, pas sur l'état du
  dossier. À requête vide, seuls les Contacts récents sont listés — jamais l'inventaire des dossiers
  non rattachés.
- **Depuis la fiche Contact (`/contacts/[id]`), seule l'identité est éditable.** `/contacts/[id]/modifier`
  corrige nom, prénom, email et téléphone via l'unique writer `modifierIdentiteContact` (ADR-057) :
  verrou humain sur les seuls champs changés, `modifie_le` déplacé, soumission à l'identique sans
  écriture. Les instantanés `acquereurs`/`prospects_vendeurs` ne sont jamais réécrits — les
  projections les lisent depuis le Contact. Rôles, projets, dossiers rattachés et interactions
  restent en lecture depuis la fiche ; aucune fusion, suppression ni changement de contact d'un
  dossier n'existe. Un email devenu identique à celui d'un autre Contact est accepté sans
  avertissement (ADR-055 §H) ; aucune validation de forme d'email ou de téléphone au-delà du reste
  du produit ; aucun verrouillage optimiste (dernier enregistrement gagnant, comme partout). Un
  projet sans dossier historique n'a pas de lien : aucune fiche n'accepte un id de projet.
- **La fiche Contact signale les Contacts partageant un email ou un téléphone, et ne fait rien
  d'autre.** `trouverContactsSimilaires` alimente une section read-only de `/contacts/[id]`
  (composant `ContactsSimilairesSection`) : pour chaque candidat du workspace, les faits détectés
  (« Même email », « Même téléphone », « Même nom et prénom » en corroboration seulement), ses
  rôles, son nombre de projets et un lien vers sa fiche. Un email ou un numéro commun n'est jamais
  une preuve d'identité (couple, famille, standard) : la section le dit, et n'emploie ni « doublon »
  ni score. Nom + prénom seuls ne font jamais remonter un candidat. Section absente sans candidat —
  jamais « aucun doublon détecté », que la détection ne peut pas affirmer (email ou numéro changé,
  faute de saisie, alias de messagerie ne sont pas détectés). Calculée à chaque rendu, jamais
  persistée (ni « vu », ni « ignoré »), aucun index dédié (`contacts_workspace_idx` seul — à
  reconsidérer sur mesure réelle). Aucune fusion, aucun bouton : le moteur de fusion est un lot
  distinct. `/contacts` (recherche) ne porte aucun badge.
- **La fusion de deux Contacts est humaine, explicite et irréversible (ADR-059).** Depuis la fiche,
  « Comparer » ouvre `/contacts/[conservé]/fusionner/[absorbé]` (aussi accessible par URL pour deux
  Contacts sans coordonnée commune) : comparaison côte à côte, « Inverser », un choix par champ en
  conflit parmi les valeurs existantes, impact annoncé, acquittement par avertissement,
  confirmation finale, puis `fusionnerContactsAction` appelle le moteur une fois. Limites
  assumées : **pas de défusion** (le journal `contact_fusions` — identités avant, choix, ids exacts
  déplacés, parties supprimées, rôles corrigés — permet une restauration manuelle) ; comparaison de
  deux Contacts à la fois seulement, aucune revue de masse ; **aucune saisie libre pendant la
  fusion** (une troisième valeur se saisit après, sur `/contacts/[id]/modifier`) ; les verrous
  humains de l'absorbé restent sur sa ligne et ne sont pas relus ; deux références externes du même
  fournisseur et type sont conservées toutes deux sur le survivant après acquittement (un
  connecteur futur devra choisir) ; sur un projet commun, la partie de l'absorbé est supprimée
  physiquement (seule suppression du produit, tracée) et un rôle principal l'emporte mécaniquement
  (`acquereur` > `co_acquereur`, `vendeur` > `co_vendeur`) sans question posée ; un refus renvoie
  sur la page de comparaison avec un message, l'humain recommence (aucune relance automatique) ;
  une chaîne invalide en lecture lève une erreur contrôlée. Un Contact absorbé est **figé** : tout
  writer métier recevant son id est refusé (`ErreurContactFusionne`), sans réécriture vers le
  survivant — un appelant qui travaille sur un état périmé doit relire. **Envoi Gmail concurrent
  d'une fusion** : l'email part, l'audit `envois_email` est réussi, mais si le contact du dossier a
  été absorbé entre-temps la finalisation rend `email_envoye_contact_fusionne` et n'écrit aucune
  interaction (ni sur l'absorbé, ni sur le survivant) ; l'échange n'apparaît alors sur aucune fiche
  tant que le message n'est pas finalisé à nouveau. Identité de l'absorbé conservée sur sa ligne et
  dupliquée dans le journal `contact_fusions` (données personnelles en double, sans mécanisme
  d'effacement). **Sur la fiche du survivant, « Contacts fusionnés » n'affiche que les fusions
  DIRECTES** (A → B → C : la fiche de C liste B, pas A — A se lit depuis la fiche de B) ; **l'audit
  détaillé n'est pas exposé** (choix par champ, ids déplacés, avertissements acquittés, identité
  finale, `sub` : en base seulement, lecture SQL) ; **aucune défusion**, ni bouton ni procédure
  outillée. `contact_fusions` n'a pas d'unicité sur `contact_absorbe_id` : le moteur garantit une
  ligne par absorbé (verrou + `deja_fusionne`), un doublon posé hors moteur serait affiché deux fois.
- **Les tâches ne sont pas agrégées sur la fiche Contact.** `taches` pointe vers les dossiers
  historiques (acquéreur, prospect, bien), jamais vers un contact ; les remonter exigerait une
  jointure par les ponts de dossier, lot à part entière. Elles restent visibles sur chaque dossier.
- **Les interactions historiques sans `contact_id` n'apparaissent pas sur la fiche.** Une
  interaction n'entre dans la fiche que par `contact_id` exact ; aucune n'est rapprochée par email
  ou téléphone (ADR-055 §H). Les notes de prospect vendeur sont fusionnées à la lecture dans
  l'Historique depuis `CRM_TIMELINE_V1` (via `prospects_vendeurs.contact_id`) ; les comptes rendus
  de visite, qui ne sont pas des interactions canoniques, restent sur leur dossier.
- **Le stade affiché pour un projet acquéreur est celui de `projets_acquereur`**, qui n'est plus mis
  à jour après la création (voir plus bas) ; le parcours commercial à jour reste sur le dossier,
  ouvrable depuis la fiche. Pas d'autosuggest, pas de barre globale, pas de filtre par rôle sur
  `/contacts`.
- **Le terme de recherche transite dans l'URL** (`?q=`), comme sur `/clients` et
  `/prospects-vendeurs` : un email ou un téléphone cherché figure dans l'historique du navigateur.
  Aucun terme n'est journalisé côté serveur ; passer en POST est une décision dédiée, hors de ce lot.
- **Aucune tolérance aux fautes.** « Dupond » ne trouve pas « Dupont ». `pg_trgm` et `unaccent` sont
  disponibles sur l'instance ; ils seront posés quand une mesure le justifiera, pas avant.
- **`projets_acquereur.stade_projet` n'est plus mis à jour après la création.** Le parcours
  commercial reste lu et écrit sur le dossier ; la copie du projet reste à sa valeur initiale.
  Aucun lecteur ne s'en sert aujourd'hui. La corriger demanderait de basculer tout le pipeline
  commercial, lot à part entière — la dupliquer en écriture recréerait une seconde vérité.
- **Le recalcul dépend du balayage de reprise.** `modifierChampProjetAcquereur()` enfile une demande
  de resynchronisation ADR-036 dans la transaction de l'appelant, mais ne la traite pas : c'est
  `/api/compatibilite/scan` qui la consomme. Une mutation canonique est donc durable mais pas
  instantanée, contrairement aux Server Actions qui appellent `traiterDemandeResynchronisation()`
  après commit. Le Sync Engine ne le fait pas, et ne doit pas le faire — il connaîtrait le moteur de
  matching.
- **Aucun filtrage par workspace dans cette lecture.** La résolution suit la FK du dossier vers son
  projet ; elle ne re-vérifie pas que les deux partagent le même périmètre. C'est la même décision
  que `getProjetAcquereurById()` (« ce lot ne l'active pas »), et le flux de création écrit les trois
  entités dans un seul workspace. Une écriture SQL directe qui croiserait deux périmètres ne serait
  pas rattrapée ici.
- **Les moteurs de points d'attention et de points forts restent sur le dossier.** Ils réutilisent
  les fonctions pures de `criteres.ts` avec un `ProfilAcquereur` — structurellement compatible avec
  le contrat du moteur. Ils peuvent donc afficher un point d'attention fondé sur un critère legacy
  pendant que la compatibilité est jugée sur le critère canonique. Aucun des deux ne décide d'une
  compatibilité, mais l'écart est réel.

## Architecture cible non construite

Rappel (détaillé dans `docs/ARCHITECTURE.md`) : ADR-003/004/005 décrivent une cible (API Python/
FastAPI, worker de connecteurs, stratégie LLM) qui n'existe pas dans le code aujourd'hui. Ce n'est
pas une limite du produit actuel, mais un écart à ne pas confondre avec l'état réel — voir aussi
`docs/AI_HANDOFF.md#ne-pas-supposer`.
