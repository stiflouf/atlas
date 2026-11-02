# Procédure manuelle d'export des données d'une personne

Statut : procédure **testée sur base jetable**. Aucun export de portabilité n'existe dans le
produit, et ce lot n'en crée pas.
Chantier : `PILOT_LEGAL_AND_OPERATING_PROCEDURES_V1`

## Ce qui existe déjà, et pourquoi ça ne suffit pas

Le seul export composite du produit est le **Pack Notaire** : un ZIP des pièces d'un **bien**, avec
un manifeste texte (`POST /api/biens/[id]/pack-notaire`). Il porte sur un dossier de transaction,
jamais sur une personne. Le code le dit lui-même :

```
cle: "PORTABILITE", outillageProduit: "NON_OUTILLE",
contrainteTechnique: "L'export documentaire existant porte sur le dossier d'un bien,
                      jamais sur les données d'une personne."
```

Il n'existe aucun export CSV ni JSON dans le dépôt. Les trois seules routes de téléchargement
servent un document, un PDF de bon de visite, ou une photo — une pièce à la fois.

## Portée de cette procédure

Elle produit **un document JSON unique** rassemblant ce qui est rattaché à une personne, et la
**liste des fichiers** la concernant. Elle ne produit pas une archive : le rassemblement des
fichiers est un geste manuel décrit à l'étape 3.

Elle sert deux besoins distincts qu'il ne faut pas confond:

- **droit d'accès** — dire à la personne ce qui est traité à son sujet ;
- **droit à la portabilité** — lui remettre dans un format structuré ce qu'elle a fourni.

Le JSON produit couvre plus que la portabilité : il contient aussi des appréciations rédigées par le
conseiller (notes, comptes rendus, repères relationnels). **Avant remise, décider ce qui est
communiqué**, car une note interne n'est pas une donnée fournie par la personne, et peut concerner
des tiers.

## Étape 1 — Identifier la personne

Obtenir `contacts.id` et le `workspace_id`. Ne jamais travailler sur un nom : les homonymes et les
contacts fusionnés rendent cette approche fausse.

Si la personne a été absorbée par une fusion, son identifiant historique reste valide et
`contacts.fusionne_dans_contact_id` pointe le survivant. Exporter **les deux** : la demande porte
sur la personne, pas sur une ligne de base.

```sql
SELECT id, fusionne_dans_contact_id, fusionne_le IS NOT NULL AS absorbe
FROM contacts WHERE id = :contact_id AND workspace_id = :workspace_id;
```

## Étape 2 — Export structuré

Vingt-cinq sections, toutes scopées par la personne. Exécuter en lecture seule, sur un environnement
contrôlé. La sortie est un document JSON à conserver hors base.

```sql
SELECT jsonb_pretty(jsonb_build_object(
  'export_version', 'domiora-export-personne-v1',
  'genere_le', now(),
  'workspace_id', :'workspace_id',
  'contact_id',   :'contact_id',
  'identite',  (SELECT to_jsonb(c) - 'workspace_id' FROM contacts c
                WHERE c.id = :'contact_id' AND c.workspace_id = :'workspace_id'),
  'chaine_fusion', (SELECT coalesce(jsonb_agg(to_jsonb(f)),'[]') FROM contact_fusions f
                WHERE f.contact_survivant_id = :'contact_id' OR f.contact_absorbe_id = :'contact_id'),
  'dossiers_acquereur', (SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM acquereurs a
                WHERE a.contact_id = :'contact_id' AND a.workspace_id = :'workspace_id'),
  'dossiers_prospect_vendeur', (SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM prospects_vendeurs p
                WHERE p.contact_id = :'contact_id' AND p.workspace_id = :'workspace_id'),
  'interactions', (SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM interactions i
                WHERE i.contact_id = :'contact_id'),
  'taches', (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM taches t
                WHERE t.contact_id = :'contact_id'),
  'participations_projet', (SELECT coalesce(jsonb_agg(to_jsonb(pp)),'[]') FROM parties_projet pp
                WHERE pp.contact_id = :'contact_id'),
  'participations_mandat', (SELECT coalesce(jsonb_agg(to_jsonb(pm)),'[]') FROM parties_mandat pm
                WHERE pm.contact_id = :'contact_id'),
  'references_externes', (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM references_externes r
                WHERE r.contact_id = :'contact_id'),
  'champs_verrouilles', (SELECT coalesce(jsonb_agg(to_jsonb(cv)),'[]') FROM champs_verrouilles cv
                WHERE cv.contact_id = :'contact_id'),
  'signatures_bon_visite', (SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM signatures_bon_visite s
                WHERE s.contact_id = :'contact_id'),
  'visites', (SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM visites v
                JOIN acquereurs a ON a.id = v.acquereur_id WHERE a.contact_id = :'contact_id'),
  'comptes_rendus_visite', (SELECT coalesce(jsonb_agg(to_jsonb(cr)),'[]') FROM comptes_rendus_visite cr
                JOIN acquereurs a ON a.id = cr.acquereur_id WHERE a.contact_id = :'contact_id'),
  'offres', (SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]') FROM offres o
                JOIN acquereurs a ON a.id = o.acquereur_id WHERE a.contact_id = :'contact_id'),
  'compromis', (SELECT coalesce(jsonb_agg(to_jsonb(cp)),'[]') FROM compromis cp
                JOIN acquereurs a ON a.id = cp.acquereur_id WHERE a.contact_id = :'contact_id'),
  'secteurs_recherche', (SELECT coalesce(jsonb_agg(to_jsonb(sr)),'[]') FROM secteurs_recherche_acquereur sr
                JOIN acquereurs a ON a.id = sr.acquereur_id WHERE a.contact_id = :'contact_id'),
  'reperes_relationnels', (SELECT coalesce(jsonb_agg(to_jsonb(rr)),'[]') FROM reperes_relationnels_acquereur rr
                JOIN acquereurs a ON a.id = rr.acquereur_id WHERE a.contact_id = :'contact_id'),
  'notes_prospect_vendeur', (SELECT coalesce(jsonb_agg(to_jsonb(npv)),'[]') FROM notes_prospect_vendeur npv
                JOIN prospects_vendeurs p ON p.id = npv.prospect_vendeur_id WHERE p.contact_id = :'contact_id'),
  'envois_email', (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM envois_email e
                WHERE e.workspace_id = :'workspace_id'
                  AND e.destinataire_email IN (SELECT email FROM contacts
                        WHERE id = :'contact_id' AND email IS NOT NULL)),
  'documents_rattaches', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'id', d.id, 'type_document', d.type_document,
                  'nom_fichier_original', d.nom_fichier_original,
                  'cle_stockage', d.cle_stockage, 'taille_octets', d.taille_octets)),'[]')
                FROM documents_bien d
                WHERE d.acquereur_id        IN (SELECT id FROM acquereurs        WHERE contact_id = :'contact_id')
                   OR d.prospect_vendeur_id IN (SELECT id FROM prospects_vendeurs WHERE contact_id = :'contact_id')),
  'biens_lies', (SELECT coalesce(jsonb_agg(DISTINCT b.id),'[]') FROM biens b
                WHERE b.workspace_id = :'workspace_id' AND (
                  b.id IN (SELECT m.bien_id FROM mandats m JOIN parties_mandat pm ON pm.mandat_id = m.id
                             WHERE pm.contact_id = :'contact_id')
                  OR b.id IN (SELECT v.bien_id FROM visites v JOIN acquereurs a ON a.id = v.acquereur_id
                             WHERE a.contact_id = :'contact_id'))),
  'legal_holds_actifs_sur_bons_rattaches', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'motif_code', lh.motif_code, 'entity_id', lh.entity_id, 'pose_le', lh.pose_le)),'[]')
                FROM legal_holds lh
                WHERE lh.leve_le IS NULL AND lh.workspace_id = :'workspace_id'
                  AND lh.entity_type = 'bons_visite'
                  AND lh.entity_id IN (SELECT bv.id::text FROM bons_visite bv
                        JOIN visites v    ON v.id = bv.visite_id
                        JOIN acquereurs a ON a.id = v.acquereur_id
                        WHERE a.contact_id = :'contact_id'))
)) AS export;
```

La dernière section n'est pas là par symétrie : elle indique que certaines pièces de la personne
sont sous maintien pour contentieux ou contrôle, information utile à la réponse qui lui sera faite.

## Étape 3 — Fichiers

Le JSON liste les `cle_stockage` ; il ne contient pas les fichiers. Les rassembler manuellement
depuis la racine `ATLAS_DOCUMENT_STORAGE_DIR` :

```
<racine>/<cleStockage>                        document, PDF de bon de visite, PNG de signature
<racine>/photos/originaux/<cleStockage>       photo originale
<racine>/photos/optimisees/<cleStockage>.webp photo optimisée
```

Ajouter les PDF de bons de visite de la personne, qui passent par le bien et non par elle :

```sql
SELECT bv.id, d.cle_stockage, d.nom_fichier_original, bv.hash_document
FROM bons_visite bv
JOIN visites v     ON v.id = bv.visite_id
JOIN acquereurs a  ON a.id = v.acquereur_id
JOIN documents_bien d ON d.id = bv.document_id
WHERE a.contact_id = :contact_id AND bv.document_id IS NOT NULL;
```

Le nom physique est un UUID sans extension ; le nom d'origine et le type MIME sont en base. Renommer
à la copie, ne jamais renommer à la source.

## Étape 4 — Contrôle de couverture

Les seules tables du schéma portant `nom`, `prenom`, `email` ou `telephone` **sans** clé étrangère
vers `contacts` sont, vérifié en base :

| Table | Pourquoi elle n'est pas dans l'export d'une personne |
|---|---|
| `documents_bien` | couverte indirectement par `acquereur_id` / `prospect_vendeur_id` et par `biens_lies` |
| `workspace_membres` | données du conseiller utilisateur, pas d'une personne concernée |
| `workspaces` | identité du responsable du traitement |

Les autres porteurs de PII sont tous atteints par l'une des vingt-cinq sections.

## Limites réelles de cet export

1. **`envois_email` est rattaché par adresse, pas par clé étrangère.** La table n'a pas de
   `contact_id`. Si la personne a changé d'adresse, les envois à l'ancienne ne sont pas retrouvés.
2. **Les textes libres rattachés au bien ne sont pas inclus** : `notes_bien` appartient au bien. Une
   note sur un bien peut nommer la personne sans qu'aucune clé ne le dise. `biens_lies` donne les
   biens à inspecter ; l'inspection est manuelle.
3. **`memoire_contextuelle` n'est pas exportée** : elle ne porte aucun nom en clair, seulement des
   identifiants d'événements Google et des empreintes.
4. **Les snapshots figés** (`bons_visite.contenu_snapshot`,
   `transmissions_dossier_notaire.manifeste_snapshot`) contiennent du texte substitué, exporté avec
   leur ligne mais non analysé champ par champ.
5. **Aucune pagination** : les interactions sont exportées intégralement, contrairement au read model
   du produit qui en limite dix.

## Test réalisé

Base jetable `atlas_proc_v1`, données synthétiques. Requête exécutée, sortie JSON valide, parsée
sans erreur. **Seules les clés et la volumétrie ont été affichées** : aucun contenu de champ n'a été
imprimé pendant le test.

| Contrôle | Résultat |
|---|---|
| Exécution de la requête complète | code de sortie 0 |
| JSON produit valide | 25 clés de premier niveau |
| Section `identite` | renseignée, 9 champs, `workspace_id` retiré |
| Rattachements détectés | 1 dossier acquéreur, 1 visite |
| Détection des legal holds | 2 holds actifs signalés |
| Rattachement indirect par le bien | 1 bien lié retrouvé via la visite |
| Contrôle de couverture PII | 3 tables hors périmètre, toutes justifiées |

## À valider par un juriste

1. **Ce qui est communiqué à la personne.** Le JSON contient les appréciations du conseiller et des
   mentions possibles de tiers. Le périmètre de la communication relève d'un arbitrage, non d'une
   requête SQL.
2. **Format de remise.** Le JSON est structuré et lisible par machine. Sa recevabilité comme format
   de portabilité n'a pas été évaluée. [Non vérifié]
3. **Vérification de l'identité du demandeur.** Aucune procédure ne l'encadre.
4. **Délai.** La procédure est manuelle.

## Décisions produit requises

1. **Pseudonymiser ou non les identifiants techniques** avant remise. Ils sont inclus tels quels.
2. **Remettre ou non les fichiers.** L'étape 3 est manuelle et peut représenter un volume
   important. Aucun mécanisme d'archive n'existe.
3. **Conserver ou non une copie de l'export remis.** Un export conservé est une duplication de PII
   de plus, hors du périmètre de toute politique de conservation.
