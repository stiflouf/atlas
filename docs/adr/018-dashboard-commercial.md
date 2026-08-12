# ADR-018 — Tableau de bord commercial : agrégation SQL, périmètre archivage, métriques exclues

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Après ADR-014 à 017, Atlas dispose de données structurées sur les visites, offres, compromis,
ventes finalisées, dates prévues/réelles, montants, acquéreurs et archivage. Audit préalable
(non reproduit ici) : sur 17 métriques envisagées, 4 familles sont calculables de façon fiable à
partir des données existantes ; 5 nécessitent une donnée non instrumentée aujourd'hui (visites →
offres, CA, commission, fiscalité) et sont explicitement écartées de cette passe plutôt que
approximées.

## Décision

### Agrégation entièrement côté SQL

`dashboardRepository.ts` (nouveau, lecture seule — aucune Server Action, aucune écriture) expose
quatre fonctions (`chargerResultats`, `chargerPipeline`, `chargerActivite`,
`chargerDelaisPertes`), chacune traduite en `COUNT`/`SUM`/`AVG`/`GROUP BY` exécutés par Postgres.
La page `/dashboard` ne charge jamais l'ensemble des lignes métier pour recalculer en mémoire —
seul le résultat agrégé transite. Un seul écart au query builder Drizzle : la moyenne de visites
avant vente repose sur une sous-requête corrélée (nombre de comptes rendus par vente), non
exprimable proprement autrement, écrite en SQL brut paramétré via `getDb().execute()`.

### Convention de retour : `0` mesuré ≠ `undefined` absence de donnée

Même principe qu'ADR-009 (`NULL ≠ false`) étendu aux agrégats : un compteur/une somme à `0` est
une vraie valeur mesurée. Un taux, une moyenne ou un délai dont le dénominateur est vide retourne
`undefined`, jamais `0` — la page affiche alors "—", jamais un zéro qui laisserait croire à une
mesure réelle.

### Règle d'archivage : historique inclut, pipeline exclut

- **Résultats, Activité, Délais/pertes** (métriques historiques/réalisées) **incluent** les biens
  et acquéreurs archivés — une vente reste une vente après l'archivage du bien qui l'a portée ;
  exclure l'historique le fausserait rétroactivement.
- **Pipeline** (métriques actives/prévisionnelles : compromis en cours, offres en cours) **exclut**
  les biens archivés (jointure sur `biens.archive_le is null`). L'archivage des **acquéreurs**
  n'est volontairement **pas** pris en compte dans ce filtre — seul le bien porte le mandat actif
  qui justifie l'exclusion du pipeline.

### `prixConvenu` = volume de transaction, jamais chiffre d'affaires du conseiller

Rappel explicite affiché dans l'UI à chaque métrique de volume (volume vendu, volume sous
compromis, volume des offres en cours, volume des compromis annulés) : ces sommes sont des
volumes de transaction immobilière, pas une commission ni un CA agence. Aucun calcul de
commission n'existe dans le modèle — le confondre serait trompeur.

### `moyenneVisitesAvantVente` : absence de compte rendu ≠ zéro visite

Calculée uniquement sur les ventes `realise` disposant d'au moins un compte rendu de visite
correspondant (même `bienId` + `acquereurId`, `dateVisite < dateSignature`). Une vente réalisée
sans compte rendu enregistré n'est **jamais** comptée comme "0 visite" — c'est une donnée
inconnue, pas une mesure de zéro — elle est exclue du dénominateur plutôt que de tirer la moyenne
vers le bas. `undefined` si aucune vente réalisée ne dispose d'un compte rendu correspondant.
Réserve affichée directement dans l'UI : "Calculé uniquement sur les ventes disposant d'au moins
un compte rendu de visite."

### Quatre familles, périmètre V1 fermé

- **Résultats** : nombre de ventes finalisées, volume vendu, taux compromis → vente, réalisé par
  mois (regroupement par mois de `dateActeReelle`).
- **Pipeline** : compromis en cours, volume sous compromis, pipeline prévisionnel par mois
  (regroupement par mois de `dateActe`, prévisionnel donc non garanti), offres en cours et leur
  volume.
- **Activité** : visites enregistrées, offres enregistrées, compromis enregistrés, moyenne de
  visites avant vente (voir ci-dessus).
- **Délais / pertes** : délai moyen offre → compromis (uniquement les compromis liés à une
  offre), délai moyen compromis → acte réel, nombre et volume des compromis annulés.

Aucune autre métrique en V1. Chaque métrique porteuse d'une réserve méthodologique l'affiche en
toutes lettres sous sa valeur, jamais seulement dans une infobulle.

### Explicitement écarté de cette passe

Taux visite → offre, délai visite → offre, CA, commission, fiscalité — "ces données ne sont pas
suffisamment instrumentées aujourd'hui" (aucun lien visite ↔ offre matérialisé, aucun modèle de
commission/fiscalité dans le schéma). Les construire maintenant reviendrait à afficher un chiffre
dont la fiabilité ne peut pas être garantie.

### Pas de graphiques, pas de filtre temporel en V1

Les séries "par mois" s'affichent en liste simple (mois : montant), sans bibliothèque de graphes
ni filtre de période — complexité jugée non justifiée pour une V1.

### Navigation

`/dashboard`, libellé "Tableau de bord", ajouté entre "Aujourd'hui" et "Biens" dans la navigation
principale (sidebar et barre mobile).

## Alternatives écartées

**Calculer les agrégats en JavaScript après avoir chargé toutes les lignes** : plus simple à
écrire au premier abord, mais ne passe pas à l'échelle et duplique dans l'application une logique
que Postgres exécute nativement et plus efficacement — écarté sans hésitation.

**Approximer les métriques non instrumentées** (ex. estimer un taux visite → offre via une
fenêtre de dates, sans lien explicite) : rejeté — un chiffre approximatif présenté sans réserve
visible serait plus trompeur qu'une absence de métrique.

## Conséquences

- Nouveau fichier `src/lib/dashboardRepository.ts`, lecture seule, aucune migration nécessaire
  (aucune nouvelle colonne ni table — uniquement des agrégats sur les tables existantes).
- Nouvelle route `/dashboard` (Server Component, `Promise.all` sur les quatre chargeurs).
- Toute nouvelle métrique future devra respecter la même convention `0` vs `undefined` et la même
  règle d'affichage des réserves méthodologiques en clair dans l'UI.
