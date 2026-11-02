# Identité du responsable du traitement — formulaire de recueil

Statut : formulaire vierge, prêt à remplir. Aucune valeur n'est pré-remplie, et c'est volontaire.
Chantier : `PILOT_LEGAL_AND_OPERATING_PROCEDURES_V1`
Modèle : `CONTROLLER_MODEL = WORKSPACE_LEGAL_CONTROLLER` (ADR-065 §1)
Code : `apps/web/src/lib/privacy/identiteResponsable.ts`
Écran existant : `/parametres/confidentialite` (garde `exigerOwnerWorkspaceCourant()`)

## Qui est le responsable du traitement

Le professionnel qui utilise l'instance et détermine les finalités : conseiller indépendant,
entreprise individuelle, agence, autre structure professionnelle.

**Ce n'est pas DOMIORA.** Aucune entité juridique DOMIORA n'est modélisée dans le produit, et le nom
produit est lui-même en cours de sécurisation juridique. Le code refuse tout repli : ni
`workspaces.nom`, ni `ATLAS_ADVISOR_DISPLAY_NAME`, ni « Conseiller DOMIORA » ne peuvent occuper
cette place. Une identité incomplète n'est pas affichée du tout.

À la sortie de la migration `0059_workspace_privacy_identity`, les treize colonnes sont à `NULL`
dans le workspace historique. C'est l'état correct : aucun backfill honnête n'était possible.

## Formulaire

Six champs sont le minimum pour qu'une notice soit remettable (`CHAMPS_REQUIS_POUR_NOTICE`). Les
sept autres sont facultatifs.

### Requis

| Champ | Colonne | Valeur | Contrainte |
|---|---|---|---|
| Nom légal du responsable | `controller_legal_name` | | « Prénom Nom » pour une personne physique en EI, raison sociale pour une société |
| Adresse | `controller_address_line1` | | |
| Code postal | `controller_postal_code` | | |
| Ville | `controller_city` | | |
| Pays | `controller_country_code` | | exactement deux lettres majuscules (`CHECK` en base) |
| Adresse d'exercice des droits | `privacy_rights_email` | | adresse réellement relevée ; c'est elle qui figure dans la notice |

### Facultatifs

| Champ | Colonne | Valeur | Contrainte |
|---|---|---|---|
| Forme juridique | `controller_legal_form` | | texte libre |
| Nom commercial | `controller_trade_name` | | |
| Complément d'adresse | `controller_address_line2` | | |
| SIREN | `controller_siren` | | exactement neuf chiffres si renseigné (`CHECK` en base) |
| Nom du DPO | `dpo_name` | | à ne renseigner que si un DPO est désigné |
| Adresse du DPO | `dpo_email` | | idem |

`privacy_identity_modifie_le` est posée par le produit, jamais saisie.

### Ce qui ne figure pas dans ce formulaire, volontairement

Carte professionnelle et son autorité de délivrance, réseau ou enseigne, garantie financière,
responsabilité civile professionnelle. Ces informations n'identifient pas un responsable de
traitement ; elles relèveraient de mentions légales, chantier distinct.

## Comment le saisir

Par l'écran `/parametres/confidentialite`, connecté comme propriétaire du workspace. Le périmètre
est résolu côté serveur : l'écran ne prend aucun paramètre d'URL et l'action ne lit aucun
identifiant de workspace du formulaire.

Aucune écriture directe en base n'est nécessaire, et aucune n'est recommandée : l'écran applique la
validation applicative et la garde de rôle que le SQL ne porte pas.

## Vérification après saisie

L'écran affiche l'état calculé par `etatIdentiteResponsable()` :

- `INCOMPLETE` — la liste des champs manquants est affichée ;
- `PRETE_POUR_LA_NOTICE` — le minimum est réuni.

`PRETE_POUR_LA_NOTICE` signifie que l'identité est complète, **pas** que la notice est publiable :
`blocagesPublicationNotice()` reste non vide tant que les durées de conservation ne sont pas
appliquées.

Contrôle en lecture seule, sur un environnement contrôlé, sans afficher de valeur :

```sql
SELECT id,
       controller_legal_name   IS NOT NULL AS nom_legal,
       controller_address_line1 IS NOT NULL AS adresse,
       controller_postal_code  IS NOT NULL AS code_postal,
       controller_city         IS NOT NULL AS ville,
       controller_country_code IS NOT NULL AS pays,
       privacy_rights_email    IS NOT NULL AS email_droits,
       privacy_identity_modifie_le
FROM workspaces;
```

## À valider par un juriste

1. **Qui est le responsable, exactement.** Le conseiller en nom propre, sa structure, ou le réseau
   auquel il est rattaché : le produit ne tranche pas, il enregistre ce qu'on lui déclare. Une
   déclaration erronée désignerait la mauvaise personne face aux personnes concernées.
2. **Nécessité d'un DPO.** Les champs existent, l'obligation n'a pas été évaluée. [Non vérifié]
3. **Co-responsabilité éventuelle.** Si un réseau ou une structure détermine aussi des finalités,
   le modèle à un seul responsable par workspace ne le représente pas. Non modélisé.
4. **Qualification de l'éditeur.** ADR-065 anticipe un rôle de sous-traitant pour un futur service
   exploité pour plusieurs clients. Aucun contrat de sous-traitance n'existe aujourd'hui.

## Décisions produit requises

1. **Saisir cette identité est un prérequis au pilote avec données réelles**, puisque sans elle
   aucune notice ne peut nommer le responsable. À confirmer comme condition d'entrée.
2. **Aucune vérification de l'exactitude** n'est faite par le produit : ni SIREN vérifié auprès
   d'un registre, ni adresse normalisée. Les `CHECK` portent sur la forme, jamais sur l'existence.
