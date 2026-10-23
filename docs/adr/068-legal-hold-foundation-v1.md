# ADR-068 — Fondation Legal Hold : suspension explicite de suppression

Statut : accepté
Date : 2026-10-23
Chantier : `LEGAL_HOLD_FOUNDATION_V1`
Complète : ADR-066 (fondation du moteur de rétention, dry-run), ADR-067 (primitive de suppression de
fichier), ADR-065 (gouvernance privacy et politiques de conservation), ADR-054 (appartenance
workspace), ADR-012 (archivage par horodatage), ADR-047 (identité de session Atlas)

## Contexte

ADR-066 a livré la fondation du moteur de rétention et constaté que, même pour la seule politique
calculable (`SIGNED_VISIT_FORM`), aucune suppression n'était possible faute de trois briques : une
primitive de suppression de fichier, un chemin de suppression complet, et **un modèle de suspension
pour contentieux**. ADR-067 a livré la première. Cette ADR livre la troisième, et seulement
celle-là.

L'état réel avant ce lot :

- `conservation.ts` (ADR-065) déclare depuis le début un champ `legalHoldApplicable: boolean` par
  politique, `true` pour `SIGNED_VISIT_FORM` seul, avec le commentaire explicite « CONCEPT documenté,
  non implémenté : il n'existe aujourd'hui ni purge à suspendre, ni marqueur de litige dans le
  schéma ». La déclaration existait, le modèle derrière n'existait pas.
- Le vocabulaire du moteur de rétention NOMMAIT l'absence : `LEGAL_HOLD_MODEL_MISSING` dans
  `CODES_BLOCAGE_RETENTION`, et `BLOCKED_MISSING_LEGAL_HOLD` dans les statuts de politique — ce
  dernier n'étant porté par aucune politique.
- Un test structurel INTERDISAIT activement toute forme de legal hold dans `lib/retention/`
  (`retention.structurel.test.ts`, « aucun legal hold n'est posé, levé ni modélisé »). Cette garde
  devait être amendée par le lot qui livrerait le modèle : c'était sa raison d'être.
- Aucune abstraction réutilisable n'existait. Les mots voisins du dépôt sont des faux amis :
  `biens.statut_mandat = 'suspendu'` est un statut de mandat (vocabulaire *legacy*, qu'ADR-055
  interdit explicitement de réutiliser), et le « gel concurrent » est l'idiome d'idempotence
  optimiste (`UPDATE ... WHERE colonne IS NULL`), sans aucun rapport.
- Aucun chemin de suppression métier n'existe dans le produit. `APPLY_SUPPORTED` est `false`,
  `RETENTION_ENFORCEMENT_V1_LIVRE` est `false`, la primitive fichier d'ADR-067 n'a aucun appelant
  métier, et `evenements_metier.bon_visite_id` en NO ACTION bloque structurellement la suppression
  d'un bon de visite référencé.

Un legal hold est donc construit ici **avant** toute purge — et c'est le bon ordre. Construire la
protection après le mécanisme destructif, c'est accepter une fenêtre pendant laquelle une preuve
nécessaire à un litige peut partir.

## Décision 1 — Périmètre : une interdiction, pas une règle de cycle de vie

Ce lot livre un registre auditable de suspensions, quatre primitives de domaine (poser, lever,
consulter, détecter) et leur intégration au CALCUL de rétention. Il ne livre ni purge, ni cron, ni
route HTTP, ni écran, ni action serveur, ni `Retention apply`, ni suppression de fichier, ni
suppression de ligne métier.

Un legal hold n'AUTORISE rien. Il INTERDIT. Cette asymétrie est ce qui rend acceptable de le livrer
seul : une fondation qui ne sait qu'interdire ne peut pas, même mal utilisée, détruire une donnée.

## Décision 2 — Une table racine à cible typée, et pas de modèle polymorphique

**Modèle retenu (option A contrainte) :** une table `legal_holds`, racine au sens d'ADR-054 §7,
portant `workspace_id`, avec une cible désignée par `entity_type` + `entity_id` dont `entity_type`
n'admet qu'un **vocabulaire fermé d'un seul élément** aujourd'hui : `'bons_visite'`.

Pourquoi racine et non feuille : `bons_visite` ne porte lui-même aucune appartenance (c'est une
feuille de `visites -> biens`), donc aucune FK vers lui ne permettrait de dériver un périmètre. Et
la cible est générique sans FK — exactement le cas de `memoire_contextuelle` (ADR-054, question
ouverte n°4) et de `runs_retention`. Un hold est d'ailleurs un acte d'administration du workspace,
pas une donnée métier rattachée à une ligne.

Pourquoi un vocabulaire fermé à un seul type : un `entity_type` ouvert aurait permis de poser un hold
sur un type qu'aucun chemin ne consulte. **Un hold qui ne protège rien est pire qu'un hold absent,
parce qu'il se lit comme une protection.** Le seul type supporté est celui pour lequel une politique
déclare `legalHoldApplicable: true` ET dont le moteur lit effectivement les holds. Un test
structurel verrouille cette correspondance dans les deux sens.

**Options rejetées :**

- **Table spécialisée par ressource** (`bons_visite_legal_holds`) : elle aurait évité la cible typée,
  mais au prix d'une nouvelle table, d'un nouveau repository et d'une nouvelle intégration à chaque
  ressource protégeable. Surtout, le jour où deux types sont protégeables, la question « cette
  ressource est-elle sous hold ? » devient une union de requêtes dont l'oubli d'une branche est
  silencieux et fail-open.
- **Hold large sur un dossier / une transaction** (option B du cadrage) : REJETÉE parce que l'entité
  n'existe pas dans le modèle. Il n'y a ni table `dossiers`, ni `transactions` regroupant les pièces
  d'une affaire. L'inventer pour porter un hold aurait été une abstraction prématurée fondée sur
  rien, et un hold rattaché à un regroupement fictif aurait une couverture impossible à vérifier.
- **Hold de catégorie globale** (option C) : REJETÉE parce que le besoin est déjà servi ailleurs, et
  mieux. Suspendre une catégorie entière, c'est ce que fait déjà `conservation.ts` par le statut
  d'une politique, et le moteur le rend par `statutPolitique`. Un second mécanisme pour la même
  décision aurait créé deux vérités sur « cette catégorie est-elle purgeable », dont la plus
  permissive aurait fini par décider.
- **Colonne `is_held` / `legal_hold_jusqu_au` sur `bons_visite`** : REJETÉE. Une colonne ne porte ni
  motif, ni auteur, ni historique de levée, et son écrasement est indétectable. Elle aurait aussi
  modifié une table métier pour une préoccupation d'administration.

## Décision 3 — Aucune clé étrangère vers la ressource protégée

C'est le point de conception le plus contre-intuitif du lot, et il mérite d'être écrit.

- Une FK `ON DELETE cascade` ferait disparaître l'historique du hold avec sa ressource. Un registre
  de conservation qui perd ses lignes quand la pièce part ne prouve précisément rien.
- Une FK `ON DELETE no action` protégerait la ressource **au niveau SQL** — séduisant — mais la
  protégerait AUSSI pour toujours une fois le hold LEVÉ, puisque la ligne du registre reste par
  immutabilité. La levée serait sans effet, et le registre deviendrait faux.
- Donc : `entity_type` + `entity_id` en texte sans FK, précédent d'`actions_retention`. Le registre
  survit à ce qu'il décrit, et **l'existence de la cible dans le workspace est prouvée à la pose**
  par la jointure `bons_visite -> visites -> biens` placée dans le `WHERE`.

Conséquence assumée, écrite ici plutôt que découverte plus tard : **la protection n'est pas
contrainte par la base.** Elle repose sur le fait que tout futur chemin de suppression consulte le
registre. Comme aucun chemin de suppression n'existe, le risque est nul aujourd'hui ; l'ADR du lot
qui en livrera un devra démontrer cette consultation, et c'est une condition de sa recevabilité.

## Décision 4 — L'état est dérivé, et la levée est une transition

Pas de colonne `statut`, pas de booléen : **actif ⟺ `leve_le IS NULL`**, sur le patron d'ADR-012
(un événement de cycle de vie binaire se représente par la date à laquelle il survient). Une colonne
d'état en plus des dates serait une seconde vérité, et le jour où les deux divergeraient, c'est la
plus permissive qui piloterait une purge.

Lever un hold n'est **jamais** un `DELETE`. C'est un `UPDATE` qui renseigne trois colonnes et n'en
écrase aucune autre :

- `leve_le`, `leve_par_identite_sub`, `motif_levee` — les trois ensemble ou aucune, imposé par
  `legal_holds_coherence_levee_check`. Sans ce CHECK, un UPDATE partiel produirait un hold « levé »
  sans auteur ni raison : la disparition silencieuse d'une protection.
- `motif`, `pose_le` et `pose_par_identite_sub` ne sont réécrits par aucune fonction du repository,
  et un test structurel vérifie que le seul `.set()` du fichier ne les mentionne pas.

Un hold levé reste lisible dans l'historique de sa cible, avec son motif d'origine et le motif de sa
levée.

## Décision 5 — Plusieurs holds actifs par ressource, clés par motif

L'unicité logique est portée par un **index unique PARTIEL** sur
`(workspace_id, entity_type, entity_id, motif_code) WHERE leve_le IS NULL`.

`motif_code` est dans la clé à dessein : plusieurs motifs peuvent protéger la même pièce en même
temps — un contentieux et un contrôle — et lever l'un ne doit pas lever l'autre. **Collapser à un
seul hold par cible aurait été fail-open :** clore le contentieux aurait libéré une pièce qu'un
contrôle retenait encore.

L'index est partiel, et c'est ce qui rend le modèle praticable : une cible dont le hold a été levé
peut en recevoir un nouveau, ce qu'un index unique total aurait interdit pour toujours.

## Décision 6 — Concurrence tranchée par la base, jamais en mémoire

- **Deux poses simultanées du même hold** : aucune lecture-puis-écriture. L'`INSERT` est tenté
  directement, l'index partiel tranche, et la violation d'unicité (`23505`) est traduite en
  `deja_actif` après relecture. Un `SELECT puis INSERT si absent` aurait laissé les deux passer,
  quel que soit le soin du code applicatif.
- **Deux levées simultanées** : la condition `leve_le IS NULL` est DANS le `WHERE` de l'`UPDATE`
  (idiome du « gel concurrent » déjà utilisé par `tacheRepository` et `envoiEmailRepository`). La
  seconde ne met à jour aucune ligne, relit l'état réel et rend `deja_leve`. L'auteur et le motif de
  la première levée ne peuvent pas être écrasés.
- **Hold déjà levé / hold inexistant / cible inexistante / cible d'un autre workspace** : états
  normaux rendus par une union discriminée (`{ statut }`), jamais par une exception — convention
  ADR-007. Seules les entrées malformées lèvent (`ErreurLegalHoldInvalide`).

## Décision 7 — Isolation workspace, et cible introuvable plutôt que refusée

`legal_holds` porte son `workspace_id`. Toute fonction du repository reçoit le périmètre en
**paramètre** (jamais lu depuis la session : convention ADR-007, et un test structurel l'interdit
dans ce module) et le place dans le `WHERE`, y compris pour l'`UPDATE` de levée.

Un hold d'un autre workspace est **introuvable**, pas « visible mais refusé ». Une cible d'un autre
workspace est **`cible_introuvable`**, indistinguable d'une cible absente. Distinguer les deux
renseignerait sur l'existence d'une ligne hors périmètre — c'est le même patron que
`bonVisiteRepository`.

## Décision 8 — Intégration au CALCUL de rétention, et à rien d'autre

Un nouveau verdict d'entité, `BLOCKED_BY_LEGAL_HOLD`, et un code de blocage, `ACTIVE_LEGAL_HOLD`.

Pourquoi un verdict distinct de `BLOCKED` : `BLOCKED` signifie « on ne sait pas » (état incohérent,
valeur hors vocabulaire, donnée manquante) ; celui-ci signifie « on sait, et c'est interdit ». Les
confondre ferait disparaître une protection délibérée dans le même compteur que les incohérences de
données — donc dans le bruit — et rendrait impossible de répondre le jour d'un contentieux à la seule
question qui compte : cette pièce est-elle protégée ?

Le hold est appliqué **en dernier**, sur le seul verdict qui autoriserait un jour une suppression :

| Verdict calculé | Avec hold actif |
|---|---|
| `ELIGIBLE` | → `BLOCKED_BY_LEGAL_HOLD` |
| `NOT_YET_ELIGIBLE` | inchangé (déjà non supprimable) |
| `OUT_OF_SCOPE` | inchangé (la ligne ne relève pas de la politique) |
| `BLOCKED` | inchangé — « on ne sait pas » reste le verdict le plus fort |

`eligible_at` est **conservé** sur un verdict bloqué par hold : l'échéance est un fait, le hold
interdit d'agir dessus sans l'annuler. L'effacer rendrait impossible de savoir, à la levée, depuis
quand la pièce était échue.

**Fail-closed, par le type et par la propagation :**

- `CandidatBonVisiteRetention.sousLegalHoldActif` est un champ **obligatoire**, pas optionnel : un
  objet littéral qui l'omettrait ne compile pas. Un `boolean | undefined` aurait fait d'un oubli de
  câblage une ligne ÉLIGIBLE — exactement la panne qu'un legal hold doit rendre impossible. Limite
  honnête de cette garde : un appelant qui étale un `Partial<CandidatBonVisiteRetention>` y échappe
  (idiome des fixtures de test, qui posent donc le champ explicitement). La garde qui tient vraiment
  est la suivante.
- Une lecture de holds en échec **remonte**. Elle n'est ni rattrapée, ni convertie en ensemble vide.
  Le `try/catch` par politique de `executerDryRunRetention` la rend comme politique BLOQUÉE avec
  `REPOSITORY_ERROR`. Rendre un ensemble vide sur échec aurait produit des candidats ÉLIGIBLES alors
  que des holds existaient. Un test structurel interdit tout `catch` dans
  `retentionRepository.ts`.
- Le moteur reçoit un **booléen**, jamais le hold : il n'a aucun usage du motif, de l'auteur ni des
  dates, et une donnée qu'une fonction ne possède pas est une donnée qu'elle ne peut pas divulguer.
- Le moteur de rétention est un **lecteur seul** du registre : seul `retentionRepository.ts` importe
  `lib/legalHold`, et seulement `listerCiblesSousLegalHoldActif`. Ni `eligibilite.ts` ni
  `dryRunRetention.ts` ne peuvent même le voir. Un moteur de purge capable de lever les protections
  qu'il consulte serait la pire défaillance possible de ce domaine.

`LEGAL_HOLD_MODEL_MISSING` est retiré des `blocagesAvantSuppression` de `SIGNED_VISIT_FORM`, et
uniquement celui-là : le modèle existe et le moteur le consulte, donc l'y laisser serait faux.
`FILE_DELETE_PRIMITIVE_MISSING` et `DELETE_PATH_MISSING` restent, et chacun suffit seul à interdire
d'agir. Le code `LEGAL_HOLD_MODEL_MISSING` reste dans le vocabulaire : il redeviendra exact le jour
où une politique visera un type de cible non couvert.

## Décision 9 — Auteur : `identite_sub`, et la question ouverte n°3 d'ADR-054 est tranchée pour ce registre

`pose_par_identite_sub` et `leve_par_identite_sub` portent le `sub` OIDC de la session Atlas
(ADR-047), déjà la clé d'appartenance de `workspace_membres` et de `connexions_google`. Aucune FK :
il n'existe pas de table d'utilisateurs, `workspace_membres.identite_sub` n'est pas unique (PK
composite), et une FK `no action` ferait du registre un obstacle au retrait d'un membre.

**Pas l'email**, contrairement au précédent `transmissions_dossier_notaire.cree_par_email` : un
registre de conservation n'a pas besoin d'une coordonnée pour désigner un auteur de façon stable, et
une adresse est une donnée personnelle de plus dans une table qui n'en veut aucune.

ADR-054 laissait en question ouverte n°3 « faut-il une colonne d'auteur ? ». Ce lot la tranche **pour
ce registre seulement**, et c'est assumé : un acte d'administration irréversible dans ses effets
juridiques sans auteur identifié n'est pas auditable. Rien n'est décidé ici pour `notes_bien`,
`comptes_rendus_visite` ni `taches`.

Le champ est obligatoire côté domaine **et** NOT NULL en base. Aucun appelant ne l'alimente
aujourd'hui depuis une session : ce lot ne livre ni route ni action serveur, et les seuls appelants
sont les tests. Le câblage à `exigerSessionAtlas()` viendra avec la surface, le jour où il y en aura
une.

## Décision 10 — Motivation obligatoire, en base

`motif_code` (vocabulaire fermé de six valeurs : `CONTENTIEUX`, `PRE_CONTENTIEUX`,
`OBLIGATION_CONSERVATION`, `CONTROLE_OU_AUDIT`, `DEMANDE_JURIDIQUE`, `AUTRE_MOTIF_DOCUMENTE`) **et**
`motif` (texte libre, NOT NULL, au moins dix caractères utiles — CHECK
`legal_holds_motif_non_vide_check`). Les deux sont exigés : le code seul ne dit pas de quoi il
s'agit, le texte seul n'est pas agrégeable. `AUTRE_MOTIF_DOCUMENTE` est un dernier recours nommé
plutôt qu'un fourre-tout silencieux, et le texte reste obligatoire.

La longueur minimale est en base, et non seulement dans le code : elle n'a pas pour but de garantir
la qualité d'un texte, elle empêche qu'un caractère unique tienne lieu de justification dans un
registre dont la seule valeur est d'être relisible par un humain des années plus tard.

Les messages de refus **ne recopient jamais la valeur refusée** : un motif décrit une affaire et peut
nommer des personnes.

## Décision 11 — Aucune donnée personnelle dans la table

Ni nom, ni prénom, ni email, ni téléphone, ni adresse, ni contenu de document, ni image de signature.
`pose_par_identite_sub` est un identifiant pseudonyme stable. `motif` est un texte rédigé par un
opérateur : il décrit une affaire, et il lui appartient de ne pas y recopier la donnée protégée —
limite documentée ci-dessous, non contrainte techniquement.

## Garanties vérifiées par les tests

| Garantie | Où |
|---|---|
| Pose, lecture, levée, détection fonctionnent sur une vraie base | `legalHoldRepository.test.ts` |
| Un hold levé reste en base, pose intacte | idem, « l'historique de pose est INTACT » |
| Double levée : `deja_leve`, première levée non écrasée | idem |
| Levées simultanées : exactement une lève | idem, `Promise.all` |
| Poses simultanées du même hold : exactement une crée | idem, `Promise.all` + comptage SQL |
| Deux motifs protègent la même cible en même temps | idem |
| Cible inexistante / non-uuid / d'un autre workspace → `cible_introuvable`, zéro écriture | idem |
| Un workspace ne lit, ne lève ni ne pose rien chez un autre | idem, trois tests + workspace vide |
| Motif et auteur obligatoires, aucune écriture sur refus | idem + `legalHold.test.ts` |
| Horodatage de pose venu de la base | idem |
| Bon échu + hold actif → `BLOCKED_BY_LEGAL_HOLD`, `eligibleCount` 0, `legalHoldCount` 1 | `legalHoldRetention.test.ts` |
| Après levée → `ELIGIBLE` de nouveau, et **aucune suppression** | idem |
| `eligible_at` conservé malgré le hold | idem |
| Aucune action de rétention écrite | idem |
| Aucun DELETE, aucun accès fichier, aucun verbe de purge dans le domaine | `legalHold.structurel.test.ts` |
| Seule `legal_holds` est écrite ; les cibles sont lues, jamais modifiées | idem |
| La levée est un UPDATE dont le `WHERE` porte l'idempotence ; pose non réécrite | idem |
| Aucune route, aucune action serveur, aucun écran, aucun cron | idem |
| Migration additive : une table, une FK vers `workspaces` seulement, aucun CASCADE | idem |
| Vocabulaires TypeScript ≡ CHECK SQL, dans les deux sens | idem |
| Le moteur de rétention est lecteur seul du registre | `retention.structurel.test.ts` |
| Une lecture de holds en échec ne peut pas être avalée | idem |

## Ce que ce chantier ne livre pas

- **Aucune purge, aucune suppression.** Ni de fichier, ni de ligne métier. `APPLY_SUPPORTED` reste
  `false`, `RETENTION_ENFORCEMENT_V1_LIVRE` reste `false`.
- **Aucun cron**, aucun planificateur, aucun déclenchement automatique.
- **Aucune route HTTP, aucune Server Action, aucun écran.** Ce lot livre le domaine et le
  repository. Même une route de lecture exposerait des motifs — des textes décrivant des affaires —
  sans qu'aucun écran n'en ait besoin aujourd'hui.
- **Aucun appel à `supprimerFichierStocke`** (ADR-067), qui reste branchée sur aucun chemin métier.
- **Aucune modification d'une table métier**, aucune colonne ajoutée ailleurs.
- **Aucune notification, aucun rappel d'échéance de hold.** Un hold n'expire pas tout seul : il n'a
  pas de date de fin, et c'est volontaire — une suspension qui se lève d'elle-même à une date saisie
  des années plus tôt est une protection qui disparaît sans décision.

## Limites connues

1. **Deux affaires distinctes de même motif se partagent un hold.** La clé d'unicité inclut
   `motif_code` mais pas une référence d'affaire. Deux contentieux simultanés sur la même pièce
   produisent un seul hold, dont le `motif` doit alors les mentionner tous deux. Ajouter une
   `reference_affaire` à la clé est possible par migration additive le jour où le cas se présente ;
   l'ajouter aujourd'hui serait une colonne « au cas où ».
2. **La protection n'est pas contrainte par la base** (voir décision 3). Elle repose sur la
   consultation du registre par tout futur chemin de suppression.
3. **Aucun appelant de production.** Les primitives existent, aucun geste humain ne peut encore
   poser de hold dans le produit. C'est cohérent avec l'ordre de construction retenu : la protection
   avant le mécanisme destructif, mais cela signifie qu'un contentieux survenant aujourd'hui se
   gérerait hors produit.
4. **`motif` est un texte libre.** Rien n'empêche techniquement un opérateur d'y recopier une donnée
   personnelle. Le champ est documenté comme devant décrire une affaire, pas la pièce.
5. **Un seul type de cible.** Un hold sur un document de bien, une photo ou un contact n'est pas
   exprimable. L'élargissement passera par une migration (CHECK) et par le câblage de la lecture
   correspondante — les deux ensemble, verrouillé par un test.
6. **Aucune garde de rôle.** Le repository ne vérifie pas que l'auteur est `owner` du workspace :
   il n'y a pas de surface, donc pas de point où l'appliquer. Le lot qui livrera la surface devra
   poser `exigerOwnerWorkspaceCourant()` (ADR-065).

## Scalabilité

Le registre est écrit à la main, par acte humain : son volume se compte en unités, pas en milliers.
La seule lecture chaude est `listerCiblesSousLegalHoldActif`, une requête par workspace et par
balayage de rétention, servie par `legal_holds_cible_idx` et bornée par le nombre de holds actifs du
workspace — jamais par le nombre de bons de visite.

Le croisement candidats × cibles protégées se fait en mémoire sur un `Set`, délibérément : un
`leftJoin` sur `legal_holds` dupliquerait chaque bon autant de fois qu'il porte de holds, et un
comptage d'éligibilité qui dépend du nombre de holds posés serait faux de la plus mauvaise manière
possible — surévaluant les lignes exactement là où une protection existe.

## Réversibilité

Le domaine est additif et isolé dans `lib/legalHold/`. Le retirer demanderait de défaire trois
points, et rien d'autre : l'import de `listerCiblesSousLegalHoldActif` dans
`retentionRepository.ts`, le champ `sousLegalHoldActif` du candidat, et la branche
`BLOCKED_BY_LEGAL_HOLD` d'`evaluerBonVisiteSigne`.

La table est vide à la sortie du lot et ne peut être remplie que par un appel explicite : une
migration de retrait serait un `DROP TABLE` sans perte de donnée métier. Les deux valeurs de
vocabulaire ajoutées au moteur de rétention (`BLOCKED_BY_LEGAL_HOLD`, `ACTIVE_LEGAL_HOLD`) sont des
constantes TypeScript, sans contrainte SQL à défaire — `actions_retention` n'a pas été touchée et
reste vide.

## Chantiers suivants

1. **`RETENTION_DELETE_PATH_V1`** — le chemin de suppression complet pour `SIGNED_VISIT_FORM` :
   `bons_visite.document_id` en SET NULL laisse la ligne `documents_bien` du PDF et son fichier, et
   `evenements_metier.bon_visite_id` en NO ACTION bloque la suppression dès qu'un événement
   référence le bon. C'est le dernier blocage avant qu'une suppression soit techniquement possible.
2. **`LEGAL_HOLD_SURFACE_V1`** — la surface humaine : poser et lever un hold depuis le produit, avec
   `exigerOwnerWorkspaceCourant()` et le câblage de l'auteur depuis la session.
3. **`RETENTION_APPLY_V1`** — et il ne sera recevable qu'en démontrant que le chemin de suppression
   consulte le registre des holds avant toute action.
