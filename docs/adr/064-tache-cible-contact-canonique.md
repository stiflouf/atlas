# ADR-064 — Une tâche peut cibler un contact canonique

**Statut :** Accepté — **IMPLEMENTED** (`TASK_CONTACT_TARGET_V1`, migration 0058).

**Date :** 2026-10-05
**Décideurs :** Steven Gausset (CEO), CTO.

> Dépend de : **ADR-028** (moteur de tâches : cibles dédiées + `CHECK` « au plus une »),
> **ADR-031** (communications assistées : intention / faits / brouillon / validation / envoi, et
> l'interdiction d'inférer un destinataire depuis un texte libre),
> **ADR-055 §A** (Contact = identité canonique, sans rôle ni donnée de projet),
> **ADR-057** (identité effective : le repli est au niveau de l'agrégat, jamais du champ),
> **ADR-058** (le Contact est l'unité de recherche humaine),
> **ADR-059** (fusion humaine traçable : un contact absorbé est figé, §10),
> **ADR-054** (appartenance workspace).

## Contexte

Un conseiller crée une tâche « envoyer un mail à Jean Dupont ». Jean Dupont n'est ni un acquéreur,
ni un prospect vendeur, ni rattaché à un bien : c'est simplement une personne de son carnet. La
tâche se crée sans cible, et DOMIORA ne propose pas « Préparer un email ».

Ce comportement était **correct** : `resoudreContexteCommunicationDepuisTache` ne suit que les FK
réelles de la tâche et ne devine jamais une personne depuis le titre ou le contexte (ADR-031,
correction n°1). Le manque n'était pas dans la règle, il était dans le **modèle** : les huit cibles
de `taches` étaient toutes des DOSSIERS (bien, acquéreur, prospect vendeur, compte rendu, offre,
compromis, rémunération, visite), et aucune n'était la personne elle-même — alors que DOMIORA
possède désormais une identité canonique (ADR-055 §A) et sa recherche (ADR-058).

Une tâche qui ne concerne qu'une personne devait donc emprunter un dossier qui n'existe pas. Créer
un acquéreur fictif pour pouvoir envoyer un email affirmerait une intention d'acquisition que
personne n'a constatée.

## Décision

| Clé | Décision |
|---|---|
| `TASK_TARGET_MODEL` | **Inchangé** : FK nullables dédiées + `CHECK` « au plus une cible ». `contact_id` est la NEUVIÈME colonne de ce patron, pas une nouvelle abstraction. Aucun couple polymorphe `{type, id}` n'est introduit — ADR-028 et ADR-055 §G l'écartent tous deux, l'intégrité référentielle primant sur la généricité. |
| `TASK_CONTACT_TARGET` | `taches.contact_id UUID NULL` → `contacts.id`, **sans `ON DELETE CASCADE`** contrairement aux huit autres cibles : `contacts` ne connaît pas la suppression (ADR-059 — une fusion est un marqueur, jamais un `DELETE`), et les dix autres FK vers `contacts.id` du schéma sont elles aussi en `no action`. |
| `TASK_CONTACT_SUFFICIENCY` | Une tâche rattachée au SEUL contact se suffit. Elle n'exige ni acquéreur, ni prospect vendeur, ni bien pour que « Préparer un email » soit proposé. |
| `NO_INFERENCE_FROM_FREE_TEXT` | **Confirmé, pas levé.** Aucun destinataire n'est jamais déduit du titre, du contexte, d'une note ou d'une adresse écrite à la main. La cible est choisie explicitement par un humain, et revérifiée côté serveur. |
| `WRITE_GUARD` | La cible contact est validée **sous verrou, dans la transaction de l'INSERT**, par `verrouillerContactActif` — la primitive déjà partagée par tous les writers qui reçoivent un `contact_id`. Session, workspace, existence et état de fusion sont vérifiés. Hors périmètre : « introuvable », message identique à celui d'un id inexistant. |
| `MERGED_CONTACT_AT_WRITE` | Une tâche ne peut **pas** être créée sur un contact absorbé (ADR-059 §10 : aucune donnée vivante ne s'y rattache). Refus explicite, jamais une réécriture silencieuse vers le survivant — réécrire masquerait un appelant qui travaille sur un état périmé. |
| `MERGED_CONTACT_AT_READ` | À la LECTURE, le destinataire est résolu par `resoudreContactActif` (ADR-059) : une tâche posée sur A avant que A ne soit absorbé par B propose **B**. La colonne de la tâche n'est jamais réécrite — la résolution est une lecture, pas une migration. La logique de fusion n'est pas réimplémentée dans le module tâche. |
| `RECIPIENT_TYPE` | `DestinataireCandidat` gagne un troisième type, `"contact"`. Pour l'envoi Gmail (ADR-031-bis / ADR-055 §G), il n'y a **aucun pont à franchir** : l'id EST le `contact_id`. Il est malgré tout relu dans le périmètre avant écriture, car il arrive d'un champ caché du formulaire. |
| `COMMUNICATION_INTENTION` | Une dixième intention, `message_contact`, **sans aucun fait** : objet vide, aucun paragraphe, seulement la salutation au nom du destinataire et la formule de politesse. Un contact n'est pas un dossier — il n'y a ni bien, ni date, ni montant à énoncer. Le repli historique (`relance_prospect_vendeur`) aurait écrit « Suivi de votre projet de vente » à une personne dont DOMIORA ne sait pas qu'elle vend. |
| `NO_EMAIL_BEHAVIOR` | Un contact sans email reste une cible valide : la tâche existe, le candidat est résolu, et **aucune adresse n'est inventée** — jamais celle d'un ancien dossier (ADR-057 : le repli est au niveau de l'agrégat, pas du champ). Le formulaire part sans destinataire, comme pour un prospect vendeur sans email. L'absence est affichée dès le choix du contact. |
| `SELECTION_UX` | Le choix du contact passe par une **recherche serveur** réutilisant `rechercherContacts` (ADR-058 : filtre de workspace obligatoire, ranking déterministe, exclusion SQL des absorbés), jamais par un `<select>` chargeant tout le carnet. La cible soumise est un `<input type="hidden">` ; le champ de recherche n'a pas de `name` et ne part donc jamais au serveur. |
| `NO_BACKFILL` | Aucune tâche historique ne reçoit de contact. Rien dans son titre ou son contexte ne désigne une personne de façon structurée ; l'en déduire une serait exactement l'inférence que cette ADR interdit. |

## Hors périmètre, volontairement

- **Aucun centre global des tâches**, et aucune section « tâches » sur la fiche contact. La fiche
  gagne seulement un point d'entrée (`+ Nouvelle tâche` → `/taches/nouveau?contactId=…`) : afficher
  les tâches d'un contact est une surface à part entière, pas un effet de bord de ce lot.
- **Aucune cible « partie de projet », « mandat » ou « interaction »** : ce lot ajoute la personne,
  pas une neuvième façon de désigner un dossier.
- **Aucun rattachement automatique** d'une tâche existante à un contact, par email ou par nom.
- **Aucune intention métier nouvelle** au-delà de `message_contact` : une tâche contact ne parle
  d'aucun projet, et DOMIORA ne lui en invente pas un.

## Conséquences

- `taches` porte neuf cibles et le `CHECK` neuf indicatrices. Toute surface qui dérive la cible
  (`deriverCibleTache`, `deriverRouteFicheCible`, « Voir la fiche », « Préparer un email ») accepte
  le nouveau type sans modification propre à elle : c'est le bénéfice du patron existant.
- Les huit cibles antérieures sont strictement inchangées, en base comme en comportement.
- Le flux de communication connaît trois types de destinataires. Les consommateurs qui testaient
  `type === "acquereur"` ou `type === "prospectVendeur"` (repères relationnels, propriétaire du
  bien pour la reformulation, note ADR-027) restent **fermés par défaut** sur `"contact"` : aucun
  d'eux ne traite un contact comme un acquéreur ou un vendeur par accident.

## Scalabilité

Le choix du contact est une recherche paginée et bornée (8 suggestions), déclenchée par un geste
explicite — jamais une requête par caractère tapé, jamais un chargement du carnet entier dans le
HTML du formulaire. C'est précisément ce qu'un `<select>` aurait fait échouer à 10 000 contacts.
La colonne ajoutée est nullable et sans index : elle ne sert aujourd'hui aucune liste filtrée par
contact. Le jour où la fiche contact listera ses tâches, un index `(contact_id)` sera posé avec ce
lecteur, pas avant.

## Réversibilité

Aucune nouvelle dépendance fournisseur. La cible est une FK Postgres entre deux tables déjà
possédées, et l'intention ajoutée est un template déterministe sans LLM (ADR-008). La migration est
additive : son retrait se limiterait à restaurer le `CHECK` à huit indicatrices et à supprimer une
colonne nullable qu'aucune ligne historique n'utilise.
