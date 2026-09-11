# ADR-055 — Modèle canonique : Contact, projets vendeur/acquéreur, Mandat, Interaction

**Statut :** Accepté — **§A, §B, §F et §G implémentés** (migrations `0034` à `0038`)
**Date :** 2026-09-08

> **État d'implémentation (2026-09-09).** Construit : la table `contacts` (§A) avec un pont nullable
> `contact_id` depuis `acquereurs` et `prospects_vendeurs` (migration `0034`) ; `projets_acquereur`
> et `parties_projet` avec un pont `projet_acquereur_id` (migration `0035`) ; `projets_vendeur` et
> l'extension de `parties_projet` aux deux types de projet, avec un pont `projet_vendeur_id`
> (migration `0036`). §B est complet : une création acquéreur ou vendeur écrit, dans une seule
> transaction, le contact, le projet, la partie et la ligne historique. Puis `mandats` (§F,
> migration `0037`), feuille de `biens`, alimentée par la signature réelle dans sa transaction
> existante — statut dérivé, renouvellement par nouvelle ligne, jamais par mutation. Enfin
> `interactions` (§G, migration `0038`), feuille de `contacts`, avec contexte optionnel à cible
> unique : elle comble le vide côté contact/acquéreur sans fusionner aucune table existante.
>
> L'invariant 5 est tenu par la base : cibles dédiées `projet_acquereur_id` / `projet_vendeur_id`
> + `CHECK` « exactement une », jamais un couple polymorphe. Le CAS 8 est exprimable et testé — un
> même contact peut être vendeur d'un projet et acquéreur d'un autre, simultanément.
>
> NON construit, et volontairement : aucun backfill de l'historique, aucune fusion ni rapprochement
> automatique (§H), aucun `projets_vendeur_biens` (§C, CAS 5), aucune `references_externes`
> (ADR-056), aucun mandant modélisé (§F laissait le choix ouvert : ni `parties_mandat`, ni
> réutilisation de `parties_projet` — la qualité juridique de mandant n'est pas la participation à
> un projet), aucun read model de mémoire relationnelle (§G point 3), aucune lecture branchée sur le
> modèle canonique. Le matching, le tunnel commercial, la signature de mandat et l'UI restent sur
> les modèles historiques, qui demeurent les sources de vérité.
>
> Écarts assumés sur §B, tous additifs le jour où un consommateur existe : `projets_vendeur` ne
> porte ni description de bien ni attribut de mandat (frontières renvoyées au lot Property/Mandat) ;
> `secteurs_recherche_acquereur` et `notes_prospect_vendeur` restent feuilles de leurs tables
> historiques ; aucun rôle de propriété juridique n'est introduit dans `parties_projet`. Sur §F :
> `mandats` ne porte ni `type`, ni `numero`, ni `motif_resiliation` — aucun écran ne les saisit et
> aucune règle ne les lit ; et la date de signature reste confondue avec la prise d'effet, faute de
> saisie distincte. Sur §G : `sens` est NULLABLE (aucun de ses trois termes ne décrit un
> rendez-vous), le contexte n'a que trois cibles au lieu de six (visite, offre et mandat se
> rejoignent depuis leur bien ou leur projet), il n'y a pas de colonne `sujet`, aucun auteur n'est
> modélisé, et aucun flux existant n'écrit d'interaction — une note vendeur a déjà son foyer, et
> `envois_email` n'a ni contact ni contenu à en tirer.

**Décideurs :** Steven Gausset (CEO), CTO

> Rubriques : Contexte · Problème · Décision · Alternatives écartées · Modèle de données /
> contrats · Invariants · Stratégie de migration · Conséquences · Risques · Hors périmètre ·
> Questions ouvertes · Scalabilité · Réversibilité (ADR-051).

## Contexte

L'audit de septembre 2026 classe l'absence d'entité Contact en risque **HIGH** n°3. Ce n'est pas
une découverte : **ADR-027 l'avait annoncée elle-même**, en toutes lettres, comme une limite V1
assumée à traiter plus tard.

Faits vérifiés dans le dépôt :

- `apps/web/src/types/prospectVendeur.ts` (commentaire d'en-tête, repris d'ADR-027 §1) :
  « une OPPORTUNITÉ commerciale de prise de mandat sur un bien potentiel, avec UN contact vendeur
  principal — jamais une personne physique générique découplée de l'opportunité », avec trois
  limites explicites : un seul contact par opportunité, une seule opportunité par bien
  (`prospects_vendeurs.bien_id` UNIQUE dans `schema.ts`), et « plusieurs propriétaires sur un même
  bien, ou un même propriétaire avec plusieurs biens, nécessiteront une séparation contact ↔
  opportunité vendeur dans une passe ultérieure — **pas construite ici** ».
- `apps/web/src/types/client.ts` : `ProfilAcquereur` porte dans une seule structure l'identité
  (`prenom`, `nom`, `email`, `telephone`) **et** le projet (`budgetMin`, `budgetMax`, `criteres`,
  `stadeProjet`, `piecesMin`, `surfaceMin`, `accessibiliteRequise`, …).
- Le mandat n'est pas une entité : `biens.statut_mandat` (`CHECK IN ('actif','suspendu','expire')`),
  `biens.date_mandat`, `biens.charge_honoraires`, plus `prospects_vendeurs.mandat_propose_le` /
  `mandat_signe_le`. Aucune date de fin, aucune exclusivité, aucun numéro, aucun renouvellement.
- Les interactions sont réparties sur quatre tables aux invariants différents :
  `notes_prospect_vendeur` (type contrôlé, fait avancer `dernier_contact_le` — ADR-027 §4),
  `notes_bien` (texte libre append-only, ADR-011), `comptes_rendus_visite` (`interet` contrôlé +
  `retour` libre + FK bien/acquéreur), `envois_email` (audit **technique** d'un envoi Gmail, avec
  clé d'idempotence fournie par l'appelant — ADR-031-bis, explicitement « jamais un fait CRM »).
- Une vue unifiée existe **déjà**, dérivée à la lecture :
  `apps/web/src/lib/relations/memoireAcquereur.ts` (VALUE-03) assemble 11 types d'événements depuis
  6 sources, sans aucune table ni cache, sur le même patron que `deriverHistoriqueBien` (ADR-014) et
  `deriverJournalProspectVendeur` (ADR-027).
- Côté acquéreur, **aucune table d'interaction n'existe** : ni note, ni appel, ni rendez-vous.
  `dernier_contact_le` n'existe que sur `prospects_vendeurs`.

## Problème

Un connecteur externe (ADR-056) livre toujours des **contacts** d'un côté et des **projets/dossiers**
de l'autre. Tant que DOMIORA fusionne les deux, tout mapping d'import est arbitraire : à quoi
correspond un contact Playiad qui n'a pas encore de projet ? Que devient un projet dont le contact
existe déjà sous une autre casquette ?

Dix situations métier ne sont aujourd'hui pas représentables sans duplication d'identité :

| # | Cas | Représentable aujourd'hui ? |
|---|---|---|
| 1 | Une personne vendeuse puis acquéreuse | Non — deux lignes sans lien |
| 2 | Deux personnes vendent ensemble un bien | Non — un seul contact par opportunité (ADR-027 §1) |
| 3 | Un couple a un projet acquéreur commun | Non — un `acquereurs` = une personne |
| 4 | Une personne a plusieurs projets successifs | Non — le projet **est** la personne |
| 5 | Un projet vendeur porte sur plusieurs biens | Non — `bien_id` UNIQUE |
| 6 | Un bien a plusieurs mandats dans le temps | Non — colonnes sur `biens` |
| 7 | Un mandat renouvelle/remplace un précédent | Non |
| 8 | Un contact est prospect, vendeur, acquéreur, apporteur… | Non — une casquette = une ligne |
| 9 | Une interaction reliée à une personne **et** à un dossier | Partiellement, et jamais côté acquéreur |
| 10 | Le même humain reçu depuis plusieurs sources externes | Non — aucune identité stable à rattacher |

## Décision

### A. Le Contact est l'identité d'une personne, jamais un rôle

Nouvelle entité racine `contacts` : l'identité d'un interlocuteur (personne physique ou morale),
indépendante de tout dossier.

**Un contact n'a pas de colonne `type`/`role`.** Ses rôles sont **dérivés de ses relations** :
il est vendeur parce qu'il est partie d'un projet vendeur, acquéreur parce qu'il est partie d'un
projet acquéreur, propriétaire parce qu'il est mandant d'un mandat. C'est la même discipline que
le statut de tâche dérivé de `terminee_le`/`annulee_le` (ADR-028), le statut commercial dérivé des
jalons (ADR-014) et la photo principale dérivée du tri (ADR-052) : **une seule source de vérité,
jamais un champ dérivé stocké**.

Cela résout le CAS 8 sans aucune duplication, et le CAS 1 par construction : la même ligne
`contacts` porte les deux histoires.

`personne_morale` (booléen) distingue une SCI/indivision/succession d'une personne physique — un
besoin déjà anticipé par le commentaire de `ProspectVendeur.prenom`, jamais modélisé.

### B. Personne et projet sont séparés ; la partie est une relation

Trois entités de dossier :

- `projets_vendeur` — généralisation de `prospects_vendeurs` (les 7 jalons timestamp d'ADR-027 sont
  conservés tels quels, y compris `dernier_contact_le` et sa règle §4) ;
- `projets_acquereur` — extraction de la moitié « projet » de `acquereurs` (budget, critères
  structurés, `stade_projet`, secteurs de recherche) ;
- `parties_projet` — relation `contact ↔ projet` portant un rôle (`vendeur`, `co_vendeur`,
  `acquereur`, `co_acquereur`, `representant`, `apporteur`, …).

`parties_projet` résout à elle seule les CAS 2, 3 et 8. Le CAS 4 est résolu par le fait qu'un
contact peut être partie de plusieurs projets, y compris successifs — l'historique est porté par
les projets, jamais par le contact.

**Le projet reste le porteur du parcours commercial.** Aucun jalon, aucun statut, aucune donnée de
pipeline ne remonte sur le contact : un contact n'a pas de « stade », il a des projets qui en ont
un.

### C. Propriété et mandat

Le lien « ce contact possède ce bien » n'est **pas** une colonne sur `biens`. Il est porté par le
**mandat** (qui a des mandants) et, en amont de tout mandat, par le projet vendeur (qui a des
parties). DOMIORA n'a aucun besoin — et aucune source fiable — pour affirmer une propriété
juridique en dehors de ces deux contextes ; l'affirmer serait inventer un fait.

Un `projets_vendeur` peut porter **plusieurs** biens (CAS 5), via une relation dédiée. La contrainte
actuelle `prospects_vendeurs.bien_id UNIQUE` reste en vigueur jusqu'au lot d'implémentation : elle
n'est pas fausse, elle est plus étroite que la cible.

### F. Mandate devient une vraie entité — décision tranchée : **OUI**

Trois raisons, toutes vérifiables :

1. **C'est le premier objet qu'un connecteur réseau synchronise.** Un mandat a un numéro, une date
   de fin et une exclusivité chez tous les réseaux ; DOMIORA n'a aucun champ pour les recevoir.
2. **Le modèle actuel ne peut pas exprimer le temps.** `biens.statut_mandat = 'expire'` sans date de
   fin ne dit pas *quand*, et un renouvellement écrase l'historique — or `biens.date_mandat` est
   unique. Aucune relance « mandat expire dans 30 jours » n'est aujourd'hui calculable.
3. **Le suivi vendeur en dépend.** Les automatisations (ADR-032/033) savent réagir à un silence,
   pas à une échéance contractuelle, faute d'échéance modélisée.

Portée délibérément **métier, pas juridique** : suffisante pour le CRM autonome, les connecteurs,
les workflows, le suivi vendeur et les automatisations. Aucune clause, aucun texte contractuel,
aucune génération d'acte.

Le renouvellement (CAS 7) est modélisé comme **un nouveau mandat qui référence celui qu'il
remplace** (`remplace_mandat_id`), jamais comme une mutation du mandat existant — c'est le patron
append-only déjà appliqué à `profil_fiscal` (instantané historisé, ADR-023) et aux offres/compromis
(« une nouvelle proposition = une nouvelle ligne », ADR-015/016). Le CAS 6 découle du même
mécanisme.

### G. Interaction : convergence par **read model**, pas par fusion de tables

Décision en deux temps, et c'est le point le plus important de cette ADR :

**1. Aucune table existante n'est fusionnée dans une table générique.**
`comptes_rendus_visite`, `notes_prospect_vendeur` et `envois_email` portent des invariants qu'une
table polymorphe détruirait :
- `comptes_rendus_visite.interet` est un vocabulaire contrôlé lu par des moteurs
  (`opportunites/regles.ts`, `catalogueRegles.ts`) ; il n'est pas un « payload » ;
- `notes_prospect_vendeur.type` conditionne l'avancement de `dernier_contact_le`, invariant
  explicite d'ADR-027 §4 ;
- `envois_email` est un **audit technique**, avec clé d'idempotence fournie par l'appelant et un
  état `incertain` qui n'a de sens que pour un appel réseau — ADR-031-bis dit explicitement que ce
  n'est « jamais un fait CRM ».

Les fusionner remplacerait des `CHECK` et des FK par une convention applicative. Le schéma refuse
cela partout ailleurs : `taches` porte **sept FK nullables + un `CHECK` « au plus une cible »**
plutôt qu'un couple polymorphe `objetType/objetId`, et le commentaire de `schema.ts` en donne la
raison — « l'intégrité référentielle prime sur la généricité ».

**2. Une table `interactions` est créée pour ce qui n'a aucun foyer aujourd'hui** : les échanges
côté contact/acquéreur (appel, email, SMS, rendez-vous, message, note) qui ne sont ni un compte
rendu de visite, ni une note vendeur, ni un envoi Gmail technique. C'est un vide réel, pas une
duplication : il n'existe **aucune** table d'interaction acquéreur dans le schéma.

**3. La vue unifiée reste dérivée à la lecture**, sur le patron déjà en production et testé
(`memoireAcquereur.ts`, `deriverHistoriqueBien`, `deriverJournalProspectVendeur`). Elle s'étend aux
nouvelles sources ; elle ne devient jamais une table matérialisée.

Une interaction est reliée à **un contact** (obligatoire) et **optionnellement à un contexte**
(projet, bien, visite, offre, mandat) — même patron de cibles dédiées + `CHECK` que `taches`,
jamais un couple polymorphe. Cela résout le CAS 9.

### H. Déduplication : jamais automatique, jamais destructive

Le CAS 10 (le même humain reçu de plusieurs sources) est résolu **côté provenance** (ADR-056) :
plusieurs références externes peuvent pointer vers un même contact canonique.

Pour le reste, la règle est celle qui gouverne déjà tout le produit :

- **Aucune fusion automatique.** DOMIORA peut *signaler* deux contacts probablement identiques ;
  il ne les fusionne jamais seul. C'est la transposition directe du principe d'ADR-006 (validation
  humaine prioritaire) et d'ADR-008 (aucune décision métier sur du texte libre interprété).
- **Aucune suppression.** Une fusion validée par le conseiller **relie** les deux contacts
  (l'un devient alias de l'autre) sans jamais supprimer de ligne ni détacher un historique — patron
  d'archivage d'ADR-012, jamais un `DELETE`.
- La détection de doublon candidat s'appuie sur des champs structurés (email, téléphone normalisé),
  jamais sur une similarité de nom en texte libre.

### I. Historique temporel

Aucun changement de doctrine : jalons `timestamptz` + statut dérivé (ADR-014/027/028), append-only
pour les faits (ADR-011), archivage plutôt que suppression (ADR-012). Le contact lui-même n'a pas
d'historique propre : son histoire est la somme de ses projets, mandats et interactions.

## Alternatives écartées

**Garder `acquereurs` tel quel et n'extraire que le contact vendeur.** Traiterait la moitié du
problème et laisserait les CAS 3 et 4 sans réponse ; surtout, un connecteur devrait alors mapper
les contacts différemment selon le côté du dossier — exactement l'arbitraire qu'on cherche à éviter.

**Une table `personnes` avec une colonne `role`.** Rend le CAS 8 impossible (une personne = une
casquette) ou incohérent (un tableau de rôles stocké qui diverge des relations réelles). Le rôle
est une conséquence des relations, pas un attribut.

**Une table `interactions` polymorphe unique absorbant les quatre tables existantes.** Écartée :
détruit les invariants listés en §G, contredit le choix explicite de `taches` (sept FK plutôt qu'un
polymorphe), et transformerait `envois_email` — un audit technique — en fait CRM, ce qu'ADR-031-bis
interdit nommément.

**Mandat = quelques colonnes de plus sur `biens` (date de fin, exclusivité).** Moins cher, mais ne
résout ni le CAS 6 (plusieurs mandats dans le temps) ni le CAS 7 (renouvellement) : un bien n'aurait
toujours qu'un seul mandat, le dernier, l'historique restant écrasé.

**Mandat comme entité juridique complète** (clauses, honoraires détaillés, signataires, avenants).
Disproportionné : aucun besoin exprimé, et le produit ne prétend jamais dire le droit — principe
déjà posé pour le dossier documentaire (« jamais une affirmation d'obligation légale »,
`schema.ts`, ADR-029).

**Fusionner `contacts` avec la future gestion des membres du workspace** (ADR-054). Écartée
fermement : un membre est une **identité authentifiée** (IDENTITY), un contact est une **donnée
métier possédée** (OWNERSHIP). Confondre les deux rouvrirait exactement la confusion qu'ADR-054 §1
ferme.

## Modèle de données / contrats (cible conceptuelle, non implémentée)

```text
contacts                        (racine — workspace_id, ADR-054 §7)
  id, workspace_id
  nom, prenom?, personne_morale, email?, telephone?
  archive_le?                   (ADR-012)
  -- AUCUNE colonne role/type/statut : les rôles se dérivent des relations

parties_projet                  (feuille)
  contact_id -> contacts        NOT NULL
  projet_type + projet_id       cibles dédiées + CHECK "exactement une" (patron taches/evenements_metier)
  role                          CHECK ('vendeur','co_vendeur','acquereur','co_acquereur',
                                       'representant','apporteur')

projets_vendeur                 (racine — généralise prospects_vendeurs, jalons ADR-027 conservés)
projets_acquereur               (racine — moitié "projet" de acquereurs : budget, critères, stade)

projets_vendeur_biens           (feuille — CAS 5 : un projet vendeur, plusieurs biens)

mandats                         (feuille de biens)
  bien_id -> biens              NOT NULL
  type                          CHECK ('simple','exclusif','semi_exclusif')
  numero?                       (souvent fourni par le réseau — ADR-056)
  date_debut, date_fin?
  exclusivite_jusqu_au?         (période d'exclusivité d'un mandat semi-exclusif)
  resilie_le?, motif_resiliation?
  remplace_mandat_id?           -> mandats        (CAS 7 : renouvellement, jamais une mutation)
  -- statut DÉRIVÉ de date_debut/date_fin/resilie_le, jamais stocké (ADR-014)
  -- mandants : via parties_projet ou une relation mandats <-> contacts dédiée (à trancher au lot)

interactions                    (feuille de contacts — comble le vide côté acquéreur)
  contact_id -> contacts        NOT NULL
  type                          CHECK ('appel','email','sms','rendez_vous','message','note')
  sens                          CHECK ('entrant','sortant','interne')
  survenu_le                    (date métier du fait, jamais la date d'insertion)
  contenu?                      texte libre — JAMAIS lu par un moteur (ADR-008)
  contexte : bien_id? / projet_* ? / visite_id? / offre_id? / mandat_id?
             cibles dédiées + CHECK "au plus une" (patron taches)
```

**Contrat de lecture (inchangé dans son principe)** : la vue unifiée d'un contact est une fonction
pure sur des faits déjà en base, sans requête ni cache — signature et discipline de
`lib/relations/memoireAcquereur.ts`, qui reste la référence.

## Invariants

1. **Un contact ne porte aucun rôle stocké.** Tout rôle est dérivé de ses relations.
2. **Un contact ne porte aucun statut commercial.** Le parcours appartient au projet.
3. Aucune table existante n'est fusionnée : `comptes_rendus_visite`, `notes_prospect_vendeur` et
   `envois_email` gardent leurs invariants et leur vocabulaire.
4. `envois_email` reste un **audit technique**, jamais un fait CRM (ADR-031-bis).
5. Le rattachement d'une interaction à son contexte utilise des **cibles dédiées + `CHECK`**, jamais
   un couple polymorphe `{type, id}` en base (patron `taches`/`evenements_metier`).
6. Le texte libre d'une interaction n'est jamais lu par un moteur de règles (ADR-008).
7. Une fusion de contacts est **toujours** validée par un humain, et **jamais** destructive.
8. Un renouvellement de mandat crée une ligne ; il ne modifie jamais le mandat remplacé.
9. Le statut d'un mandat est dérivé de ses dates, jamais stocké (ADR-014).
10. `dernier_contact_le` conserve la règle d'ADR-027 §4 : seules de vraies interactions le font
    avancer, jamais un jalon de pipeline ni une note interne.

## Stratégie de migration

**Additive, par coexistence, jamais big bang.** Aucune migration n'est écrite ici. Aucune table
existante n'est supprimée ni renommée par cette ADR — en particulier **ni `acquereurs`, ni
`prospects_vendeurs`**.

Séquence cible (chaque étape est un lot autonome, livrable et réversible) :

1. **Créer `contacts` seul**, alimenté par les écrans existants, sans rien débrancher. Aucun moteur
   modifié. Aucun comportement visible changé.
2. **Backfill non destructif** : une ligne `contacts` par `acquereurs` et par `prospects_vendeurs`
   existant, avec un lien de rattachement dans le sens ancien → nouveau. Les deux modèles
   coexistent ; l'ancien reste la source de vérité de la lecture.
3. **Basculer les lectures un domaine à la fois** (fiche contact d'abord, moteurs ensuite), avec un
   **test de caractérisation écrit avant** chaque bascule — figer le comportement observé, puis
   changer l'implémentation, jamais l'inverse.
4. `mandats` et `interactions` sont **purement additives** : elles ne remplacent rien et peuvent
   être livrées indépendamment des étapes 1-3. `mandats` peut coexister avec
   `biens.statut_mandat` le temps que les lectures basculent.
5. Le retrait éventuel des colonnes d'identité de `acquereurs`/`prospects_vendeurs` est le
   **dernier** lot, conditionné à zéro lecture résiduelle — et reste facultatif.

**État d'avancement de l'étape 3 (constat, pas une décision nouvelle) :** la première bascule de
lecture est faite — le moteur de compatibilité lit les critères du **projet acquéreur canonique**
dès que la ligne `acquereurs` est rattachée, et le dossier historique sinon. Le repli est au niveau
de l'**agrégat**, jamais champ par champ : un NULL canonique reste un NULL. L'étape 2 (backfill)
n'a **pas** été exécutée et ne l'est toujours pas — les lignes historiques restent volontairement
non rattachées et matchent exactement comme avant. Les secteurs de recherche restent legacy.
Détail : `docs/DATA_MODEL.md#lecture-effective-des-critères-acquéreur-adr-055-b-lot--read-bridge-`.

**Ce qui n'est jamais touché :** le tunnel commercial (`visites` → `comptes_rendus_visite` →
`offres` → `compromis` → `remuneration` → pack notaire), les moteurs purs
(`lib/compatibilite/`, `lib/opportunites/`, `lib/alertes/`, `lib/fiscal/`), et les invariants de
sécurité d'ADR-047.

Les moteurs purs sont protégés par construction : `evaluerCompatibilite(bien, acquereur,
secteurs)` prend des **objets typés en paramètre**, sans I/O ni accès base (ADR-034 §1). Changer
d'où viennent ces objets ne les touche pas — c'est exactement le bénéfice de leur pureté, et la
raison pour laquelle ils ne doivent pas être réécrits.

## Conséquences

- ADR-027 §1 cesse d'être une dette ouverte : la « passe ultérieure » qu'elle annonce est décidée.
- Les CAS 1 à 10 deviennent représentables. Aucun n'est implémenté par cette ADR.
- ADR-056 (identité externe) devient possible : un connecteur a désormais une cible canonique
  stable à laquelle rattacher un contact importé.
- `mandats` ouvre des règles d'automatisation aujourd'hui impossibles (échéance, exclusivité) —
  aucune n'est créée ici.
- Le nombre de tables augmente d'environ 6. C'est le coût assumé de la séparation
  identité/projet ; il est linéaire, alors que le coût de la fusion croît avec chaque
  fonctionnalité écrite dessus.

## Risques

| Risque | Portée | Atténuation décidée |
|---|---|---|
| Migration longue avec deux modèles coexistants | **Élevé** | Étapes indépendantes et livrables ; l'ancien modèle reste source de vérité jusqu'à bascule explicite ; tests de caractérisation obligatoires avant chaque bascule |
| Régression silencieuse d'un moteur pendant la bascule | Élevé | Les moteurs sont purs et déjà couverts (529 l. de tests sur `evaluerCompatibilite`, 389 l. sur `opportunites/moteur`) — la bascule ne change que l'origine des objets, jamais leur forme |
| Doublons de contacts après import multi-source | Moyen | Détection sur champs structurés + validation humaine (invariant 7) ; rattachement multi-références traité par ADR-056 |
| Sur-modélisation du mandat | Moyen | Périmètre métier explicitement borné ; aucune clause, aucun texte contractuel |
| `interactions` devient un fourre-tout qui vide les tables spécialisées de leur sens | Moyen | Invariants 3 et 4 ; règle de revue : une interaction qui a déjà une table dédiée n'entre pas dans `interactions` |

## Hors périmètre, volontairement

Toute migration SQL · toute implémentation · fusion effective des tables existantes · suppression
de `acquereurs`/`prospects_vendeurs` · modèle juridique du mandat · honoraires détaillés par
partie · gestion d'indivision/SCI au-delà du booléen `personne_morale` · carnet d'adresses partagé ·
import de contacts · détection automatique de doublons · UI.

## Questions ouvertes

1. **Les mandants d'un mandat passent-ils par `parties_projet` ou par une relation
   `mandats ↔ contacts` dédiée ?** Un mandat peut exister sans projet vendeur (bien créé
   directement, cas explicitement constaté par ADR-042) — ce qui plaide pour une relation dédiée.
   À trancher au lot d'implémentation.
2. **`projets_acquereur` remplace-t-il `acquereurs` ou le complète-t-il durablement ?** L'étape 5
   de migration est volontairement laissée facultative.
3. **Un contact peut-il exister sans aucun projet ?** Oui conceptuellement (apporteur, notaire,
   partenaire) — mais les écrans qui le créeraient n'existent pas.
4. **Le notaire, le syndic, le diagnostiqueur sont-ils des contacts ?** Probablement, avec un rôle
   non lié à un projet. Non tranché.
5. **`visites` doit-elle référencer un projet acquéreur plutôt qu'un acquéreur ?** Question réelle,
   liée à la dette connue `taches.visite_id → comptes_rendus_visite` (audit, risque n°9). Non
   traitée ici.

## Scalabilité

Une jointure de plus sur le chemin de lecture d'une fiche (contact → projet), indexée sur des FK :
aucun impact particulier à l'échelle visée par ADR-051. La vue unifiée reste dérivée à la lecture,
donc bornée par le volume d'un seul dossier, jamais par la taille de la base — c'est déjà le cas
aujourd'hui (`memoireAcquereur.ts`). Le seul point de vigilance est la détection de doublons sur
`contacts`, qui doit s'appuyer sur des index (email, téléphone normalisé) et jamais sur un balayage
avec comparaison de chaînes.

## Réversibilité

Aucune dépendance fournisseur n'est introduite : tables, FK et `CHECK` PostgreSQL standard
(ADR-051 §2). Le modèle canonique est au contraire **le prérequis de la réversibilité produit** :
c'est lui qui permet d'importer et d'exporter depuis n'importe quel CRM sans que le schéma DOMIORA
n'épouse celui d'un fournisseur particulier (voir ADR-056).
