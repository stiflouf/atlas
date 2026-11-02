# Procédure manuelle d'effacement d'une personne

Statut : procédure **testée sur base jetable**. Aucun outillage produit n'existe, et ce lot n'en
crée pas.
Chantier : `PILOT_LEGAL_AND_OPERATING_PROCEDURES_V1`
Prérequis de lecture : `docs/pilote/PROCEDURE_EXPORT_PERSONNE.md`, ADR-068.

## Avertissement, et il est la partie la plus importante de ce document

**Aucun `DELETE` improvisé en production.** Les commandes de ce document sont écrites pour un
**environnement contrôlé** : accès direct à la base, par l'exploitant, après décision écrite, et
sous transaction. Elles ne sont ni un script, ni une routine, et aucune ne doit être copiée dans un
terminal de production sans avoir relu les étapes 0 à 3.

Le produit n'offre aucun chemin de suppression : il n'y
a ni action serveur, ni route, ni écran, ni script. Les douze clés étrangères qui pointent vers
`contacts` sont **toutes en `NO ACTION`** : un `DELETE FROM contacts` échoue tant qu'une
dépendance existe, et chaque dépendance doit être traitée explicitement, dans l'ordre.

Vérifié en base :

```
acquereurs.contact_id            NO ACTION      parties_mandat.contact_id        NO ACTION
prospects_vendeurs.contact_id    NO ACTION      parties_projet.contact_id        NO ACTION
interactions.contact_id          NO ACTION      champs_verrouilles.contact_id    NO ACTION
taches.contact_id                NO ACTION      references_externes.contact_id   NO ACTION
signatures_bon_visite.contact_id NO ACTION      contact_fusions.*                NO ACTION
contacts.fusionne_dans_contact_id NO ACTION
```

Un effacement est **irréversible** et n'est pas transactionnel vis-à-vis des fichiers : la base et
le système de fichiers ne partagent aucune transaction. Supprimer une ligne ne supprime pas le
fichier, et supprimer un fichier ne se défait pas par un `ROLLBACK`.

## Étape 0 — Décider, avant d'exécuter

Une demande d'effacement n'entraîne pas mécaniquement un effacement. Avant tout acte :

1. **Identifier la personne** et obtenir son `contacts.id`. Ne jamais travailler sur un nom.
2. **Exporter d'abord** (`PROCEDURE_EXPORT_PERSONNE.md`). Un effacement sans export préalable
   détruit la seule trace de ce qui a été effacé.
3. **Vérifier les motifs de conservation** : pièce nécessaire à une preuve, à une obligation
   applicable, à la défense de droits. Un bon de visite signé relève de la politique
   `SIGNED_VISIT_FORM`, conservation probatoire retenue de cinq ans.
4. **Vérifier les legal holds actifs** — étape 1 ci-dessous, bloquante.
5. **Décider par écrit** le périmètre exact : effacement total, ou effacement des seules données
   actives avec maintien de l'archive probatoire. Les deux sont des actes différents.

## Étape 1 — Contrôle bloquant : legal holds actifs

La base **ne protège pas** les cibles sous legal hold : la table `legal_holds` ne porte aucune clé
étrangère vers sa cible, par conception (ADR-068 §3). La protection ne tient que par la
consultation du registre — c'est-à-dire par cette étape.

Vérifié sur base jetable : la suppression de la chaîne d'un acquéreur emporte ses visites et ses
bons de visite par cascade, **et laisse les lignes `legal_holds` en place, pointant vers une cible
disparue.** La base n'émet aucune erreur. Rien n'arrêtera un effacement qui n'aurait pas lu ce
registre.

```sql
-- CONTRÔLE BLOQUANT. Toute ligne retournée interdit de poursuivre.
SELECT lh.motif_code, lh.entity_id, lh.pose_le
FROM legal_holds lh
WHERE lh.leve_le IS NULL
  AND lh.workspace_id = :workspace_id
  AND lh.entity_type  = 'bons_visite'
  AND lh.entity_id IN (
    SELECT bv.id::text
    FROM bons_visite bv
    JOIN visites v     ON v.id = bv.visite_id
    JOIN acquereurs a  ON a.id = v.acquereur_id
    WHERE a.contact_id = :contact_id
  );
```

Si une ligne est retournée : **arrêter.** La levée d'un hold est une décision motivée, distincte,
qui suit `docs/pilote/PROCEDURE_LEGAL_HOLD.md`. Elle n'est jamais un préalable technique qu'on
expédie pour débloquer un effacement.

## Étape 2 — Inventaire des rattachements

Compteurs seulement : aucune donnée personnelle n'est affichée.

```sql
SELECT 'acquereurs' t, count(*) FROM acquereurs WHERE contact_id = :contact_id
UNION ALL SELECT 'prospects_vendeurs',    count(*) FROM prospects_vendeurs    WHERE contact_id = :contact_id
UNION ALL SELECT 'interactions',          count(*) FROM interactions          WHERE contact_id = :contact_id
UNION ALL SELECT 'taches',                count(*) FROM taches                WHERE contact_id = :contact_id
UNION ALL SELECT 'parties_projet',        count(*) FROM parties_projet        WHERE contact_id = :contact_id
UNION ALL SELECT 'parties_mandat',        count(*) FROM parties_mandat        WHERE contact_id = :contact_id
UNION ALL SELECT 'champs_verrouilles',    count(*) FROM champs_verrouilles    WHERE contact_id = :contact_id
UNION ALL SELECT 'references_externes',   count(*) FROM references_externes   WHERE contact_id = :contact_id
UNION ALL SELECT 'signatures_bon_visite', count(*) FROM signatures_bon_visite WHERE contact_id = :contact_id
UNION ALL SELECT 'contact_fusions',       count(*) FROM contact_fusions
  WHERE contact_survivant_id = :contact_id OR contact_absorbe_id = :contact_id
UNION ALL SELECT 'contacts_fusionnes_vers', count(*) FROM contacts WHERE fusionne_dans_contact_id = :contact_id
ORDER BY 1;
```

Lire ce qui en découle avant d'agir :

- `contact_fusions` non vide signifie que l'identité de la personne a été **recopiée en jsonb** dans
  le journal de fusion (`identite_avant_survivant`, `identite_avant_absorbe`, `identite_finale`).
  Supprimer la ligne de `contacts` sans supprimer celle-là laisserait la PII en base.
- `signatures_bon_visite` non vide signifie une **signature manuscrite** et un **PDF** sur le
  système de fichiers.

## Étape 3 — Relever les clés de stockage AVANT toute suppression

Les pointeurs vers les fichiers sont en base. Les supprimer d'abord rend les fichiers
irrécupérables et introuvables.

```sql
SELECT 'document' AS genre, d.cle_stockage
FROM documents_bien d
WHERE d.acquereur_id        IN (SELECT id FROM acquereurs        WHERE contact_id = :contact_id)
   OR d.prospect_vendeur_id IN (SELECT id FROM prospects_vendeurs WHERE contact_id = :contact_id)
UNION ALL
SELECT 'document', s.signature_cle_stockage
FROM signatures_bon_visite s WHERE s.contact_id = :contact_id
UNION ALL
SELECT 'document', d.cle_stockage
FROM documents_bien d
WHERE d.id IN (
  SELECT bv.document_id FROM bons_visite bv
  JOIN visites v    ON v.id = bv.visite_id
  JOIN acquereurs a ON a.id = v.acquereur_id
  WHERE a.contact_id = :contact_id AND bv.document_id IS NOT NULL
);
```

Conserver cette liste hors base, le temps de la procédure. Les clés sont des UUID opaques : elles
ne révèlent aucun nom.

## Étape 4 — Suppression, en transaction, dans cet ordre

Ordre établi par le graphe de dépendances réel et **vérifié sur base jetable**. Ne pas le
réordonner : chaque ligne existe parce qu'une clé étrangère `NO ACTION` l'exige.

```sql
BEGIN;
DELETE FROM references_externes   WHERE contact_id = :contact_id;
DELETE FROM champs_verrouilles    WHERE contact_id = :contact_id;
DELETE FROM interactions          WHERE contact_id = :contact_id;
DELETE FROM taches                WHERE contact_id = :contact_id;
DELETE FROM parties_projet        WHERE contact_id = :contact_id;
DELETE FROM parties_mandat        WHERE contact_id = :contact_id;
DELETE FROM signatures_bon_visite WHERE contact_id = :contact_id;
DELETE FROM contact_fusions       WHERE contact_survivant_id = :contact_id
                                     OR contact_absorbe_id  = :contact_id;
UPDATE contacts SET fusionne_dans_contact_id = NULL, fusionne_le = NULL
  WHERE fusionne_dans_contact_id = :contact_id;
DELETE FROM prospects_vendeurs    WHERE contact_id = :contact_id;
DELETE FROM acquereurs            WHERE contact_id = :contact_id;
DELETE FROM contacts              WHERE id = :contact_id;
COMMIT;
```

Ce que les cascades emportent **automatiquement** avec `acquereurs` : `secteurs_recherche_acquereur`,
`reperes_relationnels_acquereur`, `visites`, `comptes_rendus_visite`, `offres`, `compromis`,
`taches` rattachées, puis en chaîne `bons_visite` (via `visites`), `signatures_bon_visite` (via
`bons_visite`), `offre_visites`, `remuneration`. Avec `prospects_vendeurs` :
`notes_prospect_vendeur` et ses tâches.

Ce que les cascades **ne font pas** : `documents_bien.acquereur_id` et
`documents_bien.prospect_vendeur_id` passent en `SET NULL` — la ligne du document et son fichier
**restent**. `bons_visite.document_id` est aussi en `SET NULL` : supprimer le bon ne supprime pas
le PDF.

Si le `COMMIT` échoue sur une violation de clé étrangère, c'est qu'une dépendance non listée
existe. **Ne pas improviser un `DELETE` supplémentaire** : revenir à l'étape 2, identifier la
table, et mettre à jour cette procédure.

## Étape 5 — Documents restants

Les documents rattachés au **bien** et non à la personne ne sont pas emportés. Les traiter exige
une décision : un diagnostic technique, un titre de propriété ou une pièce d'identité versée au
dossier d'un bien n'ont pas le même sort.

Pour chaque ligne à supprimer, et seulement après décision écrite. Relever la clé de stockage
**avant** la suppression, et sous transaction : sans la clé, le fichier devient introuvable.

```sql
BEGIN;
-- 1. Relever la clé AVANT de supprimer la ligne, et la conserver hors base.
SELECT id, cle_stockage, type_document FROM documents_bien WHERE id = :document_id;
-- 2. Supprimer, et vérifier qu'une seule ligne est touchée avant de valider.
DELETE FROM documents_bien WHERE id = :document_id;
COMMIT;   -- ROLLBACK si le DELETE n'a pas touché exactement une ligne
```

Puis supprimer le fichier correspondant. La primitive existe
(`apps/web/src/lib/stockage/suppressionFichier.ts:71`, `supprimerFichierStocke({genre, cleStockage})`)
mais **n'a aucun appelant** : elle n'est pas invocable depuis le produit. En environnement
contrôlé, la suppression se fait sur le système de fichiers, sous la racine
`ATLAS_DOCUMENT_STORAGE_DIR` :

```
<racine>/<cleStockage>                       documents, PDF de bon de visite, PNG de signature
<racine>/photos/originaux/<cleStockage>      photos originales
<racine>/photos/optimisees/<cleStockage>.webp photos optimisées
```

Ne jamais construire ce chemin à partir d'un nom fourni par un utilisateur : les noms physiques sont
des UUID opaques générés par l'application.

## Étape 6 — Vérification

```sql
SELECT (SELECT count(*) FROM contacts              WHERE id         = :contact_id) AS contact,
       (SELECT count(*) FROM acquereurs            WHERE contact_id = :contact_id) AS acquereurs,
       (SELECT count(*) FROM prospects_vendeurs    WHERE contact_id = :contact_id) AS prospects,
       (SELECT count(*) FROM interactions          WHERE contact_id = :contact_id) AS interactions,
       (SELECT count(*) FROM signatures_bon_visite WHERE contact_id = :contact_id) AS signatures,
       (SELECT count(*) FROM contact_fusions
          WHERE contact_survivant_id = :contact_id OR contact_absorbe_id = :contact_id) AS fusions;
```

Tous les compteurs à zéro. Puis vérifier que les fichiers relevés à l'étape 3 ont disparu.

## Ce qui survit à l'effacement, et doit être dit à la personne

1. **Les lignes `legal_holds` restent**, y compris lorsque leur cible a disparu. C'est voulu : un
   registre de conservation qui perd ses lignes avec la pièce ne prouve rien. Elles ne contiennent
   ni nom, ni adresse, ni courriel — seulement un identifiant pseudonyme d'opérateur, un code de
   motif et un texte décrivant l'affaire. **Si ce texte contient une donnée personnelle, c'est une
   erreur de saisie, et aucun contrôle technique ne s'y oppose.**
2. **`actions_retention` et `runs_retention`** conservent des identifiants d'entités détectées, sans
   aucune donnée personnelle par conception.
3. **Les sauvegardes antérieures** contiennent toujours la personne. Elles ne sont pas réécrites,
   et aucune procédure ne les expurge. Leur rotation est de quatorze artefacts par type.
4. **Les messages déjà envoyés** depuis la messagerie du conseiller ne sont pas affectés : ils sont
   dans sa boîte, hors de l'application.
5. **Le journal `envois_email`** conserve le destinataire en clair. Il n'est rattaché à aucun
   contact par clé étrangère, donc jamais emporté. Le supprimer exige un ciblage par adresse :

```sql
-- Décision distincte : ce journal est la trace des envois. Le supprimer efface aussi la preuve
-- qu'un message a été adressé. Compter d'abord, supprimer ensuite, sous transaction.
BEGIN;
SELECT count(*) FROM envois_email
  WHERE workspace_id = :workspace_id AND destinataire_email = :email;
DELETE FROM envois_email
  WHERE workspace_id = :workspace_id AND destinataire_email = :email;
COMMIT;   -- ROLLBACK si le nombre de lignes supprimées ne correspond pas au comptage
```

## Test réalisé

Base jetable `atlas_proc_v1`, PostgreSQL 16, schéma complet par `drizzle-kit migrate`, données
**synthétiques** (`SYNTH-*`, adresses `@example.invalid`). Aucune donnée réelle, aucune PII affichée.

| Contrôle | Résultat |
|---|---|
| `DELETE FROM contacts` sur un contact référencé | échoue sur `acquereurs_contact_id_contacts_id_fk` |
| Inventaire des onze rattachements | exécuté, compteurs seuls |
| Détection de legal holds actifs sur les bons rattachés | 2 holds détectés, effacement arrêté |
| Suppression de la chaîne malgré un hold (transaction annulée) | la base n'oppose rien : 0 bon restant, 2 holds devenus orphelins |
| Séquence complète de l'étape 4 après levée motivée | `COMMIT` sans erreur |
| Vérification finale | contact 0, acquéreurs 0, visites 0, bons de visite 0 |
| Registre des holds après effacement | 3 lignes conservées, cible disparue |

## À valider par un juriste

1. **Effacement total contre maintien de l'archive probatoire.** Un bon de visite signé doit-il
   survivre à une demande d'effacement, et sur quel fondement exactement. ADR-065 retient cinq ans
   comme politique probatoire de DOMIORA, pas comme durée légale. [Non vérifié]
2. **Les sauvegardes.** Ne pas les expurger est le choix actuel. Sa recevabilité n'a pas été
   évaluée.
3. **Le journal des fusions.** Il recopie l'identité. Le supprimer détruit la traçabilité d'une
   fusion, le conserver maintient la PII. Arbitrage à rendre.
4. **Délai de traitement.** La procédure est manuelle et dépend de la disponibilité de l'exploitant.
   Aucun engagement de délai n'est tenable aujourd'hui.

## Décisions produit requises

1. **Qui exécute.** Cette procédure demande un accès direct à la base de production. Elle ne peut
   pas être déléguée au conseiller.
2. **Traçabilité de l'acte.** Rien n'enregistre qu'un effacement a eu lieu : ni table, ni journal.
   Tenir un registre hors produit, ou attendre `DATA_SUBJECT_RIGHTS_V1`.
3. **Pseudonymisation plutôt que suppression.** Aucune colonne d'anonymisation n'existe dans le
   schéma (vérifié : ni `anonymise_le`, ni `pii_purgee`). L'ajouter serait un lot de code, pas une
   procédure.
