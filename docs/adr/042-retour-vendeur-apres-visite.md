# ADR-042 — Retour vendeur après visite

**Statut :** Accepté
**Date :** 2026-08-16
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Un audit préalable en lecture seule a confirmé qu'après une `visite_realisee`, Atlas ne produit
aujourd'hui aucun geste vers le **vendeur** du bien visité : `suivi_apres_visite` (ADR-041) cible
exclusivement l'acquéreur, et rien ne rappelle au conseiller de faire un retour, même minimal, au
vendeur — alors que celui-ci attend légitimement de savoir comment sa visite s'est déroulée, quelle
que soit l'issue. Six décisions produit ont tranché le périmètre exact avant tout code :

1. Nouvelle règle ADR-032 indépendante (`retour_vendeur_apres_visite`), jamais fusionnée avec
   `suivi_apres_visite`.
2. Résolution du vendeur exclusivement via `getProspectVendeurParBien()` — jamais
   `resoudreDestinatairesDepuisBien()`, qui peut légitimement retourner l'acquéreur d'un compromis
   en cours.
3. Tâche créée pour les **quatre** valeurs techniques d'`interet`, y compris `pas_interesse`
   (contrairement à `suivi_apres_visite`) : le vendeur doit être informé quelle que soit l'issue.
4. Génération de brouillon déterministe (aucun LLM), whitelist stricte de faits, acquéreur jamais
   nommé.
5. Réutilisation intégrale du mécanisme d'envoi Gmail existant (ADR-031-bis) — aucune nouvelle
   table, aucun nouveau booléen de suivi d'envoi.
6. Une seule migration additive : extension de la contrainte CHECK sur
   `envois_email.origine_intention`.

## Décision

### 1. Nouvelle règle `retour_vendeur_apres_visite`, indépendante de `suivi_apres_visite`

Ajoutée à `catalogueRegles.ts`, déclenchée par le même événement `visite_realisee` que
`suivi_apres_visite`, mais construisant une tâche distincte, ciblant `{ type: "prospectVendeur",
id }`. Les deux règles s'exécutent indépendamment sur le même événement (ADR-032 : plusieurs règles
peuvent réagir au même type d'événement, idempotence garantie individuellement par
`UNIQUE(regle_code, evenement_id)`). `suivi_apres_visite` n'a subi aucune modification.

Comme toute règle V1, **`active = false` par défaut** (seedée ainsi dans la migration) —
l'activation figée d'ADR-032 s'applique intégralement : aucun rattrapage rétroactif sur les visites
déjà réalisées avant l'activation explicite depuis `/automatisations`.

### 2. Résolution du vendeur : `getProspectVendeurParBien()`, jamais de fallback

`construireTache()` résout le bien du compte rendu, puis appelle exclusivement
`getProspectVendeurParBien(bienId)` — le seul résolveur garantissant au plus un résultat
(`prospects_vendeurs.bien_id` est nullable **et** `UNIQUE` : relation Bien→Vendeur `0..1`, jamais
`1`). Un bien créé directement (`/biens/nouveau`, hors conversion d'un prospect vendeur) n'a
structurellement aucun vendeur résolvable.

Invariant respecté : **destinataire vendeur certain, ou aucun effet.** Aucun des cas suivants ne
produit de tâche ni d'erreur — `construireTache()` retourne `undefined`, l'exécution est marquée
`reussie` (succès honnête, ADR-032), jamais reprise par ADR-038 :

- compte rendu introuvable,
- bien introuvable ou archivé,
- aucun prospect vendeur lié au bien,
- prospect vendeur archivé.

### 3. Politique par `interet` : les quatre valeurs produisent une tâche

Contrairement à `suivi_apres_visite` (qui exclut `pas_interesse`), le vendeur reste informé quelle
que soit l'issue commerciale côté acquéreur — un refus a autant de valeur d'information pour lui
qu'un intérêt manifesté :

| `interet` | Contexte de la tâche |
|---|---|
| `interesse` | *« La visite a suscité un intérêt. Faire le retour au vendeur. »* |
| `a_reflechir` | *« L'acquéreur souhaite prendre le temps de réfléchir. Faire le retour au vendeur. »* |
| `pas_interesse` | *« L'acquéreur ne souhaite pas donner suite à cette visite. Faire le retour au vendeur. »* |
| `inconnu` | *« La visite a eu lieu, mais le retour précis de l'acquéreur n'est pas encore établi. »* — jamais transformé en affirmation |

Le **titre** ne varie jamais avec `interet` : *« Faire le retour de visite à {Vendeur} pour
{référenceBien} »*. Seul le contenu (contexte de tâche, puis corps de l'email) en dépend. **L'acquéreur
n'est jamais nommé**, dans aucun contenu généré — titre, contexte, objet ou corps d'email — cohérent
avec l'absence de tout tiers nommé dans les intentions de communication déjà existantes.

### 4. Whitelist stricte — aucune donnée interne ne sort jamais

Aucun champ `retourVendeur` n'est ajouté nulle part (`visites`, `comptes_rendus_visite`) : la
séparation entre donnée interne et donnée partageable est obtenue uniquement par whitelist +
template dédié, jamais par un nouveau champ. `resoudreContexteCommunicationDepuisTache()` (via
`origineCode === "retour_vendeur_apres_visite"`, voir §6) ne lit du compte rendu le plus récent du
bien que trois faits structurés : adresse du bien, date de visite, valeur technique d'`interet`.
Les champs libres `retour` et `prochaineEtape` (notes internes du conseiller, ADR-011) ne sont
jamais lus par ce chemin — `FaitsCommunication` ne porte structurellement aucun champ correspondant,
la garantie est donc portée par le système de types, pas seulement par convention. Aucun `spread`
du compte rendu, aucune sérialisation générique.

### 5. Brouillon déterministe

Nouvelle valeur `IntentionCommunication = "retour_vendeur_apres_visite"`. Sujet : *« Retour de
visite — {adresse du bien} »*. Corps déterministe par `interetVisiteValeur`, quatre formulations
distinctes (voir §3, adaptées au ton), `inconnu` et l'absence de compte rendu traités de façon
strictement identique (prudence, jamais d'affirmation non fondée — ADR-008). `date_prevue` reste un
jour civil persisté (ADR-041) : le brouillon ne va jamais chercher l'heure auprès de Google
Calendar, reste générable sans aucun appel Google.

### 6. `origineCode` distingue la tâche, jamais le seul type de cible

Une tâche `prospectVendeur` peut être créée par plusieurs mécanismes (manuelle, `mandat_signe`,
`inactivite_prospect_vendeur`, désormais `retour_vendeur_apres_visite`). Pour éviter qu'*« toute
tâche prospectVendeur »* ne reçoive la nouvelle intention, `resoudreContexteCommunicationDepuisTache()`
et `determinerIntentionParDefaut()` branchent explicitement sur `tache.origineCode ===
"retour_vendeur_apres_visite"` (identifiant machine stable posé par le moteur ADR-032,
`origineCode: regle.code`) **avant** toute autre logique. Seule la tâche produite par cette règle
précise porte les faits de visite et l'intention dédiée ; une tâche `prospectVendeur` manuelle ou
issue d'une autre règle garde son comportement générique existant, inchangé.

Limite acceptée et documentée en commentaire : les faits sont dérivés du compte rendu le **plus
récent** du bien au moment de la résolution (une tâche mono-cible, ADR-028, ne peut porter une
seconde référence structurée vers le compte rendu précis qui l'a déclenchée) — si une nouvelle
visite survient entre la création de la tâche et la préparation de l'email, le brouillon reflète la
visite la plus récente, pas nécessairement celle qui a déclenché la tâche.

### 7. Aucun fallback vers l'acquéreur, même en présence d'un compromis

Testé explicitement : un acquéreur en compromis `en_cours` sur le même bien ne devient jamais
destinataire de cette tâche ni de ce brouillon — la résolution passe uniquement par
`getProspectVendeurParBien()`, jamais par `resoudreDestinatairesDepuisBien()`.

### 8. Gmail : parcours inchangé, aucun envoi automatique

`Préparer un email` mène vers `/communications/nouveau?tacheId=...` (mécanisme ADR-031 existant,
aucun nouveau resolver) — relecture et modification possibles, confirmation explicite requise,
envoi réel seulement via `envoyerEmailGmailAction` (ADR-031-bis, inchangée). La nouvelle intention
est ajoutée à `INTENTIONS_VALIDES` avec les mêmes validations de sécurité que les huit autres.
Aucun appel automatique à `envoyerEmailGmailAction` nulle part dans cette ADR.

À l'envoi réel réussi vers un prospect vendeur, le mécanisme déjà existant
(`enregistrerInteractionSiPertinent`, inconditionnel sur l'intention, keyé uniquement sur
`destinataireType === "prospectVendeur"`) crée automatiquement la note d'interaction ADR-027 —
**zéro nouveau code** nécessaire pour tracer qu'un retour a été effectué. Aucune table
`retours_vendeur`, aucun booléen `retourEffectue`, aucun nouvel événement.

### 9. Migration — une seule, additive

`envois_email_origine_intention_check` étendu pour autoriser `retour_vendeur_apres_visite`, dans le
même mouvement que l'extension habituelle de `configurations_automatisation_regle_code_check` et
`executions_automatisation_regle_code_check` pour la 7ᵉ règle (même patron qu'ADR-037). Une ligne
`('retour_vendeur_apres_visite', false)` seedée dans `configurations_automatisation`. Aucune
nouvelle table, aucune nouvelle colonne métier.

## Hors périmètre, volontairement

Action directe supplémentaire sur la fiche Visite, email automatique, brouillon généré par IA,
champ `retourVendeur` sur `visites` ou `comptes_rendus_visite`, tâche vendeur en l'absence de
vendeur structuré, fallback vers l'acquéreur, modification de `resoudreDestinatairesDepuisBien`,
nouvelle table de suivi, statut de retour vendeur, nettoyage automatique de la tâche à la réception
d'une offre ou d'un compromis, SMS/WhatsApp/notification push, score ou analyse de sentiment.

## Conséquences

- **Une migration** (`0027_abandoned_red_wolf.sql`) : extension de trois contraintes CHECK
  (`configurations_automatisation_regle_code_check`, `executions_automatisation_regle_code_check`,
  `envois_email_origine_intention_check`) + seed `('retour_vendeur_apres_visite', false)`.
- Nouveau fichier de test : `src/lib/automatisations/catalogueRegles.retourVendeur.test.ts` (13
  tests : politique par intérêt, aucun fallback vendeur absent, jamais l'acquéreur même en présence
  d'un compromis, activation figée, idempotence/concurrence/reprise ADR-038).
- Fichiers modifiés : `src/types/automatisation.ts` (7ᵉ code de règle), `src/db/schema.ts` (3 CHECK
  étendus), `src/lib/automatisations/catalogueRegles.ts` (nouvelle règle),
  `src/lib/communications/contexteCommunication.ts` (nouvelle `IntentionCommunication`, nouveau
  fait `interetVisiteValeur`), `src/lib/communications/genererBrouillonEmail.ts` (objet + corps
  déterministes), `src/lib/communications/resoudreContexteCommunicationDepuisTache.ts` (branchement
  `origineCode`), `src/app/communications/nouveau/page.tsx` (transmission de `origineCode`),
  `src/actions/envoyerEmailGmail.ts` (`INTENTIONS_VALIDES` étendue) — et les fichiers de test
  associés à chacun.
- `docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md`
  mis à jour en conséquence.
- Hors périmètre, réservé à une ADR ultérieure : nettoyage automatique de la tâche vendeur à
  l'apparition d'une offre/d'un compromis, référence structurée au compte rendu précis ayant
  déclenché la tâche (au-delà du « plus récent au moment de la résolution »).
