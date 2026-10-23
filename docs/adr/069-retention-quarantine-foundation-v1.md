# ADR-069 — Fondation de quarantaine de rétention

Statut : accepté
Date : 2026-10-23
Chantier : `RETENTION_QUARANTINE_FOUNDATION_V1`
Complète : ADR-066 (fondation du moteur de rétention, dry-run), ADR-067 (primitive de suppression de
fichier), ADR-068 (fondation legal hold), ADR-065 (gouvernance privacy et politiques de
conservation), ADR-054 (appartenance workspace), ADR-012 (archivage par horodatage)

## Contexte

Trois fondations existent désormais : le moteur de rétention sait DIRE ce qui serait éligible
(ADR-066, dry-run uniquement), une primitive sait supprimer un fichier sûrement sans aucun appelant
métier (ADR-067), et un registre sait SUSPENDRE toute future suppression (ADR-068). Il n'existe
toujours aucun chemin de suppression : `APPLY_SUPPORTED` est `false`,
`RETENTION_ENFORCEMENT_V1_LIVRE` est `false`.

Entre « cette ligne est éligible selon une politique » et « cette ligne part » il manque une étape,
et elle manque pour une raison précise : l'éligibilité est un CALCUL, instantané et réversible, alors
qu'une suppression est un ACTE irréversible. Passer directement de l'un à l'autre rend le calcul
lui-même dangereux — une erreur de politique, une donnée métier modifiée entre-temps, un contentieux
déclaré la veille, et la suppression est déjà faite.

L'audit préalable a établi qu'aucune notion proche n'existe dans le dépôt : ni `quarantine`, ni
`pending deletion`, ni `scheduled deletion`, ni `grace period`, ni `tombstone`, ni `cooling period`
(la seule occurrence du mot « quarantaine » est le mot français courant, « une quarantaine de
fichiers », dans un commentaire de test). Rien n'est donc réutilisable, et rien n'a été inventé en
doublon d'une abstraction existante.

## Décision 1 — Définition : un état de rétention, et rien d'autre

**Ce que la quarantaine N'EST PAS**, et cette liste a autant de valeur que la table :

- elle ne déplace aucun fichier ;
- elle ne cache aucune ressource à l'utilisateur ;
- elle n'archive pas la ressource métier (`archive_le` n'est jamais touché) ;
- elle ne modifie pas le contenu de la ressource ;
- elle ne supprime ni ligne, ni fichier ;
- elle n'anonymise rien ;
- elle ne rend aucune donnée inaccessible ;
- elle ne démarre aucun compte à rebours destructif.

**Ce qu'elle EST :** un état de rétention persistant et auditable, qui dit d'une cible qu'elle a été
jugée éligible selon une politique, qu'elle a été explicitement placée en quarantaine, qu'une
échéance court, qu'une REVALIDATION sera exigée à cette échéance, qu'un legal hold peut la bloquer à
tout moment, et qu'elle ne peut jamais être supprimée depuis cet état sans un mécanisme dédié qui
n'existe pas.

## Décision 2 — L'échéance signifie REVALIDATION_REQUISE, jamais DELETABLE

C'est le point de conception central du lot.

`revalidation_due_le` n'est pas une date de suppression. C'est la date à partir de laquelle une
relecture est **exigée**. Un modèle où une date atteinte rendrait une donnée supprimable
transformerait un oubli de relecture en suppression automatique — et un oubli de relecture est
exactement ce qui arrive dans un produit réel.

La garantie n'est pas déclarative, elle est **structurelle** : aucune valeur d'aucun vocabulaire de
ce lot ne peut exprimer une autorisation de purge.

- `ETATS_QUARANTAINE` = `EN_QUARANTAINE` | `REVALIDATION_REQUISE` | `LEVEE`. Aucun troisième état
  « échu et actionnable ».
- `VERDICTS_REVALIDATION_QUARANTAINE` : le plus permissif s'appelle **`AUCUN_BLOCAGE_CONNU`**. Il
  constate l'absence des blocages que CE lot sait vérifier ; il n'accorde aucun droit. Il ne
  s'appelle pas « autorisé » pour cette raison exacte.
- Un test structurel balaie les cinq listes du lot et échoue si une valeur contient `PURGE`,
  `DELETABLE`, `ALLOWED` ou `AUTORIS`.

## Décision 3 — Une table racine dédiée, et non une extension d'`actions_retention`

**Modèle retenu (option B du cadrage) :** une table `retention_quarantines`, racine au sens
d'ADR-054 §7, portant `workspace_id`, cible désignée par `entity_type` + `entity_id` (vocabulaire
fermé à `'bons_visite'`), ouverte au titre d'un `policy_code` (vocabulaire fermé à
`'SIGNED_VISIT_FORM'`), état dérivé des dates.

**Options rejetées :**

- **Option A — étendre `actions_retention`.** Rejetée après lecture de son contrat (ADR-066) : c'est
  un JOURNAL d'actions ponctuelles (`detected_at`, `executed_at`, `result`), feuille de
  `runs_retention` par une FK NOT NULL, sans `workspace_id`, et dont le CHECK `action` n'admet
  délibérément qu'une seule valeur. Trois incompatibilités, dont deux sont des défauts de sûreté :
  (a) une quarantaine a une durée de vie LONGUE et doit survivre indépendamment du balayage qui a
  détecté l'éligibilité, alors qu'en option A son appartenance dériverait d'un scan ancien ;
  (b) transformer un journal append-only en table d'état mutable y introduirait une seconde vérité
  sur « où en est cette ligne » ; (c) la table est explicitement laissée vide par ADR-066, et son
  CHECK fail-closed est le garde-fou qui empêche aujourd'hui d'écrire un verbe destructif — l'élargir
  pour un besoin d'état aurait affaibli une garde sans rapport. Ce n'est pas parce qu'une table
  existe qu'elle convient.
- **Option C — table enfant d'un run ou d'une action.** Rejetée pour la même raison (a) : faire
  dépendre un état de longue durée d'une ligne de journal. Et sémantiquement, une quarantaine n'est
  pas un produit de scan mais une décision sur une ressource.
- **Colonne sur `bons_visite`** (`quarantaine_jusqu_au`). Rejetée : ne porte ni motif, ni auteur, ni
  historique de sortie, son écrasement est indétectable, et elle modifierait une table métier pour
  une préoccupation d'administration.
- **FK vers `runs_retention`** comme « référence au run ayant détecté l'éligibilité », évoquée par le
  cadrage. Rejetée : aucun consommateur ne la demande, elle rattacherait l'état à un journal, et
  ADR-069 applique la règle « aucun champ sans usage démontré ».

## Décision 4 — Aucune clé étrangère vers la ressource mise en quarantaine

Identique à ADR-068 §3, et pour les deux mêmes raisons :

- `ON DELETE cascade` ferait disparaître l'historique de quarantaine avec la ressource ;
- `ON DELETE no action` retiendrait pour toujours une ressource dont la quarantaine a été LEVÉE,
  puisque la ligne demeure par immutabilité du registre.

L'existence de la cible dans le workspace est donc prouvée par une lecture scopée — à l'ENTRÉE, puis
**revérifiée à chaque revalidation** (`CIBLE_INTROUVABLE`). La seule FK de la table pointe vers
`workspaces`, en `ON DELETE no action`.

Conséquence assumée, écrite plutôt que découverte plus tard : l'état n'est pas contraint par la base.
Il repose sur le fait que tout futur chemin de suppression consulte le registre. Comme aucun chemin
de suppression n'existe, le risque est nul aujourd'hui.

## Décision 5 — State machine minimale, état dérivé

Trois états, **dérivés et jamais stockés** (ADR-012, même patron que `legal_holds`) :

| Condition | État |
|---|---|
| `levee_le IS NOT NULL` | `LEVEE` |
| sinon, `revalidation_due_le <= maintenant` | `REVALIDATION_REQUISE` |
| sinon | `EN_QUARANTAINE` |

Pas de colonne `statut` : en plus des dates, elle serait une seconde vérité, et le jour où les deux
divergeraient c'est la plus permissive qui piloterait une purge. `>=` et non `>` sur l'échéance, même
convention qu'`evaluerBonVisiteSigne` — une échéance qui ne vaudrait qu'à la milliseconde suivante
serait une échéance plus un epsilon non écrit.

## Décision 6 — Sortie non destructive, et `DELETE` interdit comme mécanisme de sortie

Lever une quarantaine est un `UPDATE` qui renseigne quatre colonnes — `levee_le`,
`levee_par_identite_sub`, `cause_levee`, `motif_levee` — les quatre ensemble ou aucune, imposé par
`retention_quarantines_coherence_levee_check`. Un `DELETE` de la ligne effacerait la trace de ce qui
a été envisagé puis abandonné, c'est-à-dire précisément ce qu'un registre de rétention doit
conserver.

`cause_levee` est un vocabulaire fermé, parce que ces sorties ne se valent pas à l'audit :
`DECISION_MANUELLE`, `POLITIQUE_NON_APPLICABLE`, `CIBLE_DISPARUE`, `LEGAL_HOLD_POSE`. **Aucun code ne
pose automatiquement aucune de ces causes** : la sortie est toujours un geste explicite.

Aucune fonction du repository ne réécrit `motif`, `entre_le`, `entre_par_identite_sub` ni
`revalidation_due_le`. Rallonger une échéance en silence reviendrait à réécrire la chronologie d'une
décision de rétention ; un test structurel vérifie que le seul `.set()` du fichier ne touche que les
colonnes de sortie.

## Décision 7 — Interaction Legal Hold : combinaison A + B, fail-closed des deux côtés

Le cadrage demandait de choisir entre « le hold empêche l'entrée » (A) et « l'entrée est permise mais
la purge future est bloquée » (B). **Les deux, et pas l'un ou l'autre**, parce qu'ils répondent à
deux moments différents :

**À l'ENTRÉE — le hold empêche (A).** Entrer en quarantaine est un pas délibéré vers une future
purge ; le faire sur une pièce juridiquement protégée afficherait une progression vers la suppression
de ce qui doit être conservé. Le refus est nommé (`bloquee_par_legal_hold`), jamais silencieux.

**APRÈS l'entrée — le hold bloque la revalidation (B).** Un hold posé plus tard ne lève pas la
quarantaine : la lever effacerait l'état, donc la trace de ce qui était en cours. Elle reste active,
et la revalidation rend `BLOCKED_BY_LEGAL_HOLD`. C'est le scénario que l'étape 8 du cadrage exigeait.

Les quatre autres garanties :

3. **L'expiration ne contourne jamais le hold.** Dans `revaliderQuarantaine`, le hold est évalué
   **avant** l'échéance — un test structurel vérifie cet ordre dans le code source. Aucun écoulement
   du temps ne peut transformer une pièce protégée en pièce actionnable, et les holds sont relus à
   chaque appel sur les données fraîches.
4. **Une erreur de lecture des holds est fail-closed.** Elle n'est ni rattrapée, ni convertie en
   « aucun hold » : elle remonte. Un test structurel interdit tout `??`, `||` ou `.catch(` autour de
   `listerCiblesSousLegalHoldActif`, et n'autorise qu'un seul `catch` dans le repository — celui qui
   traduit la violation d'unicité de l'INSERT en `deja_active`.
5. **La quarantaine ne peut jamais lever un hold.** Elle n'importe que
   `listerCiblesSousLegalHoldActif` ; `creerLegalHold` et `leverLegalHold` sont interdits par un test
   structurel.
6. **Le moteur de rétention reste lecteur seul** des deux registres (ADR-068 §8, étendu à la
   quarantaine).

## Décision 8 — Durée de quarantaine : NON DÉCIDÉE, et rien ne l'invente

`QUARANTINE_DURATION_POLICY = UNDECIDED`.

Aucune durée de quarantaine n'existe dans le produit : ni dans `conservation.ts` (ADR-065), ni dans
aucune ADR, ni dans aucune règle produit. Elle n'est donc pas inventée — ni « 30 jours », ni
« 90 jours », ni une valeur dérivée des cinq ans de conservation.

**RETENTION_DURATION et QUARANTINE_DURATION ne sont pas la même chose**, et les confondre serait la
faute la plus coûteuse de ce domaine : « cinq ans après signature » est une règle de CONSERVATION
(ADR-065), pas une autorisation de purge. Un test structurel vérifie qu'aucune échéance de
quarantaine n'est calculée depuis `dureeAnneesPourDeclencheur` ni `ajouterAnnees`.

Conséquences concrètes :

- `dureeQuarantainePour()` rend `undefined` pour toute politique, et `DUREE_QUARANTINE_DECIDEE` vaut
  `false`. Le jour où une durée sera tranchée, c'est là qu'elle apparaîtra — un seul endroit.
- `revalidation_due_le` est **NOT NULL et sans DEFAULT** : l'échéance est toujours fournie
  explicitement par l'appelant. La base ne peut pas en fabriquer une, et aucun chemin automatique ne
  peut la calculer.
- Le moteur de rétention NOMME ce manque : `QUARANTINE_POLICY_MISSING` s'ajoute aux
  `blocagesAvantSuppression` de `SIGNED_VISIT_FORM`. Un blocage de plus, jamais un de moins — les
  deux précédents (`FILE_DELETE_PRIMITIVE_MISSING`, `DELETE_PATH_MISSING`) restent entiers.

## Décision 9 — Périmètre V1 : `SIGNED_VISIT_FORM` seul

`policy_code` est restreint par CHECK à `SIGNED_VISIT_FORM`, la seule politique dont l'échéance soit
calculable (`COMPUTABLE_DRY_RUN_ONLY`, ADR-066). Une politique bloquée ne produit aucun candidat :
l'accepter permettrait d'ouvrir une quarantaine que rien ne justifie. Un test structurel compare la
liste du code à ce que `statutPolitique` déclare calculable, dans les deux sens.

`entity_type` est restreint à `bons_visite`, aligné sur `TYPES_CIBLE_LEGAL_HOLD`. L'élargissement
passera par une migration et par le câblage de la lecture correspondante — les deux ensemble.

## Décision 10 — Concurrence tranchée par la base

- **Deux entrées simultanées pour la même cible et la même politique** : aucune lecture-puis-écriture
  sur l'unicité. L'`INSERT` est tenté, l'index unique **partiel**
  `retention_quarantines_cible_active_unique` (sur `WHERE levee_le IS NULL`) tranche, et la violation
  `23505` — reconnue **par le nom de la contrainte**, pas seulement par son code, pour ne pas
  absorber une violation sans rapport — est traduite en `deja_active` après relecture.
- **Deux levées simultanées** : la condition `levee_le IS NULL` est DANS le `WHERE` de l'`UPDATE`
  (idiome du « gel concurrent » déjà utilisé par `tacheRepository`, `envoiEmailRepository`,
  `legalHoldRepository`). La seconde ne met à jour aucune ligne, relit l'état réel et rend
  `deja_levee` ; l'auteur, la cause et le motif de la première ne peuvent pas être écrasés.
- **Levée puis nouvelle entrée** : possible, parce que l'index est partiel. Un index total aurait
  interdit pour toujours de remettre en quarantaine une cible déjà sortie une fois.
- **Hold ajouté pendant une revalidation** : la revalidation relit les holds à chaque appel ; elle ne
  met rien en cache et n'écrit rien, donc elle est rejouable et ne peut pas conclure sur un état
  périmé.
- **Cible déjà en quarantaine / déjà levée / inexistante / d'un autre workspace** : états normaux
  rendus par des unions discriminées (`{ statut }`), jamais par une exception (convention ADR-007).
  Seules les entrées malformées lèvent (`ErreurQuarantaineInvalide`).

## Décision 11 — Isolation workspace

`retention_quarantines` porte son `workspace_id`. Toute fonction du repository reçoit le périmètre en
**paramètre** (jamais lu depuis la session — un test structurel l'interdit dans ce module) et le place
dans le `WHERE`, y compris pour l'`UPDATE` de levée et pour la revalidation.

Une quarantaine d'un autre workspace est **introuvable** ; une cible d'un autre workspace est
`cible_introuvable`, indistinguable d'une cible absente. Distinguer les deux renseignerait sur
l'existence d'une ligne hors périmètre.

## Décision 12 — Le dry-run est LECTEUR SEUL de la quarantaine

`DRY_RUN_WRITES_QUARANTINE = NO`.

Le dry-run lit l'ensemble des cibles en quarantaine active et en fait un compteur
(`quarantineCount`). Il n'en ouvre aucune et n'en lève aucune.

Pourquoi ce choix plutôt qu'une création automatique : faire d'un balayage le créateur d'un état de
longue durée transformerait un comptage en décision. Et le jour où un balayage tournerait tout seul,
il aurait engagé des ressources vers une purge sans qu'aucun humain ne l'ait voulu — alors même que
la route de dry-run est délibérément sans cron (ADR-066). L'entrée en quarantaine reste un geste
distinct, réservé au futur lot d'enforcement. Deux tests structurels le verrouillent : le moteur ne
peut importer que `listerCiblesEnQuarantaineActive`, et seul `retentionRepository.ts` peut importer
`lib/quarantaine`.

Le compteur est **informatif** : être en quarantaine ne change AUCUN verdict. Une ligne en
quarantaine reste `ELIGIBLE` au sens de la politique — la quarantaine est l'étape SUIVANTE, pas un
blocage. Le compteur est incrémenté **hors** du `switch` de verdict, parce qu'une ligne en
quarantaine peut être `ELIGIBLE` ou `BLOCKED_BY_LEGAL_HOLD` (hold posé après l'entrée) et doit être
vue dans les deux cas.

## Décision 13 — La revalidation est une lecture

`revaliderQuarantaineEnBase` rend un verdict et **n'écrit rien**. Elle est donc rejouable autant de
fois que nécessaire sans modifier l'état qu'elle observe, ce qui est la propriété qu'on attend d'une
vérification avant acte.

Journaliser chaque tentative demanderait une seconde table dont aucun consommateur n'existe
aujourd'hui ; l'historique persisté est celui de la quarantaine elle-même (entrée, puis sortie). La
trace des revalidations relèvera du lot d'enforcement, qui en aura un usage.

Elle vérifie, dans cet ordre : quarantaine déjà levée → cible introuvable → **legal hold actif** →
politique devenue inapplicable → échéance non atteinte → `AUCUN_BLOCAGE_CONNU`. L'applicabilité de la
politique est **recalculée sur les données fraîches** par le moteur pur, jamais reprise de
l'évaluation qui avait conduit à l'entrée : c'est exactement ce que « revalider » veut dire.

## Décision 14 — Auteur : `identite_sub`, sans FK

`entre_par_identite_sub` et `levee_par_identite_sub` portent le `sub` OIDC de la session Atlas
(ADR-047), sans FK, et jamais l'email — même raisonnement et même précédent qu'ADR-068 §9. Aucun
appelant ne l'alimente depuis une session aujourd'hui : ce lot ne livre ni route ni action serveur.

## Garanties vérifiées par les tests

| Garantie | Où |
|---|---|
| Aucune valeur d'aucun vocabulaire ne nomme une suppression | `quarantaine.test.ts`, `quarantaine.structurel.test.ts` |
| Durée non décidée : aucune politique ne rend de durée | `quarantaine.test.ts` |
| Échéance absente, invalide ou antérieure à l'entrée refusée | idem + `quarantaineRepository.test.ts` |
| État dérivé, frontière exacte de l'échéance (`>=`) | `quarantaine.test.ts` |
| Échéance dépassée → `REVALIDATION_REQUISE`, jamais autre chose | idem |
| Ordre des verdicts : hold avant échéance | idem + garde structurelle sur le source |
| Entrée, lecture, sortie, revalidation sur vraie base | `quarantaineRepository.test.ts` |
| Historique d'entrée intact après levée | idem |
| Double entrée → `deja_active` ; entrées simultanées → une seule crée | idem |
| Double levée → `deja_levee` ; levées simultanées → une seule lève | idem |
| Cible levée peut recevoir une NOUVELLE quarantaine (index partiel) | idem |
| Cible inexistante / non-uuid / autre workspace → `cible_introuvable` | idem |
| Lire, lever et revalider sont scopés au workspace (+ workspace vide) | idem |
| Revalidation n'écrit rien et est rejouable | idem + garde structurelle |
| Politique devenue inapplicable détectée sur données fraîches | idem |
| Hold actif empêche l'entrée | `quarantaineLegalHold.test.ts` |
| Hold posé après l'entrée bloque la revalidation | idem |
| Échéance dépassée de 70 ans ne contourne pas le hold | idem |
| Le hold ne lève pas la quarantaine en silence | idem |
| La quarantaine n'a pas levé le hold | idem |
| Hold levé → revalidation reprend, et reste une revalidation | idem |
| Dry-run compte sans créer ; `QUARANTINE_POLICY_MISSING` nommé | idem |
| Aucune suppression, en base comme sur disque, dans tous les cas | idem + `quarantaineRepository.test.ts` |
| Aucun `.delete(`, aucun accès fs, aucun déplacement de fichier | `quarantaine.structurel.test.ts` |
| Seule `retention_quarantines` est écrite ; cibles lues, jamais masquées | idem |
| Aucune route, action serveur, écran, cron | idem |
| Migration additive : une table, une FK vers `workspaces`, aucun cascade | idem |
| Vocabulaires TypeScript ≡ CHECK SQL, dans les deux sens | idem |
| `APPLY_SUPPORTED` reste faux ; `supprimerFichierStocke` reste sans appelant | idem |
| Le moteur de rétention est lecteur seul des deux registres | `retention.structurel.test.ts` |

## Ce que ce chantier ne livre pas

- **Aucune purge, aucune suppression.** `APPLY_SUPPORTED` reste `false`,
  `RETENTION_ENFORCEMENT_V1_LIVRE` reste `false`.
- **Aucun cron**, aucun planificateur, aucun worker, aucun déclenchement automatique.
- **Aucune route HTTP, aucune Server Action, aucun écran.**
- **Aucun appel à `supprimerFichierStocke`** : la primitive d'ADR-067 reste sans appelant métier, et
  un test le vérifie sur l'ensemble de `src/`.
- **Aucune modification d'une table métier**, aucune colonne ajoutée ailleurs, aucun masquage, aucun
  archivage.
- **Aucune durée de quarantaine.** Voir décision 8.
- **Aucune journalisation des revalidations.** Voir décision 13.

## Limites connues

1. **Aucune durée décidée, donc aucun appelant légitime.** Les primitives existent ; tant que
   `QUARANTINE_DURATION_POLICY` reste `UNDECIDED`, aucun chemin automatique ne peut calculer une
   échéance. Seuls les tests ouvrent des quarantaines. C'est l'ordre de construction retenu — l'état
   et ses gardes avant le mécanisme — mais cela signifie que la quarantaine ne sert encore à rien en
   exploitation.
2. **L'état n'est pas contraint par la base** (voir décision 4) : il repose sur la consultation du
   registre par tout futur chemin de suppression.
3. **Les revalidations ne sont pas journalisées.** On sait qu'une quarantaine existe et quand elle
   est sortie ; on ne sait pas combien de fois elle a été relue ni par qui.
4. **`motif` est un texte libre.** Rien n'empêche techniquement un opérateur d'y recopier une donnée
   personnelle. Le champ est documenté comme devant décrire une situation de rétention.
5. **Une seule politique, un seul type de cible.** Voir décision 9.
6. **Aucune garde de rôle.** Le repository ne vérifie pas que l'auteur est `owner` du workspace : il
   n'y a pas de surface, donc pas de point où l'appliquer. Le lot qui livrera la surface devra poser
   `exigerOwnerWorkspaceCourant()` (ADR-065).
7. **La revalidation ne vérifie pas les préconditions fichier.** `AUCUN_BLOCAGE_CONNU` ne dit rien de
   l'existence du PDF ni du PNG de signature sur disque : ces vérifications appartiennent au chemin
   de suppression, qui n'existe pas. C'est précisément pourquoi ce verdict ne s'appelle pas
   « autorisé ».

## Scalabilité

Le registre est écrit par acte délibéré : son volume se compte en unités ou dizaines, pas en
milliers. La seule lecture chaude est `listerCiblesEnQuarantaineActive`, une requête par workspace et
par balayage, servie par `retention_quarantines_cible_idx` et bornée par le nombre de quarantaines
actives du workspace — jamais par le nombre de bons de visite.

Le croisement candidats × cibles en quarantaine se fait en mémoire sur un `Set`, délibérément : un
`leftJoin` dupliquerait chaque bon autant de fois qu'il porte de quarantaines, et un comptage
d'éligibilité qui dépend du nombre d'états ouverts serait faux de la plus mauvaise manière possible.

## Réversibilité

Le domaine est additif et isolé dans `lib/quarantaine/`. Le retirer demanderait de défaire quatre
points, et rien d'autre : l'import de `listerCiblesEnQuarantaineActive` dans
`retentionRepository.ts`, le champ `enQuarantaineActive` du candidat et de l'évaluation, le compteur
`quarantineCount`, et le blocage `QUARANTINE_POLICY_MISSING`.

La table est vide à la sortie du lot et ne peut être remplie que par un appel explicite : une
migration de retrait serait un `DROP TABLE` sans perte de donnée métier. Les valeurs ajoutées aux
vocabulaires du moteur sont des constantes TypeScript sans contrainte SQL à défaire —
`actions_retention` n'a pas été touchée et reste vide.

## Chantiers suivants

1. **`QUARANTINE_DURATION_POLICY_V1`** — trancher la durée de quarantaine, et seulement elle. Tant
   qu'elle n'est pas décidée, aucun enforcement n'est honnête : c'est le prérequis le plus court du
   reste de la file.
2. **`RETENTION_DELETE_PATH_V1`** — le chemin de suppression complet pour `SIGNED_VISIT_FORM` :
   `bons_visite.document_id` est en SET NULL (supprimer le bon laisserait la ligne `documents_bien`
   du PDF et son fichier) et `evenements_metier.bon_visite_id` en NO ACTION bloque la suppression dès
   qu'un événement référence le bon.
3. **`QUARANTINE_SURFACE_V1`** — la surface humaine : ouvrir, consulter, revalider et lever depuis le
   produit, avec `exigerOwnerWorkspaceCourant()` et le câblage de l'auteur depuis la session.
4. **`RETENTION_APPLY_V1`** — et il ne sera recevable qu'en démontrant que le chemin de suppression
   passe par une revalidation de quarantaine ET par le registre des legal holds avant toute action.
