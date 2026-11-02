# Gate d'entrée des données réelles

Chantier : `PILOT_INSTANCE_PROVISIONING_V1`

```
REAL_DATA_GATE   = CLOSED
REAL_DATA_ALLOWED = NO
```

## Ce que ce gate est, et ce qu'il n'est pas

C'est un **gate opérationnel**. Une décision humaine, tenue par ce document et par la discipline de
l'exploitant.

**Aucun contrôle technique n'interdit la saisie d'une donnée réelle dans DOMIORA.** Il faut l'écrire
sans détour, parce que croire le contraire est le seul vrai danger ici :

- aucune validation ne distingue un nom réel d'un nom synthétique ;
- aucun champ n'est marqué « donnée de test » ;
- `documents_bien.type_document` accepte `cni`, `rib` et `justificatif_domicile` sans condition ;
- rien ne bloque la saisie d'une adresse, d'un téléphone ou d'une adresse électronique réelle ;
- la seule garde technique existante est l'allowlist d'accès (`ATLAS_ALLOWED_EMAIL`, fail-closed par
  `throw` si absente, `apps/web/src/lib/auth/allowlist.ts`) : elle décide **qui entre**, jamais
  **quoi est saisi**.

Une instance ouverte à une identité autorisée est une instance où une donnée réelle peut être saisie
à la première frappe. Le gate n'y fait obstacle d'aucune manière technique ; il dit que personne n'y
est autorisé tant que les cinq conditions ci-dessous ne sont pas levées.

## Les cinq conditions

Toutes doivent être levées. Aucune ne se compense.

| # | Condition | Nature | Statut |
|---|---|---|---|
| 1 | Identité juridique du responsable du traitement renseignée | décision produit + saisie | **non levée** |
| 2 | Canal de remise de la notice décidé | décision produit | **non levée** |
| 3 | Périmètre des données autorisées pendant le pilote décidé | décision produit | **non levée** |
| 4 | Notice validée sur l'absence de durée chiffrée | validation juriste | **non levée** |
| 5 | Nature de l'accord pilote validée | validation juriste | **non levée** |

### 1. Identité juridique du responsable du traitement

Les treize colonnes `controller_*` / `privacy_*` / `dpo_*` de `workspaces` sont à `NULL`. Six sont
le minimum pour qu'une notice puisse nommer qui traite les données
(`CHAMPS_REQUIS_POUR_NOTICE`, `apps/web/src/lib/privacy/identiteResponsable.ts`).

Levée quand `etatIdentiteResponsable()` rend `PRETE_POUR_LA_NOTICE` sur l'instance concernée.
Formulaire : `docs/pilote/IDENTITE_RESPONSABLE_TRAITEMENT.md`.

**Aucune valeur fictive ne doit être saisie dans ces colonnes**, y compris pour « débloquer » un
test : elles désignent un responsable face aux personnes concernées.

### 2. Canal de remise de la notice

Aucun écran ne présente la notice : `PUBLIC_PRIVACY_PAGE_ENABLED = false`,
`SHORT_NOTICE_AT_BON_VISITE_ENABLED = false`. La remise est aujourd'hui un geste humain, et rien ne
l'enregistre.

Levée quand le canal est arrêté par écrit (pièce jointe, document papier, ou report jusqu'à
`PRIVACY_NOTICE_DELIVERY_V1`) et que la question de la traçabilité de la remise est tranchée, même
par un « non tracé pendant le pilote » explicite.

### 3. Périmètre des données autorisées

Le schéma accepte plus que ce qu'un pilote devrait recevoir. Décider nommément ce qui est autorisé,
et en particulier si les pièces d'identité, les justificatifs de domicile et les coordonnées
bancaires entrent dans le périmètre.

Levée quand la liste est écrite, et transmise au conseiller.

### 4. Notice validée sur l'absence de durée chiffrée

Le projet de notice n'annonce aucune durée, parce que le produit n'en applique aucune :
`RETENTION_ENFORCEMENT_V1_LIVRE = false`, `APPLY_SUPPORTED = false`, et trois catégories de
conservation restent `UNDECIDED`. Dire « jusqu'à suppression décidée » est exact ; sa recevabilité
n'a pas été évaluée.

Levée par une validation juridique explicite de ce choix de rédaction, ou par la fourniture de la
formulation à retenir. Projet : `docs/pilote/NOTICE_INFORMATION_PERSONNES.md`.

### 5. Nature de l'accord pilote validée

Convention de test, contrat de prestation, mise à disposition : la qualification n'est pas tranchée,
et aucun acte encadrant le traitement que l'exploitant réalise pour le compte du conseiller
n'existe.

Levée par une validation juridique de la nature du document et de sa signature.
Projet : `docs/pilote/ACCORD_PILOTE_CONSEILLER.md`.

## Pendant que le gate est fermé

Autorisé : provisionner et valider l'infrastructure, appliquer les migrations, vérifier la sonde de
santé, sauvegarder et restaurer, et exercer le parcours critique avec des données **exclusivement
synthétiques**.

Convention de synthèse, à respecter sans exception :

```
noms et références   SYNTH-*
adresses électroniques   *@example.invalid
adresses postales    aucune adresse réelle, même partielle
documents            aucun document immobilier, fiscal ou d'identité réel
messages             aucun contenu lié à un dossier client réel
```

Interdit tant que le gate est fermé : vendeur réel, acquéreur réel, adresse personnelle réelle,
numéro fiscal, pièce d'identité, coordonnées bancaires, justificatif, document immobilier réel,
contenu de messagerie lié à un dossier client.

## Lever le gate

La levée est un acte écrit, daté, qui nomme les cinq conditions et la preuve de leur levée. Elle met
à jour l'en-tête de ce document :

```
REAL_DATA_GATE    = OPEN
REAL_DATA_ALLOWED = YES
```

Tant que cet en-tête porte `CLOSED`, la saisie d'une donnée réelle est une infraction à une décision
d'exploitation, pas une erreur technique — et aucune garde ne la signalera.

## Ce qui n'est pas une condition de ce gate

Pour éviter qu'il serve à bloquer autre chose que ce qu'il couvre :

- la connexion Google du conseiller — utile au pilote, sans rapport avec l'entrée des données
  réelles ;
- la destination de sauvegarde hors site (`OFFSITE_BACKUP_DESTINATION = DECISION_REQUIRED`) — à
  trancher, mais traitée par `docs/pilote/PROCEDURE_SAUVEGARDE_RESTAURATION.md` ;
- l'outillage des droits des personnes — les procédures manuelles existent et suffisent au pilote ;
- la surface Legal Hold (`LEGAL_HOLD_PRODUCTION_PATH = DECISION_REQUIRED`) — tenable hors produit
  tant qu'aucun mécanisme de suppression n'existe.
