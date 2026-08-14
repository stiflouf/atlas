# ADR-035 — Secteurs de recherche acquéreur / compatibilité géographique

**Statut :** Accepté
**Date :** 2026-08-14
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-034 a posé le moteur canonique de compatibilité Bien ↔ Acquéreur (budget, pièces, surface,
accessibilité, parking, extérieur), en documentant explicitement la géographie comme hors périmètre
faute de modèle structuré côté acquéreur. Un audit préalable a confirmé, sur le code réel : `biens`
n'a ni coordonnée ni identifiant géographique persisté (`ville`/`codePostal` sont deux `<input>`
texte libres, sans validation de format ni géocodage à la création) ; `ProfilAcquereur` n'a aucun
champ géographique structuré, la seule expression d'un secteur recherché vivant dans `criteres`
(texte libre — ex. `"Paris — arrondissements centraux"`, trouvé tel quel dans `data/clients.ts`) ;
Atlas appelle déjà l'IGN Géoplateforme (BAN) pour géocoder l'adresse d'un bien à la volée en
préparation de visite, mais son client (`ignClient.ts`) n'extrayait que `score`/`label`, alors
qu'une vérification empirique directe de l'API a montré qu'elle retourne aussi `citycode` (code
commune INSEE), `postcode`, `city`, `context`, `type` — gratuitement, sans clé, sans changement de
fournisseur. Cette passe construit le critère géographique déterministe sur cette base.

## Décision

### 1. Modèle retenu : secteurs par commune, identifiant canonique = `citycode` IGN

Option retenue parmi celles étudiées à l'audit (rayon GPS, quartiers/IRIS, vocabulaire flou
ville/arrondissement/département) : une liste explicite de communes/arrondissements sélectionnés
par le conseiller, comparés sur leur `citycode` (chaîne — **jamais un entier**, la Corse porte des
codes non numériques `"2A"`/`"2B"`). Un rayon GPS a été écarté : le besoin exprimé ("Houilles,
Carrières-sur-Seine ou Sartrouville") est une liste discrète, qu'aucun cercle unique ne peut
reproduire sans inclure des communes non voulues. Un vocabulaire flou a été écarté : le cas
Paris/Lyon/Marseille (point 5) montre qu'une simple chaîne "ville" est déjà ambiguë avant même de
parler de quartier ou de département.

### 2. `codeInsee` : chaîne partout, jamais un entier

Type `string` en TypeScript, colonne `text` en base — aucune regex `^\d{5}$` n'a été utilisée, ni
en validation applicative ni en contrainte DB, précisément parce que la Corse (`"2A"`, `"2B"`) et
d'autres codes non strictement numériques existent réellement dans le référentiel INSEE.

### 3. `biens.codeInseeCommune` : nouvelle colonne canonique, nullable, jamais un remplacement

```ts
// types/bien.ts
codeInseeCommune?: string; // citycode IGN — jamais calculé à la lecture, jamais saisi manuellement
```

Persistée, jamais recalculée à la lecture. `adresse`/`ville`/`codePostal` continuent d'exister
inchangés, restent la saisie de référence affichée — `codeInseeCommune` ne les remplace jamais, il
sert uniquement au critère géographique du moteur de compatibilité.

### 4. Résolution du bien : automatique, non bloquante

`src/lib/geocodage/resolutionBien.ts` (`resoudreCommuneBien`) : géocode
`{adresse}, {codePostal} {ville}` via `geocoderAdresse()` (déjà existant, étendu — point 7),
persiste le `citycode` **uniquement** si `evaluerQualiteGeocodage(score) === "fiable"` (seuil
`SEUIL_FIABLE = 0.8`, réutilisé tel quel depuis `qualite.ts` — jamais un second seuil de "fiabilité"
défini ailleurs dans le code). Panne réseau, réponse HTTP en erreur, réponse sans `citycode`, ou
score insuffisant : `codeInseeCommune` reste/devient `undefined` (`NULL` en base), **l'enregistrement
du bien n'échoue jamais** pour ce motif — vérifié par des tests d'intégration
(`creerBien.test.ts`).

**Toujours recalculée en entier, jamais conditionnée à "l'adresse a-t-elle changé"** :
`creerBienAction` et `modifierBienAction` appellent `resoudreCommuneBien()` à chaque
création/édition, sans exception. C'est la façon la plus sûre d'éviter un `codeInseeCommune` périmé
après une modification d'adresse — détecter un changement aurait introduit un risque de bug de
détection ; recalculer systématiquement l'élimine par construction.
`bienRepository.modifierBien()` écrit explicitement `codeInseeCommune ?? null` dans son `SET` : si
la nouvelle résolution échoue, la ligne repasse à `NULL`, **jamais l'ancienne valeur conservée** —
testé explicitement (`modifierBien.test.ts`, scénario "aucune ancienne localisation ne subsiste
silencieusement").

### 5. Paris/Lyon/Marseille : jamais un faux équivalent générique

Vérifié empiriquement (requêtes réelles contre l'API IGN, hors du code Atlas) : la BAN modélise
chaque arrondissement de Paris/Lyon/Marseille comme sa **propre commune** (`type: "municipality"`,
son propre `citycode`/`postcode`), **et** conserve une entrée "ville entière" distincte (Paris
`citycode 75056`, Lyon `69123`, Marseille `13055`) — les deux coexistent, avec des `citycode`
différents. Une piste initialement envisagée (filtrer sur la présence du champ `banId`) a été
vérifiée puis écartée : des communes ordinaires, sans rapport avec Paris/Lyon/Marseille, en sont
également dépourvues — ce filtre aurait exclu à tort des communes légitimes. Solution retenue,
non heuristique : une liste fixe et documentée des trois codes légalement définis
(`CODES_INSEE_VILLE_A_ARRONDISSEMENTS`, Code général des collectivités territoriales, art. L2511-1),
exclue systématiquement des résultats de `rechercherCommunes()` — la sélection générique "Paris"
n'apparaît **jamais** dans l'autocomplétion, seuls les arrondissements individuels le sont. Aucune
expansion automatique `"Tout Paris" → 20 lignes` n'a été construite (aucune convention simple et
non heuristique ne le permettait) ; documenté comme limitation V1 (voir `KNOWN_LIMITATIONS.md`).

### 6. Aucun matching par `ville`/`codePostal`

Le critère géographique (`evaluerSecteur`, `src/lib/compatibilite/criteres.ts`) ne lit **jamais**
`bien.ville` ni `bien.codePostal` — vérifié par relecture directe de la fonction et par un test
dédié (un bien dont `ville`/`codePostal` sont volontairement incohérents avec le secteur recherché
reste correctement `compatible`, la seule variable qui compte étant `codeInseeCommune`).
`ville`/`codePostal` restent des données de saisie potentiellement imparfaites, jamais des
identifiants de comparaison.

### 7. Client IGN étendu, jamais un second client géographique

`src/lib/geocodage/ignClient.ts` (même fichier, jamais un nouveau module) expose désormais :

- `geocoderAdresse()` — **inchangé dans son usage** (préparation de visite), son type de retour
  `ResultatGeocodage` gagne un champ optionnel `commune?: Commune` (citycode/nom/codePostal/
  contexte), additif, aucune régression sur les appelants existants.
- `rechercherCommunes(recherche)` — nouveau, `type=municipality`, jusqu'à 10 résultats, exclut les
  trois codes génériques (point 5). Utilisé par l'autocomplétion de secteur acquéreur uniquement,
  jamais pour résoudre un bien.
- `verifierCommune(citycode, nomSoumis)` — nouveau, re-vérification serveur (point 8).

### 8. Validation serveur obligatoire à l'ajout d'un secteur

Correction obligatoire par rapport à une première ébauche : le serveur ne fait **jamais** confiance
aux `codeInsee`/`nomCommune`/`codePostal` soumis par le client (trois hidden inputs manipulables).
`ajouterSecteurRechercheAction` (`src/actions/secteurRecherche.ts`) rejoue une recherche IGN fraîche
filtrée par `citycode` (`verifierCommune`) et persiste **exclusivement** la réponse de cette
vérification — jamais les valeurs soumises, même si elles semblent correctes (testé explicitement :
un `nomCommune` soumis délibérément différent de la réponse IGN n'est jamais celui persisté). Si
l'IGN est indisponible ou ne confirme pas la sélection : aucune écriture, erreur actionnable
retournée à l'UI (voir point 10) — jamais un identifiant géographique douteux enregistré. Le réseau
est autorisé à ce moment précis (écriture, geste explicite du conseiller) ; il reste strictement
interdit dans `evaluerCompatibilite()` à la lecture.

### 9. Secteur = résultat structuré non éditable indépendamment

`codeInsee`/`nomCommune`/`codePostal` forment le résultat d'une sélection géographique unique — le
conseiller ne peut jamais éditer `nomCommune`/`codePostal` indépendamment de `codeInsee` (aucun
champ éditable dans l'UI en dehors de la recherche+sélection elle-même). Pour corriger un secteur :
supprimer, rechercher, sélectionner à nouveau. Élimine par construction tout couple incohérent
(`codeInsee` de Houilles avec un `nomCommune` de Sartrouville).

### 10. Critère géographique dans le moteur canonique ADR-034

```ts
// src/lib/compatibilite/criteres.ts
export function evaluerSecteur(bien: Bien, secteursRecherche: SecteurRecherche[]): EvaluationCritere
```

```text
secteursRecherche.length === 0            → non_concerne
bien.codeInseeCommune === undefined        → a_verifier
codeInsee présent dans secteursRecherche   → compatible
codeInsee connu, absent de tous les secteurs → incompatible
```

`evaluerCompatibilite(bien, acquereur, secteursRecherche = [])` gagne un troisième paramètre
optionnel (défaut `[]`, rétrocompatible avec tout appel à deux arguments — équivaut exactement à
"aucun secteur connu"). `agregerStatutGlobal()` **n'a pas changé** : le critère géographique suit
exactement les mêmes règles de priorité (`incompatible` > `a_verifier` > `compatible`,
`non_concerne` ignoré) que les six critères ADR-034 existants.

### 11. Orchestration sans N+1

`src/lib/secteurRechercheRepository.ts` expose `listerSecteursPourAcquereurs(acquereurIds)` — une
seule requête groupée (`inArray`), retournant une `Map<acquereurId, SecteurRecherche[]>`.
`evaluerCompatibiliteBien()` (bien → acquéreurs) l'utilise pour charger les secteurs de **tous** les
acquéreurs candidats en un seul aller-retour DB, jamais une requête par acquéreur dans la boucle.
`evaluerCompatibiliteAcquereur()` (acquéreur → biens) charge les secteurs de cet unique acquéreur
une seule fois, réutilisés pour chaque bien comparé. Aucun appel réseau IGN dans ces boucles — les
secteurs sont déjà des données persistées. Testé explicitement (`orchestration.test.ts`) : un même
bien comparé à plusieurs acquéreurs ayant des secteurs différents produit bien des critères
géographiques distincts et corrects par acquéreur (preuve que le regroupement ne mélange jamais les
données de deux acquéreurs).

### 12. Modèle DB : table dédiée, jamais un array/JSON

```sql
CREATE TABLE secteurs_recherche_acquereur (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acquereur_id uuid NOT NULL REFERENCES acquereurs(id) ON DELETE CASCADE,
  code_insee text NOT NULL,
  nom_commune text NOT NULL,
  code_postal text NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (acquereur_id, code_insee)
);
ALTER TABLE biens ADD COLUMN code_insee_commune text;
```

Aucune colonne `jsonb`/`json` (le schéma Atlas n'en a d'ailleurs aucune à ce jour) : chaque secteur
recherché est une commune structurée à plusieurs champs, pas une liste de texte libre — une table
dédiée avec FK `CASCADE`, l'idiome déjà constant du projet pour toute entité répétable structurée
(`notes_bien`, `taches`, `notes_prospect_vendeur`, `offre_visites`...). Contrainte
`UNIQUE(acquereur_id, code_insee)` : empêche un doublon en base, indépendamment de toute validation
applicative.

### 13. Repository secteurs

`src/lib/secteurRechercheRepository.ts` : `listerSecteursPourAcquereur`,
`listerSecteursPourAcquereurs` (groupé), `ajouterSecteurRecherche` (insertion pure — le `Commune`
passé en argument doit déjà avoir été vérifié par l'appelant, jamais revérifié ici),
`supprimerSecteurRecherche(id, acquereurId)` — **scopée à l'acquéreur propriétaire** dans la clause
`WHERE` (pas seulement l'id de la ligne) : un formulaire manipulé sur la fiche d'un acquéreur ne
peut jamais supprimer le secteur d'un autre acquéreur, testé explicitement.

### 14. UX

Section dédiée sur la fiche acquéreur (`SecteursRechercheSection.tsx`, **pas** dans
`AcquereurFormulaire`) : liste des secteurs déjà enregistrés (commune + code postal), chacun avec un
bouton "Retirer" (formulaire natif classique, `redirect()`) ; recherche avec suggestions IGN
(`"use client"`, debounce 300 ms, proxy serveur `GET /api/geocodage/communes` — le client ne parle
jamais directement à l'IGN) affichant le contexte département/région pour désambiguïser les
homonymes ; un secteur n'est persisté qu'après sélection explicite d'un résultat **et** confirmation
via le bouton "Ajouter" (jamais à la frappe). `ajouterSecteurRechercheAction` suit le patron
`useActionState` déjà établi par `envoyerEmailGmailAction` (ADR-031-bis) — état
`idle`/`succes`/`erreur` avec message actionnable affiché inline, jamais un `throw` brut qui
déclencherait la page d'erreur générique de Next.js.

### 15. Aucune conversion silencieuse du texte libre existant

`criteres`/`notes` existants (ex. `"Paris — arrondissements centraux"`) ne sont **jamais** lus,
analysés ni convertis en secteurs structurés — aucune regex, aucun `.includes`, aucun LLM, aucune
migration heuristique. Testé explicitement : un acquéreur dont `criteres`/`description` mentionnent
un lieu reste `non_concerne` tant qu'aucune ligne `secteurs_recherche_acquereur` n'existe. Le texte
existant reste du texte — sa conversion, si elle a lieu un jour, restera un geste explicite du
conseiller (recherche + sélection), jamais automatique.

### 16. Backfill des biens existants

`scripts/backfill-code-insee-commune.mjs`, script autonome (sans les alias `@/`, pour rester
exécutable hors Next.js), deux modes : dry-run (par défaut, aucune écriture, rapport complet) et
`--apply` (écrit uniquement les résolutions fiables). Ne lit que `adresse`/`ville`/`codePostal` —
jamais `description`/`caracteristiques`/notes/texte acquéreur. Idempotent par construction : ne
retraite jamais un bien dont `code_insee_commune` est déjà non `NULL`, relancer le script ne peut
donc jamais dégrader un résultat déjà correct. Validé réellement sur la base de développement
(voir Conséquences).

## Géographie et cas limites — hors du modèle actuel, documentés

- **Codes postaux couvrant plusieurs communes ou l'inverse** (fait connu des codes postaux
  français, non administratifs) : sans impact sur ce choix, précisément parce que `citycode`
  (jamais `codePostal`) est l'identifiant canonique — une commune a toujours exactement un
  `citycode`.
- **`"Tout Paris"` / `"Tout Lyon"` / `"Tout Marseille"` en un clic** : non construit en V1 (point 5)
  — le conseiller sélectionne chaque arrondissement individuellement s'il veut couvrir toute une
  ville à arrondissements.

## Conséquences

- Migration `0022_dashing_speed.sql` : table `secteurs_recherche_acquereur` (6 colonnes, FK CASCADE,
  `UNIQUE(acquereur_id, code_insee)`) ; colonne nullable `biens.code_insee_commune`.
- Nouveaux fichiers : `src/types/secteurRecherche.ts`, `src/lib/secteurRechercheRepository.ts`,
  `src/lib/geocodage/resolutionBien.ts`, `src/actions/secteurRecherche.ts`,
  `src/app/api/geocodage/communes/route.ts`, `src/components/client/SecteursRechercheSection.tsx`,
  `scripts/backfill-code-insee-commune.mjs`.
- Fichiers modifiés : `src/lib/geocodage/ignClient.ts` (étendu, `geocoderAdresse()` inchangé dans
  son usage), `src/types/geocodage.ts` (type `Commune`, `ResultatGeocodage.commune?`),
  `src/types/bien.ts`/`src/db/schema.ts` (`codeInseeCommune`), `src/lib/bienRepository.ts`,
  `src/actions/{creerBien,modifierBien}.ts`, `src/lib/compatibilite/{criteres,evaluerCompatibilite,
  orchestration}.ts`, `src/app/clients/[id]/page.tsx`.
- Tests : 143 nouveaux (critère géographique et agrégation, repository secteurs en intégration
  Postgres, résolution IGN mockée — jamais dépendante du réseau réel dans la suite automatisée,
  Server Actions bien/secteur avec le scénario "code périmé jamais conservé", parsing IGN et
  exclusion Paris/Lyon/Marseille) — suite complète du projet passante (818 tests).
- **Backfill réel exécuté sur la base de développement** : 1 bien réel candidat
  (`PROJ-TEST-001`, adresse fictive) — score IGN insuffisant (0.45 < 0.8), aucune écriture, comme
  attendu ; validation du chemin "résolu" faite séparément avec un bien de test à adresse réelle
  (Place de la Concorde, Paris 8e → `citycode 75108`, score 0.96), résolu puis nettoyé après
  vérification. Idempotence confirmée par un second passage `--apply` sans effet sur le bien déjà
  résolu.
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- Hors périmètre, réservé à des passes ultérieures : rayon kilométrique, GPS comme critère de
  recherche, quartiers/IRIS, temps de trajet, proximité gare/métro, préférences pondérées/scoring,
  extraction automatique depuis `criteres`/`notes`, historique des recherches géographiques,
  intégration avec le moteur d'automatisations (ADR-032/033), sélection groupée "tout Paris".
