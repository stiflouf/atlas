# Chronologie V1 — Atlas (`apps/web`)

Reconstruite depuis `git log` (62 commits au 2026-08-11) et l'état actuel du code — pas un détail
commit par commit, mais les grandes étapes fonctionnelles, dans l'ordre où elles ont été
construites. Chaque étape reste vérifiable via `git log --oneline` pour qui veut le détail exact.

## 1. Fondations

Squelette monorepo (Turborepo + pnpm workspaces), types TypeScript et données mockées réalistes,
layout responsive (`AppShell`, `Sidebar`, `BottomNav`), premières versions entièrement mockées de
l'accueil ("Aujourd'hui"), de la liste des biens/fiche bien (onglets contexte/historique/notes/
visites/documents/actions), et de la préparation de visite. Premiers raffinements : fuseau
horaire centralisé, tri déterministe des dossiers par priorité, gestion des événements calendrier
"journée entière".

## 2. Google Calendar et moteur de matching

Authentification OAuth 2.0 (tokens chiffrés, protection CSRF par `state`), client Google Calendar
avec pagination, bascule de l'accueil sur les vrais rendez-vous avec repli et indicateur de
source. Introduction du moteur de matching déterministe (`RendezVous → ContexteRendezVous`),
récupération d'un événement unique, résolution de la préparation de visite par contexte plutôt que
par id brut, confirmation d'un bien ambigu par le conseiller.

## 3. PostgreSQL et mémoire persistée

Introduction de Postgres via Drizzle dans `apps/web` (ADR-006) : schéma mono-conseiller et table
de mémoire contextuelle générique. Connexion Google désormais persistée en base (fin du cookie de
tokens), priorité validation humaine > cache > moteur de matching implémentée et testée.

## 4. Enrichissement géographique de la préparation

Remplacement progressif des blocs curatés mockés de la préparation de visite par des données
réelles : géocodage IGN de l'adresse du bien (avec seuil de qualité), transports et Vélib' à
proximité, écoles via l'annuaire de l'Éducation nationale, patrimoine via la base Mérimée
(avec extraits "à raconter" sélectionnés algorithmiquement), transactions de marché réelles via
DVF. Retrait complet du contexte humain mocké et des blocs curatés une fois leurs équivalents
réels disponibles.

## 5. Points d'attention et points forts

Moteurs de règles déterministes V1 : points d'attention (prix vs budget, statut du mandat,
transport, accessibilité, pièces/surface, parking/extérieur), points forts (parking/extérieur en
bonus non demandé). Premiers tests unitaires du projet (introduction de Vitest).

## 6. Biens et acquéreurs réels

Tables `biens`/`acquereurs`, repositories associés, première création réelle d'un bien puis d'un
acquéreur. Accueil, matching et préparation de visite branchés sur ces repositories plutôt que sur
les mocks directement — début de la bascule démo → réel décrite dans `docs/DEMO_VS_REAL.md`.
Ajout de "Clients" à la navigation principale.

## 7. Agenda "à venir"

Section "À venir" sur l'accueil (7 prochains jours), en plus du jour courant, réutilisant la
fenêtre de lecture déjà large de `getAgendaSemaine()`.

## 8. Actions

Table `actions` et repository associé, remplaçant les anciens mocks séparés "relances"/"tâches à
préparer" par un modèle unique (bien/acquéreur/aucun des deux, priorité, échéance, statut).
Création d'une action directement depuis la fiche d'un bien ou d'un acquéreur, avec préremplissage
du formulaire.

## 9. Historique réel et notes

Fiche bien réelle affranchie de sa dépendance au `DossierBien` mocké pour Contexte et Actions.
Historique dérivé de faits réellement persistés (création du bien, actions créées/terminées).
Notes libres persistées par bien (table dédiée `notes_bien`, append-only).

## 10. Mémoire du dossier et comptes rendus de visite

Section "Mémoire du dossier" sur la page de préparation de visite (comptes rendus précédents,
notes, actions en cours, historique récent — uniquement des faits déjà enregistrés par le
conseiller). Puis boucle complète "après la visite" : table dédiée `comptes_rendus_visite`
(intérêt structuré, retour libre, prochaine étape textuelle sans génération automatique d'action),
enrichissant à leur tour l'historique du bien et la mémoire du dossier pour une prochaine visite du
même couple bien/acquéreur.

## 11. Édition des biens et acquéreurs réels

Sprint de documentation technique (`docs/`, ADR 007-011) puis reprise des fonctionnalités :
`/biens/[id]/modifier` et `/clients/[id]/modifier`, réservées aux entités réelles. Formulaires de
création et d'édition factorisés (`BienFormulaire`/`AcquereurFormulaire`, parsing/validation
partagés dans `bienFormulaire.ts`/`acquereurFormulaire.ts`) — même validation serveur, même
préremplissage tri-état (`undefined` → "Inconnu", jamais "Non" par défaut) dans les deux modes.
`modifierBien()`/`modifierAcquereur()` rafraîchissent explicitement `modifie_le` et retournent
`undefined` si l'id ne correspond à aucune ligne réelle, plutôt que de supposer une modification
effective.

## 12. Archivage contrôlé des biens et acquéreurs

Sortie réversible d'un bien ou d'un acquéreur des flux actifs, sans suppression physique
(ADR-012) : colonne `archive_le` (nullable) sur `biens`/`acquereurs`, `NULL` = actif. `listerBiens()`/
`listerClients()` excluent les lignes archivées par défaut ; `listerBiensArchives()`/
`listerClientsArchives()` (routes `/biens?archives=1`, `/clients?archives=1`) les affichent
séparément. `getBienById()`/`getClientById()` continuent de résoudre une entité archivée, donc sa
fiche, son historique, ses notes et ses comptes rendus restent consultables — seules les
créations liées sont bloquées : `creerAction` refuse explicitement (erreur) toute association à
une entité archivée, `ajouterNoteBienAction`/`enregistrerCompteRenduVisiteAction` refusent
silencieusement côté serveur (l'UI empêche déjà le cas normal). Le moteur de matching exclut les
archivés puisqu'il ne consomme que `listerBiens()`/`listerClients()`, sans code spécifique
supplémentaire. Actions liées à un acquéreur archivé exclues de "Autres actions" à l'accueil.

## 13. Documents réels attachés à un bien

Dernier onglet majeur de la fiche bien sortant du mock : `documents_bien` (table dédiée, FK réelle
vers `biens`), stockage du binaire sur le filesystem local du serveur (`stockage-documents/`, hors
`public/`), jamais en base et sans dépendance objet externe (ADR-013). Nom physique sur disque =
clé opaque générée côté serveur, jamais le nom fourni par le conseiller — le nom original reste
une métadonnée, restituée uniquement au téléchargement via `Content-Disposition`. Liste blanche
stricte (PDF, JPEG, PNG), 10 Mo maximum côté validation applicative. Ajout bloqué sur un bien
archivé (formulaire masqué + refus silencieux serveur, même patron que Notes) ; documents déjà
existants d'un bien archivé restent consultables et téléchargeables. Aucune suppression en V1,
append-only comme Notes et Comptes rendus (ADR-011).

## 14. Statut commercial du bien

Dernière pièce du mock `DossierBien` sortie du mock : le bandeau "État du dossier" devient réel
pour tout bien. Aucun statut stocké — deux timestamps de jalons (`offreEnCoursLe`,
`compromisSigneLe`, ADR-014), état dérivé en lecture (`deriverStatutCommercial`). Quatre Server
Actions manuelles (marquer/retirer offre, marquer/annuler compromis), jamais automatisées depuis
une visite, un compte rendu ou une action — aucune donnée réelle ne permet de le faire
honnêtement. Compromis marquable directement sans offre préalable. `retirerOffreAction` refuse
explicitement si un compromis est déjà signé ; les 4 actions refusent explicitement sur un bien
archivé. Historique dérivé enrichi de "Offre en cours"/"Compromis signé", datés par ces mêmes
timestamps — non append-only, annuler un jalon efface rétroactivement l'événement correspondant
(conséquence assumée, voir `docs/KNOWN_LIMITATIONS.md`).

## 15. Offre d'achat structurée

Table `offres` (bien, acquéreur, montant, date, statut, date de validité optionnelle) : le "qui,
combien" que `offreEnCoursLe` seul ne pouvait pas représenter (ADR-015). Montant/acquéreur/bien/
date immuables après création — une nouvelle proposition est une nouvelle ligne. Statut mutable
en place (`en_cours` → `acceptee`/`refusee`/`retiree` uniquement, jamais l'inverse). Créer une
offre pose aussi `offreEnCoursLe` (couplage unidirectionnel) ; changer son statut ne touche jamais
`offreEnCoursLe`/`compromisSigneLe` — gestes commerciaux séparés. Refus explicites sur bien/
acquéreur archivé, offre déjà résolue, ou montant invalide. Nouvel onglet "Offres" sur la fiche
bien réelle (aucun équivalent mock), section de lecture sur la fiche acquéreur. Historique dérivé
enrichi d'un événement de création par offre, jamais l'acquéreur nommé, aucun événement pour un
changement de statut (pas de date de transition fiable disponible).

## 16. Compromis structuré

Table `compromis` (bien, acquéreur, offre acceptée optionnelle, prix convenu, date de signature,
date d'acte optionnelle, statut) : le "qui, quel prix, quand l'acte" que `compromisSigneLe` seul
ne pouvait pas représenter (ADR-016). Prix/bien/acquéreur/offre/date de signature immuables après
création — une nouvelle signature est une nouvelle ligne, plusieurs compromis historiques
autorisés par bien, un compromis annulé reste consultable. Statut mutable en place (`en_cours` →
`realise`/`annule` uniquement). Garde applicative : un seul compromis `en_cours` par bien à la
fois. Offre liée validée côté serveur (même bien, même acquéreur, statut `acceptee`). Créer un
compromis pose `compromisSigneLe` (couplage unidirectionnel) ; changer son statut ne le touche
jamais. Refus explicites sur bien/acquéreur archivé, compromis déjà en cours, offre liée
incohérente, ou compromis déjà résolu. Nouvel onglet "Compromis" sur la fiche bien réelle, section
de lecture sur la fiche acquéreur. Historique dérivé enrichi de "Compromis structuré — {prix}",
libellé volontairement distinct de l'événement générique ADR-014 ("Compromis signé") qui continue
de coexister séparément.

## 17. Vente finalisée

Nouveau champ `dateActeReelle` sur `compromis`, distinct de `dateActe` (prévue, inchangée) — le
"vendu, à qui, à quel prix, quand réellement" qu'aucune donnée existante ne pouvait représenter
(ADR-017). Aucune nouvelle entité : `Compromis` portait déjà bien/acquéreur/prix. Passage à
`realise` : `dateActeReelle` obligatoire, écriture atomique avec le statut
(`marquerCompromisRealise`) — jamais de compromis `realise` sans date réelle. 4e état commercial
dérivé `vendu` (`deriverStatutCommercial`, prioritaire sur `compromis_signe`), badge "Vendu" sur le
bandeau. Historique dérivé enrichi de "Vente finalisée — {prix}", daté par `dateActeReelle` —
seule exception à "pas d'événement pour un changement de statut", justifiée par l'écriture
atomique. Toujours aucun couplage automatique vers l'archivage, `stadeProjet`, ou une commission.
La distinction `dateActe`/`dateActeReelle` est conservée délibérément pour un futur suivi de
pipeline/délais/CA prévisionnel vs réalisé/conversions — aucun calcul de ce type construit dans
cette passe.

## 18. Tableau de bord commercial

Premier tableau de bord d'Atlas, entièrement calculé côté SQL (`dashboardRepository.ts`,
`COUNT`/`SUM`/`AVG`/`GROUP BY` par Postgres, jamais recalculé en mémoire — ADR-018). Quatre
familles de métriques bâties uniquement sur des données déjà persistées : Résultats (ventes
finalisées, volume vendu, taux compromis → vente, réalisé par mois), Pipeline (compromis/offres en
cours et leurs volumes, prévisionnel par mois via `dateActe`, biens archivés exclus), Activité
(visites/offres/compromis enregistrés, moyenne de visites avant vente), Délais/pertes (délai offre
→ compromis, délai compromis → acte, compromis annulés et leur volume). Convention `0` mesuré vs
`undefined` absence de donnée étendue aux agrégats (ADR-009). Règle d'archivage différenciée :
l'historique inclut les entités archivées, le pipeline actif exclut les biens archivés. Correction
notable sur la moyenne de visites avant vente : une vente sans compte rendu enregistré est exclue
du dénominateur, jamais comptée comme "0 visite". `prixConvenu` rappelé partout comme volume de
transaction, jamais le CA du conseiller. Explicitement écarté faute d'instrumentation suffisante :
taux/délai visite → offre, CA, commission, fiscalité. Pas de graphiques, pas de filtre temporel en
V1. Nouvelle route `/dashboard`, ajoutée à la navigation principale sous "Tableau de bord".

## 19. Lien explicite visite → offre

Nouvelle table de liaison many-to-many `offre_visites` (ADR-019) — jamais une inférence par
proximité de date ou par texte, toujours un geste explicite du conseiller. Représente sans
exception les quatre cas du domaine : offre sans visite, visite sans offre, plusieurs visites
précédant une même offre, une même visite précédant plusieurs offres successives. Intégrité
applicative (offre et visite existantes, même bien, même acquéreur, `dateVisite <= dateOffre`,
paire unique) validée côté Server Action, jamais en `CHECK` SQL. Deux points d'entrée : à la
création d'une offre (`ajouterOffreAction`, transaction unique couvrant l'offre, ses liens et le
jalon `offreEnCoursLe` — tout ou rien) et rétroactivement sur une offre déjà existante
(`lierVisiteAOffreAction`/`delierVisiteAction`) — la liaison n'est jamais figée au seul instant de
création de l'offre, et se corrige sans jamais modifier la visite ni l'offre elles-mêmes. Aucune
garde d'archivage sur la liaison (documente un rapprochement entre faits existants, pas un nouveau
fait commercial), aucun événement d'historique dédié, aucun backfill automatique de l'historique
antérieur. Débloque deux métriques dans `/dashboard` explicitement écartées par ADR-018 : taux
visite → offre (Activité) et délai moyen visite → offre (Délais/pertes), toutes deux réservées aux
visites explicitement liées.

## 20. Motifs et dates de perte

Audit des pertes commerciales (offre refusée/retirée, compromis annulé) : aucune date fiable de
décision, aucun motif stocké jusqu'ici. Ajout de `dateDecision`/`motifPerte` sur `offres` et
`dateAnnulation`/`motifAnnulation` sur `compromis` (ADR-020), posés atomiquement avec le statut
(même patron que `marquerCompromisRealise`). Vocabulaire `MotifPerte` partagé (7 valeurs, dérivé
d'un unique `as const`) — choisi explicitement par le conseiller, jamais déduit d'un texte libre
ni d'un acteur implicite. `dateDecision` obligatoire pour les 3 transitions finales d'une offre,
`motifPerte` obligatoire pour `refusee`/`retiree` et toujours `NULL` pour `acceptee` — imposé à la
compilation via un type discriminé (`TransitionFinaleOffre`), pas seulement à l'exécution. Aucune
corrélation `CHECK` SQL avec le statut (uniquement sur la valeur du motif) : les lignes historiques
sans date ni motif restent valides, comptées dans les totaux par étape, mais absentes des
répartitions par motif et des séries mensuelles — aucun backfill, aucun motif `NULL` reclassé en
`"autre"`. `statutMandat` explicitement exclu du périmètre (cycle du mandat vendeur, pas une perte
commerciale). Nouvelle section dashboard "Pertes commerciales" (`chargerPertes`, ex-`compromisAnnules`/
`volumeCompromisAnnules` déplacées depuis `chargerDelaisPertes`, renommée `chargerDelais`) : pertes
par étape, par motif, par mois, volume perdu jamais qualifié de "CA" (`volume des offres perdues`,
`volume de transactions interrompues`). Trois nouveaux événements d'historique
(`"Offre acceptée/refusée/retirée"`, `"Compromis annulé"`), datés par les nouveaux champs, jamais
affichés sans eux. Pas de taux de conversion par cause en V1.

## 21. Rémunération conseiller

Première donnée financière précise d'Atlas : nouvelle table `remuneration` (ADR-021), en relation
1:1 stricte avec `compromis` (`compromisId` `UNIQUE`), montants stockés en **centimes entiers**
(jamais un flottant), contrairement aux euros entiers utilisés partout ailleurs dans le schéma.
Trois faits monétaires distincts, jamais fusionnés en une notion comptable/juridique de "CA
acquis" : rémunération prévisionnelle, associée à une vente finalisée, encaissée — dérivés à la
lecture de `compromis.statut` + `dateEncaissementReelle`, jamais un `statut` stocké. Aucun calcul
automatique (jamais `prixConvenu × taux`, jamais `honoraires × pourcentage`) : seuls des montants
saisis à la main font foi, aucune ligne créée si le montant est inconnu. V1 suppose un encaissement
unique (pas de paiement partiel, plusieurs versements, avoirs ni régularisations) ; une fois
`dateEncaissementReelle` posée, la ligne est figée, protégée par un gel concurrent
(`WHERE date_encaissement_reelle IS NULL`) sur les deux écritures (`modifierRemunerationPrevisionnelle`/
`marquerRemunerationEncaissee`). Encaissement strictement subordonné à une vente finalisée
(`compromis.statut === "realise"` et `dateActeReelle` présente). Exception notable au reste du
domaine commercial : l'archivage du bien/acquéreur ne bloque que les nouveaux engagements sur un
compromis encore `en_cours` — jamais la correction ni l'encaissement d'une rémunération sur un
compromis déjà `realise` ("archivage commercial ≠ clôture du suivi financier historique"). Une
rémunération prévisionnelle sur un compromis ensuite annulé reste consultable telle quelle, sort du
prévisionnel actif, sans métrique dédiée en V1. Nouvelle famille dashboard "Rémunération" : trois
montants mutuellement exclusifs, chacun accompagné d'un compteur de couverture (lignes renseignées
sur population éligible) pour ne jamais laisser une somme partielle se lire comme un total
exhaustif ; règle d'archivage volontairement asymétrique (prévisionnelle exclut les biens archivés,
comme le pipeline ; les deux métriques "vente finalisée" les incluent, comme les résultats). Un
nouvel événement d'historique, `"Rémunération encaissée"`, daté par `dateEncaissementReelle`, jamais
affiché sans elle.

## 22. Projection financière annuelle

Audit préalable (métrique par métrique : source, formule, limites, archivage, comportement si
`dateEncaissementPrevue` absente) débouchant sur `chargerProjectionAnnuelle()` (ADR-022, scindée de
`chargerRemuneration()` — même logique qu'ADR-020), qui étend `/dashboard` existant sans nouvelle
route ni filtre temporel : année civile fixe, janvier → décembre. Quatre nouvelles métriques :
encaissé depuis le 1er janvier (biens archivés inclus), prévisionnel restant jusqu'au 31 décembre
(`en_cours` uniquement, jamais fusionné avec finalisé non encaissé, biens archivés exclus),
"Encaissement(s) attendu(s) dépassé(s)" — jamais "retard", justifié par le caractère auto-déclaré et
corrigible de `dateEncaissementPrevue` — et une ventilation mensuelle zero-remplie (`generate_series`,
deuxième et dernier usage de SQL brut du fichier) répartissant prévisionnel/finalisé non encaissé par
`dateEncaissementPrevue` et encaissé par `dateEncaissementReelle`. Couverture à trois niveaux : les
deux premiers (population éligible, ligne `remuneration` renseignée) réutilisés tels quels depuis
`chargerRemuneration()`, jamais dupliqués ; le troisième (date prévue renseignée) neuf. Mapping
explicite `undefined`/`0`/somme en JS pour ne jamais confondre "aucune date connue" (vraiment
inconnu) et "des dates connues mais hors fenêtre" (un vrai zéro mesuré) — le `NULL` naturel de
`SUM ... FILTER` aurait confondu les deux. Aucun écart moyen prévu/réel construit (la date prévue
reste corrigible jusqu'à l'encaissement, la mesurer serait trompeuse sans historique des
corrections). Aucun changement de schéma, aucune fiscalité.

## 23. Fondations fiscales

Audit fiscal préalable (champ légal, sources BOFiP/URSSAF, statuts de vérification par règle) suivi
d'une passe de modélisation dédiée : cinq nouvelles tables (`dossier_fiscal`, `profil_fiscal`,
`historique_amorcage`, `rfr_foyer`, `regle_fiscale`, ADR-023). Racine `dossier_fiscal` mono-dossier
(même patron que `connexions_google`, ADR-006) à laquelle se rattachent les trois autres tables du
domaine, pour que le futur rattachement conseiller reste additif. `profil_fiscal` reprend le patron
instantané complet historisé déjà établi par `remuneration` (append-only, jamais un historique
champ par champ) mais sans contrainte d'ordre sur `dateDebutValidite` — une correction rétroactive
d'un changement de situation découvert après coup est explicitement admise, résolue par
`dateDebutValidite DESC, creeLe DESC`. `historique_amorcage` généralise `NULL ≠ false` (ADR-009) à
un agrégat annuel : absence de ligne = couverture antérieure inconnue, jamais un CA de zéro,
contrat typé (`CouvertureAnnuelle`) préparé pour le futur résolveur d'ADR-024, avec
`dateFinCouverture` portant l'invariant anti-double-comptage. `rfr_foyer`, entièrement optionnel,
introduit `nombrePartsCentiemes` (entier exact, 1,5 part = `150`) — même principe "jamais de
flottant sur une donnée fiscale" appliqué à `regle_fiscale.valeur` (`centimes`/`points_base`/
`jours`). `regle_fiscale` porte uniquement des paramètres légaux datés, jamais un algorithme,
convention temporelle `[début, fin[`, chevauchement rejeté explicitement par le repository plutôt
qu'un `CHECK` SQL inter-lignes ; amorcé en migration avec les valeurs 2026 (plafond micro-BNC,
seuils de franchise TVA, taux de cotisations, CFP, abattement micro-BNC, versement libératoire),
chacune tracée par un statut de confiance (`verifie_direct`/`recoupement`/`a_confirmer`). Nouvelle
page `/fiscal` ("Ma situation fiscale") : collecte de faits uniquement, aucune estimation ni aucun
calcul affiché — construits ensuite par ADR-024 (moteur année courante) et ADR-025 (projections
N+1 à N+5).

## 24. Moteur fiscal, année civile courante

Premier moteur de calcul fiscal (ADR-024), borné à l'année en cours, construit exclusivement à
partir des fondations ADR-023 et des faits `remuneration`/`chargerProjectionAnnuelle` (ADR-021/022)
— aucune nouvelle table. `resoudreAssietteAnnuelle` corrige un piège identifié en revue
architecturale : en l'absence de ligne `historique_amorcage`, tous les encaissements Atlas connus
comptent quand même dans le montant connu, mais la couverture reste "partielle" et la période
"inconnue" couvre toute l'année visible — jamais une déduction d'un début de couverture depuis le
seul fait qu'un premier encaissement existe. Chaque encaissement est rattaché à la règle légale
applicable à sa date exacte (`resoudreTrancheAvecTaux`), jamais un taux moyen appliqué au total ;
une tranche d'amorçage chevauchant un changement de taux devient explicitement non ventilable.
Cotisations sociales/CFP/versement libératoire gardés strictement au régime micro-BNC réellement
couvert par le référentiel (jamais un taux appliqué à une déclaration contrôlée ou à la Cipav,
`regime_non_couvert` sinon) ; l'ACRE, absente du référentiel, retourne `regle_absente` plutôt que le
taux plein. Franchise TVA limitée à `regimeTva = 'franchise'` — aucune sémantique HT/TTC modélisée
pour un profil redevable, aucune couche TVA/facturation créée. Micro-BNC : jamais de verdict de
"sortie du régime", uniquement des faits datés et leur couverture ; le plafond proratisé d'une année
de création est présenté comme une valeur de référence pour le mécanisme légal des années de
référence, jamais un seuil de sortie immédiate. Arithmétique entière/`BigInt` exclusive (taux en
points de base, prorata en jours) — `Math.round(a * b / c)` banni, remplacé par un arrondi "moitié
vers le haut" testé aux bornes. Contrat `ResultatFiscal<T>` générique (jamais un `number` nu) :
"calcule" seulement si aucune raison n'existe, y compris l'incomplétude de l'assiette elle-même.
Projection fin d'année en trois blocs jamais fusionnés (encaissé réel / finalisé non encaissé
restant, nouveau champ symétrique sur `chargerProjectionAnnuelle` / compromis en cours restant,
réutilisé d'ADR-022 sans duplication). Nouvelle section "Vue {année}" sur `/fiscal` : cinq blocs
(encaissé, à provisionner, seuils, à venir, ce qu'Atlas ne sait pas calculer et pourquoi), avec
explication assiette + provenance sous chaque montant.

## 25. Projection fiscale pluriannuelle (N+1 à N+5)

Extension du moteur fiscal (ADR-025) à un horizon N+1 → N+5, à partir du pipeline commercial daté et
d'une tendance statistique (run-rate) dérivée des encaissements réels — toujours sans nouvelle
table. Pipeline daté et tendance statistique restent deux blocs strictement séparés, jamais
additionnés (aucun champ agrégé sur `ProjectionAnneeFiscale`) : Atlas n'a aucun historique de
snapshots permettant d'estimer leur recouvrement. Le run-rate se calcule sur une série mensuelle
zero-remplie (un mois sans vente compte comme 0), avec un seuil produit de 6 mois calendaires
entièrement garantis par `historique_amorcage` — jamais une moyenne sur les seuls mois ayant une
vente. `resoudreRegleProjection` distingue, pour une date future, une règle explicitement bornée et
publiée ("officielle") d'une simple reconduction hypothétique de la dernière règle connue
("hypothese_reconduction", jamais matérialisée en base) — `dateFinValidite = NULL` ne prouve jamais
qu'une règle est officiellement connue pour une année lointaine. Chaque tranche (mois de run-rate ou
élément de pipeline) est résolue à sa propre date, pour qu'un changement de taux/régime en cours
d'année projetée s'applique mois par mois, jamais un dernier taux connu multiplié par le total
annuel — même contrainte pour une hypothèse utilisateur (montant annuel unique) : si le profil ou
une règle change en cours d'année, chaque composante retourne explicitement `ventilation_requise`
plutôt qu'une répartition devinée. Les hypothèses utilisateur ne sont jamais persistées (lues depuis
la query string d'un formulaire GET, valables uniquement pour la requête courante). Nouvelle section
"Projection {N+1}–{N+5}" sur `/fiscal`, une carte par année.

## 26. Moteur d'alertes déterministes du copilote

Moteur d'alertes (ADR-026) qui dérive, à la lecture et sans aucune persistance, un ensemble
priorisé d'alertes à partir des résultats déjà exposés par ADR-022→025 — même patron que
`pointsForts`/`pointsAttention` (règles pures `{ id, evaluer }`) et `actionPriority.ts` (priorité
par score). Distingue systématiquement un champ réellement inconnu (action possible) d'un régime
réellement renseigné mais non couvert par le moteur V1 (jamais une action de changer sa situation
réelle). L'alerte "assiette incomplète" se fonde sur `AssietteAnnuelle.couverture`, jamais sur
l'absence brute d'une ligne `historique_amorcage`. Déduplication par cause racine (type + code) :
un profil fiscal absent supprime toute alerte fiscale dépendante sans supprimer les alertes
commerciales indépendantes ; une couverture insuffisante peut absorber l'alerte de run-rate
insuffisant pour la même cause, jamais l'alerte de règles futures hypothétiques (cause
indépendante) ; les règles futures reconduites à titre d'hypothèse sont regroupées en une seule
alerte sur tout l'horizon N+1→N+5. Nouvelle section "Ce qui mérite mon attention" en tête de `/` :
5 alertes prioritaires au maximum, le reste derrière un `<details>` natif "Afficher les autres",
aucune nouvelle route. Aucune alerte de proximité de seuil dans cette V1.

## 27. CRM vendeur / prise de mandat

Nouvelle entité `prospects_vendeurs` (ADR-027) : une opportunité commerciale de prise de mandat
sur un bien potentiel, avec un contact vendeur principal, en amont du cycle déjà modélisé par
`biens` — comble un vide total (aucune entité vendeur/propriétaire n'existait avant cette passe).
Statut jamais stocké, dérivé d'une cascade de jalons (`prospect → qualification → rendez_vous →
estimation → mandat_propose → mandat_signe`, `perdu` prioritaire depuis n'importe quel état) — un
rendez-vous seulement planifié n'avance jamais le statut, seul un rendez-vous marqué réalisé le
fait. Adresse précise et secteur approximatif restent deux champs distincts, jamais fusionnés :
seule l'adresse précise peut préremplir le bien à la conversion. `dernierContactLe` n'avance que
sur une vraie interaction (note typée, ou rendez-vous réalisé), jamais sur un simple jalon de
pipeline interne — les notes elles-mêmes distinguent une interaction d'une remarque interne.
Archivage (erreur de saisie, doublon) distinct de la perte commerciale, jamais mélangés dans les
statistiques. La conversion en bien (`signerMandatProspectVendeurAction`) est une transaction
atomique qui rejette explicitement toute valeur obligatoire manquante — aucune donnée fictive.
Nouvelle section `/prospects-vendeurs` (liste + fiche + création + signature de mandat), et
section "Pipeline vendeur" sur `/dashboard` avec un taux de conversion explicitement limité aux
opportunités clôturées. Aucune modification de la table `actions` ni du moteur de tâches — réservé
à un futur ADR-028.

## 28. Moteur de tâches générique

Table `actions` renommée `taches` (ADR-028) et entièrement repensée : sept colonnes FK nullables
dédiées (`bienId`, `acquereurId`, `prospectVendeurId`, `visiteId`, `offreId`, `compromisId`,
`remunerationId`) avec un `CHECK` garantissant qu'au plus une cible est renseignée, plutôt qu'un
couple `objetType`/`objetId` polymorphe sans intégrité référentielle — une union TypeScript
`CibleTache {type,id}` reste exposée comme API générique au-dessus. Statut jamais stocké, dérivé de
`termineeLe`/`annuleeLe` (`deriverStatutTache`) ; `StatutTache` conserve une valeur `'en_attente'`
réservée, jamais dérivée aujourd'hui, pour une future vraie notion métier d'attente. L'absence
d'échéance s'affiche "Sans échéance" (jamais "En attente", qui aurait laissé croire à cette notion
inexistante). `origine` (`'manuelle'`/`'automatique'`) et `origineCode` (identifiant machine stable,
jamais du texte d'affichage) préparent une future génération automatique de tâches sans en
implémenter la moindre règle — l'idempotence/déduplication de cette future automatisation est
documentée comme non construite, volontairement.

Terminer une tâche ne signifie jamais silencieusement "contact réalisé" : pour une tâche rattachée
à un prospect vendeur, l'enregistrement d'une vraie interaction reste **optionnel**, une case à
cocher explicite dans le même geste qui réutilise le mécanisme ADR-027
(`notes_prospect_vendeur`/`dernierContactLe`) — aucun mécanisme équivalent pour les autres cibles,
qui n'ont pas encore de journal d'interactions structuré.

Migration sans heuristique : audit préalable des lignes `actions` portant simultanément `bienId` et
`acquereurId` (aucune trouvée → migration directe, sinon la migration se serait arrêtée pour un
traitement explicite) ; migration immédiate des anciens champs simples
`prospectsVendeurs.prochaineAction`/`prochaineActionLe` en tâches réelles, colonnes supprimées dans
la même migration — aucune période de compatibilité, aucun dual-write. Nouvelle route
`/taches/nouveau` (cible bien/acquéreur/prospect vendeur/aucune), section "Tâches" sur les fiches
bien/acquéreur/prospect vendeur, `/prospects-vendeurs` (liste) et `/` (accueil) désormais dérivés
des tâches réelles plutôt que des anciens champs simples.

## 29. Dossier documentaire transactionnel

Audit préalable complet du système documentaire réel (`documents_bien`, ADR-013), des entités
bien/acquéreur/prospect vendeur/offre/compromis/tâches (ADR-027/028), et des retours terrain d'une
clerc de notaire — avant tout codage. Quatre concepts séparés explicitement : DOCUMENT (fichier
reçu), RATTACHEMENT (à quel bien/personne/transaction), EXIGENCE DOCUMENTAIRE (règle produit
codée) et CONTRÔLE (état dérivé, jamais stocké).

**Immutabilité du fichier séparée de la correction du classement.** `documents_bien` gagne des
colonnes de classement/rattachement corrigibles (`typeDocument`, dates, `compromisId`/
`acquereurId`/`prospectVendeurId`, `coproprieteDeclaree`/`adresseDeclaree`, `provenance`,
`etatVerification`) via `corrigerClassementDocumentBien` (remplacement complet, même contrat que
`remuneration`, ADR-021) — mais `nomFichierOriginal`/`cleStockage`/`tailleOctets`/`typeMime`/
`creeLe` restent immuables (ADR-013 inchangée). Une erreur de classement (le retour terrain le
plus fréquent : pièces mélangées entre dossiers) devient réversible sans jamais ré-uploader.

**Invariants de cohérence entre rattachements**, portés en Server Action
(`validerCoherenceRattachementsDocument`, pas en `CHECK` SQL — comparaisons inter-tables) :
un `compromisId` doit appartenir au `bienId` du document, un `acquereurId` doit correspondre à
l'acquéreur du compromis rattaché, un `prospectVendeurId` doit être le vendeur ayant réellement
converti ce bien. Des FK valides séparément ne suffisent jamais.

**Deux vocabulaires d'état distincts, jamais confondus** : `etatVerification` (colonne, jugement du
conseiller sur le classement d'un document précis — `non_verifie`/`confirme`/`a_verifier`/
`rejete`) et l'état de contrôle d'une exigence de checklist (dérivé uniquement —
`present`/`manquant`/`a_verifier`/`non_applicable`/`perime`/`incoherent`). `incoherent` ne dérive
que d'un `etatVerification = 'rejete'` explicitement posé par le conseiller — jamais une déduction
automatique (aucun OCR, aucun LLM dans cette passe).

**Charge des honoraires portée par `biens`, pas `compromis`.** Nouveau champ
`biens.chargeHonoraires` (`vendeur`/`acquereur`, V1 volontairement binaire — pas de `partagee` sans
modéliser une vraie répartition) : condition du mandat, connue avant toute offre/tout compromis,
jamais dupliquée entre bien et compromis. Distinct de
`remuneration.montantRemunerationConseillerCentimes` (ADR-021, part du conseiller) — deux faits
jamais confondus.

**Vocabulaire `typeDocument` fermé mais non exhaustif juridiquement** (`TYPES_DOCUMENT`, 28
valeurs réparties en 8 familles — parties/bien/diagnostics/copropriete/transaction/financement/
notaire/autre), décorrélé de `categorie` (existante, inchangée). PV d'assemblée générale : jamais
un booléen, plusieurs documents `pv_ag` datés, "3 derniers présents" dérivé au calcul
(`checklistDossier.ts`). Diagnostics : présence ≠ validité, `dateFinValidite` purement déclarative,
aucune durée légale codée depuis la mémoire.

**Pas de nouvelle entité `dossier_vente`, pas d'entité `copropriete` dédiée.** Le "dossier" est une
vue composée dérivée de `bien` + le compromis pertinent + les parties liées, calculée à la lecture
(`/biens/[id]`) — aucune table supplémentaire pour lui donner une existence. `biens.nomCopropriete`
(texte déclaratif) suffit pour cette passe ; une vraie entité `copropriete` reste une évolution
future si un besoin de mutualisation entre plusieurs biens apparaît.

**Moteur de checklist déterministe et pur** (`calculerChecklistDossier`,
`src/lib/documents/checklistDossier.ts`) : contexte (bien + compromis actuel + prospect vendeur
d'origine) + règles codées + documents présents ⇒ état par exigence, jamais un score global,
jamais réimplémenté dans un composant React.

**Constats, pas de tâches.** ADR-029 produit uniquement des constats documentaires dérivés
(affichés dans le nouveau bloc "Dossier documentaire" de l'onglet Documents) — aucune tâche
générée automatiquement, aucun dual-write avec `taches` (ADR-028). La chaîne constat → règle
d'automatisation → tâche reste un futur ADR.

## 30. Pack notaire et contrôle documentaire pré-transmission

Nouveau contrôle pré-transmission (`src/lib/documents/packNotaire.ts`), entièrement dérivé — aucune
table `pack_notaire`, aucune sélection ni ZIP persistés. Consomme `calculerChecklistDossier()`
(ADR-029) tel quel, sans réimplémenter aucune règle de présence/validité documentaire.

**Quatre sévérités, aucun critère juridique bloquant inventé** : `a_obtenir` (exigence checklist
manquante — jamais `bloquant`, la checklist Atlas n'est pas juridiquement exhaustive), `a_verifier`
(validité/rapprochement incertain, y compris un diagnostic périmé — constat strictement factuel,
jamais la conclusion « transmission impossible »), `information`, `bloquant_technique` (strictement
réservé à une impossibilité sûre/factuelle : rattachement structurellement contradictoire,
classement `rejete`, fichier illisible à l'export).

**Anti-mauvais-dossier étendu au-delà des pièces d'identité** : `compromisId`/`acquereurId`/
`prospectVendeurId` d'un document comparés à `compromisActuel`/`prospectVendeurOrigine` — une
contradiction n'est démontrée (`bloquant_technique`) que si une référence existe réellement pour
comparer ; en son absence, seule une correspondance « impossible à établir » (`a_verifier`) est
signalée, jamais une exclusion.

**Sélection proposée + choix manuel éphémère, jamais persisté** : auto-sélection strictement
croisée `etatVerification = 'confirme'` **et** état checklist `present` — un document jamais
explicitement confirmé (`non_verifie`, le défaut à l'upload) n'est jamais auto-inclus. Formulaire
HTML natif (`<form method="POST">`, aucun JavaScript nécessaire), revalidation intégrale côté
serveur de chaque id soumis, aucune écriture en base à la sélection.

**Aucun export sans compromis courant** : `POST /api/biens/[id]/pack-notaire` refuse
explicitement (409) en l'absence de `compromisActuel` — l'export ZIP est indisponible, pas
seulement affiché « non prêt ». État de préparation exposé (`contexte_transactionnel_incomplet` /
`elements_bloquants` / `elements_a_traiter` / `preparation_atlas_complete`) sans jamais prétendre à
une complétude juridique ou une acceptation garantie par le notaire.

**Export ZIP atomique en mémoire** (`jszip`, nouvelle dépendance — pure JS, sans binding natif) :
taille cumulée vérifiée avant toute lecture (`MAX_TAILLE_PACK_OCTETS`, 200 Mo, contrainte technique
V1 documentée comme telle), tous les fichiers lus et validés avant tout `zip.file()` — un seul
document illisible fait échouer la génération entière, jamais un ZIP partiel. Jamais écrit sur
disque. Nom d'export (`genererNomExport`) dérivé uniquement de données structurées, ne renomme
jamais le fichier stocké (ADR-013). Manifeste texte (`Contact vendeur principal`/`Acquéreur
enregistré` — jamais « Vendeur »/« Acquéreur » seuls, prudence ADR-027) généré uniquement depuis
des faits structurés.

Aucun email, aucun OCR/LLM, aucune tâche automatique, aucune journalisation d'audit persistante.
L'absence d'authentification (ADR-006) reste une limite héritée non résolue, documentée comme
bloquante avant toute exposition à un tiers.

## 31. Emails et relances assistées

Brouillons d'email éphémères — aucune table, aucune persistance. Cinq couches strictement séparées
(intention/faits/brouillon/validation humaine/envoi).

**Résolution de destinataire depuis toute la surface des tâches**, pas seulement
prospect-vendeur/acquéreur direct : `resoudreContexteCommunicationDepuisTache` suit les FK/relations
métier déjà réelles (tâche → visite/offre/compromis → acquéreur ; tâche → bien → contact vendeur
principal + acquéreur du compromis pertinent) — jamais `titre`/`contexte` (texte libre). Zéro, un ou
plusieurs destinataires possibles ; un choix humain explicite est présenté dès qu'il y en a
plusieurs, jamais tranché arbitrairement. Un constat documentaire (checklist ADR-029) ne
présélectionne un destinataire que si le document porte lui-même un rattachement personne non
ambigu — sinon repli sur les candidats du bien, aucune correspondance type de document → personne
inventée.

**Deux couches de contenu, une seule construite** : templates déterministes (8 intentions × 4 tons,
`genererBrouillonEmail`), zéro donnée inventée, zéro contenu sensible de document intégré (seul le
nom du type de pièce est mentionné). La couche de reformulation LLM est entièrement hors périmètre
— serait la première intégration LLM réelle d'Atlas, différée à une passe dédiée.

**`mailto:` avec repli copie systématique** : seul mécanisme d'envoi V1, reconstruit à chaque rendu
depuis le texte actuellement édité par le conseiller (jamais depuis le brouillon initial), masqué
au-delà d'une longueur pratique au profit d'un bouton "Copier le message" toujours disponible —
aucun bouton "Envoyer" nulle part. Aucune interaction n'est journalisée automatiquement (`mailto:`
ne permet aucune confirmation d'envoi vérifiable côté serveur) ; aucune tâche automatique ; aucun
document joint (limitation structurelle de `mailto:`).

**Notaire : contenu seul, `biens.notaireEmail` volontairement non ajouté** — aucun contact notaire
structuré n'existe, une future modélisation devra vivre au niveau transaction/parties avec support
multi-contacts, pas un champ scalaire unique sur `biens`.

Points d'entrée : tâches (`TacheItem`, `BienTabs`, fiche prospect vendeur), constats de checklist
(onglet Documents de `BienTabs`), pack notaire (message notaire).

## 31-bis. Envoi Gmail réel avec validation humaine

Remplace la dernière étape d'ADR-031 (`mailto:`) par un vrai envoi, uniquement lorsqu'explicitement
autorisé — le moteur de contenu (destinataire/objet/corps, templates, tons) reste totalement
inchangé.

**Scope minimal, additif** : `gmail.send` seul (ni lecture, ni recherche, ni labels), demandé via
une route d'autorisation dédiée (`/api/auth/google/gmail/login`) utilisant l'autorisation
incrémentale native de Google (`include_granted_scopes=true`) plutôt qu'une union de scopes codée
en dur — Calendar et Gmail restent deux capacités indépendantes dans ce code, jamais couplées. La
route Calendar existante est inchangée. Le statut de chaque capacité (`chargerCapacitesGoogle()`)
se dérive uniquement du `scope` réellement retourné par Google, jamais d'une supposition liée à la
route appelée — affiché distinctement sur la page d'accueil (`Google Calendar : connecté` /
`Gmail : non autorisé`), jamais un statut "Google connecté" unique.

**Confirmation humaine obligatoire** : un écran dédié fige À/Objet/Corps avant tout envoi — jamais
à la génération du brouillon, au chargement de page, à une création de tâche ou à une navigation.

**Idempotence par clé cliente, pas une fenêtre de temps** : nouvelle table `envois_email`, `id`
fourni par l'appelant (généré à l'entrée de l'écran de confirmation) utilisé comme clé
d'idempotence (`INSERT ... ON CONFLICT DO NOTHING` avant tout appel Gmail) — une garde temporelle
arbitraire initialement envisagée a été retirée au profit d'un `contenuHash` (SHA-256) purement
diagnostique, jamais utilisé pour bloquer un envoi.

**`incertain` distinct d'`echec`** : une rupture réseau/timeout survenue après le déclenchement de
l'appel Gmail ne permet jamais de conclure — jamais assimilée à un échec net (qui suppose une
réponse HTTP effectivement reçue de Google), jamais un renvoi automatique, jamais une interaction
posée. Un succès n'est jamais annoncé comme "reçu" ou "délivré" — uniquement "Envoi confirmé par
Gmail" (`users.messages.send` ne renseigne pas la livraison effective).

**Sécurité de la construction MIME** : rejet strict de `\r`/`\n` dans tous les en-têtes (protection
contre l'injection d'en-têtes, objet/corps étant édités par le conseiller juste avant envoi),
encodage RFC 2047 de l'objet, base64url pour le message complet.

**Interaction ADR-027 uniquement sur succès réel confirmé** — jamais sur un résultat incertain ou
échoué. Le corps complet du message n'est jamais persisté (ni dans `envois_email`, ni dans la note
CRM, qui ne porte que l'objet). Clôture de tâche proposée explicitement après succès, jamais
automatique. Fallback `mailto:`/copie conservé dans tous les états. Aucun contact notaire ajouté.

---

Pour le détail technique de chaque étape : `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`,
`docs/BUSINESS_RULES.md`, `docs/FLOWS.md`. Pour les décisions qui ont structuré ces étapes :
`docs/adr/`.
