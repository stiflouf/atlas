# ADR-054 — Appartenance des données : Workspace, identité, accès, secrets

**Statut :** Accepté — **fondation implémentée** (migrations `0032` et `0033`)
**Date :** 2026-09-08
**Décideurs :** Steven Gausset (CEO), CTO

> **État d'implémentation (2026-09-08).** Ce qui est construit : `workspaces`, `workspace_membres`,
> `workspace_id` sur les 9 tables racines, résolution du périmètre depuis la session
> (`exigerWorkspaceCourant`) et depuis un contexte machine (`resoudreWorkspaceExecutionMachine`),
> bootstrap idempotent de l'appartenance `owner` au callback OIDC, et retrait du `DEFAULT` SQL
> (migration `0033`) — une écriture qui oublie son périmètre échoue désormais immédiatement.
>
> Ce qui n'est PAS construit, et reste hors périmètre : aucun filtrage par workspace en lecture,
> aucun sélecteur de workspace, aucun rôle au-delà d'`owner`, aucune UI. Le produit reste
> strictement mono-conseiller.
>
> **Résolution de la question ouverte n°4 (`dossier_fiscal`) :** tranchée en faveur de
> l'IDENTITÉ, pas du workspace — voir §6 bis.

> Rubriques : Contexte · Problème · Décision · Alternatives écartées · Modèle de données /
> contrats · Invariants · Stratégie de migration · Conséquences · Risques · Hors périmètre ·
> Questions ouvertes · Scalabilité · Réversibilité (les deux dernières exigées par ADR-051 pour
> toute ADR importante, voir `docs/adr/README.md`).

## Contexte

`docs/audits/DOMIORA-STRATEGIC-ARCHITECTURE-AUDIT-2026-09.md` classe le mono-tenant structurel en
risque **CRITICAL** n°2. Les faits vérifiés :

- aucune des 31 tables de `apps/web/src/db/schema.ts` ne porte de colonne d'appartenance
  (`user_id`, `workspace_id`, `tenant_id`, `owner_id`) ;
- `connexions_google` et `dossier_fiscal` sont explicitement des tables à ligne unique
  (`id: text("id").primaryKey().default("default")`) ;
- ADR-006 §« Pas de multi-utilisateur » a acté ce choix, et sa dernière conséquence dit
  textuellement : « Le jour où un deuxième conseiller doit utiliser Atlas, `connexions_google` et
  `memoire_contextuelle` devront gagner une notion d'utilisateur — actuellement absente par choix,
  pas par oubli » ;
- ADR-047 a introduit une **identité** réelle (Google OIDC + `ATLAS_ALLOWED_EMAIL`, allowlist à une
  seule adresse, `apps/web/src/lib/auth/allowlist.ts`) et une session chiffrée
  (`sessionAtlas.ts`), mais déclare le multi-utilisateur explicitement hors périmètre : « une
  instance, une base, un conseiller, une identité autorisée » ;
- le nom affiché du conseiller est une propriété d'instance (`ATLAS_ADVISOR_DISPLAY_NAME`,
  documentée dans `apps/web/.env.local.example`), pas une donnée en base ;
- ADR-051 fixe l'objectif d'architecture « évoluer vers ~10 000+ utilisateurs sans réécriture
  fondamentale du cœur métier », sans aucune implémentation.

Le positionnement produit a évolué : DOMIORA doit pouvoir fonctionner comme CRM autonome, comme
couche d'intelligence au-dessus d'un CRM existant, et avec plusieurs réseaux — donc, à terme, avec
plusieurs humains et plusieurs organisations.

## Problème

Chaque table créée sans appartenance aujourd'hui devient une migration de données demain. Le coût
d'attendre n'est pas linéaire : il croît avec le nombre de tables, de lignes et de moteurs qui les
lisent. Mais construire maintenant une architecture SaaS multi-tenant complète (organisations,
rôles, permissions, invitations, facturation) coûterait cher pour un besoin qui n'existe pas : le
produit compte **un** utilisateur autorisé.

La question n'est donc pas « faut-il faire du multi-tenant ? » mais : **quel est le plus petit
engagement de modèle qui rend le multi-tenant additif plus tard, et qui ne coûte presque rien
maintenant ?**

Un second problème, distinct et plus grave, est une confusion de vocabulaire que cette ADR doit
fermer : « utilisateur » désigne aujourd'hui indistinctement l'humain qui se connecte, le
propriétaire des données, le droit de lire une ligne, et le détenteur d'un token Google. Ce sont
quatre choses différentes.

## Décision

### 1. Quatre concepts distincts, jamais fusionnés

| Concept | Question à laquelle il répond | Porteur cible | État actuel |
|---|---|---|---|
| **IDENTITY** | Qui est l'humain authentifié ? | identité externe (Google `sub` + email) | Existe (ADR-047), aucune table |
| **OWNERSHIP** | À quel périmètre appartient cette ligne ? | `workspace_id` | **Absent** — objet de cette ADR |
| **ACCESS** | Cette identité a-t-elle le droit de lire/écrire cette ligne ? | appartenance à un workspace | Binaire aujourd'hui (allowlist 1 adresse) |
| **SECRETS** | À qui appartient ce token / ce paramètre personnel ? | l'identité, jamais le workspace | `connexions_google` (ligne unique) |

Aucune colonne ne doit jamais porter deux de ces concepts à la fois. En particulier : un
`workspace_id` ne dit **jamais** qui a créé la ligne, et un `cree_par` ne dit **jamais** qui a le
droit de la lire.

### 2. L'unité racine d'appartenance est le **Workspace**

Un `workspace` est le périmètre propriétaire des données métier. Une ligne métier appartient à
exactement un workspace, pour toute sa vie.

Évaluation explicite des quatre candidats :

- **`user`** — écarté. Une donnée possédée par un humain ne peut pas être partagée plus tard sans
  changer de propriétaire, c'est-à-dire sans migration de données ET de sémantique. Le premier
  besoin réel (un assistant qui saisit pour le conseiller) casserait le modèle.
- **`organization`** — écarté pour l'instant. Le mot porte une charge implicite : personne morale,
  facturation, annuaire, rôles, administration. L'adopter maintenant obligerait à répondre à des
  questions qui n'ont pas de réponse produit aujourd'hui.
- **`account`** — écarté. Ambigu par nature : selon les produits il signifie identité de connexion,
  entité facturée, ou compte client CRM. DOMIORA a déjà un vocabulaire « client » côté métier
  (`/clients`) ; réutiliser le mot ailleurs créerait une collision durable.
- **`workspace`** — **retenu.** C'est le plus petit contenant qui accepte sans être renommé : un
  conseiller seul, un conseiller + assistant, une agence, un manager et ses filleuls, une équipe.
  Il ne présume ni d'une personne morale, ni d'une facturation, ni de rôles.

Une `organisation` pourra plus tard **contenir** des workspaces (réseau → agences → conseillers)
sans que rien de ce qui est décidé ici ne change : ce serait une clé étrangère ajoutée à
`workspaces`, jamais une reprise des tables métier.

### 3. Aujourd'hui : un workspace, une appartenance, un rôle

Le produit reste strictement mono-conseiller. La cible est un workspace unique
`id = 'default'` — exactement le patron déjà éprouvé par `connexions_google` et `dossier_fiscal`
(`schema.ts`), et pour la même raison : rendre l'unicité visible et intentionnelle plutôt
qu'implicite.

L'identité autorisée reste celle d'ADR-047 (`ATLAS_ALLOWED_EMAIL`, une seule adresse,
fail-closed). **Cette ADR ne remplace pas l'allowlist et n'ouvre aucune inscription.**

### 4. Les objets métier appartiennent au workspace, jamais directement à un utilisateur

Pas de double appartenance (`user_id` **et** `workspace_id`), pas de table ACL, pas de partage
sélectif ligne à ligne en V1.

Raison : la double appartenance crée immédiatement deux vérités à maintenir et une question sans
réponse (« que voit un membre sur une ligne créée par un autre ? »). Le partage sélectif est une
fonctionnalité produit, pas une fondation — il s'ajoutera par une table dédiée le jour où le besoin
est formulé, sans toucher `workspace_id`.

**L'auteur d'une ligne est une préoccupation séparée.** Le jour où « qui a fait quoi » devient un
besoin (probable dès le deuxième humain), il se traite par une colonne d'auteur distincte sur les
tables où le fait a un sens (`notes_bien`, `comptes_rendus_visite`, `taches`) — jamais en détournant
`workspace_id`, jamais rétroactivement sur l'historique existant (aucun backfill d'auteur ne serait
honnête : personne ne peut savoir qui a écrit une ligne d'avant).

### 5. Rôles : un vocabulaire réservé, aucun moteur de permissions

Une seule colonne `role` sur l'appartenance, avec un `CHECK` sur un vocabulaire fermé.
Aujourd'hui, **une seule valeur est acceptée : `owner`**.

`member`, `manager`, `admin` sont **réservés dans la réflexion, jamais dans le `CHECK`** : ajouter
une valeur au vocabulaire est une migration additive triviale, tandis qu'une valeur acceptée mais
sans sémantique implémentée est un état à moitié construit — exactement ce que le dépôt refuse
ailleurs (cf. `biens.chargeHonoraires`, où `'partagee'` est explicitement absent tant que la
répartition n'est pas modélisée).

Conséquence immédiate assumée : **l'accès est binaire.** Être membre d'un workspace donne accès à
tout le workspace. Aucun RBAC, aucune matrice de permissions, aucun scope par entité. Le jour où un
manager ne doit voir que des agrégats et pas les fiches, c'est une nouvelle ADR — pas une extension
silencieuse de celle-ci.

### 6. Secrets et données personnelles : jamais possédés par le workspace

`connexions_google` porte un `refresh_token` OAuth chiffré (AES-256-GCM,
`GOOGLE_TOKEN_ENCRYPTION_KEY`). Ce secret est **personnel à l'identité qui l'a accordé**, jamais un
actif du workspace.

Décision : le jour du multi-utilisateur, `connexions_google` gagne une référence vers
**l'appartenance/l'identité**, jamais un `workspace_id`. Même règle pour toute future préférence
personnelle (paramètres d'affichage, signature d'email, notifications).

Corollaire explicite : **aucun partage de secret OAuth au niveau organisation** n'est autorisé par
cette ADR. Une boîte mail partagée, un agenda d'agence ou un connecteur au nom de l'organisation
sont des besoins légitimes — mais ce sont des connexions **distinctes**, accordées explicitement à
ce titre, jamais l'élargissement implicite du token personnel d'un conseiller. Le jour où ce besoin
existe, il fait l'objet de sa propre décision.

Cas limite tranché : une donnée métier produite **grâce** à un secret personnel (un rendez-vous lu
depuis le Calendar du conseiller, un email envoyé depuis son Gmail) appartient au **workspace**, pas
à l'identité. Le secret reste personnel ; son produit est un fait métier du dossier.

### 6 bis. `dossier_fiscal` appartient à l'identité, jamais au workspace (tranché le 2026-09-08)

La question ouverte n°4 posait le cas de `dossier_fiscal`, que le §Répartition classait parmi les
racines. Elle est tranchée : **le dossier fiscal et ses trois filles (`profil_fiscal`,
`historique_amorcage`, `rfr_foyer`) ne reçoivent pas de `workspace_id`.**

Raison, et c'est le §6 qui la donne : ces tables portent la situation fiscale **personnelle** du
conseiller — régime micro-BNC, option TVA, revenu fiscal de référence du **foyer**. Or l'accès est
binaire (§5) : être membre d'un workspace donne accès à tout le workspace. Les y rattacher
exposerait intégralement ces données au premier assistant ajouté, sans qu'aucune décision produit ne
l'ait jamais voulu. Le commentaire d'origine du schéma (ADR-023) anticipait d'ailleurs un
rattachement « conseillerId », pas un rattachement d'organisation.

Ce qui n'est PAS décidé ici : la forme exacte du futur rattachement (`identite_sub`,
`conseiller_id`, ou autre). Aucune nouvelle notion d'utilisateur n'est créée pour ce seul besoin —
`workspace_membres` porte déjà l'identité, et le jour venu le rattachement s'y appuiera ou
s'écrira à côté. Tant qu'un second membre n'existe pas, le sujet n'a aucune conséquence pratique.

`memoire_contextuelle` reste, elle, **non tranchée** : question ouverte n°4 bis, inchangée.

### 7. Toute table créée après cette ADR porte son appartenance dès sa création

Règle sans exception, deux formes autorisées et seulement deux :

- **Table racine** : colonne `workspace_id` NOT NULL, FK vers `workspaces`.
- **Table feuille** : FK NOT NULL vers une table déjà possédée (le parent porte l'appartenance).

Aucune troisième forme. Une table sans appartenance dérivable est refusée en revue.

**Une table feuille ne duplique pas `workspace_id`.** Dénormaliser l'appartenance sur une feuille
crée une seconde vérité qui peut diverger de son parent — exactement ce que le schéma refuse
partout ailleurs (photo principale dérivée du tri plutôt que d'un flag, statut de tâche dérivé de
`terminee_le`/`annulee_le`, statut commercial dérivé des jalons, ADR-014/028/052). Si une requête
prouve un besoin de dénormalisation pour des raisons de performance, ce sera une décision mesurée,
pas une convention par défaut.

Seule exception prévue : un **référentiel non possédé** (une table de barèmes valable pour tout le
monde, comme `regle_fiscale`) n'a pas d'appartenance — mais doit le dire explicitement en
commentaire de schéma.

## Alternatives écartées

**`user_id` partout maintenant, workspace plus tard.** Le moins cher à écrire, le plus cher à
défaire : changer le propriétaire d'une ligne est une migration de sémantique, pas de structure.
Toute requête, tout moteur et toute règle écrite entre-temps devraient être relus.

**Rien faire, décider au moment du besoin.** C'est le statu quo, et c'est ce que l'audit chiffre :
31 tables et ~1 682 tests écrits sans appartenance. La règle du §7 coûte une colonne par nouvelle
table ; l'inaction coûte une migration de données par table existante.

**Row-Level Security PostgreSQL dès maintenant.** Robuste, mais suppose un modèle de rôles et une
identité de connexion en base qui n'existent ni l'un ni l'autre. RLS reste une option future
excellente **par-dessus** `workspace_id` — cette ADR ne la ferme pas, elle en pose le prérequis.

**Une base par conseiller (isolation par déploiement).** Défendable, et cohérent avec le pilote
actuel. Écartée comme modèle cible parce qu'elle rend structurellement impossibles trois objectifs
produit explicites : manager + filleuls, agence + collaborateurs, partage réseau. Elle reste
parfaitement valable comme **mode de déploiement** du pilote — les deux ne s'excluent pas.

**Multi-tenant complet immédiat (organisations, rôles, invitations, RBAC).** Disproportionné :
aucune de ces briques n'a de besoin exprimé, et chacune ajoute des états impossibles à tester sans
utilisateurs réels.

## Modèle de données / contrats (cible conceptuelle, non implémentée)

```text
workspaces
  id                  identifiant interne (ligne unique 'default' au démarrage)
  nom                 libellé affichable
  cree_le

workspace_membres            (ACCESS — jamais OWNERSHIP)
  workspace_id        -> workspaces
  identite_sub        identifiant Google stable (le `sub` déjà porté par la session, ADR-047)
  email               email vérifié au moment de l'ajout
  role                CHECK ('owner')   -- vocabulaire fermé, une seule valeur aujourd'hui
  ajoute_le
  UNIQUE (workspace_id, identite_sub)

tables métier racines
  workspace_id        NOT NULL -> workspaces

tables métier feuilles
  <parent>_id         NOT NULL -> parent déjà possédé      (aucun workspace_id dupliqué)

secrets / personnel  (connexions_google et suivants)
  rattachement vers l'identité/l'appartenance — JAMAIS vers workspaces
```

Contrat de lecture côté application : **le workspace courant est résolu une fois par requête,
depuis la session**, et jamais fourni par le client. C'est la même discipline que
`exigerSessionAtlas()` (ADR-047), verrouillée par
`apps/web/src/actions/gardeSessionAtlas.structurel.test.ts` — le point d'accroche existe déjà.

### Répartition des 31 tables existantes (classement cible, aucune migration écrite ici)

- **Racines** (gagneront `workspace_id`) : `biens`, `acquereurs`, `prospects_vendeurs`, `taches`,
  `memoire_contextuelle`, `evenements_metier`, `configurations_automatisation`,
  `runs_scan_automatisation`, `compatibilites_bien_acquereur_etat`,
  `compatibilites_a_resynchroniser`, `envois_email`, `dossier_fiscal`.
- **Feuilles** (appartenance dérivée du parent, aucune colonne ajoutée) : `notes_bien`,
  `documents_bien`, `photos_bien`, `secteurs_recherche_acquereur`,
  `reperes_relationnels_acquereur`, `visites`, `comptes_rendus_visite`, `offres`, `offre_visites`,
  `compromis`, `remuneration`, `transmissions_dossier_notaire`, `notes_prospect_vendeur`,
  `executions_automatisation`, `profil_fiscal`, `historique_amorcage`, `rfr_foyer`.
- **Secret personnel** (rattachement identité, jamais workspace) : `connexions_google`.
- **Référentiel non possédé** : `regle_fiscale`.

Ce classement est une **décision de cible**, pas une migration : il fixe où la colonne ira le jour
du lot d'implémentation, pour que ce lot n'ait plus à trancher table par table.

## Invariants

1. Une ligne métier appartient à **exactement un** workspace, pour toute sa vie. Aucun transfert
   d'une ligne d'un workspace à un autre n'est prévu ni autorisé.
2. `workspace_id` n'est **jamais** dérivé d'une donnée fournie par le client — toujours de la
   session serveur.
3. **IDENTITY, OWNERSHIP, ACCESS et SECRETS ne partagent jamais une colonne.**
4. Un secret OAuth n'est jamais possédé par un workspace, et n'est jamais partagé implicitement
   entre membres.
5. Toute table créée après cette ADR est racine (avec `workspace_id`) ou feuille (avec FK NOT NULL
   vers un parent possédé). Pas de troisième forme.
6. Une feuille ne duplique jamais l'appartenance de son parent.
7. Le vocabulaire de `role` reste fermé par `CHECK` ; ajouter une valeur exige d'implémenter sa
   sémantique dans le même lot.

## Stratégie de migration

**Additive, jamais destructive, jamais big bang.** Cette ADR n'écrit aucune migration.

Séquence cible lorsque le lot d'implémentation sera lancé :

1. Créer `workspaces` + `workspace_membres`, insérer la ligne `'default'` et l'unique appartenance
   `owner` correspondant à `ATLAS_ALLOWED_EMAIL`. Aucune table métier touchée. Aucun comportement
   modifié.
2. Ajouter `workspace_id` aux tables racines avec `DEFAULT 'default'` **et** `NOT NULL` dans la
   même migration. C'est possible sans backfill risqué **précisément parce qu'il n'existe
   aujourd'hui qu'un seul conseiller** — fait garanti par l'allowlist à une adresse (ADR-047), pas
   supposé. Cette fenêtre se referme au premier deuxième humain : c'est l'argument pour agir tôt.
3. Retirer le `DEFAULT` dans une migration ultérieure, une fois que tout chemin d'écriture pose
   explicitement le workspace. Tant que le `DEFAULT` existe, il est un filet, jamais une source de
   vérité.
4. Résoudre le workspace en session et le poser dans les repositories, un domaine à la fois.
   Pendant cette phase, les deux comportements coexistent sans conflit : avec un seul workspace,
   filtrer ou ne pas filtrer donne le même résultat — c'est ce qui rend la migration progressive
   sûre et testable.
5. `connexions_google` : rattachement à l'identité, traité séparément et **jamais** dans la même
   migration que les tables métier (concepts différents, cf. §1).

Tests de caractérisation exigés **avant** l'étape 4 sur les moteurs qui lisent en masse
(`dashboardRepository`, `compatibilite/baseline`, `automatisations/scanTemporel`) : figer le
comportement actuel avant d'introduire un filtre, jamais l'inverse.

## Conséquences

- Le produit reste mono-conseiller, à l'identique. Cette ADR ne change aucun comportement
  observable tant que le lot d'implémentation n'est pas fait.
- Toute nouvelle table est désormais soumise à la règle du §7 — y compris les tables introduites
  par ADR-055 (contacts, projets, mandats) et ADR-056 (références externes), qui naîtront donc
  directement avec leur appartenance.
- La conséquence d'ADR-006 (« le jour où un deuxième conseiller… ») cesse d'être une note ouverte :
  elle a désormais une réponse décidée, même non implémentée.
- ADR-047 reste entièrement en vigueur : l'allowlist à une adresse n'est pas relâchée.
- La question « une instance par conseiller, ou un déploiement partagé ? » reste ouverte côté
  exploitation (voir Questions ouvertes) — mais le modèle de données ne dépend plus de sa réponse.

## Risques

| Risque | Portée | Atténuation décidée |
|---|---|---|
| Le multi-utilisateur n'arrive jamais et cette ADR coûte une colonne inutile par table | Faible | Une colonne NOT NULL à valeur unique coûte un espace négligeable et zéro complexité de lecture |
| Un chemin d'écriture oublie de poser `workspace_id` | Moyen | Le `DEFAULT` de l'étape 2 est un filet ; un test structurel sur le modèle de `gardeSessionAtlas.structurel.test.ts` peut verrouiller la règle |
| Un moteur de lecture oublie de filtrer par workspace (fuite inter-workspace) | **Élevé au moment de l'ouverture** | Ne jamais ouvrir un deuxième workspace avant que 100 % des chemins de lecture filtrent ; RLS PostgreSQL en défense en profondeur reste possible par-dessus |
| Le vocabulaire `role` s'élargit sans sémantique | Moyen | `CHECK` fermé + invariant n°7 |
| Un secret personnel devient partagé par commodité | Élevé (sécurité/RGPD) | Invariant n°4, explicite et non négociable sans nouvelle ADR |

## Hors périmètre, volontairement

Inscription/onboarding self-service · invitations · facturation · organisations · RBAC ·
permissions par entité · partage sélectif ligne à ligne · Row-Level Security · migration de
`connexions_google` · colonne d'auteur (`cree_par`) · UI d'administration · export/suppression RGPD
outillés · toute migration SQL.

## Questions ouvertes

1. **Un workspace par conseiller ou un workspace par agence ?** Les deux sont représentables ; le
   choix est produit, pas technique, et n'a pas besoin d'être tranché pour poser la colonne.
2. **Le pilote reste-t-il une instance par conseiller ?** Décision d'exploitation, indépendante de
   ce modèle de données. Si la réponse est « oui pour toujours », les §5 et §7 restent utiles
   (coût quasi nul) mais l'étape 4 de migration devient facultative.
3. **Faut-il une colonne d'auteur dès le deuxième humain ?** Probablement oui pour `notes_bien`,
   `comptes_rendus_visite` et `taches`. Non tranché ici.
4. ~~**`dossier_fiscal` : workspace ou identité ?**~~ — **TRANCHÉE** le 2026-09-08 en faveur de
   l'identité, voir §6 bis.
4 bis. **`memoire_contextuelle` est-elle possédée par le workspace ou par l'identité ?** Elle
   mémorise des décisions humaines sur des éléments issus d'un Calendar **personnel**. Toujours
   ouverte, volontairement : aucune preuve du dépôt ne tranche, et la forcer figerait la réponse
   sans l'avoir décidée. Aucune colonne n'est posée tant que le besoin n'existe pas.

## Scalabilité

`workspace_id` est le préfixe naturel de tout index métier. À ~10 000 workspaces, les requêtes
restent des scans d'index préfixés — le patron standard PostgreSQL, sans extension propriétaire
(ADR-051 §2). Le principal enjeu de charge n'est pas cette colonne mais les balayages globaux
existants (`compatibilite/baseline`, `scanTemporel`) qui devront devenir **par workspace** plutôt
que globaux : c'est un travail de découpage, pas de réécriture, et il est plus simple **avec**
`workspace_id` que sans.

## Réversibilité

Aucune dépendance fournisseur n'est introduite : `workspaces`, `workspace_membres` et une colonne
FK sont du PostgreSQL standard. L'identité reste Google (ADR-047) et cette ADR ne l'aggrave pas —
au contraire, en séparant IDENTITY d'OWNERSHIP, elle rend un changement de fournisseur d'identité
(SSO d'entreprise, autre OIDC) purement local à `workspace_membres.identite_sub`, sans toucher une
seule ligne métier.
