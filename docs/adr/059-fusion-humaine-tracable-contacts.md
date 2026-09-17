# ADR-059 — Fusion humaine et traçable des Contacts

**Statut :** Accepté — modèle (migration `0043`), moteur repository (`fusionnerContacts`) et UI humaine (`/contacts/[id]/fusionner/[absorbeId]`, `fusionnerContactsAction`) implémentés
**Date :** 2026-09-14
**Décideurs :** Steven Gausset (CEO), CTO

> Rubriques : Contexte · Problème · Décision · Alternatives écartées · Modèle de données /
> contrats · Invariants · Conséquences · Risques · Hors périmètre · Questions ouvertes ·
> Scalabilité · Réversibilité (ADR-051).
>
> Dépend de : **ADR-055** (§A identité canonique ; §H jamais de fusion automatique, jamais de
> suppression), **ADR-057** (writer unique d'identité, verrous humains), **ADR-058** (Contact, unité
> de recherche), **ADR-054** (appartenance), **ADR-012** (archivage, jamais de DELETE).

## Contexte

Depuis ADR-055, une personne est un Contact canonique. Depuis ADR-058, on la cherche par ce
Contact ; depuis ADR-057, on corrige son identité à un seul endroit. Le lot « similarité » (2026-09)
a ajouté la détection read-only : la fiche d'un Contact signale les autres Contacts du workspace qui
partagent un email ou un téléphone normalisés, sans rien conclure.

Ce qui manque est le geste suivant : quand un humain a établi que deux Contacts décrivent bien la
même personne, il n'existe aucun moyen de le dire au produit. Deux fiches continuent de vivre,
deux historiques divergent, et chaque écran doit choisir laquelle croire.

## Problème

Une fusion est l'opération la plus destructrice qu'un CRM puisse faire sur une personne : mal
faite, elle mélange les échanges de deux humains, déplace des dossiers vers la mauvaise fiche, et
ne se défait pas. Le produit doit donc pouvoir fusionner sans jamais perdre la trace de ce qui a
été fusionné, par qui, et à partir de quoi — et refuser structurellement toute fusion que personne
n'a décidée.

Cette ADR pose le MODÈLE, les règles de lecture, le MOTEUR repository (`fusionnerContacts`,
`lib/fusionContactRepository.ts`) et l'ÉCRAN humain qui l'appelle (page de comparaison + Server
Action `fusionnerContactsAction`).

## Décision

1. **Similarité ≠ identité.** Même email, même téléphone, même nom : des faits, jamais une preuve.
   Un couple partage une adresse, une famille un numéro, deux homonymes existent.
2. **La détection reste read-only.** `trouverContactsSimilaires` signale ; rien n'est persisté, rien
   n'en découle.
3. **Toute fusion est humaine et directionnelle.** Elle désigne explicitement un SURVIVANT et un
   ABSORBÉ ; aucune heuristique (ancienneté, richesse) ne choisit à la place de l'humain.
4. **Un Contact absorbé n'est jamais supprimé.** Sa ligne reste, avec l'identité qu'il avait à la
   fusion (patron d'archivage ADR-012, transposé à l'identité).
5. **Un Contact absorbé pointe vers son survivant** : `contacts.fusionne_dans_contact_id`, avec
   `fusionne_le`. Les deux vont ensemble (CHECK), jamais vers soi-même (CHECK).
6. **Le journal de fusion est immuable** : `contact_fusions`, une ligne par fusion, écrite une fois
   — identités avant/après, choix humain champ par champ, ids déplacés par table, avertissements
   acquittés, auteur. Aucun UPDATE ni DELETE de cette table dans le produit (garde structurelle).
7. **Les instantanés legacy ne sont jamais réécrits** : `acquereurs.*` et `prospects_vendeurs.*`
   gardent leur identité de création (ADR-057). Une fusion future repointe `contact_id`, jamais les
   colonnes d'identité.
8. **Fusion inter-workspace interdite.** Survivant et absorbé appartiennent au workspace courant.
9. **Self-merge interdit** (CHECK en base, sur `contacts` et sur `contact_fusions`).
10. **Un Contact absorbé n'est plus un Contact actif, et il est FIGÉ.** Il est exclu des recherches
    actives (`rechercherContacts`, `rechercherPersonnes`), de la similarité (ni source ni candidat),
    des candidats de rattachement et des destinations de rattachement ; l'éditeur d'identité le
    traite comme introuvable et le writer `modifierIdentiteContact` le refuse lui-même. **Tout
    writer métier recevant un `contact_id`** (interaction, partie de projet, référence externe et
    verrou ciblant un contact, dossier acquéreur ou vendeur créé avec un `contactId`, rattachement)
    passe par la garde partagée `verrouillerContactActif` / `exigerContactActif`
    (`lib/contactActif.ts`) : lecture `SELECT … FOR UPDATE` dans la transaction du writer, refus
    explicite d'un absorbé (`ErreurContactFusionne`), introuvable pour un inconnu ou un autre
    workspace, **jamais de réécriture silencieuse vers le survivant**. Le verrou de ligne sérialise
    le writer avec le moteur : soit l'écriture précède la fusion et le moteur la repointe, soit elle
    la suit et voit l'absorbé. Seul le moteur repointe un absorbé (garde structurelle).
11. **Le moteur est transactionnel, avec `SELECT … FOR UPDATE`** sur les deux Contacts en une
    instruction, par id croissant (l'ordre de verrou ne dit rien de la direction de fusion) ; refus
    si l'un des deux est déjà absorbé ; refus si l'identité de l'un des deux a changé depuis son
    affichage (`identiteAttendue*`, `modifie_le` compris). C'est le seul endroit du produit où
    « dernier enregistrement gagnant » est inacceptable.
12. **La résolution d'identité finale est un choix humain champ par champ** (nom, prénom, email,
    téléphone), reçu par le moteur et VÉRIFIÉ contre les deux identités réelles
    (`survivant | absorbe | identique | absence_comblee`) : un choix qui ne produit pas la valeur
    finale est refusé (`choix_identite_invalide`). Le moteur ne choisit jamais.
13. **Aucune fusion automatique** par email, téléphone ou nom, jamais — ni à l'import, ni à la
    saisie, ni par un connecteur.
14. **Rattachement legacy et fusion Contact restent deux gestes distincts** : l'un relie un dossier
    historique à une personne (`rattachementContact`), l'autre réunit deux personnes. Ils ne
    partagent ni écran ni liste.
15. **Irréversible en V1.** Aucune défusion ; le journal (ids déplacés, identités avant) rend une
    restauration manuelle possible et une défusion V2 envisageable.

### Moteur `fusionnerContacts` (repository, sans UI)

Une transaction, dans l'ordre : verrous → invariants (périmètre, actifs, identités inchangées,
choix cohérents, avertissements acquittés) → parties de projet des projets COMMUNS dédoublées
(partie de l'absorbé supprimée ; rôle principal `acquereur`/`vendeur` préservé sur la partie
conservée, corrigé si l'absorbé le portait) → parties de mandat des mandats COMMUNS dédoublées de
la même façon (ADR-060 §16, lot `MANDATE_PARTIES_V1`, 2026-09-17 : partie de l'absorbé supprimée,
rôle retenu par priorité déterministe `mandant` > `representant` sur la partie conservée) → repoint
de `parties_projet`, `parties_mandat`, `interactions`,
`acquereurs`, `prospects_vendeurs`, `references_externes` (ids exacts retournés) → identité
finale par `modifierIdentiteContact` (no-op si identique) → `marquerContactFusionne` → journal.
Toute erreur annule tout. Avertissement obligatoire, clé déterministe recalculée sous verrou :
deux références du même (fournisseur, type) d'ids différents portées par les deux Contacts
(`reference_externe_contradictoire:<fournisseur>/<type>`) ; sans acquittement exact, aucune
écriture ; avec, les deux références sont conservées sur le survivant. Les verrous humains de
l'absorbé restent sur sa ligne. Résultat : union discriminée (`fusionne`, `meme_contact`,
`contact_introuvable`, `deja_fusionne`, `identite_modifiee_entre_temps`,
`choix_identite_invalide`, `avertissement_reference_externe_requis`, `acquittement_inconnu`).
L'acteur (`sub`, `email`) est un paramètre : aucune session dans le repository.

### UI humaine : `/contacts/[id]/fusionner/[absorbeId]`

- Entrée : bouton « Comparer » sur chaque candidat de la section « Contacts partageant un email ou
  un téléphone » de la fiche — jamais un bouton « Fusionner » depuis la fiche. La similarité est
  une aide de découverte, pas une autorisation : la page s'ouvre par URL pour n'importe quels deux
  Contacts actifs du workspace (coordonnées changées, homonyme reconnu par l'humain).
- L'URL encode la direction : premier segment = CONSERVÉ, second = ABSORBÉ ; « Inverser » navigue
  vers l'URL symétrique, sans écriture.
- Read model `preparerFusionContacts` (`lib/preparationFusionContactRepository.ts`, requêtes fixes) :
  les deux Contacts, leurs identités attendues (`modifie_le` compris), la nature de chaque champ
  (`identique` / `absence_comblee` / `conflit`), rôles et nombre de projets, verrous humains,
  impact (projets concernés = union, participations en double = intersection, interactions,
  dossiers acquéreur et vendeur, références externes de l'absorbé), avertissements par la MÊME
  analyse pure que le moteur (`lib/fusionContactAnalyse.ts`).
- Formulaire natif, sans JavaScript : un conflit = radio obligatoire sans présélection (valeur du
  conservé ou de l'absorbé) ; identique et absence comblée = champ caché typé ; aucune saisie
  libre ; badge « Modifié manuellement » sur un champ verrouillé, sans bloquer ; une checkbox
  d'acquittement par avertissement, portant la clé exacte ; confirmation finale obligatoire ;
  bouton « Fusionner les contacts ».
- Server Action : session + workspace du contexte ; confirmation exigée ; RELECTURE serveur de la
  préparation — les identités attendues transmises au moteur en viennent, jamais du navigateur ;
  la date de modification vue par la page est comparée à la relecture avant d'appeler le moteur
  (un champ caché altéré ne peut produire qu'un refus) ; identité finale DÉDUITE du choix et des
  identités relues ; UN appel au moteur, jamais de seconde tentative ; succès → fiche du
  survivant ; refus → retour sur la page de comparaison avec un code (`fusion=…`), patron des
  actions de rattachement.

### Finalisation Gmail et fusion concurrente

`finaliserEnvoiGmailReussi` résout le contact depuis `dossier.contact_id` puis crée l'interaction
sous verrou. Si le contact a été absorbé entre la construction de l'envoi et sa finalisation, le
résultat est `email_envoye_contact_fusionne` : l'email est bien parti (audit `envois_email` déjà
réussi), aucune interaction n'est écrite — ni sur l'absorbé (figé), ni sur le survivant (l'envoi a
été décidé dans un contexte devenu périmé ; le réécrire masquerait la course). Aucune référence
Gmail n'est créée sans interaction ; une finalisation ultérieure du même message sur le dossier
repointé produit l'interaction sur le survivant.

### Lecture d'un Contact absorbé

- `getContactDuWorkspace` (lecture générique) RENDS un absorbé, avec son marqueur : l'état fusionné
  ne doit pas devenir invisible ; c'est chaque appelant qui décide.
- `chargerContactDetail` rend une union discriminée : `{ type: "actif", detail }` ou
  `{ type: "fusionne", contact, fusionneDansContactId, fusionneLe }` — pour un absorbé, une seule
  requête, aucun projet, dossier ni interaction chargé.
- `/contacts/[id]` d'un absorbé rend une page explicite en HTTP 200 (« Ce contact a été fusionné
  avec un autre contact. »), l'identité figée, la date, et un seul geste : « Voir le contact
  actif » — vers le Contact actif FINAL (`contactActifId`, résolu par `resoudreContactActif`),
  jamais le maillon intermédiaire ; le read model distingue `fusionneDansContactId` (stocké) de
  `contactActifId` (résolu). Une chaîne invalide est une erreur contrôlée, pas un 404 ni un lien
  fabriqué. Jamais de redirection silencieuse : un conseiller arrivé par un vieux lien doit
  comprendre où il est.
- (2026-09-15) La fiche du SURVIVANT liste « Contacts fusionnés » : les fiches DIRECTEMENT absorbées,
  lues dans le journal `contact_fusions` (`listerFusionsAbsorbees`, sixième requête fixe de
  `chargerContactDetail`, périmètre vérifié par jointure sur le survivant du workspace) — jamais
  reconstituées depuis `fusionne_dans_contact_id`. Par entrée : nom d'alors
  (`identite_avant_absorbe`), date, email du conseiller s'il existe (jamais le `sub`), lien vers
  `/contacts/{absorbé}`. Section absente sans fusion ; rien sur une fiche absorbée ; historique
  direct seulement (V1) ; aucun champ d'audit technique rendu.
- `resoudreContactActif(contactId, workspaceId)` suit la chaîne A → B → C jusqu'au Contact actif,
  bornée à `MAX_CHAINE_FUSION = 10` maillons et protégée contre les cycles ; au-delà, ou en cas
  de maillon manquant, elle rend `chaine_invalide` plutôt que de boucler. Aucune compaction en base.

## Alternatives écartées

- **Suppression physique de l'absorbé** : interdit par ADR-012 et ADR-055 §H ; perdrait la trace.
- **Soft delete seul (`archive_le`)** : dit « parti », pas « où ». Un lien ancien finirait en 404.
- **Table `contact_alias`** : ambiguë avec `references_externes` (ADR-056), qui porte déjà « telle
  identité externe désigne tel Contact ».
- **`contact_fusions` seule, sans marqueur sur `contacts`** : chaque lecteur devrait joindre le
  journal pour savoir si un Contact est actif. Le marqueur est la vérité de lecture ; le journal,
  la trace.
- **`workspace_id` sur `contact_fusions`** : envisagé, écarté par ADR-054 §7 — une table dont les
  FK vers un parent possédé sont NOT NULL est une FEUILLE et ne duplique pas l'appartenance
  (comme `interactions`, `parties_projet`). L'invariant « même workspace » est tenu par le moteur.
- **Redirection 302 de l'absorbé vers le survivant** : silencieuse, elle cache une décision que
  l'utilisateur doit pouvoir voir.
- **Event sourcing / défusion V1** : disproportionné pour un geste rare ; le journal suffit.

## Modèle de données / contrats

```
contacts
  + fusionne_dans_contact_id  uuid NULL  FK contacts(id) NO ACTION
  + fusionne_le               timestamptz NULL
  CHECK contacts_fusion_coherente_check   : (fusionne_dans IS NULL) = (fusionne_le IS NULL)
  CHECK contacts_fusion_pas_soi_meme_check: fusionne_dans IS NULL OR fusionne_dans <> id
  INDEX contacts_fusionne_dans_idx (partiel, WHERE fusionne_dans IS NOT NULL)

contact_fusions (feuille de contacts, ADR-054 §7)
  id, contact_survivant_id NOT NULL FK, contact_absorbe_id NOT NULL FK,
  fusionne_le NOT NULL default now(), fusionne_par_sub NULL, fusionne_par_email NULL,
  identite_avant_survivant jsonb, identite_avant_absorbe jsonb, identite_finale jsonb,
  choix_par_champ jsonb, ids_deplaces jsonb, avertissements_acquittes jsonb
  CHECK contact_fusions_pas_soi_meme_check : survivant <> absorbe
```

Types (`types/contactFusion.ts`) : `IdentiteContactSnapshot`, `ChoixFusionParChamp`
(`survivant | absorbe | identique | absence_comblee` par champ), `IdsDeplacesFusionContact`
(interactions, partiesProjet, partiesProjetSupprimees, partiesProjetRoleCorrige, acquereurs,
prospectsVendeurs, referencesExternes ; depuis `MANDATE_PARTIES_V1` : partiesMandat,
partiesMandatSupprimees, partiesMandatRoleCorrige — optionnels à la lecture, absents des journaux
antérieurs qui ne sont jamais réécrits), `ContactFusion`. `lib/contactFusion.ts` : `estContactFusionne`,
`MAX_CHAINE_FUSION`.

## Invariants

1. Un Contact est actif ⇔ `fusionne_dans_contact_id IS NULL` ; absorbé ⇔ les deux colonnes non NULL.
2. Aucun état partiel, aucune auto-absorption (base).
3. `contact_fusions` est append-only (structurel).
4. Exactement deux `UPDATE contacts` dans le produit, tous deux dans `contactRepository` :
   `modifierIdentiteContact` (refuse un absorbé) et `marquerContactFusionne` (refuse self, absorbé,
   survivant absorbé, autre workspace ; exige un exécuteur transactionnel).
5. Les lecteurs de Contacts actifs excluent les absorbés EN SQL, avant toute pagination.
6. Le journal n'est inséré que par le moteur, le marqueur n'est posé que par
   `marquerContactFusionne` ; la seule porte vers le moteur est `fusionnerContactsAction`, appelé
   une fois par soumission (structurel) ; aucune page ni composant ne l'importe.
7. La résolution de chaîne est bornée et ne boucle jamais.

## Conséquences

- Une fusion pourra être faite sans rien perdre, et relue trois ans plus tard.
- Tout nouveau lecteur de Contacts « actifs » doit filtrer `fusionne_dans_contact_id IS NULL` ;
  la garde structurelle liste les lecteurs actuels.
- Le test « contacts se limite à l'identité » intègre les deux colonnes ; le test d'appartenance
  classe `contact_fusions` en feuille.
- Le second writer de `contacts` (`marquerContactFusionne`) vit dans `contactRepository` ; la garde
  structurelle compte désormais exactement deux `UPDATE contacts`, tous deux là.

## Risques

- Fusion à tort, irréversible en V1 — mitigé en amont (résolution explicite, double confirmation
  prévue) et en aval (journal complet avec ids déplacés).
- Un lecteur futur oubliant l'exclusion — mitigé par la garde structurelle, à étendre.
- Références externes ou verrous encore pointés sur un absorbé — impossible aujourd'hui (aucun
  écrivain), à traiter par le moteur (§20 et §19 de l'audit).

## Hors périmètre

Repoint des `champs_verrouilles` (jamais) · défusion · revue de masse des similaires · fusion de
plus de deux Contacts à la fois · saisie d'une troisième valeur pendant la fusion (passer par
`/contacts/[id]/modifier` après) · personne morale.

## Questions ouvertes

- (Tranchée le 2026-09-14) La page d'un absorbé suit la chaîne jusqu'au survivant FINAL via
  `resoudreContactActif` ; les maillons stockés ne sont jamais compactés.
- (Tranchée le 2026-09-15) Le rappel côté survivant existe : section « Contacts fusionnés », lue
  dans le journal `contact_fusions` (source des fusions), historique direct V1. L'historique
  transitif et une vue d'audit détaillée (choix par champ, ids déplacés) restent à décider.

## Scalabilité

Aucun impact particulier : deux colonnes nullables, un index partiel qui ne contient que les
absorbés (rares), un journal écrit une fois par fusion. Les filtres `IS NULL` s'ajoutent à des
requêtes déjà bornées par `contacts_workspace_idx`.

## Réversibilité

Le modèle n'introduit aucune dépendance fournisseur. Sans moteur, aucune ligne ne porte le marqueur
et le journal est vide : retirer les colonnes et la table serait une migration additive inverse
sans perte.
