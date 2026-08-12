# ADR-022 — Projection financière annuelle (rémunération)

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-021 a introduit la rémunération conseiller (montants en centimes, trois états dérivés,
compteurs de couverture) mais sans aucune vue temporelle : ni cumul annuel, ni ventilation
mensuelle, ni signal sur les encaissements attendus qui ne se sont pas produits. Un audit dédié
(non technique, mené avant cette passe) a examiné chaque métrique candidate — source, formule,
limites, traitement de l'archivage, comportement quand `dateEncaissementPrevue` est absente — et a
validé qu'Atlas peut construire une vue annuelle/mensuelle fiable **sans toucher à la fiscalité**,
à condition de respecter des règles de fiabilité précises. Cette passe les met en œuvre.

Aucun changement de schéma : toutes les colonnes nécessaires existent déjà
(`remuneration.dateEncaissementPrevue`/`dateEncaissementReelle`, `compromis.statut`).

## Décision

### Extension de `/dashboard` existant, pas de route ni de filtre dédiés

Option retenue explicitement parmi trois : étendre `/dashboard` (choisie), créer
`/dashboard/finances` (écartée), ajouter un filtre de période au dashboard actuel (écartée — un
filtre temporel est un non-but déjà documenté de la V1, `docs/BUSINESS_RULES.md`). Année civile
fixe (janvier → décembre de l'année en cours), aucun sélecteur d'année.

### Scission `chargerProjectionAnnuelle()` de `chargerRemuneration()`

Même patron qu'ADR-020 (`chargerDelaisPertes` → `chargerDelais`/`chargerPertes`) : une fonction
stable et déjà testée (`chargerRemuneration()`, snapshot 3-états inchangé) et une fonction neuve
dédiée à l'année en cours. Convention du fichier respectée : chaque `charger*` reste indépendante,
jamais imbriquée — `chargerProjectionAnnuelle()` n'appelle jamais `chargerRemuneration()`, les deux
sont composées côte à côte via `Promise.all` dans `dashboard/page.tsx`.

### Prévisionnel restant : `en_cours` uniquement, jamais fusionné

`previsionnelRestantCentimes` ne porte que sur les compromis `en_cours` — un compromis `realise`
sort du prévisionnel dès sa signature d'acte, quel que soit son état d'encaissement. Le mélanger
avec "finalisé non encaissé" aurait rendu la métrique ambiguë (à quelle catégorie appartient un
euro compté deux fois ?) — rejeté explicitement.

### Couverture à trois niveaux, jamais dupliquée

`chargerRemuneration()` fournit déjà deux niveaux (population éligible ; population avec une ligne
`remuneration` renseignée). Cette passe ajoute un **troisième niveau** — population avec en plus une
`dateEncaissementPrevue` renseignée — sans jamais recalculer les deux premiers :
`chargerProjectionAnnuelle()` ne retourne que `nombreRemunerationsPrevisionnellesAvecDatePrevue` et
la paire `nombreFinaliseNonEncaisseAvecDatePrevue`/`nombreFinaliseNonEncaisseRenseignees` (cette
dernière paire, elle, doit être recalculée en entier : le dénominateur de
`chargerRemuneration()` mélange ventes encaissées et non encaissées, ce troisième niveau a besoin
d'une population plus étroite qui n'existe nulle part ailleurs). La page compose les trois niveaux
pour l'affichage ("X compromis éligibles, Y/X ont une rémunération, Z/Y ont en plus une date
prévue").

### Mapping `undefined`/`0`/somme — ne jamais se contenter du `NULL` naturel de `SUM ... FILTER`

`SUM(...) FILTER(where fenêtre)` renvoie `NULL` aussi bien quand *aucune date n'est connue* que
quand *des dates sont connues mais aucune ne tombe dans la fenêtre* — deux situations que la
convention "inconnu ≠ zéro" (ADR-018/021) interdit de confondre. Réinterprétation explicite en JS,
appliquée à `previsionnelRestantCentimes` et `encaissementsAttendusDepassesCentimes` :

```
compteurAvecDate === 0
  ? undefined                 // aucune donnée exploitable — on ne sait rien
  : (sommeFenetre ?? 0)       // des dates existent : NULL du FILTER devient un vrai 0 mesuré
```

Testé explicitement (`dashboardRepository.test.ts`) : une date connue mais hors fenêtre produit un
`0` numérique, jamais `undefined`.

### Ventilation mensuelle zero-remplie par `generate_series`

Deuxième et dernier usage de SQL brut paramétré du fichier (après `chargerActivite()`, ADR-018) —
`generate_series` fournit une spine de 12 mois (janvier → décembre), trois `LEFT JOIN`
zero-remplissent chaque catégorie via `coalesce(...,0)`. C'est le **seul** endroit de tout
`chargerRemuneration`/`chargerProjectionAnnuelle` où `coalesce(...,0)` est correct : un mois
zero-rempli est une vraie mesure (aucune ligne ce mois-là), jamais une absence de donnée globale —
à ne jamais confondre avec la convention inverse qui régit les totaux (ci-dessus).

Ventilation par catégorie : prévisionnel et finalisé-non-encaissé par `dateEncaissementPrevue`,
encaissé par `dateEncaissementReelle` (seule date jamais absente pour cet état, ADR-021). Une
ligne sans `dateEncaissementPrevue` reste dans son total global (`chargerRemuneration()`) mais
n'apparaît dans aucun mois — testé explicitement par un test croisé entre les deux fonctions.

### "Encaissement(s) attendu(s) dépassé(s)", jamais "retard"

`dateEncaissementPrevue` est une estimation auto-déclarée, non contractuelle, non recoupée contre
l'acte ou le compromis, et **reste corrigible jusqu'à l'encaissement** (ADR-021). "Retard" implique
une échéance connue et manquée ; ici il n'y a qu'une date qu'une personne a tapée, potentiellement
obsolète. Risque comportemental identifié : si "retard" devenait un indicateur visible, le réflexe
naturel serait de repousser la date pour faire disparaître le signal plutôt que de corriger le vrai
problème, dégradant la qualité même des données que cette passe exploite. Le libellé neutre est
appliqué partout (label, réserves), jamais le mot "retard".

### Écart moyen `dateEncaissementPrevue → dateEncaissementReelle` explicitement non construit

La date prévue restant corrigible jusqu'à l'encaissement, elle ne représente pas nécessairement la
prévision initiale — mesurer un écart contre une valeur qui a pu être réécrite serait trompeur tant
qu'aucun historique des corrections n'existe. Reporté à une éventuelle passe future
d'historisation, hors périmètre ici.

### Total "Finalisé non encaissé à ce jour" jamais filtré à l'année

Réutilise `chargerRemuneration().remunerationVenteFinaliseeNonEncaisseeCentimes` tel quel — un
compromis finalisé n'expire pas, filtrer ce total à l'année en cours l'aurait rendu incohérent avec
le reste du dashboard (ADR-021) qui l'affiche déjà toutes années confondues. La ventilation
mensuelle ci-dessous suffit à montrer la répartition par mois.

### Réserve "Encaissé depuis le 1er janvier" réutilise la couverture des ventes finalisées

"Encaissé" est un sous-ensemble de "ventes finalisées" : une vente réellement encaissée mais dont
la rémunération n'a jamais été saisie dans Atlas reste invisible à cette somme. La réserve UI le
dit explicitement, en réutilisant les compteurs déjà affichés (`nombreVentesFinalisees`,
`nombreRemunerationsVentesFinaliseesRenseignees`), plutôt que de présenter le montant comme
exhaustif.

## Alternatives écartées

- **`/dashboard/finances` dédié** : nouvelle route, deux sources de vérité pour l'argent — écarté,
  voir "Extension de `/dashboard` existant" ci-dessus.
- **Filtre de période sur le dashboard actuel** : contredit un non-but déjà documenté de la V1
  (`docs/BUSINESS_RULES.md`), portée très supérieure au besoin réel (une année fixe suffit).
- **Fusionner prévisionnel et finalisé-non-encaissé dans "restant"** : rendrait la métrique ambiguë,
  contredit les trois états mutuellement exclusifs déjà actés (ADR-021).
- **Libellé "retard"** : voir justification ci-dessus.
- **Construire l'écart moyen dès cette passe** : voir justification ci-dessus (prévision non
  historisée).
- **Se contenter du `NULL` naturel de `SUM ... FILTER`** : aurait confondu "aucune donnée" et "des
  données qui ne tombent pas dans la fenêtre" — rejeté, voir mapping explicite ci-dessus.

## Conséquences

- Aucune migration.
- `src/lib/dashboardRepository.ts` : nouveaux types `MontantCentimesParMoisAnnuel`,
  `DashboardProjectionAnnuelle`, nouvelle fonction `chargerProjectionAnnuelle()` — le commentaire
  de `chargerActivite()` référençant "seule fonction du fichier écrite ainsi" est mis à jour (devenu
  faux, deux fonctions utilisent désormais du SQL brut).
- `src/app/dashboard/page.tsx` : nouvelle section "Projection {année}" entre "Rémunération" et
  "Pipeline", nouveau composant local `VentilationAnnuelleTable`.
- `src/lib/dashboardRepository.test.ts` : nouveau `describe` dédié, dates de fixture dérivées de
  `CURRENT_DATE` lu une seule fois côté Postgres (jamais de l'horloge Node), pour ne jamais risquer
  un décalage jour/année entre le process de test et le serveur.
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`
  mis à jour en conséquence.
