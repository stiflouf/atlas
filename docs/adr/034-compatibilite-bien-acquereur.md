# ADR-034 — Moteur canonique de compatibilité Bien ↔ Acquéreur

**Statut :** Accepté
**Date :** 2026-08-14
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Deux implémentations indépendantes croisaient déjà les mêmes champs structurés bien × acquéreur
(étage/ascenseur, pièces/surface minimum, parking, extérieur, budget) : `pointsAttention/moteur.ts`
(alertes ponctuelles pour la préparation de visite) et implicitement toute future vue "qui
correspond à quoi". Un audit préalable a confirmé que `pointsAttention/moteur.ts` n'avait jusqu'ici
aucun test, et qu'aucun moteur déterministe et explicable de compatibilité commerciale n'existait —
`src/lib/matching/` est un moteur distinct, dédié à la résolution floue d'un rendez-vous Google
Calendar vers un bien/acquéreur, qui ne participe jamais à cette décision. Cette passe construit ce
moteur canonique en V1, sans migration de schéma (tous les champs nécessaires existent déjà depuis
ADR-009), et fait converger `pointsAttention` vers lui pour ne garder qu'une seule implémentation
de chaque décision métier.

## Décision

### 1. Périmètre : `src/lib/compatibilite/`, entièrement dérivé à la lecture

Nouveau module, distinct de `src/lib/matching/` (jamais réutilisé, jamais renommé — vocabulaire
volontairement différent pour ne jamais confondre "matching flou d'un rendez-vous" et "compatibilité
commerciale bien ↔ acquéreur"). Aucune migration de schéma : uniquement les champs structurés déjà
introduits par ADR-009 (`bien.{etage,ascenseur,parking,exterieur}`,
`acquereur.{piecesMin,surfaceMin,accessibiliteRequise,necessiteParking,necessiteExterieur}`) plus
`bien.{pieces,surface,prix}` et `acquereur.budgetMax}`, déjà présents avant ADR-009. Aucune table de
matching, aucun cache persistant, aucun événement métier, aucune tâche, aucun email, aucune
intégration avec le moteur d'automatisations (ADR-032/033) — un résultat de compatibilité est une
pure fonction de lecture, jamais un fait qui déclenche quoi que ce soit.

### 2. Quatre statuts de critère, trois statuts globaux, aucun score

```ts
export type StatutCritere = "compatible" | "incompatible" | "a_verifier" | "non_concerne";
export type StatutCompatibilite = "compatible" | "incompatible" | "a_verifier";
```

`non_concerne` n'existe qu'au niveau d'un critère — jamais au niveau du statut global. Il distingue
deux situations que la codebase a l'habitude de garder séparées (même principe que ADR-009,
"inconnu ≠ faux") : une exigence absente côté acquéreur (`non_concerne`, rien à évaluer) d'une
exigence présente mais une information manquante côté bien (`a_verifier`, quelque chose à vérifier).
Les confondre aurait masqué des cas où le conseiller doit activement compléter la fiche du bien.

Agrégation du statut global — sur les seuls critères pertinents (`non_concerne` ignoré) :

1. au moins un `incompatible` → `incompatible` (priorité absolue) ;
2. sinon au moins un `a_verifier` → `a_verifier` ;
3. sinon → `compatible`.

Aucun score numérique, aucune pondération arbitraire : un score aurait fait perdre l'information
"quel critère précisément pose problème", contraire à l'objectif d'explicabilité de cette ADR.

### 3. Budget : `budgetMax` seule contrainte dure, `budgetMin` sans sémantique

```text
bien.prix > acquereur.budgetMax → incompatible
bien.prix <= acquereur.budgetMax → compatible
```

`budgetMax` et `bien.prix` sont tous deux `NOT NULL` en base (`schema.ts` : `budget_max`/`prix`) —
vérifié explicitement pour cette ADR, jamais de `non_concerne` ni de `a_verifier` pour ce critère.

**`budgetMin` n'a délibérément aucune sémantique dans ce moteur.** Un bien moins cher que
`budgetMin` n'est jamais incompatible pour ce seul motif — rien dans le modèle actuel ne permet de
distinguer "l'acquéreur refuserait ce bien parce que trop bon marché" d'un simple minimum indicatif
de gamme. Le champ reste dans le modèle (`ProfilAcquereur.budgetMin`), simplement jamais lu par
`evaluerBudgetMax()`. Une future ADR pourrait lui donner un sens si un vrai besoin métier
l'exigeait — non inventé ici.

### 4/5. Pièces et surface minimum

```text
piecesMin absent → non_concerne
bien.pieces >= piecesMin → compatible
bien.pieces < piecesMin → incompatible
```

Même règle pour `surfaceMin`/`bien.surface`. Vérifié explicitement pour cette ADR : `bien.pieces`
(`integer("pieces").notNull()`) et `bien.surface` (`real("surface").notNull()`) sont tous deux
`NOT NULL` en base et validés strictement positifs à la saisie (`bienFormulaire.ts`) — aucune
branche `a_verifier` n'existe pour ces deux critères, il n'y a rien à vérifier côté bien.

### 6/7. Parking et extérieur — inconnu ≠ faux

```text
necessiteParking !== true → non_concerne
bien.parking === true → compatible
bien.parking === false → incompatible
bien.parking undefined → a_verifier
```

Même structure pour l'extérieur (`necessiteExterieur`/`bien.exterieur`, compatible pour
`"balcon"|"terrasse"|"jardin"`, incompatible pour `"aucun"`, `a_verifier` si absent). Aucune
déduction depuis `caracteristiques`/`description`/`notes` ou tout autre texte libre — un bien décrit
comme ayant "une magnifique terrasse" dans son texte libre reste `a_verifier` tant que le champ
structuré `exterieur` n'est pas renseigné (ADR-008, testé explicitement).

### 8. Accessibilité — besoin fonctionnel immobilier, jamais une donnée de santé

`accessibiliteRequise` reste, comme depuis sa création, uniquement un besoin fonctionnel immobilier
(accessibilité du logement recherché) — jamais une information de santé ou un diagnostic.

```text
accessibiliteRequise !== true → non_concerne
bien.etage undefined → a_verifier
bien.etage === 0 → compatible (l'état de l'ascenseur n'a jamais besoin d'être connu au RDC)
bien.etage > 0 ET bien.ascenseur === true → compatible
bien.etage > 0 ET bien.ascenseur === false → incompatible
bien.etage > 0 ET bien.ascenseur undefined → a_verifier
```

`bien.ascenseur === undefined` n'est jamais transformé en `false`. Le modèle réel
(`bienFormulaire.ts`) rejette explicitement tout étage négatif à la saisie ("Étage invalide : doit
être positif ou nul") — aucun sous-sol n'est représenté par un étage négatif dans cette V1. Si une
valeur négative existait malgré tout (donnée insérée hors du chemin applicatif normal), le moteur
retourne `a_verifier` plutôt que d'inventer une sémantique de sous-sol non modélisée — testé
explicitement.

### 9. Contrat de résultat

```ts
export type EvaluationCritere = {
  critere: string; // identifiant stable ("budget_max", "pieces_min", ...), jamais une phrase
  label: string;
  exigenceAcquereur?: string | number | boolean;
  valeurBien?: string | number | boolean;
  statut: StatutCritere;
  explication: string;
};

export type ResultatCompatibilite = {
  bienId: string;
  acquereurId: string;
  statutGlobal: StatutCompatibilite;
  criteres: EvaluationCritere[];
};
```

Pas de champ `categorie: "obligatoire" | "preference"` : construire une branche `"preference"`
aujourd'hui aurait créé une distinction que rien dans le modèle actuel n'alimente (aucune donnée de
préférence pondérée n'existe) — voir section 16.

### 10. Fonction pure canonique

```ts
export function evaluerCompatibilite(bien: Bien, acquereur: ProfilAcquereur): ResultatCompatibilite
```

`src/lib/compatibilite/evaluerCompatibilite.ts` — zéro fetch, zéro Drizzle, zéro `Date` courante,
zéro effet de bord, zéro texte libre interprété, déterministe pour les mêmes entrées, testable sans
Next.js. Devient la source canonique de toute décision de compatibilité commerciale dans Atlas.

### 11. Convergence avec `pointsAttention` — une seule implémentation par décision

Avant tout changement de `pointsAttention/moteur.ts` (qui n'avait aucun test), un fichier de tests
de caractérisation (`moteur.test.ts`, 30 cas) a verrouillé son comportement existant. Les six règles
qui recouvrent réellement une règle ADR-034 (`prix_superieur_budget_max`, `accessibilite_requise`,
`pieces_insuffisantes`, `surface_insuffisante`, `parking_manquant`, `exterieur_manquant`) ont ensuite
été réécrites pour déléguer leur condition de déclenchement aux fonctions de critère partagées de
`src/lib/compatibilite/criteres.ts` — chacune ne se déclenche plus que si le critère partagé
retourne `statut === "incompatible"`, reproduisant exactement le comportement d'origine (vérifié :
les 30 tests de caractérisation restent verts sans modification). `pointsAttention` garde sa propre
formulation éditoriale (texte adapté à la Mémoire du dossier, pas à l'explicabilité critère par
critère) et son silence volontaire sur `a_verifier`/`non_concerne` — seule la décision est partagée,
jamais la présentation. `regleMandatNonActif` et `regleAucunTransportProche`, hors périmètre ADR-034,
restent inchangées.

`pointsForts/moteur.ts` n'a **pas** été refactoré : les bonus non demandés (parking non requis mais
présent, extérieur non requis mais présent) ont une sémantique différente des contraintes de
compatibilité — une extraction aurait ajouté un couplage sans supprimer de duplication réelle.

### 12. Aucun texte libre dans la décision

Aucune fonction de critère ne lit `notes`, `criteres`, `caracteristiques`, `description` ou
équivalent (ADR-008). Testé explicitement : un bien/acquéreur dont les champs texte libre
contiennent "parking obligatoire", "cherche terrasse", "5e sans ascenseur" produit exactement le
même résultat qu'un bien/acquéreur aux mêmes champs texte libre vidés, tant que les champs
structurés correspondants restent absents.

### 13. Orchestration symétrique

```ts
evaluerCompatibiliteBien(bienId: string): Promise<ResultatCompatibilite[]>
evaluerCompatibiliteAcquereur(acquereurId: string): Promise<ResultatCompatibilite[]>
```

`src/lib/compatibilite/orchestration.ts` — composition minimale au-dessus des repositories déjà
existants (`getBienById`/`listerBiens`/`getClientById`/`listerClients`), pas un nouveau repository :
aucune responsabilité IO propre, uniquement `evaluerCompatibilite()` appliquée à chaque candidat.
Les deux sens appellent obligatoirement la même fonction — vérifié par un test d'intégration qui
crée un couple bien/acquéreur réel et confirme que `evaluerCompatibiliteBien()` et
`evaluerCompatibiliteAcquereur()` retournent le résultat structurellement identique pour ce couple.
`listerBiens()`/`listerClients()` excluent déjà les entités archivées (ADR-012) — jamais
réintroduites silencieusement comme candidates. La cible elle-même (le bien ou l'acquéreur dont on
consulte la fiche) reste résolue via `getBienById()`/`getClientById()`, qui résolvent une entité
archivée : consulter les compatibilités depuis une fiche déjà archivée reste possible (lecture
informative), seule la liste des *candidats* reste filtrée.

## UX

- **Fiche bien** (`BienTabs.tsx`) — nouvel onglet "Acquéreurs compatibles" : une carte par
  acquéreur actif (`<details>`/`<summary>` natif, sans JS), statut global en `Badge`
  (`success`/`danger`/`default`), triées compatible → à vérifier → incompatible. Le détail
  critère par critère (uniquement les critères pertinents, `non_concerne` jamais affiché) est
  disponible dès l'ouverture — l'explicabilité est une propriété du moteur, pas une fonctionnalité
  facultative reportée à plus tard.
- **Fiche acquéreur** (`clients/[id]/page.tsx`) — nouvelle section "Biens compatibles", même patron
  (la fiche n'a pas d'onglets, une section `<section>` classique comme Offres/Compromis).
- Aucun score sur 100, aucun graphique, aucune nouvelle route ni dashboard. `a_verifier` n'est
  jamais stylé ni libellé comme une incompatibilité (`Badge` `default`, libellé "À vérifier").

## Géographie — explicitement hors périmètre

La recherche géographique acquéreur (aucun champ structuré de secteur/zone recherchée, seulement du
texte libre) n'est pas suffisamment structurée dans le modèle actuel pour participer à ce moteur
déterministe. Aucune comparaison naïve de chaînes, aucune extraction depuis `criteres`, aucun
géocodage bricolé n'a été ajouté pour contourner cette absence. Elle fera l'objet d'une
décision/modélisation séparée si elle est priorisée plus tard — non démarrée automatiquement ici.

## Préférences — hors périmètre V1

Les champs actuels sont interprétés comme des contraintes **uniquement** lorsqu'ils expriment
explicitement un besoin minimum/requis (`piecesMin`, `surfaceMin`, `necessiteParking`,
`necessiteExterieur`, `accessibiliteRequise`). Pas de scoring, pas de poids, pas de
`"nice to have"` implicite, pas d'inférence depuis les notes.

## Persistance

Rien n'est persisté pour le résultat de compatibilité. Les seules données persistées restent les
faits déjà présents (`Bien`, `ProfilAcquereur`) — la compatibilité est `fonction(Bien,
ProfilAcquereur)` à la lecture, recalculée à chaque affichage. Aucune table `resultats_matching`,
aucun `matching_score`, aucun état à synchroniser.

## Conséquences

- Aucune migration de schéma.
- Nouveaux fichiers : `src/lib/compatibilite/{types,criteres,evaluerCompatibilite,orchestration}.ts`
  et leurs tests (`evaluerCompatibilite.test.ts` — 41 cas, `orchestration.test.ts` — 6 cas
  d'intégration Postgres).
- Nouveau fichier de caractérisation : `src/lib/pointsAttention/moteur.test.ts` (30 cas) — ce moteur
  n'avait aucun test avant cette ADR.
- `src/lib/pointsAttention/moteur.ts` modifié (6 règles déléguées aux critères partagés, comportement
  inchangé) ; `src/lib/pointsForts/moteur.ts` non touché.
- `src/components/bien/BienTabs.tsx` (nouvel onglet), `src/app/biens/[id]/page.tsx` (fetch
  `evaluerCompatibiliteBien`), `src/app/clients/[id]/page.tsx` (nouvelle section, fetch
  `evaluerCompatibiliteAcquereur`).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- Hors périmètre, réservé à des passes ultérieures : géographie (nécessite une modélisation
  structurée du secteur recherché), préférences pondérées/scoring, notification/alerte automatique
  sur un nouveau match compatible, intégration avec le moteur d'automatisations (ADR-032/033),
  édition de `budgetMin` pour lui donner une sémantique.
