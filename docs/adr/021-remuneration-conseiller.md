# ADR-021 — Rémunération conseiller

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Le tableau de bord commercial (ADR-018) et le suivi du pipeline (compromis/offres, ADR-014 à
ADR-017) existent déjà, mais aucune notion de rémunération de l'agence/du conseiller n'est stockée
nulle part : `compromis.prixConvenu`/`offres.montant` sont des volumes de transaction, jamais des
honoraires — rappelé explicitement dans l'UI du dashboard à chaque métrique de volume (ADR-018).

Cette passe introduit le **premier fait monétaire de rémunération** d'Atlas, sous forme d'une table
séparée `remuneration`, en relation 1:1 stricte avec `compromis` (option validée explicitement,
plutôt que des colonnes directement sur `compromis` — voir "Alternatives écartées"). C'est aussi la
première fois que le schéma stocke un montant avec une précision au centime : tous les montants
existants (`prixConvenu`, `montant`) sont des euros entiers.

## Décision

### Table séparée 1:1, pas de colonnes sur `compromis`

`remuneration.compromisId` est une FK réelle `UNIQUE NOT NULL` (`ON DELETE CASCADE`, même rationale
que `compromis.bienId`/`acquereurId` : une ligne `remuneration` n'a aucun sens indépendamment de son
compromis). Au plus une ligne par compromis, pour toute sa durée de vie.

### Centimes entiers, parsing texte sans multiplication flottante

`montantHonorairesTotalCentimes`/`montantRemunerationConseillerCentimes` sont des `integer`
représentant des centimes — jamais un flottant, jamais un `real`. Le parsing d'une saisie
utilisateur (`"12487.36"`) vers des centimes exacts se fait par manipulation de chaîne
(`parseMontantCentimes`, `src/types/remuneration.ts`), pas par `Math.round(euros * 100)` : cette
dernière casse sur des valeurs comme `12487.36 * 100 = 1248735.9999999998` en JavaScript. Accepte
indifféremment `.` et `,` comme séparateur décimal, vérifie `Number.isSafeInteger` sur le résultat.
L'affichage (`formatMontantCentimes`) fait le chemin inverse par division entière + modulo, jamais
réutilisé comme valeur intermédiaire ailleurs dans la logique métier — aucun round-trip
centimes → euros → centimes.

### Aucune formule implicite

Pas de `tauxConseillerInformatif`, pas de `prixConvenu × taux`, pas de `honoraires × pourcentage`,
aucune relation automatique entre `montantHonorairesTotalCentimes` et
`montantRemunerationConseillerCentimes`. Seuls des montants saisis à la main font foi. Aucune ligne
vide : si le montant de rémunération du conseiller n'est pas connu, aucune ligne `remuneration`
n'est créée — cohérent avec la convention "inconnu ≠ zéro" appliquée aux agrégats du dashboard.

### Trois états dérivés et mutuellement exclusifs, jamais un `statut` stocké

```ts
export type EtatRemuneration = "previsionnelle" | "associee_vente_finalisee" | "encaissee";

export function deriverEtatRemuneration(
  remuneration: Remuneration,
  statutCompromis: StatutCompromis
): EtatRemuneration | undefined {
  if (statutCompromis === "annule") return undefined;
  if (statutCompromis === "realise" && remuneration.dateEncaissementReelle) return "encaissee";
  if (statutCompromis === "realise") return "associee_vente_finalisee";
  return "previsionnelle"; // en_cours
}
```

Contrairement à `offres.statut`/`compromis.statut`, aucune colonne `statut` n'est stockée sur
`remuneration` : l'état se déduit entièrement de `compromis.statut` + présence de
`dateEncaissementReelle`, jamais dupliqué. `annule` retourne toujours `undefined`, même face à une
`dateEncaissementReelle` renseignée par ailleurs (donnée incohérente en théorie impossible via
`marquerRemunerationEncaisseeAction`, qui exige `statutCompromis === "realise"` — mais la garde
reste explicite pour ne jamais afficher "encaissée" sur un compromis annulé par une autre voie).

Aucune notion comptable/juridique de "CA acquis" n'est gravée dans cette passe : les trois libellés
(`Prévisionnelle`, `Associée à une vente finalisée`, `Encaissée`) restent strictement descriptifs.
Une future passe dédiée déterminera à quel moment une rémunération devient juridiquement/
comptablement acquise et comment elle doit être traitée fiscalement.

### Archivage commercial ≠ clôture du suivi financier historique

Contrairement au reste du domaine commercial (créer une offre/un compromis est bloqué sur un bien
ou un acquéreur archivé, ADR-012/015/016), l'archivage ne bloque **que** les nouveaux engagements/
corrections sur un compromis encore `en_cours` :

| Geste | Compromis `en_cours` | Compromis `realise` |
|---|---|---|
| Créer une rémunération | Bloqué si bien/acquéreur archivé | Toujours autorisé, même archivé |
| Corriger avant encaissement | Bloqué si bien/acquéreur archivé | Toujours autorisé, même archivé |
| Marquer encaissée | Jamais applicable (voir ci-dessous) | Toujours autorisé, même archivé |

Rationale : le règlement financier d'une vente déjà conclue ne s'arrête pas à l'archivage du dossier
commercial — un bien archivé après la vente reste une créance à encaisser, pas un dossier clos au
sens financier. Un compromis encore `en_cours` sur un bien/acquéreur archivé, à l'inverse, ne
justifie aucun nouvel engagement prévisionnel (même logique que le reste du domaine : l'archivage
gèle les nouveaux gestes commerciaux prospectifs).

Cette asymétrie se reflète dans `chargerRemuneration()` (dashboard) : la métrique "prévisionnelle"
exclut les biens archivés (comme `chargerPipeline`, ADR-018) ; les deux métriques "vente finalisée"
(non encaissée et encaissée) incluent les biens archivés (comme `chargerResultats`).

### Encaissement strictement subordonné à la vente finalisée

`marquerRemunerationEncaisseeAction` exige `compromis.statut === "realise"` **et**
`compromis.dateActeReelle` présente — impossible de marquer une rémunération encaissée sur un
compromis `en_cours`. La seconde vérification est une garde défensive (ne devrait jamais être
fausse si le premier test passe, `dateActeReelle` étant posée atomiquement avec `statut = 'realise'`
depuis ADR-017) mais reste explicite, même réflexe que le reste du domaine face à des lignes
historiques créées avant l'introduction d'une garantie.

### Gel après encaissement + gel concurrent

Une fois `dateEncaissementReelle` posée, la ligne est figée : `modifierRemunerationPrevisionnelle`
et `marquerRemunerationEncaissee` protègent chacune leur `UPDATE` par
`WHERE compromis_id = ... AND date_encaissement_reelle IS NULL`. Si l'`UPDATE` ne touche aucune
ligne (déjà encaissée, y compris une course entre deux appels concurrents), le repository retourne
`undefined` plutôt qu'une valeur silencieusement inchangée — la Server Action distingue ce cas
(gel concurrent) du refus amont (vérifié avant l'écriture) et lève une erreur explicite dédiée.

### Correction = remplacement complet en `number | null` / `string | null`

```ts
export type ChampsCorrectionRemuneration = {
  montantRemunerationConseillerCentimes: number;
  montantHonorairesTotalCentimes: number | null;
  dateEncaissementPrevue: string | null;
};
```

`modifierRemunerationPrevisionnelle` remplace intégralement les trois champs corrigibles à chaque
appel — jamais un patch partiel. `montantHonorairesTotalCentimes`/`dateEncaissementPrevue` sont
typés `number | null` / `string | null` (jamais optionnels) pour qu'une remise à `NULL` explicite
(le conseiller vide le champ) soit distinguable d'un "ne pas toucher" qui n'existe pas dans cette
API — un formulaire de correction renvoie toujours l'état voulu des trois champs, jamais un delta.
`dateEncaissementReelle` est volontairement absente du type de création (`NouvelleRemuneration`) :
elle ne peut être posée que par `marquerRemunerationEncaissee`, jamais fournie à la création.

### V1 encaissement unique

Pas de paiement partiel, plusieurs versements, avoirs ni régularisations — une seule
`dateEncaissementReelle` par ligne. Limitation documentée explicitement
(`docs/KNOWN_LIMITATIONS.md`) pour permettre l'introduction future d'une table `encaissements`
dédiée sans rupture de modèle.

### Indicateurs de couverture au dashboard, jamais un total silencieusement partiel

`chargerRemuneration()` retourne, en plus des trois sommes, un compteur de lignes `remuneration`
renseignées sur la population éligible correspondante
(`nombreRemunerationsPrevisionnellesRenseignees`/`nombreCompromisEnCoursEligibles`,
`nombreRemunerationsVentesFinaliseesRenseignees`/`nombreVentesFinalisees`) — calculés par un
`count(*)` séparé sur la même population filtrée, jamais déduits de la somme elle-même. Une somme
sur une population où seule une fraction des lignes a une rémunération renseignée serait trompeuse
(ex. 3 compromis renseignés sur 10 `en_cours` affichant une somme comme si elle couvrait les 10) —
`dashboard/page.tsx` affiche ce compteur en réserve visible sous chaque `MetricCard`, jamais
seulement en tooltip (règle déjà en vigueur pour les autres réserves méthodologiques, ADR-018).
Chaque somme utilise par ailleurs `sum(...) filter (where ...)` sans `coalesce(..., 0)` : une
population sans aucune ligne renseignée retourne `undefined` (affiché "Pas encore renseignée"),
jamais `0` — même convention qu'ADR-018 appliquée ici à des sommes plutôt qu'à des ratios.

## Alternatives écartées

- **Colonnes directement sur `compromis`** : aurait mélangé un fait commercial (le compromis) et un
  fait financier (sa rémunération), avec des règles de mutabilité et d'archivage différentes (une
  rémunération reste corrigible après archivage du bien pour un compromis `realise`, alors
  qu'aucune autre colonne de `compromis` n'est corrigible après sa création) — une table séparée
  rend cette divergence de règles explicite plutôt que de la coder en conditions sur des colonnes
  partagées.
- **`statut` stocké sur `remuneration`** : aurait dupliqué une information déjà entièrement dérivable
  de `compromis.statut` + `dateEncaissementReelle` (même piège qu'un `statut` qui se désynchroniserait
  de son fait générateur) — préféré un calcul pur (`deriverEtatRemuneration`), jamais persisté.
- **Table `encaissements` dès la V1** : sur-ingénierie pour un besoin non exprimé — aucun encaissement
  partiel/multiple n'est demandé aujourd'hui. La distinction `dateEncaissementPrevue`/
  `dateEncaissementReelle` est conservée sur `remuneration` justement pour permettre cette extension
  plus tard sans rupture, même patron que `compromis.dateActe`/`dateActeReelle` (ADR-017).
- **Montants en euros flottants** : rejeté d'emblée pour la première donnée financière précise
  d'Atlas — un flottant introduirait des erreurs d'arrondi silencieuses sur des sommes agrégées au
  dashboard, invisibles jusqu'à ce qu'elles s'accumulent.
- **API de correction partielle (`undefined` = "ne pas toucher")** : plus proche d'un patch REST
  classique, mais rendrait impossible d'effacer explicitement `montantHonorairesTotalCentimes`/
  `dateEncaissementPrevue` une fois renseignés — un besoin réel (un montant d'honoraires saisi par
  erreur doit pouvoir être retiré, pas seulement remplacé). Le remplacement complet en
  `number | null` / `string | null` lève cette ambiguïté au niveau du type.

## Conséquences

- Migration `0013_thin_warbird.sql` : nouvelle table `remuneration` (8 colonnes, 1 FK unique,
  2 `CHECK` de valeur).
- Nouveaux fichiers : `src/types/remuneration.ts`, `src/lib/remunerationRepository.ts`,
  `src/actions/remuneration.ts`, et leurs tests associés.
- `src/lib/historiqueBien.ts` (`deriverHistoriqueBien`) et `src/components/bien/BienTabs.tsx`
  étendus avec un paramètre/une prop `remunerations`.
- `src/lib/dashboardRepository.ts` gagne `chargerRemuneration()` et le type
  `MontantCentimesParMois` (dédié, jamais confondu avec `MontantParMois` qui reste en euros) ;
  `src/app/dashboard/page.tsx` gagne la section "Rémunération".
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`
  mis à jour en conséquence.
