# ADR-066 — Fondation du moteur de rétention : dry-run, aucune suppression

Statut : accepté
Date : 2026-10-09
Chantier : `RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1`
Complète : ADR-065 (fondation de gouvernance de la confidentialité), ADR-033 (moteur d'automatisation
et routes machine), ADR-054 (appartenance workspace), ADR-007 (couche repository)

## Contexte

ADR-065 a tranché des durées de conservation et n'en a appliqué aucune. C'était cohérent : une
notice qui énonce « 5 ans » alors que le produit conserve indéfiniment est un engagement non exécuté,
donc un défaut affirmatif. `PUBLIC_PRIVACY_PAGE` et `SHORT_NOTICE_AT_BON_VISITE` sont restés
désactivés jusqu'à `RETENTION_ENFORCEMENT_V1`.

L'audit `RETENTION_ENFORCEMENT_V1_READINESS_AUDIT` a ensuite établi ce qui manque réellement pour
exécuter ces durées, et le résultat est franchement asymétrique :

- une seule politique est aujourd'hui **calculable** à partir de données réelles — le bon de visite
  signé, dont `bons_visite.signe_le` est le déclencheur, garanti NOT NULL dès `statut = 'signe'` par
  le CHECK `bons_visite_coherence_statut_check` ;
- deux politiques n'ont **aucun déclencheur fiable** : `PROSPECT_MARKETING` (pas de dernier contact
  entrant) et `CUSTOMER_MARKETING` (pas de fin de relation canonique) ;
- trois catégories restent `UNDECIDED` (ADR-065 §3) ;
- deux politiques sont déjà respectées hors base (session, état OIDC), une l'est partiellement
  (connexion Google) ;
- et même pour la seule politique calculable, **aucune suppression n'est possible** : pas de modèle
  de suspension pour contentieux, pas de primitive de suppression de fichier, et un chemin de
  suppression incomplet.

Écrire un moteur de purge dans cet état produirait des suppressions justifiées par une chronologie
inventée. Ce chantier pose donc la fondation et s'arrête volontairement avant la suppression.

## Décision 1 — Le lot n'est pas `RETENTION_ENFORCEMENT_V1`

```
RETENTION_ENFORCEMENT_V1_LIVRE = FALSE
APPLY_SUPPORTED                = NO
```

Ce lot livre un **dry-run** : il lit le minimum nécessaire, calcule des éligibilités, écrit un
journal technique de run, et retourne des compteurs agrégés. Il ne supprime pas, n'anonymise pas,
n'archive pas, ne déplace aucun fichier, ne modifie aucune donnée métier.

`RETENTION_ENFORCEMENT_V1_LIVRE` ne passera à `TRUE` que lorsqu'au moins une politique réellement
applicable sera effectivement exécutée par un mécanisme de rétention sûr. Compter n'est pas
appliquer, et nommer ce lot « enforcement » parce qu'il produit des chiffres serait précisément
l'erreur qu'ADR-065 §7 cherche à éviter : affirmer une exécution qui n'a pas lieu.

## Décision 2 — Un moteur d'éligibilité PUR, séparé de `lib/privacy/`

```
RETENTION_LIBRARY = apps/web/src/lib/retention/
```

`privacyGouvernance.structurel.test.ts` interdit délibérément les primitives destructives dans
`src/lib/privacy/`, qui est le lieu des **décisions** de gouvernance. Le moteur, qui lit la base et
écrit un journal, vit donc dans `src/lib/retention/`. Cette garde n'est pas affaiblie : elle est
respectée par séparation, pas par exception.

`eligibilite.ts` est **pur** : il n'importe ni la base, ni `process.env`, ni `next/*`, et n'appelle
jamais `Date.now()`. L'instant de référence est un paramètre obligatoire. Ce n'est pas du purisme —
une échéance de conservation est une comparaison entre deux dates, et une fonction qui va chercher
l'une des deux toute seule ne peut pas être testée sur la frontière exacte, qui est le seul endroit
où elle peut se tromper.

Les « 5 ans » ne sont pas une constante du moteur : ils sont **lus** dans
`lib/privacy/conservation.ts`, source canonique des politiques (ADR-065). Le vocabulaire des codes de
politique n'est pas redéclaré côté rétention — il est exporté depuis `conservation.ts` et réutilisé.

```
POLICY_SOURCE_REUSED = YES
```

Deux listes de codes dériveraient, et la plus fausse des deux serait celle qui pilote la purge.

## Décision 3 — Trois vocabulaires fermés, et trois seulement

Trois questions distinctes se posent, et les confondre est ce qui rendrait un moteur de purge
dangereux :

| Question | Vocabulaire |
| --- | --- |
| Que peut-on faire de **cette politique** aujourd'hui ? | `StatutPolitiqueRetention` |
| Où en est **cette ligne** par rapport à l'échéance ? | `VerdictEntiteRetention` |
| **Pourquoi** est-ce bloqué, précisément ? | `CodeBlocageRetention` |

Statuts de politique : `ALREADY_ENFORCED`, `PARTIAL_EXISTING_RUNTIME`, `COMPUTABLE_DRY_RUN_ONLY`,
`BLOCKED_MISSING_TRIGGER`, `BLOCKED_UNDECIDED_POLICY`, `BLOCKED_MISSING_LEGAL_HOLD`,
`BLOCKED_MISSING_FILE_DELETE`.

Aucun de ces statuts ne signifie « actionnable pour suppression ». La liste est fermée et un test le
vérifie : aucun code du vocabulaire ne porte ce sens, parce qu'aucun n'en a le droit dans ce lot.

Les deux derniers ne sont portés par **aucune** politique à la sortie du lot. Ils existent pour le
jour où un chemin de suppression existera mais pas encore la suspension pour contentieux, ou pas
encore la primitive fichier — c'est-à-dire exactement l'état intermédiaire qu'il ne faut pas pouvoir
confondre avec « calculable ».

## Décision 4 — Fail-closed, sans exception

Toute situation inconnue produit un **blocage**, jamais une éligibilité :

- statut hors vocabulaire → `BLOCKED` / `UNKNOWN_ENTITY_STATE` (on ne sait pas ce qu'est la ligne) ;
- statut connu mais non concerné → `OUT_OF_SCOPE` (on sait, et elle n'est pas concernée) ;
- `signe_le` absent ou invalide → `BLOCKED` / `SIGNED_AT_MISSING` ;
- politique décidée non branchée au moteur → `BLOCKED` / `UNKNOWN_POLICY` ;
- durée absente ou d'unité inattendue → blocage, jamais une durée de repli ;
- erreur de lecture → `BLOCKED` / `REPOSITORY_ERROR`, rapportée dans le résultat de la politique
  concernée.

Le moteur ne transforme jamais une absence d'information en date 0 ni en date ancienne. Dire
« 0 éligible » après une erreur de lecture serait indistinguable de « rien à faire », et c'est la
confusion qui ferait croire un jour qu'une purge n'avait rien à purger.

Le « + 5 ans » est de l'arithmétique **de calendrier** en UTC, jamais `5 × 365 × 86 400 000` ms : une
durée dérivée d'une année supposée décale l'échéance d'un ou deux jours, et sur une politique
probatoire, décaler l'échéance c'est supprimer une preuve avant terme ou la garder trop longtemps.
Cas limite assumé et déterministe : 29 février + 5 ans = 1er mars.

## Décision 5 — État de chaque politique à la sortie du lot

| Politique | Statut | Cause / mécanisme |
| --- | --- | --- |
| `SIGNED_VISIT_FORM` | `COMPUTABLE_DRY_RUN_ONLY` | `signe_le + 5 ans`, comptable, **non supprimable** |
| `PROSPECT_MARKETING` | `BLOCKED_MISSING_TRIGGER` | `LAST_INBOUND_CONTACT_AT_MISSING` |
| `CUSTOMER_MARKETING` | `BLOCKED_MISSING_TRIGGER` | `RELATIONSHIP_END_AT_MISSING` |
| `TRANSACTION_DOCUMENTS` | `BLOCKED_UNDECIDED_POLICY` | `POLICY_UNDECIDED` (ADR-065 §3) |
| `FREE_TEXT_NOTES` | `BLOCKED_UNDECIDED_POLICY` | `POLICY_UNDECIDED` |
| `ACTIVE_CLIENT_OR_PROJECT_DATA` | `BLOCKED_UNDECIDED_POLICY` | `POLICY_UNDECIDED` |
| `SESSION` | `ALREADY_ENFORCED` | cookie scellé iron-session, TTL 7 jours — aucune table |
| `OIDC_STATE` | `ALREADY_ENFORCED` | cookie `maxAge` 600 s, consommé à usage unique |
| `GOOGLE_CONNECTION` | `PARTIAL_EXISTING_RUNTIME` | révocation + suppression à la déconnexion, écart connu |

Le caractère indécis n'est pas écrit en dur : il est **lu** depuis `conservation.ts`. Le jour où une
catégorie est tranchée, le moteur cesse de la déclarer indécise sans modification du moteur.

### `PROSPECT_MARKETING` — pourquoi `dernier_contact_le` est interdit

```
LAST_INBOUND_USES_DERNIER_CONTACT_LE = NO
```

`prospects_vendeurs.dernier_contact_le` et `projets_vendeur.dernier_contact_le` **ne représentent pas
un dernier contact entrant**. Leurs écrivains sont des gestes du conseiller (ajout d'une note, RDV
d'estimation marqué réalisé). Les utiliser prolongerait la durée de prospection par la seule activité
de l'agence — une durée de conservation qui s'étend parce que le responsable du traitement travaille
son fichier n'est pas une durée de conservation.

La seule source orientée démontrée est `interactions.sens = 'entrant'` + `interactions.survenu_le`,
qui n'est pas disponible de façon fiable pour tous les prospects. La politique reste donc bloquée, et
un test de non-régression explicite verrouille l'interdiction : aucune occurrence de
`dernier_contact_le` dans `lib/retention/`, sous aucune forme, et aucune composition du type
`max(dernier_contact_le, cree_le)`.

### `CUSTOMER_MARKETING` — pourquoi aucune fin de relation n'est déduite

Plusieurs candidats existent (acte, perte, résiliation de mandat, archivage), aucun n'est **la** fin
de relation, et l'acquéreur n'a aucun horodatage de sortie de parcours. Aucun `relationship_end_at`
n'est fabriqué dans ce lot : ni depuis `archive_le` seul, ni depuis un compromis, un mandat ou un
stade de projet seuls. La décision composite reste à prendre, et c'est une décision de gouvernance,
pas d'implémentation.

### `SIGNED_VISIT_FORM` — calculable, et strictement rien de plus

Trois blocages de **suppression** sont rendus séparément du statut, parce qu'ils n'empêchent pas de
compter mais interdisent d'agir :

- `LEGAL_HOLD_MODEL_MISSING` — aucun modèle de suspension pour contentieux ;
- `FILE_DELETE_PRIMITIVE_MISSING` — ni le PDF `documents_bien`, ni le PNG de signature n'ont de
  primitive de suppression ;
- `DELETE_PATH_MISSING` — `bons_visite.document_id` est en SET NULL, donc supprimer le bon laisserait
  la ligne `documents_bien` du PDF et son fichier ; `evenements_metier.bon_visite_id` est en NO
  ACTION et bloque de toute façon la suppression dès qu'un événement référence le bon.

Les mélanger avec le statut ferait croire que la politique n'est pas calculable, ou — bien pire —
qu'elle est actionnable.

## Décision 6 — Lecture minimale

Le repository lit `id`, appartenance, `statut`, `signe_le`. Rien d'autre : ni `contenu_snapshot` (qui
porte l'adresse du bien, le nom du conseiller et le texte signé), ni les `*_snapshot` d'identité du
signataire, ni `hash_document`, ni aucune clé de stockage. Une donnée qu'une fonction ne possède pas
est une donnée qu'elle ne peut pas divulguer, et un moteur de rétention est le dernier endroit où
charger des données personnelles dont on n'a pas l'usage.

`bons_visite` ne porte pas `workspace_id` : c'est une feuille (ADR-054 §7) et son appartenance se
dérive par `visites -> biens`. La jointure reste dans le `WHERE` — un filtrage en mémoire après
lecture aurait chargé les bons des autres workspaces avant de les écarter.

Les politiques bloquées ou déjà appliquées ne déclenchent **aucune lecture**. Charger un dataset pour
conclure « bloqué » serait lire des données personnelles sans en avoir l'usage.

## Décision 7 — Journal : un run écrit, aucune action écrite

Deux tables, migration `0060_retention_engine_foundation_v1`, strictement additive : deux
`CREATE TABLE`, trois FK, deux index. Aucune table métier touchée, aucun `DROP`, aucun backfill,
aucun trigger, aucune colonne `legal_hold`.

`runs_retention` — un balayage a eu lieu, et voici ce qu'il a compté : workspace, mode, `demarre_le`,
`ordre` (ordre total du journal, même rationale que `runs_scan_automatisation.ordre`), `termine_le`,
nombres de politiques / éligibles / bloquées, erreur technique. La ligne est posée au début et
complétée à la fin (patron ADR-033) : un run resté sans `termine_le` reste honnêtement visible comme
inachevé plutôt qu'absent.

`actions_retention` — créée **vide**, écrite par aucun chemin de ce lot.

```
DRY_RUN_WRITES_RUN         = YES   (1 ligne par workspace balayé)
DRY_RUN_WRITES_ACTION_ROWS = NO    (0 ligne, toujours)
```

Une ligne d'action par candidat détecté ne serait pas un journal : ce serait un **index permanent des
personnes bientôt effaçables**, c'est-à-dire une nouvelle donnée personnelle créée par le dispositif
censé en réduire la durée de vie. Le dry-run ne compte que des agrégats.

`actions_retention` ne porte **pas** `workspace_id` : c'est une FEUILLE de `runs_retention` par sa FK
NOT NULL, et ADR-054 §7 interdit à une feuille de dupliquer l'appartenance — une seconde vérité
pouvant diverger de celle du run. Le périmètre d'une action est celui du balayage qui l'a produite, et
il se lit par jointure. Le brief du chantier listait `workspace_id` parmi les colonnes minimales
attendues ; la garde structurelle d'ADR-054 prévaut, et elle n'a pas été affaiblie. Même précédent
qu'`executions_automatisation`, feuille de son événement.

Ce que `actions_retention` ne doit jamais contenir : nom, prénom, email, téléphone, adresse, texte
libre, snapshot, contenu de document, image de signature. `entity_type` + `entity_id` prouvent qu'une
ligne précise a été traitée sans permettre de reconstituer qui elle désignait une fois la donnée
partie — c'est exactement la propriété recherchée. Pas de FK vers l'entité, pour la même raison : le
journal doit survivre à la disparition de ce qu'il décrit.

`action` n'admet qu'une valeur, `'DRY_RUN_DETECTED'`, et c'est le point fail-closed de la migration :
aucune capacité de suppression n'existe, donc aucun verbe de suppression n'est accepté par la base. Un
`INSERT` prématuré de `'DELETE_DB'` est refusé par PostgreSQL, pas seulement par une revue de code. Le
lot qui livrera une suppression élargira ce CHECK par migration — ce qui le rendra visible et daté.

`runs_retention.mode` accepte `'apply'` alors qu'aucun chemin applicatif ne peut l'écrire. La valeur
existe pour que le journal d'une future purge ne soit pas distinguable d'un dry-run par une colonne
ajoutée après coup, ce qui rendrait l'historique antérieur muet sur ce qu'il était.

## Décision 8 — Résultats non personnels par construction

```
NO_PERSONAL_DATA_IN_RESPONSE = YES
```

L'`entityId` existe **en interne**, au niveau de l'évaluation d'une ligne, parce que la composition et
la déduplication en ont besoin. Il tombe à l'agrégation : `agregerEvaluations` reçoit des évaluations
identifiées et ne rend que des compteurs et deux bornes de dates. Aucun identifiant ne franchit cette
frontière.

C'est structurel et non déclaratif : la réponse publique n'est pas un objet filtré en dernière
minute, c'est un objet qu'aucun identifiant n'a jamais traversé. Par politique : `policyCode`,
`status`, compteurs, `oldestEligibleAt` / `newestEligibleAt`, `blockerCode`, `mechanism`,
`blocagesAvantSuppression`, `erreurTechnique` éventuels.

Multi-workspace : une passe et un run **par workspace** (ADR-054), politiques à l'intérieur, chaque
politique isolée par `try/catch` comme `executerScanTemporelComplet`. L'échec d'une politique
n'empêche jamais les autres d'être évaluées et est rapporté dans le résultat de celle qui a échoué.

## Décision 9 — Route machine, et aucun cron

```
MACHINE_ROUTE = POST /api/retention/dry-run
CRON_CREATED  = NO
```

Patron d'authentification identique aux quatre routes machine existantes (ADR-033, ADR-036) : secret
partagé en en-tête `Authorization: Bearer`, jamais en query string, comparaison en temps constant
avec contrôle de longueur préalable, secret absent de la configuration → **503** et jamais un
traitement anonyme, valeur reçue jamais journalisée ni renvoyée. Secret **dédié**
(`RETENTION_DRY_RUN_SECRET`) : aucun secret de cron existant ne doit pouvoir, même par erreur de
configuration, déclencher un balayage de rétention. La route est déclarée dans `ROUTES_MACHINE`
(`frontiereWorkspace.structurel.test.ts`) et n'exige aucune session.

Aucun cron, aucun `setInterval`, aucune configuration Railway, aucun secret ajouté en production dans
ce lot. La route suit le précédent de `/api/compatibilite/baseline`, seule route machine dont le
déclenchement est un geste humain explicite. Un balayage de rétention qui tournerait tout seul chaque
nuit n'aurait rien à supprimer aujourd'hui — mais il installerait l'habitude d'un chemin automatique
vers une opération irréversible, avant que la moindre garde n'existe.

`mode: "apply"` est refusé dans le **service** autant que dans la route : le refus applicatif précède
toute lecture, pour qu'un futur appelant interne (script, autre service) ne puisse pas contourner la
garde en évitant HTTP.

## Décision 10 — La publication reste bloquée

```
RETENTION_ENFORCEMENT_V1_LIVRE      = FALSE
PUBLIC_PRIVACY_PAGE_ENABLED         = FALSE
SHORT_NOTICE_AT_BON_VISITE_ENABLED  = FALSE
```

Les trois catégories `UNDECIDED` le restent. Ce lot ne débloque donc aucune notice, et ADR-065 §7
s'applique inchangée. Les gardes structurelles d'ADR-065 ne sont ni modifiées ni contournées.

## Hors périmètre, volontairement

- Toute suppression, anonymisation, archivage ou déplacement de donnée ou de fichier.
- Toute primitive de suppression de fichier (PDF de bon de visite, PNG de signature).
- Tout modèle de suspension pour contentieux (`legal_hold`), posé ou levé.
- Tout cron, planificateur ou déclenchement automatique.
- Toute écriture dans `actions_retention`.
- Toute modification du parcours du bon de visite.
- Toute activation de notice publique.
- Toute purge des connexions Google dont le refresh token chiffré est illisible — écart documenté,
  chantier séparé.

## Conséquences

Le produit sait désormais **dire** ce qu'il devrait supprimer, workspace par workspace, sans rien
supprimer et sans produire de donnée personnelle nouvelle. C'est la condition pour décider de la
suite sur des chiffres réels plutôt que sur une estimation, et pour qu'une future purge soit
auditable dès son premier run.

La dette reste exactement celle qu'ADR-065 décrit : les durées sont décidées, une seule est
calculable, aucune n'est appliquée. `docs/KNOWN_LIMITATIONS.md` est mis à jour en ce sens, sans
changer de verdict.

## Scalabilité

À 10 000 workspaces, le dry-run est une boucle de 10 000 itérations avec une requête indexée par
workspace pour la seule politique calculable : les huit autres ne lisent rien. Le balayage est
déclenché à la main, jamais concurrent de lui-même, et n'écrit qu'une ligne par workspace. Si le
volume de bons signés par workspace devenait important, le comptage descendrait en SQL agrégé plutôt
qu'en mémoire — le moteur pur resterait inchangé, puisque seul le repository connaît la base.

L'index `runs_retention_workspace_demarre_idx` couvre la lecture naturelle du journal (l'historique
d'un workspace par date).

## Réversibilité

Aucune nouvelle dépendance fournisseur : PostgreSQL et Node seuls. Aucun planificateur externe,
aucun service tiers, aucun secret de production ajouté. Le moteur pur est du TypeScript sans
dépendance, testable hors base. Les deux tables du journal sont additives et autonomes : les
supprimer ne casse aucune table métier.

## Chantiers suivants

Dans cet ordre, et la suite immédiate n'est **pas** une purge :

1. `FILE_DELETION_PRIMITIVE_V1` — supprimer réellement un fichier (PDF, signature) et sa ligne, de
   façon traçable. Sans elle, aucune politique portant un document n'est exécutable.
2. `LEGAL_HOLD_V1` — modèle de suspension pour contentieux : sans lui, une purge correcte peut
   détruire une preuve nécessaire à un litige en cours.
3. `SIGNED_VISIT_FORM_RETENTION_V1` — la première exécution réelle, une fois 1 et 2 livrés, avec le
   chemin de suppression complet (`documents_bien`, `evenements_metier`, signature).
4. `PROSPECT_MARKETING_RETENTION_V1` — exige d'abord un `LAST_INBOUND_CONTACT_AT` fiable.
5. `CUSTOMER_MARKETING_RETENTION_V1` — exige d'abord une décision sur `RELATIONSHIP_END_AT`.
6. `UNDECIDED_RETENTION_POLICIES` — trancher les trois catégories indécises (ADR-065 §3).

`RETENTION_ENFORCEMENT_V1_LIVRE` passe à `TRUE` au plus tôt à l'issue du point 3.
