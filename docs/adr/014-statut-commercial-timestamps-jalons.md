# ADR-014 — Statut commercial du bien : timestamps de jalons plutôt qu'un enum

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Le bandeau "État du dossier" de `/biens/[id]` (badge "En commercialisation"/"Offre en cours"/
"Compromis signé") n'existait que pour les deux biens mockés historiques (`DossierBien.statut`,
`data/dossier.ts`) — dernière pièce de ce mock sans équivalent réel (voir l'audit de sortie du
mock, session du 2026-08-12). Aucune donnée réelle actuelle ne permet de dériver cet état sans
l'inventer : `statutMandat` (validité juridique du mandat) et `acquereurs.stade_projet` (pipeline
par acquéreur, pas par bien) sont des concepts distincts ; `comptes_rendus_visite.interet` et le
texte libre des actions ne constituent pas un signal structuré fiable d'offre ou de compromis.

## Décision

Deux colonnes nullables sur `biens`, sans défaut, mêmes conventions qu'`archiveLe` (ADR-012) :
```
offreEnCoursLe: timestamp("offre_en_cours_le", { withTimezone: true })
compromisSigneLe: timestamp("compromis_signe_le", { withTimezone: true })
```

**Aucun champ `statutCommercial` stocké.** L'état affiché (`en_commercialisation`/
`offre_en_cours`/`compromis_signe`) est dérivé en lecture (`deriverStatutCommercial()`,
`src/lib/statutCommercialBien.ts`) : compromis non NULL prioritaire, puis offre, sinon défaut
implicite. Repris à l'identique le patron déjà posé par ADR-012 pour un jalon binaire, étendu ici
à une progression à plusieurs jalons indépendants.

**Mise à jour manuelle uniquement**, par 4 Server Actions (`src/actions/statutCommercialBien.ts`)
— jamais dérivée depuis une visite, un compte rendu ou une action, pour les raisons exposées en
Contexte (aucun signal fiable) :

| Action | Effet | Garde |
|---|---|---|
| Marquer une offre en cours | `offreEnCoursLe = now()` | Refusé (throw) si `archiveLe` posé |
| Retirer l'offre | `offreEnCoursLe = NULL` | Refusé (throw) si `archiveLe` posé **ou** si `compromisSigneLe` posé (incohérence : compromis sans offre sous-jacente) |
| Marquer compromis signé | `compromisSigneLe = now()` | Refusé (throw) si `archiveLe` posé — **ne pose jamais `offreEnCoursLe`** : un compromis peut être marqué directement, sans offre préalable enregistrée |
| Annuler le compromis | `compromisSigneLe = NULL` | Refusé (throw) si `archiveLe` posé |

Refus explicites (throw), même style que `creerAction` — pas un refus silencieux : contrairement à
une note ou un compte rendu, une entrée illégitime ici casserait la cohérence du pipeline affiché.

L'historique dérivé (`deriverHistoriqueBien`) lit directement ces deux timestamps pour produire
"Offre en cours"/"Compromis signé", sans nouveau champ.

## Alternatives écartées

**Colonne `statutCommercial` enum** (même patron que `statutMandat`/`acquereurs.stade_projet`) :
plus simple à éditer (un seul champ), mais perd la date de transition à moins d'ajouter un
timestamp en plus — deux colonnes pour une seule idée, même argument qu'ADR-012 contre
l'archivage par enum. Aurait aussi nécessité un champ séparé pour alimenter l'historique dérivé.

**Dérivation automatique depuis les comptes rendus/actions** : écartée dès l'audit — aucune donnée
existante ne permet de distinguer honnêtement "une offre a été faite" d'un simple intérêt exprimé
(`interet: "interesse"`) sans analyser du texte libre, interdit par ADR-008.

## Conséquences

- **L'historique dérivé n'est pas append-only pour ces deux événements**, contrairement à
  `notes_bien`/`comptes_rendus_visite` : annuler un jalon (`compromisSigneLe = NULL`) efface
  rétroactivement l'événement "Compromis signé" de l'historique affiché, puisqu'il est recalculé
  en direct depuis la valeur courante, pas depuis un journal immuable. Conséquence assumée et
  documentée (`docs/KNOWN_LIMITATIONS.md`) plutôt qu'une complexité de journal d'événements
  supplémentaire.
- Aucune "dernière activité" réelle pour le bandeau — contrairement au mock (`dossier.
  derniereActivite`, valeur statique), aucune donnée équivalente n'est dérivée pour un bien réel
  dans cette passe.
- Les 4 Server Actions restent disponibles sur un bien archivé au niveau du repository
  (`bienRepository.ts` n'a aucune garde interne, même séparation que `archiverBien`), mais
  bloquées explicitement au niveau Server Action — écart volontaire par rapport à
  `modifierBienAction`/`archiverBienAction` (qui restent disponibles sur un bien archivé) : marquer
  un nouveau jalon commercial est un nouveau fait métier sur le dossier, pas une édition des
  champs structurels du bien.
