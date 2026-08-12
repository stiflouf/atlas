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

---

Pour le détail technique de chaque étape : `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`,
`docs/BUSINESS_RULES.md`, `docs/FLOWS.md`. Pour les décisions qui ont structuré ces étapes :
`docs/adr/`.
