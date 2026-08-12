# ADR-020 — Motifs et dates de perte commerciale

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Audit des pertes commerciales (offre `refusee`/`retiree`, compromis `annule`) : `changerStatutOffre`
et l'ancien `changerStatutCompromis` faisaient un `UPDATE` du seul `statut`, sans date de
transition ni raison. Impossible de calculer un taux ou une répartition de pertes fiable, ou de
distinguer une offre refusée pour désaccord de prix d'une offre retirée faute de financement.

`biens.statutMandat` a été explicitement exclu de cet audit : c'est une notion du cycle du mandat
vendeur, orthogonale au funnel visite → offre → compromis → vente — pas une perte commerciale au
sens de cette passe.

## Décision

### Colonnes sur `offres`/`compromis`, pas de table séparée

`offres.dateDecision`/`offres.motifPerte`, `compromis.dateAnnulation`/`compromis.motifAnnulation` —
nullables, posées atomiquement avec le statut (même patron que `marquerCompromisRealise`).
Alternatives écartées :
- **Table générique `pertes_commerciales`** : dupliquerait `montant`/`bienId`/`acquereurId` déjà
  présents sur la ligne d'origine, pour une cardinalité 1-1 (une offre a au plus une perte, la
  sienne) — sans le many-to-many qui justifiait `offre_visites` (ADR-019).
- **Table d'événements de statut générale** : sur-ingénierie — chaque offre/compromis ne connaît
  qu'une seule transition finale, jamais réversible (déjà documenté dans
  `docs/KNOWN_LIMITATIONS.md`), aucun besoin de tracer une séquence qui n'existe pas.

### Vocabulaire `MotifPerte` partagé, dérivé d'un seul `as const`

```ts
export const MOTIFS_PERTE = [
  "financement_refuse", "acquereur_se_retire", "vendeur_se_retire",
  "desaccord_prix", "juridique_administratif", "delai_calendrier", "autre",
] as const;
export type MotifPerte = (typeof MOTIFS_PERTE)[number];
```

Un seul type pour `offres.motifPerte` et `compromis.motifAnnulation` — ces deux colonnes,
mutuellement exclusives sur leur propre ligne (`refusee`/`retiree` sur une offre,
`annule` sur un compromis), n'ont pas besoin de deux vocabulaires distincts, seulement d'être
posées au bon endroit physique. Toujours choisi explicitement par le conseiller dans un menu
fermé, jamais déduit d'un texte libre ni d'un acteur implicite — `refusee`/`retiree` ne disent pas
par eux-mêmes qui est à l'origine de la perte.

### Obligation conditionnelle imposée à la compilation, pas seulement à l'exécution

```ts
export type TransitionFinaleOffre =
  | { statut: "acceptee"; dateDecision: string }
  | { statut: "refusee" | "retiree"; dateDecision: string; motifPerte: MotifPerte };
```

`changerStatutOffre(id, transition: TransitionFinaleOffre)` rend l'état "motifPerte renseigné pour
une offre acceptee" irreprésentable — pas seulement vérifié par un `if` à l'exécution. Choix
délibéré (option validée explicitement) pour un invariant jugé important : jamais de motif de
perte sur une offre qui n'a pas été perdue. `compromis.marquerCompromisAnnule(id, dateAnnulation,
motifAnnulation)` reste une fonction dédiée à plat (une seule transition concernée, pas de
discrimination nécessaire) ; `marquerCompromisRealise` inchangée, `date_acte_reelle` reste
l'unique champ de `realise`.

### Aucune corrélation `CHECK` SQL entre statut et date/motif

`date_decision`/`motif_perte`/`date_annulation`/`motif_annulation` sont nullables sans contrainte
« statut final ⇒ date/motif non nul » : une telle contrainte casserait les lignes historiques déjà
en `refusee`/`retiree`/`annule` sans ces champs — **aucun backfill n'est fait ni prévu**. Le
`CHECK` ne porte que sur la valeur du motif (appartenance au vocabulaire) quand elle est renseignée,
jamais sur son obligation, qui reste entièrement portée par la Server Action — même principe
qu'`offres.statut`/`compromis.statut` eux-mêmes.

### Aucun rattrapage, aucune reclassification, aucune inférence

- Une perte sans date/motif compte dans les totaux par étape (`offresRefusees`, `offresRetirees`,
  `compromisAnnules` — ne dépendent que de `statut`), mais est **silencieusement absente** des
  répartitions par motif et des séries mensuelles (filtrées sur la colonne correspondante non
  nulle).
- Un motif `NULL` n'est **jamais** reclassé vers `"autre"` — la répartition par motif ne contient
  que les motifs explicitement renseignés.
- Aucune série mensuelle n'est approximée depuis `dateOffre`/`dateSignature` (date de création,
  pas de la perte).
- Aucune déduction d'acteur depuis `refusee`/`retiree` seuls — le motif choisi fait foi, ou rien.

### Historique enrichi de quatre événements, jamais rétroactifs

`historiqueBien.ts` gagne : `"Offre acceptée/refusée/retirée — {montant}"` (daté par
`dateDecision`) et `"Compromis annulé — {prixConvenu}"` (daté par `dateAnnulation`) — chacun
affiché uniquement si sa date est présente, même garde que `"Vente finalisée"` (ADR-017). Le motif
n'apparaît jamais dans le texte de l'événement (déjà consultable dans l'onglet Offres/Compromis).
"Offre acceptée" est ajoutée en plus des trois événements de perte, par symétrie : les trois
transitions finales disposent désormais d'une date fiable, pas seulement les deux pertes.

### Dashboard : nouvelle famille "Pertes commerciales", pas de duplication

`chargerDelaisPertes()` est scindée en `chargerDelais()` (les 3 métriques de délai) et
`chargerPertes()` (nouvelle) — `compromisAnnules`/`volumeCompromisAnnules` déplacés de la première
vers la seconde plutôt que dupliqués, rejoignant `offresRefusees`/`offresRetirees`/
`volumeOffresPerdues`, les répartitions `pertesOffresParMotif`/`pertesCompromisParMotif` et les
séries `pertesOffresParMois`/`pertesCompromisParMois`. `volumeOffresPerdues`/`volumeCompromisAnnules`
ne sont **jamais** qualifiés de "CA perdu" — "volume des offres perdues" / "volume de transactions
interrompues", même convention que `volumeVendu`/`volumeSousCompromis` (ADR-018). Aucun taux de
conversion par cause en V1 — hors périmètre de cette passe, explicitement exclu.

## Alternatives écartées

Voir "Colonnes sur `offres`/`compromis`, pas de table séparée" ci-dessus pour la comparaison
complète (table générique de pertes, table d'événements de statut).

## Conséquences

- Migration `0012_furry_cassandra_nova.sql` : 4 colonnes nullables, 2 `CHECK` sur la valeur du
  motif uniquement.
- `offreRepository.changerStatutOffre` change de signature (type discriminé) — tous les appelants
  directs (tests) mis à jour. `compromisRepository.changerStatutCompromis` supprimée (son seul
  usage réel était `annule`), remplacée par `marquerCompromisAnnule`.
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`
  mis à jour en conséquence.
