# Procédure de pose et de levée d'un Legal Hold

Statut : procédure **testée sur base jetable** (13 contrôles).
Chantier : `PILOT_LEGAL_AND_OPERATING_PROCEDURES_V1`
Modèle : ADR-068. Code : `apps/web/src/lib/legalHold/`.

## Ce qu'un legal hold fait, et ne fait pas

Il **interdit** une suppression future. Il n'autorise rien, ne déplace rien, ne cache rien, ne
modifie aucune donnée métier.

Un hold n'a **pas de date de fin** : il ne se lève pas tout seul. C'est volontaire — une protection
qui disparaît à une date saisie des années plus tôt est une protection qui disparaît sans décision.

## Avant de commencer : trois faits à connaître

1. **Il n'existe aucune surface humaine.** Ni route, ni action serveur, ni écran, ni cron. Les
   primitives du domaine existent et leurs seuls appelants sont des tests. Poser un hold aujourd'hui
   exige un accès direct à la base. C'est une décision produit non tranchée (`LEGAL_HOLD_SURFACE_V1`).
2. **Un seul type de cible est supporté** : `bons_visite`. Un hold sur un contact, un document, une
   photo ou un dossier **n'est pas exprimable**, et un `CHECK` en base le refuse. Un contentieux
   portant sur autre chose se gère hors produit.
3. **La base ne protège pas la cible.** `legal_holds` n'a aucune clé étrangère vers ce qu'elle
   protège, par conception : une cascade effacerait le registre avec la pièce, et un `NO ACTION`
   protégerait la pièce pour toujours même après la levée. Vérifié sur base jetable : supprimer la
   chaîne d'un acquéreur emporte ses bons de visite **sans aucune erreur**, laissant les holds
   orphelins. La protection ne tient que par la consultation du registre avant tout acte.

## Garanties portées par la base, et non par le code appelant

C'est ce qui rend une procédure SQL acceptable ici : les invariants ne dépendent pas de l'appelant.

| Contrainte | Effet |
|---|---|
| `legal_holds_entity_type_check` | `entity_type` ne peut valoir que `'bons_visite'` |
| `legal_holds_motif_code_check` | six motifs seulement (voir ci-dessous) |
| `legal_holds_motif_non_vide_check` | motif de dix caractères utiles au minimum |
| `legal_holds_coherence_levee_check` | `leve_le`, `leve_par_identite_sub`, `motif_levee` : les trois ou aucun, motif de levée de dix caractères minimum |
| `legal_holds_levee_apres_pose_check` | une levée ne peut précéder sa pose |
| `legal_holds_cible_actif_unique` (index partiel) | un seul hold **actif** par (workspace, type, cible, motif) ; un nouveau hold est possible après levée |
| `pose_le DEFAULT now()` | l'horodatage vient de l'horloge du serveur de base |

Actif se dérive : **actif si et seulement si `leve_le IS NULL`**. Il n'existe aucune colonne d'état,
et il ne faut pas en inventer une.

## Motifs autorisés

`CONTENTIEUX`, `PRE_CONTENTIEUX`, `OBLIGATION_CONSERVATION`, `CONTROLE_OU_AUDIT`,
`DEMANDE_JURIDIQUE`, `AUTRE_MOTIF_DOCUMENTE`.

`AUTRE_MOTIF_DOCUMENTE` est un dernier recours nommé, pas un fourre-tout : le texte libre reste
obligatoire.

**Le texte du motif décrit une affaire, jamais la pièce ni la personne.** Aucun contrôle technique
ne l'impose, et le registre est conçu pour ne contenir aucune donnée personnelle. Y recopier un nom
est une erreur de saisie qui survivra à l'effacement de la personne.

## Pose

### Étape 1 — Identifier la cible et prouver qu'elle est dans le périmètre

La jointure n'est pas décorative : `bons_visite` ne porte aucune appartenance, elle se dérive par
`visites -> biens`. Elle doit rester **dans le `WHERE` de l'insertion**.

```sql
SELECT bv.id, bv.statut, bv.signe_le IS NOT NULL AS signe
FROM bons_visite bv
JOIN visites v ON v.id = bv.visite_id
JOIN biens   b ON b.id = v.bien_id
WHERE bv.id = :bon_visite_id AND b.workspace_id = :workspace_id;
```

Aucune ligne : la cible est introuvable **dans ce workspace**. Les deux cas — absente, ou
appartenant à un autre périmètre — sont volontairement indistinguables.

### Étape 2 — Holds déjà en place

```sql
SELECT motif_code, leve_le IS NULL AS actif, pose_le, leve_le
FROM legal_holds
WHERE workspace_id = :workspace_id AND entity_type = 'bons_visite'
  AND entity_id = :bon_visite_id
ORDER BY ordre;
```

Plusieurs motifs peuvent protéger la même pièce simultanément — un contentieux **et** un contrôle —
et lever l'un ne lève pas l'autre. C'est la raison pour laquelle `motif_code` fait partie de la clé
d'unicité.

### Étape 3 — Poser

```sql
INSERT INTO legal_holds
  (workspace_id, entity_type, entity_id, motif_code, motif, pose_par_identite_sub)
SELECT :workspace_id, 'bons_visite', bv.id::text, :motif_code, :motif, :identite_sub
FROM bons_visite bv
JOIN visites v ON v.id = bv.visite_id
JOIN biens   b ON b.id = v.bien_id
WHERE bv.id = :bon_visite_id AND b.workspace_id = :workspace_id
RETURNING id, motif_code, pose_le;
```

`INSERT 0 0` signifie **cible introuvable dans ce workspace** : rien n'a été écrit, et ce n'est pas
une erreur à contourner.

Une violation d'unicité signifie qu'un hold actif de **même motif** existe déjà. Relire l'étape 2 et
montrer la protection existante ; ne jamais lever puis reposer pour « rafraîchir » un hold.

`:identite_sub` est le `sub` OIDC de l'opérateur, jamais son adresse électronique : un registre de
conservation n'a pas besoin d'une coordonnée pour désigner un auteur de façon stable.

### Étape 4 — Vérifier

```sql
SELECT count(*) AS holds_actifs FROM legal_holds
WHERE workspace_id = :workspace_id AND entity_id = :bon_visite_id AND leve_le IS NULL;
```

Effet attendu sur le moteur de rétention : le verdict du bon passe de `ELIGIBLE` à
`BLOCKED_BY_LEGAL_HOLD`, avec le code `ACTIVE_LEGAL_HOLD`. `eligible_at` est **conservé** :
l'échéance est un fait, le hold interdit d'agir dessus. Les verdicts `NOT_YET_ELIGIBLE`,
`OUT_OF_SCOPE` et `BLOCKED` ne changent pas.

Contrôle par le dry-run, en lecture seule, sans toucher aux données :

```
POST /api/retention/dry-run     (Bearer RETENTION_DRY_RUN_SECRET, mode apply refusé par la route)
```

## Levée

La levée est un `UPDATE`, **jamais** un `DELETE`. Un hold levé reste lisible avec son motif
d'origine et son motif de levée.

### Étape 1 — Décider, et écrire pourquoi

Un hold se lève parce que l'affaire est close, non parce qu'une suppression est souhaitée. Le motif
de levée est conservé pour être relu des années plus tard.

### Étape 2 — Lever

La condition `leve_le IS NULL` est **dans le `WHERE`** : c'est elle qui rend l'opération idempotente
et qui interdit qu'une seconde levée écrase l'auteur et le motif de la première.

```sql
UPDATE legal_holds
SET leve_le = now(),
    leve_par_identite_sub = :identite_sub,
    motif_levee = :motif_levee
WHERE workspace_id = :workspace_id
  AND entity_type  = 'bons_visite'
  AND entity_id    = :bon_visite_id
  AND motif_code   = :motif_code
  AND leve_le IS NULL
RETURNING id, motif_code, leve_le;
```

`UPDATE 0` : soit le hold n'existe pas dans ce périmètre, soit il était déjà levé. Les deux sont des
états normaux. Relire l'étape 2 de la pose pour les distinguer — **sans jamais retirer
`leve_le IS NULL` du `WHERE`.**

Ne jamais renseigner `leve_le` seul : le `CHECK` de cohérence refuse, et c'est exactement ce qui
évite un hold « levé » sans auteur ni raison.

### Étape 3 — Vérifier

```sql
SELECT motif_code, leve_le IS NULL AS actif, pose_par_identite_sub, leve_par_identite_sub
FROM legal_holds
WHERE workspace_id = :workspace_id AND entity_id = :bon_visite_id ORDER BY ordre;
```

Vérifier que les autres motifs encore actifs le sont restés. La levée d'un hold ne libère pas une
pièce qu'un autre retient.

`SUPPRESSION_SUR_LEVEE_SUPPORTEE = false` : lever un hold ne déclenche aucune suppression. Il n'y a
d'ailleurs aucun chemin de suppression — `APPLY_SUPPORTED` et `RETENTION_ENFORCEMENT_V1_LIVRE`
valent tous deux `false`.

## Test réalisé

Base jetable `atlas_proc_v1`, PostgreSQL 16, schéma complet, cible synthétique. Aucune PII.

| # | Contrôle | Résultat |
|---|---|---|
| 1 | Cible prouvée par la jointure `bons_visite -> visites -> biens` | trouvée |
| 2 | Pose, horodatage par la base | créé, `pose_le` non nul |
| 3 | Seconde pose, même motif | refusée (violation d'unicité) |
| 4 | Second motif sur la même cible | acceptée |
| 5 | Motif de moins de dix caractères | refusé par `legal_holds_motif_non_vide_check` |
| 6 | `entity_type = 'contacts'` | refusé par `legal_holds_entity_type_check` |
| 7 | Deux holds actifs simultanés sur la même cible | confirmés |
| 8 | Levée du seul motif `CONTENTIEUX` | 1 ligne mise à jour |
| 9 | Seconde levée du même hold | 0 ligne ; auteur de la première levée intact |
| 10 | Levée partielle (`leve_le` seul) | refusée par `legal_holds_coherence_levee_check` |
| 11 | Le hold `CONTROLE_OU_AUDIT` reste actif | confirmé |
| 12 | Nouvelle pose du même motif après levée | acceptée (index partiel) |
| 13 | Levée tentée depuis un autre workspace | 0 ligne, aucune écriture |

## Production : ce qui n'est pas réglé

Cette procédure a été validée sur une base jetable. **En production, aucune voie encadrée n'existe
aujourd'hui** : pas de surface produit, et un accès SQL direct à la base de production est un geste
à haut risque qui n'est pas couvert par ce lot.

`LEGAL_HOLD_PRODUCTION_PATH = DECISION_REQUIRED`

Si un contentieux survient pendant le pilote avant que `LEGAL_HOLD_SURFACE_V1` ne soit livré, le
maintien se gère **hors produit** — par écrit, documenté, en s'abstenant de toute suppression sur le
périmètre concerné. C'est la limite n° 3 d'ADR-068, et elle est tenable précisément parce qu'aucun
mécanisme de suppression n'existe : il n'y a rien à suspendre.

## À valider par un juriste

1. **Quand un hold doit être posé.** Le produit fournit un registre ; il ne dit pas à partir de quel
   signal une conservation devient nécessaire. [Non vérifié]
2. **Durée du maintien.** Un hold n'expire pas. Le moment de la levée est une décision juridique.
3. **Le motif comme pièce.** Le texte du motif est un écrit conservé décrivant une affaire. Son
   statut n'a pas été évalué.
4. **Les pièces non couvertes.** Seuls les bons de visite sont protégeables. Un contentieux portant
   sur un compromis, un document ou un échange ne peut pas être enregistré dans ce registre.

## Décisions produit requises

1. **`LEGAL_HOLD_SURFACE_V1`** — poser et lever depuis le produit, avec la garde
   `exigerOwnerWorkspaceCourant()` et l'auteur câblé depuis la session. Aujourd'hui, l'identité de
   l'auteur est saisie à la main, donc déclarative.
2. **Élargir les types de cible.** Exige une migration du `CHECK` **et** le câblage de la lecture
   correspondante — les deux ensemble. Un hold sur un type qu'aucun chemin ne consulte se lirait
   comme une protection sans en être une.
3. **Registre des holds posés hors produit** pendant le pilote : où, et sous quelle forme.
